const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const base = path.join(__dirname,'..');
const html = fs.readFileSync(path.join(base,'index.html'),'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const userId='11111111-1111-4111-8111-111111111111';
async function open({loggedIn=false,admin=false}={}) {
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>{if(!error.message.includes('Not implemented: window.scrollTo'))errors.push(error);});
  const dom=new JSDOM(html,{url:'https://app.test/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;let current=loggedIn?{id:userId}:null,listener,remote=null,rev=0;
  w.scrollTo=()=>{};w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});w.alert=()=>{};w.confirm=()=>true;w.prompt=()=>null;
  if(w.HTMLDialogElement){w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};}
  function query(table){const result={data:null,error:null},filters={};const q={select(){return q;},eq(key,value){filters[key]=value;return q;},order(){return q;},limit(){return q;},in(){return q;},upsert(){return Promise.resolve({data:null,error:null});},single(){return execute();},maybeSingle(){return execute();},then(a,b){return execute().then(a,b);}};
    function execute(){if(table==='journal_workspaces')result.data=remote?{data:JSON.parse(JSON.stringify(remote)),revision:rev}:null;else if(table==='profiles')result.data={id:current?.id,username:'こはる',selected_habits:[]};else if(table==='admins')result.data=admin?{user_id:current?.id}:null;else result.data=[];return Promise.resolve(result);}return q;}
  const client={auth:{async startAutoRefresh(){},async getSession(){return {data:{session:current?{user:current,access_token:'token'}:null},error:null};},onAuthStateChange(cb){listener=cb;},async setSession(){return {error:null};},async signOut(){current=null;listener?.('SIGNED_OUT',null);}},from:query,async rpc(name,body){if(name==='save_journal_workspace'){if(body.p_expected_revision!==rev)return {data:null,error:{message:'workspace_conflict'}};remote=JSON.parse(JSON.stringify(body.p_data));rev++;return {data:rev,error:null};}return {data:null,error:null};}};
  w.supabase={createClient:()=>client};
  w.fetch=async(url,opts)=>{const body=opts?.body?JSON.parse(opts.body):null;if(url==='/api/member-auth')return {ok:true,json:async()=>({member_id:'1234567890',nickname:current?.id===userId?'こはる':'別メンバー'})};if(String(url).startsWith('/api/journal-admin'))return {ok:true,json:async()=>({members:[],next_offset:null})};if(url==='/api/journal-report')return {ok:true,json:async()=>({report:{id:'report',month:body.month}})};return {ok:true,json:async()=>({})};};
  const context=dom.getInternalVMContext();vm.runInContext(inline,context);vm.runInContext(fs.readFileSync(path.join(base,'assets/journal-model.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(base,'assets/journal-v2.js'),'utf8'),context);
  await tick();await tick();await tick();
  return {dom,w,errors,getRemote:()=>remote,getRevision:()=>rev,async switchUser(id){current={id};remote=null;rev=0;w.eval('currentUser = '+JSON.stringify(current));w.updateAuthUI();await tick();await tick();},async logout(){await client.auth.signOut();await tick();await tick();}};
}
function change(w,node,value){assert.ok(node);node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}));node.dispatchEvent(new w.Event('change',{bubbles:true}));}
function click(w,selector){const node=w.document.querySelector(selector);assert.ok(node,selector);node.click();}
function submit(w,id){const form=w.document.getElementById(id);assert.ok(form);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
test('guest UI starts without email inputs and records explicit did-not-do as one droplet',async()=>{
  const app=await open();const {w}=app;try{
    assert.equal(w.document.querySelectorAll('input[type=email]').length,0);assert.equal(w.document.querySelector('.page.active').id,'page-v2-home');
    click(w,'[data-action=item][data-index="2"]');click(w,'[data-action=pick][data-value=false]');click(w,'[data-action=save-day]');await tick();await tick();
    assert.equal(w.document.querySelector('.big-drop strong').textContent,'1');
    const data=JSON.parse(w.localStorage.getItem('bloom-journal-v2:guest'));assert.equal(Object.values(data.workspace.daily)[0].stretch,false);
    assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
  }finally{app.dom.window.close();}
});
test('logged-in goal, daily input and monthly bulk override survive online sync',async()=>{
  const app=await open({loggedIn:true});const {w}=app;try{
    assert.match(w.document.getElementById('nav-name').textContent,/こはる/);
    w.showPage('page-goal');const targets=w.document.querySelectorAll('[data-target]');assert.equal(targets.length,4);targets.forEach(node=>change(w,node,'10'));
    // Changing a recording method must not discard other typed targets.
    change(w,w.document.querySelector('[data-config-type="0"]'),'sum');
    assert.equal(w.document.querySelector('[data-target=stretch]').value,'10');
    submit(w,'v2-settings-form');await tick();await tick();
    assert.equal(w.document.querySelector('.page.active').id,'page-v2-report');assert.equal(app.getRemote().months[Object.keys(app.getRemote().months)[0]].targets.stretch,10);
    w.showPage('page-todo');click(w,'[data-action=item][data-index="2"]');click(w,'[data-action=pick][data-value=true]');click(w,'[data-action=save-day]');await tick();await tick();
    w.showPage('page-summary');change(w,w.document.querySelector('[data-input=bulk][data-item=stretch]'),'5');assert.equal(w.document.querySelector('[data-pct=stretch]').textContent,'50%');submit(w,'v2-bulk-form');await tick();await tick();
    assert.match(w.document.querySelector('#page-v2-report').textContent,/50%/);const remote=app.getRemote(),config=remote.months[Object.keys(remote.months)[0]];assert.equal(config.actuals.stretch,5);
    assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
  }finally{app.dom.window.close();}
});
test('switching accounts and logging out never reuse a previous account workspace',async()=>{
  const app=await open({loggedIn:true});const {w}=app;try{
    click(w,'[data-action=item][data-index="2"]');click(w,'[data-action=pick][data-value=true]');click(w,'[data-action=save-day]');await tick();await tick();
    assert.equal(w.document.querySelector('.big-drop strong').textContent,'1');
    w.showPage('page-record');await app.switchUser('22222222-2222-4222-8222-222222222222');assert.equal(w.document.querySelector('.page.active').id,'page-v2-home');assert.equal(w.document.querySelector('.big-drop strong').textContent,'0');
    await app.logout();assert.equal(w.document.querySelector('.big-drop strong').textContent,'0');
    assert.ok(w.localStorage.getItem('bloom-journal-v2:'+userId));assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
  }finally{app.dom.window.close();}
});
test('admin navigation preserves existing announcement, groups, requests and story controls',async()=>{
  const app=await open({loggedIn:true,admin:true});const {w}=app;try{
    w.showPage('page-admin');await tick();assert.equal(w.document.querySelectorAll('[data-action=admin-tab]').length,5);
    click(w,'[data-action=admin-tab][data-tab=notices]');assert.equal(w.document.getElementById('admin-announcement-text').closest('[data-admin-panel]').hidden,false);
    click(w,'[data-action=admin-tab][data-tab=groups]');assert.equal(w.document.getElementById('admin-group-form').closest('[data-admin-panel]').hidden,false);
    click(w,'[data-action=admin-tab][data-tab=story]');assert.equal(w.document.getElementById('admin-story-template-input').closest('[data-admin-panel]').hidden,false);
    assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
  }finally{app.dom.window.close();}
});
test('app-authored UI has no emoji literals and inline script parses after migration',()=>{
  assert.equal(/\p{Extended_Pictographic}/u.test(html),false);assert.doesNotThrow(()=>new Function(inline));
});
