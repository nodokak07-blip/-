const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('both migrations preserve existing accounts, profiles, habits, health, journals, group and photo history byte-for-byte',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,encrypted_password text);
 create table profiles(id uuid primary key,username text,selected_habits jsonb,height numeric,weight numeric);
 create table admins(user_id uuid primary key);create table groups(id uuid primary key,name text);
 create table group_members(group_id uuid,user_id uuid,status text);
 create table todos(user_id uuid,date date,habit text,done boolean);
 create table records(user_id uuid,date date,weight numeric,mood text,stress integer,memo text);
 create table journals(user_id uuid,date date,content text);
 create table group_reports(id integer,group_id uuid,user_id uuid,content text);
 create table posts(id integer,user_id uuid,image_url text,caption text,expires_at timestamptz);
 create table likes(post_id integer,user_id uuid);create table comments(post_id integer,user_id uuid,content text);
 create schema storage;create table storage.objects(id integer,bucket_id text,name text);
 insert into auth.users values('11111111-1111-4111-8111-111111111111','fixture@example.invalid','unchanged-fixture-hash');
 insert into profiles select id,'こはる','["散歩","ストレッチ"]',160,61.2 from auth.users;
 insert into admins select id from auth.users;
 insert into groups values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','朝のおさんぽ');
 insert into group_members select g.id,u.id,'accepted' from groups g,auth.users u;
 insert into todos select id,'2026-10-01','散歩',true from auth.users;
 insert into todos select id,'2026-10-02','散歩',false from auth.users;
 insert into records select id,'2026-10-01',61.2,'ふつう',3,'以前の体調メモ' from auth.users;
 insert into journals select id,'2026-10-01','以前の自分の言葉' from auth.users;
 insert into group_reports select 1,g.id,u.id,'以前のグループ報告' from groups g,auth.users u;
 insert into posts select 1,id,'https://example.invalid/existing.jpg','以前の写真','2026-12-01T00:00:00Z' from auth.users;
 insert into likes select 1,id from auth.users;insert into comments select 1,id,'以前のコメント' from auth.users;
 insert into storage.objects values(1,'posts','existing.jpg');`);
 const tables={'auth.users':'id,email,encrypted_password',profiles:'id,username,selected_habits,height,weight',admins:'user_id',groups:'id,name',group_members:'group_id,user_id,status',todos:'user_id,date,habit,done',records:'user_id,date,weight,mood,stress,memo',journals:'user_id,date,content',group_reports:'*',posts:'*',likes:'*',comments:'*','storage.objects':'*'};
 async function snapshot(){const result={};for(const [table,columns] of Object.entries(tables))result[table]=(await db.query(`select ${columns} from ${table}`)).rows;return result;}
 const before=await snapshot();
 for(const file of ['202611090001_journal_v2.sql','202611100001_journey.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 assert.deepEqual(await snapshot(),before);
 assert.equal((await db.query('select count(*) n from member_identity')).rows[0].n,1);
 assert.equal((await db.query('select count(*) n from journal_workspaces')).rows[0].n,0,'SQL does not replace existing records with default workspaces');
 }finally{await db.close();}
});
