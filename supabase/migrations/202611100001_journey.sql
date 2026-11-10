-- Apply after 202611090001_journal_v2.sql. Existing health records are retained.
begin;
create table public.journey_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default (now() at time zone 'Asia/Tokyo')::date,
  choice text not null default '' check (choice in ('','step','pace','rest','connect')),
  note text not null default '' check (char_length(note)<=160),
  audience text not null default 'self' check (audience in ('self','counselor','group')),
  group_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,day),
  check (choice<>'' or length(trim(note))>0),
  check ((audience='group' and group_ref is not null) or (audience<>'group' and group_ref is null))
);
create table public.journey_reactions (
  post_id uuid not null references public.journey_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('step','rest','same','together')),
  created_at timestamptz not null default now(),
  primary key(post_id,user_id,kind)
);
create table public.journey_comments (
  id uuid primary key,
  post_id uuid not null references public.journey_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 400),
  created_at timestamptz not null default now()
);
create index journey_posts_group on public.journey_posts(group_ref,day desc);
create index journey_comments_post on public.journey_comments(post_id,created_at desc);
create function public.journey_scope_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.audience is distinct from new.audience or old.group_ref is distinct from new.group_ref then
    delete from public.journey_reactions where post_id=old.id;
    delete from public.journey_comments where post_id=old.id;
  end if;
  return new;
end; $$;
revoke all on function public.journey_scope_changed() from public,anon,authenticated;
create trigger journey_scope_changed before update on public.journey_posts for each row execute function public.journey_scope_changed();
alter table public.journey_posts enable row level security;
alter table public.journey_reactions enable row level security;
alter table public.journey_comments enable row level security;
-- All reads and writes go through the authenticated RPC, including nickname projection.
revoke all on public.journey_posts,public.journey_reactions,public.journey_comments from public,anon,authenticated;
grant all on public.journey_posts,public.journey_reactions,public.journey_comments to service_role;

create function public.journey_visible(p public.journey_posts, actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select actor is not null and (
    p.user_id=actor or
    (p.audience='counselor' and exists(select 1 from public.admins a where a.user_id=actor)) or
    (p.audience='group' and exists(select 1 from public.groups g where g.id::text=p.group_ref) and
      (exists(select 1 from public.group_members m where m.group_id::text=p.group_ref and m.user_id=actor and m.status='accepted')
       or exists(select 1 from public.admins a where a.user_id=actor)))
  );
$$;
revoke all on function public.journey_visible(public.journey_posts,uuid) from public,anon,authenticated;

create function public.journal_journey(p_action text default 'feed', p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid(); post public.journey_posts; result jsonb;
  scope text; grp text; selected text; note text; cid uuid; v_kind text; enabled boolean;
begin
  if actor is null then raise exception 'journey_auth_required'; end if;
  if not exists(select 1 from public.member_identity where user_id=actor) then raise exception 'journey_identity_required'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8000 then raise exception 'journey_invalid_input'; end if;
  if p_action='save' then
    scope:=coalesce(p_payload->>'audience','self'); grp:=nullif(p_payload->>'group_ref','');
    selected:=coalesce(p_payload->>'choice',''); note:=trim(coalesce(p_payload->>'note',''));
    if scope not in ('self','counselor','group') or selected not in ('','step','pace','rest','connect') or char_length(note)>160 or (selected='' and note='') then raise exception 'journey_invalid_input'; end if;
    if scope='group' then
      if not exists(select 1 from public.group_members m join public.groups g on g.id=m.group_id where m.user_id=actor and m.status='accepted' and g.id::text=grp) then raise exception 'journey_group_forbidden'; end if;
    else grp:=null; end if;
    insert into public.journey_posts(user_id,choice,note,audience,group_ref)
      values(actor,selected,note,scope,grp)
      on conflict(user_id,day) do update set choice=excluded.choice,note=excluded.note,audience=excluded.audience,group_ref=excluded.group_ref,updated_at=now()
      returning * into post;
    return jsonb_build_object('id',post.id);
  elsif p_action in ('react','comment','delete','delete_comment') then
    select * into post from public.journey_posts where id=(p_payload->>'post_id')::uuid for update;
    if post.id is null or not public.journey_visible(post,actor) then raise exception 'journey_forbidden'; end if;
    if p_action='delete' then
      if post.user_id<>actor then raise exception 'journey_forbidden'; end if;
      delete from public.journey_posts where id=post.id;
    elsif p_action='react' then
      if post.user_id=actor or post.audience='self' then raise exception 'journey_forbidden'; end if;
      v_kind:=p_payload->>'kind'; enabled:=(p_payload->>'enabled')::boolean;
      if v_kind is null or v_kind not in ('step','rest','same','together') or enabled is null then raise exception 'journey_invalid_input'; end if;
      if enabled then insert into public.journey_reactions(post_id,user_id,kind) values(post.id,actor,v_kind) on conflict do nothing;
      else delete from public.journey_reactions where post_id=post.id and user_id=actor and journey_reactions.kind=v_kind; end if;
    elsif p_action='comment' then
      note:=trim(coalesce(p_payload->>'content','')); cid:=(p_payload->>'id')::uuid;
      if post.audience='self' or note='' or char_length(note)>400 or cid is null then raise exception 'journey_invalid_input'; end if;
      insert into public.journey_comments(id,post_id,user_id,content) values(cid,post.id,actor,note) on conflict(id) do nothing;
    else
      delete from public.journey_comments c where c.id=(p_payload->>'id')::uuid and c.post_id=post.id
        and (c.user_id=actor or post.user_id=actor or exists(select 1 from public.admins a where a.user_id=actor));
    end if;
    return jsonb_build_object('ok',true);
  elsif p_action<>'feed' then raise exception 'journey_invalid_action'; end if;

  select jsonb_build_object(
    'today',(now() at time zone 'Asia/Tokyo')::date,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id::text,'name',g.name) order by g.name)
      from public.groups g where exists(select 1 from public.group_members m where m.group_id=g.id and m.user_id=actor and m.status='accepted')),'[]'::jsonb),
    'posts',coalesce((select jsonb_agg(item order by day desc,created_at desc) from (
      select p.day,p.created_at,jsonb_build_object('id',p.id,'own',p.user_id=actor,'day',p.day,'choice',p.choice,'note',p.note,'audience',p.audience,'group_ref',p.group_ref,
        'group_name',(select g.name from public.groups g where g.id::text=p.group_ref),
        'nickname',case when exists(select 1 from public.admins a where a.user_id=p.user_id) then 'カウンセラー' else coalesce((select m.nickname from public.member_identity m where m.user_id=p.user_id),'メンバー') end,
        'reactions',coalesce((select jsonb_agg(jsonb_build_object('kind',r.kind,'count',r.n,'mine',r.mine)) from
          (select r.kind,count(*) n,bool_or(r.user_id=actor) mine from public.journey_reactions r where r.post_id=p.id group by r.kind) r),'[]'::jsonb),
        'comments',coalesce((select jsonb_agg(c.item order by c.created_at) from (
          select c.created_at,jsonb_build_object('id',c.id,'content',c.content,'created_at',c.created_at,'can_delete',c.user_id=actor or p.user_id=actor or exists(select 1 from public.admins a where a.user_id=actor),
            'nickname',case when exists(select 1 from public.admins a where a.user_id=c.user_id) then 'カウンセラー' else coalesce((select m.nickname from public.member_identity m where m.user_id=c.user_id),'メンバー') end) item
          from public.journey_comments c where c.post_id=p.id order by c.created_at desc limit 20) c),'[]'::jsonb)) item
      from public.journey_posts p where public.journey_visible(p,actor) and p.user_id<>actor order by p.day desc,p.created_at desc limit 50
    ) visible),'[]'::jsonb),
    'mine',coalesce((select jsonb_agg(item order by day desc) from (
      select p.day,jsonb_build_object('id',p.id,'own',true,'day',p.day,'choice',p.choice,'note',p.note,'audience',p.audience,'group_ref',p.group_ref,
        'group_name',(select g.name from public.groups g where g.id::text=p.group_ref),
        'reactions',coalesce((select jsonb_agg(jsonb_build_object('kind',r.kind,'count',r.n,'mine',false)) from
          (select r.kind,count(*) n from public.journey_reactions r where r.post_id=p.id group by r.kind) r),'[]'::jsonb)) item
      from public.journey_posts p where p.user_id=actor order by p.day desc limit 50) own_posts),'[]'::jsonb),
    'words',coalesce((select jsonb_agg(c.item order by c.created_at desc) from (
      select c.created_at,jsonb_build_object('id',c.id,'post_id',p.id,'choice',p.choice,'day',p.day,'content',c.content,'created_at',c.created_at,
        'nickname',case when exists(select 1 from public.admins a where a.user_id=c.user_id) then 'カウンセラー' else coalesce((select m.nickname from public.member_identity m where m.user_id=c.user_id),'メンバー') end) item
      from public.journey_comments c join public.journey_posts p on p.id=c.post_id where p.user_id=actor and c.user_id<>actor order by c.created_at desc limit 100) c),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.journal_journey(text,jsonb) from public,anon;
grant execute on function public.journal_journey(text,jsonb) to authenticated;
commit;
