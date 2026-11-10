-- Run once in Supabase SQL Editor, before enabling the new deployment.
-- Existing profiles, todos, records, admins, groups and storage are retained.
begin;
-- Administrator assignment is an operations-only action, never an end-user write.
revoke insert, update, delete on public.admins from anon, authenticated;
alter table public.groups add column if not exists kind text not null default 'group' check (kind in ('group','event'));
create table if not exists public.member_identity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id text not null unique check (member_id ~ '^[0-9]{10}$'),
  nickname text not null check (char_length(nickname) between 1 and 40),
  recovery_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.member_identity enable row level security;
-- Identity and recovery hashes are service-role-only, including membership searches.
revoke all on public.member_identity from anon, authenticated;
grant all on public.member_identity to service_role;
-- Issue numbers to existing accounts without deleting their previous login or data.
-- Empty recovery hashes are replaced with a secret shown once, on their next authenticated visit.
do $$
declare account record; issued text;
begin
  for account in select u.id, left(coalesce(nullif(p.username,''),'メンバー'),40) as nickname
    from auth.users u left join public.profiles p on p.id=u.id
    where not exists(select 1 from public.member_identity m where m.user_id=u.id)
  loop
    loop
      issued := (1000000000 + (('x'||substr(replace(gen_random_uuid()::text,'-',''),1,12))::bit(48)::bigint % 9000000000))::text;
      begin
        insert into public.member_identity(user_id,member_id,nickname,recovery_hash) values(account.id,issued,account.nickname,'');
        exit;
      exception when unique_violation then
        if exists(select 1 from public.member_identity m where m.user_id=account.id) then exit; end if;
      end;
    end loop;
  end loop;
end $$;

create table if not exists public.journal_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 1,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.journal_workspaces enable row level security;
revoke all on public.journal_workspaces from anon, authenticated;
grant select on public.journal_workspaces to authenticated;
grant all on public.journal_workspaces to service_role;
create policy journal_workspace_owner_read on public.journal_workspaces for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.save_journal_workspace(p_expected_revision integer, p_data jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare new_revision integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 2000000 then raise exception 'invalid_workspace'; end if;
  if p_expected_revision = 0 then
    insert into public.journal_workspaces(user_id, data) values (auth.uid(), p_data) on conflict do nothing returning revision into new_revision;
  else
    update public.journal_workspaces set data = p_data, revision = revision + 1, updated_at = now()
      where user_id = auth.uid() and revision = p_expected_revision returning revision into new_revision;
  end if;
  if new_revision is null then raise exception 'workspace_conflict'; end if;
  return new_revision;
end; $$;
revoke all on function public.save_journal_workspace(integer,jsonb) from public, anon;
grant execute on function public.save_journal_workspace(integer,jsonb) to authenticated;

create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  workspace_revision integer not null,
  snapshot jsonb not null,
  comment text not null default '' check (char_length(comment) <= 2000),
  submitted_at timestamptz not null default now(),
  unique(user_id, month)
);
alter table public.monthly_reports enable row level security;
revoke all on public.monthly_reports from anon, authenticated;
grant select on public.monthly_reports to authenticated;
grant all on public.monthly_reports to service_role;
create policy monthly_report_owner_read on public.monthly_reports for select to authenticated using ((select auth.uid()) = user_id);
create index if not exists monthly_reports_month_idx on public.monthly_reports(month,submitted_at);

create table if not exists public.report_replies (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.monthly_reports(id) on delete cascade,
  admin_id uuid not null references auth.users(id),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table public.report_replies enable row level security;
revoke all on public.report_replies from anon, authenticated;
grant select on public.report_replies to authenticated;
grant all on public.report_replies to service_role;
create policy report_reply_owner_read on public.report_replies for select to authenticated
  using (exists(select 1 from public.monthly_reports r where r.id = report_id and r.user_id = (select auth.uid())));
create index if not exists report_replies_report_idx on public.report_replies(report_id,created_at);

-- Durable rate limiting; never stores raw IP addresses or credentials.
create table if not exists public.member_auth_limits (bucket text primary key, hits integer not null, expires_at timestamptz not null);
alter table public.member_auth_limits enable row level security;
revoke all on public.member_auth_limits from anon, authenticated;
grant all on public.member_auth_limits to service_role;
create or replace function public.member_auth_rate_limit(p_bucket text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_limit < 1 or p_seconds < 1 or length(p_bucket) > 100 then return false; end if;
  delete from public.member_auth_limits where expires_at < now() - interval '1 hour';
  insert into public.member_auth_limits(bucket,hits,expires_at) values (p_bucket,1,now()+make_interval(secs=>p_seconds))
  on conflict(bucket) do update set hits = case when member_auth_limits.expires_at <= now() then 1 else member_auth_limits.hits+1 end,
    expires_at = case when member_auth_limits.expires_at <= now() then now()+make_interval(secs=>p_seconds) else member_auth_limits.expires_at end
  returning hits into n;
  return n <= p_limit;
end; $$;
revoke all on function public.member_auth_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.member_auth_rate_limit(text,integer,integer) to service_role;
create or replace function public.rotate_member_recovery(p_member_id text, p_old_hash text, p_new_hash text)
returns uuid language sql security definer set search_path = '' as $$
  update public.member_identity set recovery_hash=p_new_hash where member_id=p_member_id and recovery_hash=p_old_hash returning user_id;
$$;
revoke all on function public.rotate_member_recovery(text,text,text) from public,anon,authenticated;
grant execute on function public.rotate_member_recovery(text,text,text) to service_role;
commit;
