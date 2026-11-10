const test = require('node:test');
const assert = require('node:assert/strict');
const Auth = require('../api/member-auth.js');
const Report = require('../api/journal-report.js');
const Admin = require('../api/journal-admin.js');
const { hash, createServices } = require('../lib/journal-server.cjs');
const env = { SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'secret-test',AUTH_RATE_LIMIT_SECRET:'test-rate-limit-secret-at-least-32-characters' };
const uid='11111111-1111-4111-8111-111111111111';
test('modern Supabase app keys use apikey while authenticated requests retain the user token',async()=>{
 const calls=[];const modern={...env,SUPABASE_ANON_KEY:'sb_publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture'};
 const service=createServices({env:modern,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/auth/v1/user')?{id:uid}:[]};}});
 await service.rest('member_identity');assert.equal(calls[0].options.headers.apikey,'sb_secret_fixture');assert.equal(calls[0].options.headers.Authorization,undefined);
 await service.request('/auth/v1/token?grant_type=password',{method:'POST',key:modern.SUPABASE_ANON_KEY,token:modern.SUPABASE_ANON_KEY,body:{}});assert.equal(calls[1].options.headers.apikey,'sb_publishable_fixture');assert.equal(calls[1].options.headers.Authorization,undefined);
 assert.equal((await service.actor({headers:{authorization:'Bearer real-user-jwt'}})).id,uid);assert.equal(calls[2].options.headers.apikey,'sb_publishable_fixture');assert.equal(calls[2].options.headers.Authorization,'Bearer real-user-jwt');
});
test('legacy Supabase JWT keys preserve their existing Authorization header',async()=>{
 let headers;const service=createServices({env,fetchImpl:async(url,options)=>{headers=options.headers;return {ok:true,json:async()=>[]};}});await service.rest('profiles');assert.equal(headers.apikey,env.SUPABASE_SERVICE_ROLE_KEY);assert.equal(headers.Authorization,'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY);
});
function setup(module, route) {
  const calls=[];
  const fetchImpl=async(url,options)=>{const body=options.body?JSON.parse(options.body):undefined;calls.push({url,options,body});const r=await route(url,options,body);if(r===undefined)throw Error('Unexpected upstream call: '+url);return {ok:(r.status||200)<400,status:r.status||200,json:async()=>r.data};};
  const handler=module.createHandler({env,fetchImpl});
  async function run(body,extras={}) {const req={method:'POST',url:'/api/test',headers:{host:'app.test',origin:'https://app.test','content-type':'application/json',authorization:'Bearer user-token',...extras.headers},socket:{remoteAddress:'127.0.0.1'},body,...extras};const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(x){this.body=x;return this;}};await handler(req,res);return res;}
  return {run,calls};
}
test('signup uses a server-generated number and non-deliverable alias; no personal email',async()=>{
  const t=setup(Auth,(url,opt,body)=>{
    if(url.includes('member_auth_rate_limit'))return {data:true};
    if(url.endsWith('/admin/users')){assert.match(body.email,/^m\d{10}@members\.invalid$/);assert.equal(body.email_confirm,true);return {data:{id:uid}};}
    if(url.includes('/member_identity')){assert.equal(body.nickname,'こはる');assert.match(body.recovery_hash,/^[a-f0-9]{64}$/);return {status:201,data:null};}
    if(url.includes('/profiles')){assert.equal(body.username,'こはる');return {status:201,data:null};}
  });
  const res=await t.run({action:'signup',nickname:'こはる',password:'a-very-long-password'});
  assert.equal(res.code,201);assert.match(res.body.member_id,/^\d{10}$/);assert.match(res.body.recovery_code,/^[a-f0-9]{48}$/);assert.equal(res.body.email,undefined);
});
test('weak passwords and cross-origin mutations are rejected before upstream calls',async()=>{
  const t=setup(Auth,()=>undefined);
  assert.equal((await t.run({action:'signup',nickname:'test',password:'short'})).code,400);
  assert.equal((await t.run({action:'signup'},{headers:{host:'app.test',origin:'https://evil.test','content-type':'application/json'}})).code,403);
  assert.equal(t.calls.length,0);
});
test('member number alone never authenticates; failed logins have generic errors',async()=>{
  const t=setup(Auth,url=>url.includes('rate_limit')?{data:true}:url.includes('member_identity')?{data:[]}:undefined);
  const missing=await t.run({action:'login',member_id:'1234567890'});assert.equal(missing.code,401);
  const noUser=await t.run({action:'login',member_id:'1234567890',password:'unknown'});assert.equal(noUser.code,401);assert.equal(missing.body.error,noUser.body.error);
});
test('identity responses never expose stored recovery hashes',async()=>{
  const t=setup(Auth,url=>url.endsWith('/auth/v1/user')?{data:{id:uid}}:url.includes('member_identity')?{data:[{member_id:'1234567890',nickname:'こはる',recovery_hash:'private-hash'}]}:undefined);
  const r=await t.run({action:'identity'});assert.deepEqual(r.body,{member_id:'1234567890',nickname:'こはる'});
});
test('recovery consumes and rotates the code atomically; a replay cannot reset the password',async()=>{
  const code='a'.repeat(48);let stored=hash(code),updates=0;
  const t=setup(Auth,(url,opt,body)=>{
    if(url.includes('rate_limit'))return {data:true};
    if(url.includes('rotate_member_recovery')){if(stored!==body.p_old_hash)return {data:null};stored=body.p_new_hash;return {data:uid};}
    if(url.includes('/admin/users/')){updates++;return {data:{id:uid}};}
  });
  const r=await t.run({action:'recover',member_id:'1234567890',recovery_code:code,password:'a-very-long-password'});assert.equal(r.code,200);assert.notEqual(r.body.recovery_code,code);
  assert.equal((await t.run({action:'recover',member_id:'1234567890',recovery_code:code,password:'another-long-password'})).code,401);assert.equal(updates,1);
});
test('unauthorized clients cannot read the admin directory',async()=>{
  const t=setup(Admin,url=>url.endsWith('/auth/v1/user')?{data:{id:uid}}:url.includes('/admins')?{data:[]}:undefined);
  const r=await t.run(undefined,{method:'GET',url:'/api/journal-admin?month=2026-10'});assert.equal(r.code,403);assert.equal(t.calls.some(c=>c.url.includes('member_identity')),false);
});
test('report snapshots are calculated from stored data, never trusted from client percentages',async()=>{
  const workspace={items:[{id:'habit',name:'腹筋',type:'binary'}],daily:{'2026-10-01':{habit:true}},months:{'2026-10':{targets:{habit:10},actuals:{habit:5}}}};
  const t=setup(Report,(url,opt,body)=>{
    if(url.endsWith('/auth/v1/user'))return {data:{id:uid}};
    if(url.includes('journal_workspaces'))return {data:[{revision:3,data:workspace}]};
    if(url.includes('monthly_reports')){assert.equal(body.snapshot[0].percentage,50);assert.equal(body.user_id,uid);return {data:[{id:uid,...body}]};}
  });
  const r=await t.run({month:'2026-10',revision:3,snapshot:[{percentage:999}],user_id:'someone-else'});assert.equal(r.code,200);
  const conflict=await t.run({month:'2026-10',revision:2});assert.equal(conflict.code,409);
});
test('rate-limit denial blocks account creation',async()=>{const t=setup(Auth,url=>url.includes('rate_limit')?{data:false}:undefined);assert.equal((await t.run({action:'signup',nickname:'こはる',password:'a-very-long-password'})).code,429);assert.equal(t.calls.length,1);});
