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
async function open({loggedIn=false,admin=false,preview=false,legacy=null}={}) {
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>{if(!error.message.includes('Not implemented: window.scrollTo'))errors.push(error);});
  const dom=new JSDOM(html,{url:'https://app.test/'+(preview?'?demo=1':''),runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;let current=loggedIn?{id:userId}:null,listener,remote=null,rev=0;
  for(const [key,value] of Object.entries(legacy?.local||{}))w.localStorage.setItem(key,JSON.stringify(value));
  w.scrollTo=()=>{};w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});w.alert=()=>{};w.confirm=()=>true;w.prompt=()=>null;
  if(w.HTMLDialogElement){w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};}
  function query(table){const result={data:null,error:null},filters={};const q={select(){return q;},eq(key,value){filters[key]=value;return q;},gt(){return q;},order(){return q;},limit(){return q;},in(){return q;},upsert(){return Promise.resolve({data:null,error:null});},single(){return execute();},maybeSingle(){return execute();},then(a,b){return execute().then(a,b);}};
    function execute(){if(table==='journal_workspaces')result.data=remote?{data:JSON.parse(JSON.stringify(remote)),revision:rev}:null;else if(table==='profiles')result.data=legacy?.profile||{id:current?.id,username:'こはる',selected_habits:[]};else if(table==='admins')result.data=admin?{user_id:current?.id}:null;else result.data=legacy?.[table]||[];return Promise.resolve(result);}return q;}
  const client={auth:{async startAutoRefresh(){},async getSession(){return {data:{session:current?{user:current,access_token:'token'}:null},error:null};},onAuthStateChange(cb){listener=cb;},async setSession(){return {error:null};},async signOut(){current=null;listener?.('SIGNED_OUT',null);}},from:query,async rpc(name,body){if(name==='save_journal_workspace'){if(body.p_expected_revision!==rev)return {data:null,error:{message:'workspace_conflict'}};remote=JSON.parse(JSON.stringify(body.p_data));rev++;return {data:rev,error:null};}return {data:null,error:null};}};
  w.supabase={createClient:()=>client};
  let journeyMine=[],journeyFailure=false;const journeyCalls=[];
  const originalRpc=client.rpc;
  client.rpc=async(name,body)=>{
    if(name!=='journal_journey')return originalRpc(name,body);
    journeyCalls.push(JSON.parse(JSON.stringify(body)));
    if(journeyFailure)return {error:{message:'network unavailable'},data:null};
    const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(body.p_action==='save'){journeyMine=[{id:'post-own',own:true,day,...body.p_payload,reactions:[]}];return {data:{id:'post-own'},error:null};}
    return {data:{today:day,mine:journeyMine,groups:[{id:'group-one',name:'朝のおさんぽ'}],posts:[{id:'post-peer',day,nickname:'こはる',group_name:'朝のおさんぽ',choice:'step',note:'',reactions:[],comments:[]}],words:[{id:'comment-one',post_id:'post-own',choice:'rest',day,content:'休むのも一歩ですね。',nickname:'カウンセラー',created_at:day}]},error:null};
  };
  const reportRequests=[];let reportFailure=false;
  w.fetch=async(url,opts)=>{const body=opts?.body?JSON.parse(opts.body):null;if(url==='/api/member-auth')return {ok:true,json:async()=>({member_id:'1234567890',nickname:current?.id===userId?'こはる':'別メンバー'})};if(String(url).startsWith('/api/journal-admin'))return {ok:true,json:async()=>({members:[],next_offset:null})};if(url==='/api/journal-report'){reportRequests.push(body);return reportFailure?{ok:false,json:async()=>({error:'報告に接続できませんでした。'})}:{ok:true,json:async()=>({report:{id:'report',month:body.month}})};}return {ok:true,json:async()=>({})};};
  const context=dom.getInternalVMContext();vm.runInContext(inline,context);vm.runInContext(fs.readFileSync(path.join(base,'assets/journal-model.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(base,'assets/journal-v2.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(base,'assets/journey.js'),'utf8'),context);
  await tick();await tick();await tick();
  return {dom,w,errors,journeyCalls,reportRequests,setReportFailure:v=>{reportFailure=v;},setJourneyFailure:v=>{journeyFailure=v;},getRemote:()=>remote,getRevision:()=>rev,async switchUser(id){current={id};remote=null;rev=0;w.eval('currentUser = '+JSON.stringify(current));w.updateAuthUI();await tick();await tick();},async logout(){await client.auth.signOut();await tick();await tick();}};
}
function change(w,node,value){assert.ok(node);node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}));node.dispatchEvent(new w.Event('change',{bubbles:true}));}
function click(w,selector){const node=w.document.querySelector(selector);assert.ok(node,selector);node.click();}
function submit(w,id){const form=w.document.getElementById(id);assert.ok(form);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
test('guest UI starts without email inputs and records explicit did-not-do as one droplet',async()=>{
  const app=await open();const {w}=app;try{
    assert.equal(w.document.querySelectorAll('input[type=email]').length,0);assert.equal(w.document.querySelector('.page.active').id,'page-v2-home');assert.equal(w.document.querySelector('#nav-icon use').getAttribute('href'),'#ic-settings');
    click(w,'[data-action=item][data-index="2"]');assert.equal(w.document.querySelector('[data-action=pick][data-value=false]').textContent,'スキップ');click(w,'[data-action=pick][data-value=false]');click(w,'[data-action=save-day]');await tick();await tick();
    assert.equal(w.document.querySelector('.record-count').textContent,'5項目のうち1項目を記録');
    const data=JSON.parse(w.localStorage.getItem('bloom-journal-v2:guest'));assert.equal(Object.values(data.workspace.daily)[0].stretch,false);
    assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
  }finally{app.dom.window.close();}
});
test('motion preview never changes records or starts online saving',async()=>{
  const app=await open({loggedIn:true,preview:true}),{w}=app;
  try{
    const before=w.localStorage.getItem('bloom-journal-v2:'+userId),revision=app.getRevision();
    click(w,'[data-action=motion-demo]');await tick();await tick();
    assert.equal(w.localStorage.getItem('bloom-journal-v2:'+userId),before);
    assert.equal(app.getRevision(),revision);
    assert.match(w.document.querySelector('.sync-state').textContent,/記録の保存・送信はしていません/);
    assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
  }finally{app.dom.window.close();}
});
test('hover and touch wobble without saving, blocking scrolling or ignoring reduced motion',async()=>{
  const app=await open({loggedIn:true}),{w}=app;
  try{
    const before=w.localStorage.getItem('bloom-journal-v2:'+userId),revision=app.getRevision(),water=w.document.querySelector('.big-drop'),pool=water.closest('.drop-pool');
    let animations=0,time=1000;
    Object.defineProperty(w.performance,'now',{value:()=>time});
    water.animate=()=>{animations++;return {finished:Promise.resolve()};};
    w.matchMedia=()=>({matches:false});
    water.dispatchEvent(new w.MouseEvent('pointerenter',{clientX:0,clientY:0}));assert.equal(animations,1);
    time+=1000;const touch=new w.MouseEvent('pointerdown',{bubbles:true,cancelable:true,clientX:0,clientY:0});Object.defineProperty(touch,'pointerType',{value:'touch'});pool.dispatchEvent(touch);assert.equal(animations,2);assert.equal(touch.defaultPrevented,false);
    time+=1000;w.matchMedia=()=>({matches:true});water.click();assert.equal(animations,2);
    assert.equal(w.localStorage.getItem('bloom-journal-v2:'+userId),before);assert.equal(app.getRevision(),revision);
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
    assert.equal(w.document.querySelector('.record-count').textContent,'5項目のうち1項目を記録');
    w.showPage('page-record');await app.switchUser('22222222-2222-4222-8222-222222222222');assert.equal(w.document.querySelector('.page.active').id,'page-v2-home');assert.equal(w.document.querySelector('.record-count').textContent,'5項目のうち0項目を記録');
    await app.logout();assert.equal(w.document.querySelector('.record-count').textContent,'5項目のうち0項目を記録');
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
test('journey choices save without comments, reactions and received words work, booking and health history remain accessible',async()=>{
 const app=await open({loggedIn:true}),{w}=app;try{
  w.showPage('page-journey');await tick();await tick();
  assert.equal(w.document.querySelector('.nav-tab.active').textContent.trim(),'わたしの歩み');
  assert.equal(w.document.getElementById('journey-audience').value,'self');
  assert.equal(w.document.querySelector('.journey-optional').open,false);
  click(w,'[data-journey=choice][data-choice=rest]');submit(w,'journey-form');await tick();await tick();
  const saved=app.journeyCalls.find(c=>c.p_action==='save');assert.equal(saved.p_payload.audience,'self');assert.equal(saved.p_payload.note,'');assert.equal(saved.p_payload.choice,'rest');
  assert.equal(w.document.querySelector('#journey-form'),null);
  click(w,'[data-journey=react][data-kind=step]');await tick();await tick();
  assert.ok(app.journeyCalls.some(c=>c.p_action==='react'&&c.p_payload.enabled===true));
  click(w,'[data-journey=tab][data-tab=words]');assert.equal(w.document.getElementById('journey-panel-words').hidden,false);assert.match(w.document.querySelector('.journey-quote').textContent,/休むのも/);
  assert.equal(w.document.querySelector('.journey-reservation').href,'https://timerex.net/s/iw-inc.jp/dd1d7f4f');assert.match(w.document.querySelector('.journey-reservation').textContent,/新規の方は別途お問い合わせ/);
  w.showPage('page-more');const history=[...w.document.querySelectorAll('#page-more button')].find(b=>b.textContent==='以前の体調記録を見る');assert.ok(history);history.click();assert.equal(w.document.querySelector('.page.active').id,'page-record');
  assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
 }finally{app.dom.window.close();}
});
test('journey failed saves retain input and account switches clear private drafts',async()=>{
 const app=await open({loggedIn:true}),{w}=app;try{
  w.showPage('page-journey');await tick();await tick();
  click(w,'[data-journey=choice][data-choice=pace]');change(w,w.document.getElementById('journey-note'),'<私だけの言葉>');
  app.setJourneyFailure(true);submit(w,'journey-form');await tick();await tick();
  assert.equal(w.document.getElementById('journey-note').value,'<私だけの言葉>');assert.match(w.document.getElementById('journey-status').textContent,/接続できません/);
  await app.switchUser('22222222-2222-4222-8222-222222222222');
  assert.equal(w.document.getElementById('journey-note').value,'');assert.equal(w.document.getElementById('journey-audience').value,'self');assert.equal(w.document.querySelectorAll('.journey-choice[aria-pressed=true]').length,0);
  assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
 }finally{app.dom.window.close();}
});
test('reordered navigation keeps reports, bulk entry, journey and meals selected; gear opens account settings',async()=>{
 const app=await open({loggedIn:true}),{w}=app;try{
  const nav=[...w.document.querySelectorAll('.nav-tab')];
  const inlineClick=selector=>w.eval(w.document.querySelector(selector).getAttribute('onclick'));
  assert.deepEqual(nav.map(n=>n.textContent.trim()),['ホーム','目標設定','記録レポート','わたしの歩み','グループ','みんなのご飯','コラム']);
  inlineClick('.nav-tab[data-nav=reports]');assert.equal(w.document.querySelector('.page.active').id,'page-more');
  inlineClick('#page-more button[onclick*="page-report"]');assert.equal(w.document.querySelector('.page.active').id,'page-v2-report');assert.equal(w.document.querySelector('.nav-tab.active').dataset.nav,'reports');
  w.showPage('page-summary');assert.equal(w.document.querySelector('.nav-tab.active').dataset.nav,'reports');
  inlineClick('.nav-tab[data-nav=journey]');await tick();assert.equal(w.document.querySelector('.nav-tab.active').dataset.nav,'journey');
  inlineClick('.nav-tab[data-nav=meals]');await tick();assert.equal(w.document.querySelector('.page.active').id,'page-sns');assert.equal(w.document.querySelector('.nav-tab.active').dataset.nav,'meals');
  w.switchSnsTab('post');assert.equal(w.document.getElementById('sns-post').style.display,'block');assert.match(w.document.getElementById('post-caption').placeholder,/ランチ/);
  w.switchSnsTab('feed');assert.match(w.document.getElementById('posts-container').textContent,/みんなのご飯/);
  inlineClick('#nav-auth-btn');assert.equal(w.document.getElementById('account-settings').open,true);assert.ok(w.document.querySelector('[data-action=account-profile]'));assert.match(w.document.getElementById('account-settings').textContent,/会員番号 1234567890/);
  await app.logout();assert.equal(w.document.getElementById('account-settings').open,false);assert.equal(w.document.getElementById('account-settings').textContent,'');
  inlineClick('#nav-auth-btn');assert.ok(w.document.querySelector('[data-action=account-login]'));click(w,'[data-action=account-login]');assert.equal(w.document.getElementById('auth-overlay').style.display,'flex');
  assert.equal(w.document.querySelectorAll('input[type=email]').length,0);assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
 }finally{app.dom.window.close();}
});
test('existing server habits and health/journal history remain readable after the UI upgrade',async()=>{
 const legacy={profile:{id:userId,username:'こはる',selected_habits:['散歩','ストレッチ']},todos:[{date:'2026-10-01',habit:'散歩',done:true},{date:'2026-10-02',habit:'散歩',done:false}],records:[{date:'2026-10-01',weight:61.2,mood:3,stress:3,memo:'以前の体調メモ'}],journals:[{date:'2026-10-01',content:'以前の自分の言葉'}]};
 const before=JSON.stringify(legacy),app=await open({loggedIn:true,legacy}),{w}=app;try{
  const remote=app.getRemote();assert.equal(remote.items[0].legacyName,'散歩');assert.equal(remote.daily['2026-10-01']['legacy-0'],true);assert.equal(remote.daily['2026-10-02']['legacy-0'],false);assert.equal(JSON.stringify(legacy),before);
  w.showPage('page-record');assert.match(w.document.getElementById('page-record').textContent,/61.2/);assert.match(w.document.getElementById('page-record').textContent,/以前の体調メモ/);assert.match(w.document.getElementById('page-record').textContent,/以前の自分の言葉/);
  assert.equal(app.errors.length,0,app.errors.map(e=>e.message).join('\n'));
 }finally{app.dom.window.close();}
});
test('unattributed old device-only records are retained but intentionally not silently assigned to a new account',async()=>{
 const old={'bloom-todo':{'2026-10-01':{'散歩':true}},'bloom-record':{'2026-10-01':{weight:61.2,memo:'端末だけの記録'}},'bloom-monthly-summary':{'2026-10':{avgTodo:50}}};
 const app=await open({loggedIn:true,legacy:{local:old}}),{w}=app;try{
  for(const [key,value] of Object.entries(old))assert.equal(w.localStorage.getItem(key),JSON.stringify(value));
  assert.deepEqual(Object.keys(app.getRemote().daily),[]);
  w.showPage('page-record');assert.doesNotMatch(w.document.getElementById('page-record').textContent,/端末だけの記録/);
 }finally{app.dom.window.close();}
});

function swipe(w,node,{dx=0,dy=-32,elapsed=250,cancel=false,id=1}={}){
  function pointer(type,x,y,time){const event=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperties(event,{pointerId:{value:id},isPrimary:{value:true},pointerType:{value:'touch'},timeStamp:{value:time}});node.dispatchEvent(event);}
  pointer('pointerdown',100,200,1000);pointer('pointermove',100+dx,200+dy,1000+elapsed);
  pointer(cancel?'pointercancel':'pointerup',100+dx,200+dy,1000+elapsed);
}
test('short upward touch swipe saves once; sideways, tiny and cancelled drags do not save',async()=>{
  const app=await open(),{w}=app;try{
    click(w,'[data-action=item][data-index="2"]');click(w,'[data-action=pick][data-value=true]');
    const card=w.document.getElementById('v2-daily-card');card.setPointerCapture=()=>{throw Error('not available');};
    const before=w.localStorage.getItem('bloom-journal-v2:guest');
    for(const attempt of [{dy:-8},{dy:-32,cancel:true},{dx:60,dy:-40},{dy:24}]){swipe(w,card,attempt);await tick();assert.equal(w.localStorage.getItem('bloom-journal-v2:guest'),before);assert.equal(card.style.transform,'');}
    swipe(w,card);swipe(w,card);await tick();await tick();
    const data=JSON.parse(w.localStorage.getItem('bloom-journal-v2:guest'));assert.equal(Object.values(data.workspace.daily)[0].stretch,true);assert.equal(w.document.querySelector('.record-count').textContent,'5項目のうち1項目を記録');assert.equal(app.errors.length,0);
  }finally{app.dom.window.close();}
});
test('quick small flick is accepted but a slow small drag is returned without saving',async()=>{
  const app=await open(),{w}=app;try{
    click(w,'[data-action=item][data-index="2"]');click(w,'[data-action=pick][data-value=false]');
    const card=w.document.getElementById('v2-daily-card'),before=w.localStorage.getItem('bloom-journal-v2:guest');
    swipe(w,card,{dy:-18,elapsed:400});await tick();assert.equal(w.localStorage.getItem('bloom-journal-v2:guest'),before);
    swipe(w,card,{dy:-18,elapsed:50});await tick();await tick();
    assert.equal(Object.values(JSON.parse(w.localStorage.getItem('bloom-journal-v2:guest')).workspace.daily)[0].stretch,false);
  }finally{app.dom.window.close();}
});
test('record is persisted before visual completion and cancelled animation cannot prevent saving',async()=>{
  const app=await open({loggedIn:true}),{w}=app;try{
    click(w,'[data-action=item][data-index="2"]');click(w,'[data-action=pick][data-value=true]');
    w.matchMedia=()=>({matches:false});let finish;
    w.HTMLElement.prototype.animate=function(){return {finished:this.id==='v2-daily-card'?new Promise((resolve,reject)=>{finish=()=>reject(new w.DOMException('cancelled','AbortError'));}):Promise.resolve()};};
    swipe(w,w.document.getElementById('v2-daily-card'));
    assert.equal(Object.values(JSON.parse(w.localStorage.getItem('bloom-journal-v2:'+userId)).workspace.daily)[0].stretch,true);
    finish();await tick();await tick();assert.equal(Object.values(app.getRemote().daily)[0].stretch,true);assert.equal(w.document.querySelectorAll('.merge-overlay').length,0);assert.equal(w.document.querySelector('.record-count').textContent,'5項目のうち1項目を記録');assert.equal(app.errors.length,0);
  }finally{app.dom.window.close();}
});
test('monthly content scroll gesture does not report; handle reports once and failure can be retried',async()=>{
  const app=await open({loggedIn:true}),{w}=app;try{
    w.showPage('page-report');let card=w.document.getElementById('v2-month-card');swipe(w,card,{dy:-80});await tick();assert.equal(app.reportRequests.length,0);
    change(w,w.document.getElementById('v2-comment'),'今月のひとこと');app.setReportFailure(true);let handle=card.querySelector('[data-swipe-handle]');swipe(w,handle);swipe(w,handle);await tick();await tick();assert.equal(app.reportRequests.length,1);assert.match(w.document.querySelector('.sync-state').textContent,/接続できません/);assert.equal(w.document.getElementById('v2-comment').value,'今月のひとこと');assert.equal(w.document.getElementById('v2-month-card').style.transform,'');
    app.setReportFailure(false);handle=w.document.querySelector('#v2-month-card [data-swipe-handle]');swipe(w,handle);await tick();await tick();assert.equal(app.reportRequests.length,2);assert.match(w.document.getElementById('v2-report-state').textContent,/提出済み/);assert.equal(app.reportRequests[1].comment,'今月のひとこと');assert.equal(app.errors.length,0);
  }finally{app.dom.window.close();}
});
