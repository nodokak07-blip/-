const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
test('real PostgreSQL migration: identity privacy, owner isolation, CAS writes and single-use recovery',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key,username text);
      create table public.admins(user_id uuid primary key);
      create table public.groups(id uuid primary key);
      insert into auth.users values('${a}'),('${b}');
      insert into public.profiles values('${a}','こはる'),('${b}','そら');
      grant select,insert,update,delete on public.admins to authenticated;`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611090001_journal_v2.sql'),'utf8'));
    const identities=await db.query('select member_id,nickname,recovery_hash from member_identity order by nickname');
    assert.equal(identities.rows.length,2);identities.rows.forEach(row=>{assert.match(row.member_id,/^\d{10}$/);assert.equal(row.recovery_hash,'');});
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);`);
    await assert.rejects(db.query('select * from member_identity'),/permission denied/);
    await assert.rejects(db.query(`insert into admins values('${a}')`),/permission denied/);
    const first=await db.query('select save_journal_workspace(0,$1::jsonb) as revision',[JSON.stringify({items:[],daily:{},months:{}})]);assert.equal(first.rows[0].revision,1);
    await assert.rejects(db.query(`update journal_workspaces set revision=99 where user_id='${a}'`),/permission denied/);
    await db.query('select save_journal_workspace(1,$1::jsonb)',[JSON.stringify({items:[],daily:{},months:{}})]);
    await assert.rejects(db.query('select save_journal_workspace(1,$1::jsonb)',[JSON.stringify({})]),/workspace_conflict/);
    await db.exec(`select set_config('request.jwt.claim.sub','${b}',false);`);
    assert.equal((await db.query('select * from journal_workspaces')).rows.length,0);
    await db.exec('reset role');
    const report=await db.query(`insert into monthly_reports(user_id,month,workspace_revision,snapshot) values('${a}','2026-10',2,'[]') returning id`);
    await db.query(`insert into report_replies(report_id,admin_id,content) values($1,'${b}','応援しています')`,[report.rows[0].id]);
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${b}',false);`);
    assert.equal((await db.query('select * from monthly_reports')).rows.length,0);assert.equal((await db.query('select * from report_replies')).rows.length,0);
    await assert.rejects(db.query(`insert into monthly_reports(user_id,month,workspace_revision,snapshot) values('${b}','2026-10',1,'[]')`),/permission denied/);
    await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);`);
    assert.equal((await db.query('select * from monthly_reports')).rows.length,1);assert.equal((await db.query('select * from report_replies')).rows.length,1);
    await assert.rejects(db.query("select rotate_member_recovery('1234567890','','secret')"),/permission denied/);
    await db.exec('reset role;set role service_role');
    const id=identities.rows[0].member_id;
    assert.ok((await db.query('select rotate_member_recovery($1,$2,$3) as uid',[id,'','new-hash'])).rows[0].uid);
    assert.equal((await db.query('select rotate_member_recovery($1,$2,$3) as uid',[id,'','replayed'])).rows[0].uid,null);
    for(let i=1;i<=3;i++){const r=await db.query("select member_auth_rate_limit('test-bucket',2,900) as allowed");assert.equal(r.rows[0].allowed,i<=2);}
    await db.exec('reset role;set role anon');
    await assert.rejects(db.query('select * from journal_workspaces'),/permission denied/);
  }finally{await db.close();}
});
