-- Read-only baseline. Run BEFORE migration and again AFTER migration.
-- This checks counts/schema only; it does not back up actual records or storage files.
begin transaction read only;
select 'auth.users' as source, count(*) as rows from auth.users
union all select 'profiles',count(*) from public.profiles
union all select 'todos',count(*) from public.todos
union all select 'records',count(*) from public.records
union all select 'journals',count(*) from public.journals
union all select 'admins',count(*) from public.admins
union all select 'groups',count(*) from public.groups
union all select 'group_members',count(*) from public.group_members
union all select 'group_reports',count(*) from public.group_reports
union all select 'posts',count(*) from public.posts
union all select 'likes',count(*) from public.likes
union all select 'comments',count(*) from public.comments
union all select 'storage.objects',count(*) from storage.objects;
select table_name,column_name,data_type,udt_name from information_schema.columns
where table_schema='public' and table_name in ('profiles','groups','group_members','admins')
order by table_name,ordinal_position;
select status,count(*) as members from public.group_members group by status;
select to_regclass('public.member_identity') as member_identity,
       to_regclass('public.journal_workspaces') as journal_workspaces,
       to_regclass('public.journey_posts') as journey_posts;
commit;
