/* Gentle, choice-first reflections. Private by default; all sharing is authorized by the DB. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => '<svg class="ico" aria-hidden="true"><use href="#ic-' + name + '"/></svg>';
  const choices = [['step','小さな一歩を踏み出せた','leaf'],['pace','自分のペースで過ごせた','flower'],['rest','ゆっくり休めた','heart'],['connect','誰かとつながりたい日','chat']];
  const stamps = [['step','すてきな一歩','flower'],['rest','おつかれさま','heart'],['same','わかるよ','chat'],['together','一緒にゆっくり','leaf']];
  const title = p => choices.find(c => c[0] === p.choice)?.[1] || '今日のひとこと';
  const ownId = () => currentUser?.id || null;
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let owner = null, generation = 0, feed = {mine:[],posts:[],words:[],groups:[]}, tab = 'journey';
  let draft = null, editing = true, busy = false, loading = false, loaded = false, message = '', failed = false;
  const commentDrafts = new Map();
  function reset() { owner=ownId();generation++;feed={mine:[],posts:[],words:[],groups:[]};draft=null;tab='journey';editing=true;busy=false;loading=false;loaded=false;message='';failed=false;commentDrafts.clear();render(); }
  function scope(p) { return p.audience==='self'?'自分だけ':p.audience==='counselor'?'自分とカウンセラー':p.group_name || '参加していたグループ'; }
  function button(text, action, extra='', cls='journey-small') {return '<button type="button" class="'+cls+'" data-journey="'+action+'" '+extra+'>'+text+'</button>';}
  function reservation() { return '<a class="journey-reservation" href="https://timerex.net/s/iw-inc.jp/dd1d7f4f" target="_blank" rel="noopener noreferrer" aria-label="定期カウンセリングの予約。新規の方は別途お問い合わせが必要です。新しいタブで開きます">'+icon('calendar')+'<span><strong>定期カウンセリングの予約</strong><small>新規の方は別途お問い合わせが必要です。</small></span>'+icon('chev-r')+'</a>'; }
  function stampRow(post, interactive) { return '<div class="journey-stamps" '+(interactive?'role="group" aria-label="'+esc(post.nickname)+'さんを応援"':'')+'>'+stamps.map(([kind,label,svg])=>{const r=(post.reactions||[]).find(r=>r.kind===kind), n=Number(r?.count)||0;if(!interactive&&!n)return '';const text=icon(svg)+'<span>'+label+(n?' '+n:'')+'</span>';return interactive?button(text,'react','data-post="'+esc(post.id)+'" data-kind="'+kind+'" aria-pressed="'+!!r?.mine+'" aria-label="'+label+(r?.mine?'の応援を取り消す':'の応援を送る')+'"','journey-stamp'):'<span class="journey-stamp received">'+text+'</span>';}).join('')+'</div>'; }
  function commentHtml(c,post) { return '<div class="journey-comment"><p class="journey-meta">'+esc(c.nickname)+' · '+esc(c.created_at?.slice(0,10))+'</p><p class="journey-comment-text">'+esc(c.content)+'</p>'+(c.can_delete?button('削除','delete-comment','data-post="'+esc(post.id)+'" data-comment="'+esc(c.id)+'"'):'')+'</div>'; }
  function postHtml(p) {const cd=commentDrafts.get(p.id);return '<article class="journey-post"><p class="journey-meta">'+esc(p.nickname)+' · '+esc(p.group_name||'カウンセラーへの共有')+' · '+esc(p.day)+'</p><h3>'+esc(title(p))+'</h3>'+(p.note?'<p class="journey-comment-text">'+esc(p.note)+'</p>':'')+stampRow(p,true)+'<details><summary>ひとこと届ける'+(p.comments?.length?'・コメント '+p.comments.length:'')+'</summary>'+(p.comments||[]).map(c=>commentHtml(c,p)).join('')+'<form data-journey-comment="'+esc(p.id)+'"><label class="field"><span>ひとこと（任意・400文字まで）</span><textarea rows="2" maxlength="400" required aria-label="'+esc(p.nickname)+'さんへのコメント">'+esc(cd?.text||'')+'</textarea></label><button type="submit" class="secondary">言葉を届ける</button></form></details></article>'; }
  function editorHtml() {
    const d=draft||{choice:'',note:'',audience:'self',group_ref:''};
    return '<form id="journey-form"><h2>今日は、どんな自分でしたか。</h2><p class="muted">近いものをひとつ。言葉にしなくても大丈夫。</p><div class="journey-choices" role="group" aria-label="今日の自分を選ぶ">'+choices.map(([key,text,svg])=>button(icon(svg)+'<span>'+text+'</span>','choice','data-choice="'+key+'" aria-pressed="'+(key===d.choice)+'"','journey-choice')).join('')+'</div><label class="field section"><span>見られる人</span><select id="journey-audience"><option value="self"'+(d.audience==='self'?' selected':'')+'>自分だけ</option><option value="counselor"'+(d.audience==='counselor'?' selected':'')+'>自分とカウンセラー</option><option value="group"'+(d.audience==='group'?' selected':'')+'>参加しているグループ</option></select></label>'+(d.audience==='group'?'<label class="field"><span>共有するグループ</span><select id="journey-group" required><option value="">グループを選択</option>'+feed.groups.map(g=>'<option value="'+esc(g.id)+'"'+(String(g.id)===d.group_ref?' selected':'')+'>'+esc(g.name)+'</option>').join('')+'</select></label>'+(!feed.groups.length?'<p class="muted">共有できるのは、参加が承認されたグループです。</p>':''):'')+'<details class="journey-optional"'+(d.note?' open':'')+'><summary>ひとこと添えたいときは（任意）</summary><label class="field"><span>あなたの言葉で・160文字まで</span><textarea id="journey-note" rows="2" maxlength="160" placeholder="短い言葉でも、大丈夫。">'+esc(d.note)+'</textarea></label></details><button class="primary wide-button" type="submit">'+(busy?'保存しています…':d.audience==='self'?'今日のわたしを残す':'今日のわたしを共有する')+'</button></form>';
  }
  function render() {
    const page=$('page-journey');if(!page)return;
    const mine=feed.mine.find(p=>p.day===(feed.today||today()));
    if(!draft)draft=mine?{choice:mine.choice,note:mine.note,audience:mine.audience,group_ref:mine.group_ref||''}:{choice:'',note:'',audience:'self',group_ref:''};
    page.innerHTML='<header class="journey-hero"><p class="journey-eyebrow">MY LITTLE BLOOM</p><h1>わたしの歩み</h1><p class="muted">小さな変化も、休んだ日も。<br>ここには、わたしのペースがある。</p><button type="button" class="big-drop journey-drop" data-journey="wobble" aria-label="透明なしずくに触れる"></button></header><div class="journey-tabs" role="tablist" aria-label="歩みの表示">'+[['journey','小さな変化'],['support','届いた応援'],['words','大切な言葉']].map(([key,label])=>'<button type="button" role="tab" id="journey-tab-'+key+'" aria-controls="journey-panel-'+key+'" aria-selected="'+(tab===key)+'" data-journey="tab" data-tab="'+key+'">'+label+'</button>').join('')+'</div>'+
      (!owner?'<p class="notice">歩みの保存や応援には、会員番号でのログインが必要です。</p>':'')+
      '<p id="journey-status" role="status" class="journey-status'+(failed?' error':'')+'">'+esc(message||(loading?'歩みを読み込んでいます。':''))+'</p><div class="journey-toolbar">'+button(loading?'読み込み中…':'最新の応援を読む','refresh')+'</div>'+
      '<section id="journey-panel-journey" role="tabpanel" aria-labelledby="journey-tab-journey"'+(tab==='journey'?'':' hidden')+'><article class="paper journey-reflection"><p class="journey-meta">今日のわたし · '+esc(feed.today||today())+'</p>'+(editing||!mine?editorHtml():'<h2>'+esc(title(mine))+'</h2>'+(mine.note?'<p class="journey-comment-text">'+esc(mine.note)+'</p>':'')+'<p class="journey-meta">'+esc(scope(mine))+'</p>'+button('気づきを見直す','edit')+button('削除','delete','data-post="'+esc(mine.id)+'"'))+'</article><h2 class="journey-heading">'+(isAdmin?'届いた、小さな歩み':'みんなの、小さな歩み')+'</h2>'+(feed.posts.length?feed.posts.map(postHtml).join(''):'<p class="muted">共有された歩みが、ここに集まります。</p>')+'<details class="journey-history"><summary>これまでのわたしの歩み</summary>'+feed.mine.filter(p=>p.day!==(feed.today||today())).map(p=>'<article class="journey-post"><p class="journey-meta">'+esc(p.day)+' · '+esc(scope(p))+'</p><h3>'+esc(title(p))+'</h3><p class="journey-comment-text">'+esc(p.note)+'</p>'+button('削除','delete','data-post="'+esc(p.id)+'"')+'</article>').join('')+'</details></section>'+
      '<section id="journey-panel-support" role="tabpanel" aria-labelledby="journey-tab-support"'+(tab==='support'?'':' hidden')+'><h2 class="journey-heading">ひと押しに、気持ちをのせて。</h2>'+ (feed.mine.some(p=>p.reactions?.some(r=>Number(r.count)>0))?feed.mine.filter(p=>p.reactions?.some(r=>Number(r.count)>0)).map(p=>'<article class="journey-post"><p class="journey-meta">'+esc(p.day)+'のあなたへ</p><h3>'+esc(title(p))+'</h3>'+stampRow(p,false)+'</article>').join(''):'<p class="muted">共有した歩みに応援が届いたら、ここに表示されます。</p>')+'<p class="muted section">コメントが届いたら「大切な言葉」に。</p></section>'+
      '<section id="journey-panel-words" role="tabpanel" aria-labelledby="journey-tab-words"'+(tab==='words'?'':' hidden')+'><h2 class="journey-heading">あなたへ届いた、言葉の贈りもの。</h2><p class="muted">歩みに届いたコメントが、ここに集まります。</p>'+feed.words.map(c=>'<article class="journey-post"><p class="journey-meta">'+esc(c.nickname)+' · '+esc(c.created_at?.slice(0,10))+'</p><p class="journey-quote">'+esc(c.content)+'</p><p class="journey-meta">'+esc(c.day)+'「'+esc(title(c))+'」へのコメント</p>'+button('削除','delete-comment','data-post="'+esc(c.post_id)+'" data-comment="'+esc(c.id)+'"')+'</article>').join('')+(!feed.words.length?'<p class="muted section">言葉が届いたら、いつでも読み返せます。</p>':'')+'</section>'+reservation();
    page.querySelectorAll('button,input,select,textarea').forEach(n=>{if(!n.matches('[data-journey=tab],[data-journey=wobble]'))n.disabled=busy||loading;});
    const drop=page.querySelector('.journey-drop');drop.addEventListener('pointerenter',wobble);drop.addEventListener('pointerdown',wobble);
  }
  function status(text,error=false){message=text;failed=error;const n=$('journey-status');if(n){n.textContent=text;n.classList.toggle('error',error);}}
  function wobble(){const n=$('page-journey')?.querySelector('.journey-drop');if(!n||matchMedia('(prefers-reduced-motion: reduce)').matches)return;n.animate?.([{transform:'rotate(12deg)'},{transform:'rotate(8deg) scale(1.07,.94)'},{transform:'rotate(16deg) scale(.96,1.04)'},{transform:'rotate(12deg)'}],{duration:760,easing:'ease-out'});}
  async function rpc(action,payload={}) {
    const who=owner,epoch=generation;
    if(!who||!supabaseClient)throw Error('会員番号でログインしてください。');
    const {data:session,error:authError}=await supabaseClient.auth.getSession();
    if(authError||session?.session?.user?.id!==who||who!==ownId()||epoch!==generation)throw Error('ログイン状態を確認してください。');
    const {data,error}=await supabaseClient.rpc('journal_journey',{p_action:action,p_payload:payload});
    if(epoch!==generation||who!==ownId())throw Error('アカウントが切り替わりました。');
    if(error){const m=String(error.message||'');throw Error(m.includes('journey_group_forbidden')?'このグループへの参加承認を確認してください。':m.includes('journey_forbidden')?'この歩みは現在、閲覧・応援できません。最新の内容を読み直してください。':m.includes('journey_invalid')?'入力内容を確認してください。':m.includes('journey_identity_required')?'会員番号の読み込み後、もう一度お試しください。':'歩みに接続できませんでした。入力はこの画面に残っています。時間をおいて再試行してください。');}
    return data;
  }
  async function refresh() {
    if(loading||busy)return;if(owner!==ownId())reset();if(!owner){render();return;}
    const epoch=generation;loading=true;render();
    try{const result=await rpc('feed');if(epoch!==generation)return;if(!result||!Array.isArray(result.mine)||!Array.isArray(result.posts)||!Array.isArray(result.groups)||!Array.isArray(result.words))throw Error('歩みのデータを読み込めませんでした。');feed=result;if(!loaded){draft=null;editing=!feed.mine.some(p=>p.day===feed.today);}loaded=true;message='';failed=false;}
    catch(error){if(epoch===generation){message=error.message;failed=true;}}
    finally{if(epoch===generation){loading=false;render();}}
  }
  async function mutate(action,payload,success) {
    if(busy||loading)return false;const epoch=generation;busy=true;render();
    try {await rpc(action,payload);if(epoch!==generation)return false;busy=false;await refresh();if(epoch!==generation)return false;if(failed){status('操作は完了しましたが、一覧の再取得に失敗しました。「最新の応援を読む」で確認してください。',true);return true;}status(success);return true;}
    catch(error){if(epoch===generation){busy=false;render();status(error.message,true);}return false;}
    finally{if(epoch===generation){busy=false;}}
  }
  async function action(event) {
    const b=event.target.closest('[data-journey]');if(!b||!$('page-journey')?.contains(b))return;
    const a=b.dataset.journey;
    if(a==='tab'){tab=b.dataset.tab;render();$('journey-tab-'+tab).focus({preventScroll:true});return;}
    if(a==='wobble'){wobble();return;}if(busy||loading)return;
    if(a==='refresh'){await refresh();return;}if(a==='choice'){draft.choice=b.dataset.choice;render();$('page-journey').querySelector('[data-choice="'+draft.choice+'"]').focus({preventScroll:true});return;}
    if(a==='edit'){editing=true;render();return;}
    if(a==='react'){const p=feed.posts.find(p=>p.id===b.dataset.post),r=p?.reactions?.find(r=>r.kind===b.dataset.kind);if(!p)return;await mutate('react',{post_id:p.id,kind:b.dataset.kind,enabled:!r?.mine},r?.mine?'応援を取り消しました。':'応援を届けました。');return;}
    if(a==='delete'||a==='delete-comment'){if(!confirm(a==='delete'?'この歩みと、届いた応援・コメントを削除しますか？':'このコメントを削除しますか？'))return;const ok=await mutate(a==='delete'?'delete':'delete_comment',{post_id:b.dataset.post,id:b.dataset.comment},'削除しました。');if(ok&&a==='delete'){draft=null;editing=true;render();}return;}
  }
  async function submit(event){
    const form=event.target;if(form.id!=='journey-form'&&!form.matches('[data-journey-comment]'))return;event.preventDefault();if(busy||loading)return;
    if(form.id==='journey-form'){
      if(!draft.choice&&!draft.note.trim()){status('近いものをひとつ選ぶか、ひとこと添えてください。',true);return;}
      if(draft.audience==='group'&&!draft.group_ref){status('共有するグループを選んでください。',true);return;}
      const old=feed.mine.find(p=>p.day===feed.today);if(old&&(old.audience!==draft.audience||(old.group_ref||'')!==(draft.audience==='group'?draft.group_ref:''))&&!confirm('共有先を変更すると、これまでの応援とコメントは削除されます。変更しますか？'))return;
      const epoch=generation;const ok=await mutate('save',{...draft},draft.audience==='self'?'今日のわたしを残しました。':'選んだ相手に、今日のわたしを共有しました。');if(ok&&epoch===generation){editing=false;render();}
    }else{const post_id=form.dataset.journeyComment;const content=form.querySelector('textarea').value.trim();if(!content){status('ひとことを入力してください。',true);return;}const cd=commentDrafts.get(post_id)||{id:crypto.randomUUID(),text:content};cd.text=content;commentDrafts.set(post_id,cd);const epoch=generation;const ok=await mutate('comment',{post_id,id:cd.id,content},'言葉を届けました。');if(ok&&epoch===generation){commentDrafts.delete(post_id);render();}}
  }
  const oldPage=showPage;
  showPage=function(id){oldPage(id);if(id==='page-journey'){$('page-journey')?.classList.add('active');document.querySelectorAll('.nav-tab').forEach(n=>n.classList.toggle('active',n.dataset.nav==='journey'));if(owner!==ownId())reset();render();refresh();}};
  const oldAuth=updateAuthUI;updateAuthUI=function(){if(owner!==ownId())reset();oldAuth();};
  window.addEventListener('load',()=>{
    const page=document.createElement('section');page.id='page-journey';page.className='page jv journey';$('page-record').before(page);
    const nav=document.querySelector('.nav-tab[data-nav="journey"]');nav.setAttribute('onclick',"showPage('page-journey')");
    const history=document.createElement('button');history.type='button';history.className='btn-secondary';history.textContent='以前の体調記録を見る';history.addEventListener('click',()=>showPage('page-record'));$('page-more').firstElementChild.append(history);
    const admin=document.createElement('button');admin.type='button';admin.className='chip';admin.textContent='歩み・応援';admin.addEventListener('click',()=>showPage('page-journey'));document.querySelector('.admin-tabs')?.append(admin);
    page.addEventListener('click',action);page.addEventListener('submit',submit);
    page.addEventListener('input',event=>{if(event.target.id==='journey-note')draft.note=event.target.value;const form=event.target.closest('[data-journey-comment]');if(form){const key=form.dataset.journeyComment;const previous=commentDrafts.get(key);commentDrafts.set(key,{id:previous?.id||crypto.randomUUID(),text:event.target.value});}});
    page.addEventListener('change',event=>{if(event.target.id==='journey-audience'){draft.audience=event.target.value;draft.group_ref='';render();}if(event.target.id==='journey-group')draft.group_ref=event.target.value;});
    owner=ownId();render();
  });
})();
