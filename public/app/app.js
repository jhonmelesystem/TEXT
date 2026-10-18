const $=(s,r=document)=>r.querySelector(s);
const h=(t,p,...k)=>{const e=document.createElement(t);for(const[a,v]of Object.entries(p||{}))a.startsWith('on')?e[a]=v:a==='cls'?e.className=v:e.setAttribute(a,v);for(const c of k.flat())if(c!=null&&c!==false)e.append(c);return e};
const BASE=window.TEXT_API||'';
const PRESETS=['#FFFFFF','#E0E0E0','#9E9E9E','#BBD7FF','#1A73E8','#111111'];
let tk=localStorage.getItem('tk'),me,sock,settings,tab='chats',cur=null,chats=[],contacts=[],unread={},lastQ='',VMAX=60,side,pane,msgsEl,subEl,appEl,recCtl=null,playing=null;
const root=$('#root'),show=e=>root.replaceChildren(e);
const pad=n=>String(n).padStart(2,'0');
const fmt=s=>{s=Math.max(0,Math.floor(s||0));const hh=Math.floor(s/3600),mm=Math.floor(s%3600/60);return(hh?hh+':'+pad(mm):mm)+':'+pad(s%60)};
const bg=u=>u?`background-image:url("${BASE}${u}")`:'';
const av=(n,u,c)=>h('div',{cls:'av'+(c?' '+c:''),style:bg(u)},u?'':(n||'?')[0].toUpperCase());
const prev=c=>(c.last_sender===me.id?'Tu: ':'')+(c.last_type==='image'?'📷 Foto':c.last_type==='video'?'🎥 Video':c.last_type==='audio'?'🎤 Nota de voz':c.last_body||'');
const totalUnread=()=>Object.values(unread).reduce((a,b)=>a+b,0);
const theme=()=>document.body.classList.toggle('dark',localStorage.getItem('th')==='d');
const btn=(t,f,g)=>h('button',{cls:g?'g':'',onclick:async()=>{try{await f()}catch(x){alert(x.message)}}},t);
const row=(u,extra,click,sub)=>h('div',{cls:'row',onclick:click},av(u.display_name,u.avatar_url),h('div',{cls:'grow'},h('b',{},u.display_name),h('small',{},sub??'@'+u.username)),extra);
const toBottom=sm=>msgsEl&&msgsEl.scrollTo({top:msgsEl.scrollHeight,behavior:sm?'smooth':'auto'});

async function api(m,p,b){
  const r=await fetch(BASE+p,{method:m,headers:{...(tk&&{Authorization:'Bearer '+tk}),...(b&&{'Content-Type':'application/json'})},body:b?JSON.stringify(b):undefined});
  const d=await r.json().catch(()=>({}));
  if(r.status===401&&tk){logout();throw new Error('Sesion vencida')}
  if(!r.ok)throw new Error(d.error||'Error '+r.status);
  return d}
const up=(url,fd,cb)=>new Promise((ok,no)=>{const x=new XMLHttpRequest();x.open('POST',BASE+url);x.setRequestHeader('Authorization','Bearer '+tk);x.upload.onprogress=e=>e.lengthComputable&&cb(Math.round(e.loaded/e.total*100));x.onload=()=>{let d={};try{d=JSON.parse(x.responseText)}catch{}x.status<300?ok(d):no(new Error(d.error||'Error '+x.status))};x.onerror=()=>no(new Error('Sin conexion'));x.send(fd)});
const dur=f=>new Promise(r=>{const v=document.createElement('video'),u=URL.createObjectURL(f);v.preload='metadata';v.onloadedmetadata=()=>{URL.revokeObjectURL(u);r(v.duration)};v.onerror=()=>{URL.revokeObjectURL(u);r(null)};v.src=u});

async function load(){
  [chats,contacts]=await Promise.all([api('GET','/api/chats'),api('GET','/api/contacts')]);
  unread={};chats.forEach(c=>unread[c.chat_id]=+c.unread);
  if(cur)unread[cur.chat_id]=0}
const refreshList=()=>load().then(()=>tab==='chats'&&drawSide()).catch(()=>{});
const act=async f=>{await f();await load();drawSide()};

function logout(){localStorage.removeItem('tk');localStorage.removeItem('pin');const lk=$('.lock');if(lk)lk.remove();locked=false;if(recCtl)recCtl.cancel();tk=null;sock&&sock.disconnect();cur=null;show(loginView())}
async function start(t){tk=t;localStorage.setItem('tk',t);await boot()}
async function boot(){
  try{me=await api('GET','/api/me');settings=await api('GET','/api/settings');await load()}catch{return show(loginView())}
  fetch(BASE+'/api/limits').then(r=>r.json()).then(l=>VMAX=l.video_max_seconds||60).catch(()=>{});
  connect();show(appView());
  const iv=localStorage.getItem('inv');if(iv){localStorage.removeItem('inv');join(iv)}}

function loginView(){
  const err=h('div',{cls:'err'}),box=h('div',{cls:'login'}),f={};
  const field=(k,ph,type='text')=>f[k]=h('input',{placeholder:ph,type,autocomplete:'off'});
  const go=fn=>async()=>{err.textContent='';try{await fn()}catch(e){err.textContent=e.message}};
  const page=(msg,...k)=>box.replaceChildren(h('h1',{},'text'),err,h('p',{cls:'mut'},msg),...k);
  const s1=()=>page('Ingresa tu correo para entrar o registrarte',field('email','correo@ejemplo.com','email'),h('button',{onclick:go(async()=>{await api('POST','/api/auth/request-code',{email:f.email.value});s2(f.email.value)})},'Enviar codigo'));
  const s2=email=>page('Codigo enviado a '+email,field('code','Codigo de 6 digitos'),h('button',{onclick:go(async()=>{const d=await api('POST','/api/auth/verify-code',{email,code:f.code.value});d.token?start(d.token):s3(email,f.code.value)})},'Continuar'));
  const s3=(email,code)=>page('Crea tu perfil',field('un','Tu ID unico (ej: juan_01)'),field('dn','Tu nombre'),h('button',{onclick:go(async()=>{const d=await api('POST','/api/auth/verify-code',{email,code,username:f.un.value,display_name:f.dn.value});start(d.token)})},'Crear cuenta'));
  s1();return box}

function appView(){
  side=h('div',{cls:'side'});pane=h('div',{cls:'chat'});
  appEl=h('div',{cls:'app'+(cur?' in-chat':'')},side,pane);
  drawSide();drawChat();return appEl}

function drawSide(){
  const n=totalUnread();
  const tabs=h('div',{cls:'tabs'},...[['chats','Chats'],['contacts','Contactos'],['settings','Ajustes']].map(([k,l])=>h('div',{cls:tab===k?'on':'',onclick:()=>{tab=k;drawSide()}},l,k==='chats'&&n?' ('+n+')':'')));
  const body=h('div',{cls:'list'});
  ({chats:chatsTab,contacts:contactsTab,settings:settingsTab})[tab](body);
  side.replaceChildren(tabs,body)}

function chatsTab(b){
  if(!chats.length)b.append(h('p',{cls:'sec mut'},'Aun no hay conversaciones. Ve a Contactos para empezar.'));
  chats.forEach(c=>b.append(row(c,unread[c.chat_id]?h('span',{cls:'badge'},unread[c.chat_id]):null,()=>openChat(c),prev(c))))}

const cOpen=c=>openChat({chat_id:c.chat_id,user_id:c.id,display_name:c.display_name,avatar_url:c.avatar_url});

function contactsTab(b){
  const q=h('input',{placeholder:'Buscar por ID o nombre',value:lastQ}),res=h('div'),reqs=h('div'),inv=h('div'),pl=h('input',{placeholder:'Pegar enlace de invitacion'});
  const accept=u=>act(()=>api('POST','/api/contacts/'+u.id+'/accept'));
  const action=u=>u.relation==='contact'?btn('Mensaje',()=>{const c=contacts.find(x=>x.id===u.id);c&&cOpen(c)},1)
    :u.relation==='request_sent'?h('small',{},'Enviada')
    :u.relation==='request_received'?btn('Aceptar',()=>accept(u))
    :btn('Agregar',()=>act(()=>api('POST','/api/contacts/request',{username:u.username})));
  const find=async()=>{lastQ=q.value;res.replaceChildren();try{(await api('GET','/api/users/search?q='+encodeURIComponent(lastQ))).forEach(u=>res.append(row(u,action(u))))}catch(e){res.append(h('small',{cls:'err'},e.message))}};
  if(lastQ)find();
  api('GET','/api/contacts/requests').then(l=>{l.length&&reqs.append(h('div',{cls:'sec'},h('h4',{},'Solicitudes')));l.forEach(u=>reqs.append(row(u,h('span',{},btn('Aceptar',()=>accept(u)),' ',btn('Rechazar',()=>act(()=>api('POST','/api/contacts/'+u.id+'/reject')),1)))))}).catch(()=>{});
  b.append(
    h('div',{cls:'sec'},h('h4',{},'Agregar contacto'),q,btn('Buscar',find),res),reqs,
    h('div',{cls:'sec'},h('h4',{},'Mis contactos'),!contacts.length&&h('small',{},'Aun no tienes contactos')),
    ...contacts.map(c=>row(c,null,()=>cOpen(c))),
    h('div',{cls:'sec'},h('h4',{},'Invitar por enlace'),
      btn('Mi enlace de invitacion',async()=>{const i=await api('POST','/api/invites');inv.replaceChildren(h('img',{src:i.qr,width:'200',height:'200'}),h('br'),h('small',{},i.link),h('br'),btn('Copiar',()=>navigator.clipboard.writeText(i.link),1),navigator.share&&btn('Compartir',()=>navigator.share({title:'text',text:'Agregame en text',url:i.link}),1))}),inv,
      h('br'),pl,btn('Unirme',async()=>{const t=(pl.value.match(/[a-f0-9]{48}/)||[])[0];if(!t)throw new Error('Enlace invalido');await join(t)})))}

function profileCard(){
  const fa=h('input',{type:'file',accept:'image/*',hidden:''}),fc=h('input',{type:'file',accept:'image/*',hidden:''});
  const pick=(inp,path)=>{inp.onchange=async()=>{const f=inp.files[0];inp.value='';if(!f)return;const fd=new FormData();fd.append('file',f);try{Object.assign(me,await up(path,fd,()=>{}));drawSide()}catch(e){alert(e.message)}}};
  pick(fa,'/api/me/avatar');pick(fc,'/api/me/cover');
  const del=p=>async()=>{Object.assign(me,await api('DELETE',p));drawSide()};
  return h('div',{},
    h('div',{cls:'cover',style:bg(me.cover_url)}),av(me.display_name,me.avatar_url,'big'),
    h('div',{cls:'sec'},h('b',{},me.display_name),h('br'),h('small',{},'@'+me.username),h('br'),
      btn('Foto de perfil',()=>fa.click(),1),fa,btn('Portada',()=>fc.click(),1),fc,
      me.avatar_url&&btn('Quitar foto',del('/api/me/avatar'),1),me.cover_url&&btn('Quitar portada',del('/api/me/cover'),1)))}

function settingsTab(b){
  const nm=h('input',{value:me.display_name}),bgf=h('input',{type:'file',accept:'image/*',hidden:''}),bl=h('div');
  const setBg=p=>p.then(s=>{settings=s;applyBg()}).catch(e=>alert(e.message));
  const color=c=>setBg(api('PUT','/api/settings/background',{type:'color',value:c}));
  bgf.onchange=()=>{const f=bgf.files[0];bgf.value='';if(!f)return;const fd=new FormData();fd.append('file',f);setBg(up('/api/settings/background/image',fd,()=>{}))};
  const pin=localStorage.getItem('pin'),pi=ph=>h('input',{type:'password',inputmode:'numeric',maxlength:'6',placeholder:ph,autocomplete:'new-password'}),pc=pin&&pi('PIN actual'),pn=pi(pin?'PIN nuevo (4-6 numeros)':'Crea un PIN (4-6 numeros)'),ms=localStorage.getItem('lockms')||'0';
  const secPin=h('div',{cls:'sec'},h('h4',{},'Bloqueo con PIN'),pc,pn,
    btn(pin?'Cambiar PIN':'Activar PIN',async()=>{if(pin&&!(await checkPin(pc.value)))throw new Error('PIN actual incorrecto');if(!/^\d{4,6}$/.test(pn.value))throw new Error('El PIN debe tener de 4 a 6 numeros');await setPin(pn.value);alert('PIN guardado');drawSide()}),
    pin&&btn('Quitar PIN',async()=>{if(!(await checkPin(pc.value)))throw new Error('Escribe tu PIN actual');localStorage.removeItem('pin');drawSide()},1),
    pin&&h('div',{},h('small',{},'Bloquear: '),h('select',{onchange:e=>localStorage.setItem('lockms',e.target.value)},...[['0','al salir de la app'],['60000','tras 1 minuto'],['300000','tras 5 minutos']].map(([v,l])=>h('option',{value:v,...(ms===v&&{selected:''})},l)))));
  api('GET','/api/blocks').then(l=>l.forEach(u=>bl.append(row(u,btn('Desbloquear',async()=>{await api('DELETE','/api/blocks/'+u.id);drawSide()},1))))).catch(()=>{});
  b.append(
    profileCard(),
    h('div',{cls:'sec'},h('h4',{},'Mi nombre'),nm,btn('Guardar nombre',async()=>{await api('PATCH','/api/me',{display_name:nm.value});me.display_name=nm.value.trim();alert('Guardado');drawSide()})),
    h('div',{cls:'sec'},h('h4',{},'Fondo del chat'),...PRESETS.map(c=>h('span',{cls:'sw',style:'background:'+c,onclick:()=>color(c)})),h('input',{type:'color',value:'#ffffff',onchange:e=>color(e.target.value)}),h('br'),btn('Imagen',()=>bgf.click(),1),bgf,btn('Quitar',()=>setBg(api('DELETE','/api/settings/background')),1)),
    h('div',{cls:'sec'},btn('Cambiar tema claro/oscuro',()=>{localStorage.setItem('th',document.body.classList.contains('dark')?'l':'d');theme()},1)),
    secPin,
    h('div',{cls:'sec'},h('h4',{},'Bloqueados'),bl),
    h('div',{cls:'sec'},btn('Cerrar sesion',logout,1)))}

function applyBg(){
  if(!msgsEl||!settings)return;
  const s=settings,v=s.chat_bg_value;
  msgsEl.style.background=s.chat_bg_type==='image'?`url("${BASE}${v}") center/cover no-repeat`:(v.toUpperCase()==='#FFFFFF'?'':v)}

function openChat(u){
  if(recCtl)recCtl.cancel();
  cur={chat_id:u.chat_id,user_id:u.user_id,display_name:u.display_name,avatar_url:u.avatar_url};unread[cur.chat_id]=0;
  appEl.classList.add('in-chat');drawSide();drawChat()}

async function drawChat(){
  if(!cur){pane.replaceChildren(h('div',{cls:'empty'},'Elige un chat'));return}
  const c=cur;
  subEl=h('small',{},'');msgsEl=h('div',{cls:'msgs'});applyBg();
  const more=h('button',{cls:'g',onclick:async()=>{const f=$('.m',msgsEl);const l=await api('GET',`/api/chats/${c.chat_id}/messages?before=${f.dataset.id}`);l.reverse().forEach(m=>add(m,1));if(l.length<50)more.remove()}},'Cargar anteriores');
  const file=h('input',{type:'file',accept:'image/*,video/*',hidden:''}),txt=h('input',{placeholder:'Escribe un mensaje',autocomplete:'off'}),bar=h('div',{cls:'bar'});
  const ab=h('button',{cls:'act',onclick:()=>txt.value.trim()?send(txt):startRec(bar,drawBar)},'🎤');
  function drawBar(){bar.replaceChildren(btn('📎',()=>file.click(),1),file,txt,ab)}
  const upd=()=>{ab.textContent=txt.value.trim()?'➤':'🎤'};
  txt.addEventListener('x',upd);
  file.onchange=()=>sendFile(file.files[0],txt,file);
  txt.onkeydown=e=>{if(e.key==='Enter')send(txt)};
  let ts=0,tt;
  txt.oninput=()=>{upd();if(!ts){sock.emit('typing',{chat_id:c.chat_id,is_typing:true});ts=1}clearTimeout(tt);tt=setTimeout(()=>{sock.emit('typing',{chat_id:c.chat_id,is_typing:false});ts=0},1500)};
  drawBar();
  pane.replaceChildren(
    h('div',{cls:'head'},
      h('button',{cls:'back g',onclick:()=>{if(recCtl)recCtl.cancel();cur=null;appEl.classList.remove('in-chat');drawSide();setTimeout(()=>{if(!cur)drawChat()},280)}},'←'),
      h('div',{cls:'who',onclick:()=>showProfile(c.user_id)},av(c.display_name,c.avatar_url),h('div',{cls:'grow'},h('b',{},c.display_name),subEl)),
      btn('⋮',()=>showProfile(c.user_id),1)),
    more,msgsEl,bar);
  try{
    const l=await api('GET','/api/chats/'+c.chat_id+'/messages');
    if(cur!==c)return;
    l.forEach(m=>add(m,0,1));toBottom();if(l.length<50)more.remove();
    sock.emit('message:read',{chat_id:c.chat_id});refreshList()
  }catch(e){alert(e.message)}}

async function showProfile(uid){
  try{
    const p=await api('GET','/api/users/'+uid+'/profile');
    const close=()=>m.remove(),rs=h('input',{placeholder:'Motivo del reporte'});
    const m=h('div',{cls:'modal',onclick:e=>{if(e.target===m)close()}},h('div',{cls:'card'},
      h('div',{cls:'cover',style:bg(p.cover_url)}),av(p.display_name,p.avatar_url,'big'),
      h('div',{cls:'sec'},h('b',{},p.display_name),h('br'),h('small',{},'@'+p.username)),
      h('div',{cls:'sec'},rs,btn('Reportar',async()=>{if(!rs.value.trim())throw new Error('Indica el motivo');await api('POST','/api/reports',{user_id:p.id,reason:rs.value});alert('Reporte enviado');close()}),
        btn('Bloquear',async()=>{if(!confirm('Bloquear a '+p.display_name+'?'))return;await api('POST','/api/blocks',{user_id:p.id});close();cur=null;appEl.classList.remove('in-chat');await load();drawChat();drawSide()},1),
        btn('Cerrar',close,1))));
    document.body.append(m)
  }catch(e){alert(e.message)}}

const tick=(id,s)=>{const e=$('#s'+id);if(e){e.textContent=s==='sent'?'✓':'✓✓';e.className=s==='read'?'read':''}};

function voice(m,u){
  const a=new Audio(u);a.preload='metadata';
  const total=()=>isFinite(a.duration)&&a.duration>0?a.duration:(m.duration_sec||0);
  const bt=h('button',{cls:'pl'},'▶'),fill=h('i'),bar=h('div',{cls:'wave'},fill),tm=h('small',{},fmt(m.duration_sec)),sp=h('button',{cls:'sp g'},'1x');
  bt.onclick=()=>{if(a.paused){if(playing&&playing!==a)playing.pause();playing=a;a.play().catch(()=>{})}else a.pause()};
  a.onplay=()=>{bt.textContent='⏸'};a.onpause=()=>{bt.textContent='▶'};
  a.ontimeupdate=()=>{fill.style.width=(a.currentTime/(total()||1)*100)+'%';tm.textContent=fmt(a.currentTime)+' / '+fmt(total())};
  a.onended=()=>{fill.style.width='0';bt.textContent='▶';tm.textContent=fmt(total())};
  bar.onclick=e=>{const r=bar.getBoundingClientRect();a.currentTime=(e.clientX-r.left)/r.width*total()};
  sp.onclick=()=>{const s={1:1.5,1.5:2,2:1}[a.playbackRate]||1;a.playbackRate=s;sp.textContent=s+'x'};
  return h('div',{cls:'voice'},bt,h('div',{cls:'grow'},bar,tm),sp)}

function add(m,pre,now){
  if(!msgsEl||!cur||m.chat_id!==cur.chat_id||$('#m'+m.id,msgsEl))return;
  const mine=m.sender_id===me.id,u=BASE+m.media_url;
  const near=msgsEl.scrollHeight-msgsEl.scrollTop-msgsEl.clientHeight<150;
  const d=h('div',{cls:'m'+(mine?' me':'')+(pre||now?' na':''),id:'m'+m.id,'data-id':m.id});
  if(m.type==='image')d.append(h('img',{cls:'pic',src:u,onclick:()=>window.open(u),onload:()=>{if(!pre&&(near||mine))toBottom()}}));
  if(m.type==='video')d.append(h('video',{cls:'pic',controls:'',preload:'metadata',poster:u.replace(/\.mp4$/,'.jpg'),src:u}));
  if(m.type==='audio')d.append(voice(m,u));
  if(m.body)d.append(h('div',{},m.body));
  const t=h('div',{cls:'t'},new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+(m.type==='video'&&m.duration_sec?' · '+m.duration_sec+'s':'')+' ');
  if(mine)t.append(h('span',{id:'s'+m.id}));
  d.append(t);
  pre?msgsEl.prepend(d):msgsEl.append(d);
  if(!pre&&!now&&(mine||near))toBottom(1);
  if(mine)tick(m.id,m.status)}

function send(txt){
  const body=txt.value.trim();if(!body||!cur)return;txt.value='';txt.dispatchEvent(new Event('x'));
  sock.emit('message:send',{chat_id:cur.chat_id,body},r=>{if(r.ok){add(r.message);refreshList()}else alert(r.error)})}

async function sendFile(f,txt,input){
  input.value='';if(!f||!cur)return;
  const v=f.type.startsWith('video/'),id=cur.chat_id;
  if(v){const d=await dur(f);if(d&&d>VMAX+.5)return alert(`El video dura ${Math.round(d)} s y el maximo es ${VMAX} s`)}
  const fd=new FormData(),cap=txt.value.trim();if(cap){fd.append('caption',cap);txt.value='';txt.dispatchEvent(new Event('x'))}fd.append('file',f);
  try{const r=await up(`/api/chats/${id}/${v?'video':'media'}`,fd,p=>subEl.textContent=p<100?`Subiendo ${p}%`:'Procesando...');add(r.message);refreshList()}
  catch(e){alert(e.message)}finally{subEl.textContent=''}}

// ---------- Notas de voz (sin limite de duracion) ----------
async function startRec(bar,restore){
  if(!navigator.mediaDevices||!window.MediaRecorder)return alert('Tu navegador no permite grabar audio');
  let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch{return alert('Permite el acceso al microfono para grabar')}
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
  const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),parts=[],t0=Date.now();let go=true;
  const tm=h('b',{},'0:00'),timer=setInterval(()=>{tm.textContent=fmt((Date.now()-t0)/1000)},500);
  rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
  rec.onstop=()=>{
    clearInterval(timer);stream.getTracks().forEach(t=>t.stop());window.onbeforeunload=null;recCtl=null;restore();
    if(go&&parts.length)sendAudio(new Blob(parts,{type:rec.mimeType}),(Date.now()-t0)/1000)};
  recCtl={cancel:()=>{go=false;if(rec.state!=='inactive')rec.stop()}};
  window.onbeforeunload=e=>{e.preventDefault();e.returnValue=''};
  rec.start(1000);
  bar.replaceChildren(h('span',{cls:'rdot'}),tm,h('div',{cls:'grow'},h('small',{},'Grabando... toca ➤ para enviar')),btn('🗑',()=>recCtl.cancel(),1),btn('➤',()=>rec.stop()))}

async function sendAudio(blob,secs){
  if(secs<1||!cur)return;
  const id=cur.chat_id,ext=blob.type.includes('mp4')?'m4a':blob.type.includes('ogg')?'ogg':'webm';
  const fd=new FormData();fd.append('file',blob,'nota.'+ext);
  try{const r=await up(`/api/chats/${id}/audio`,fd,p=>{if(subEl)subEl.textContent=p<100?`Subiendo nota ${p}%`:'Procesando...'});add(r.message);refreshList()}
  catch(e){alert(e.message)}finally{if(subEl)subEl.textContent=''}}

function connect(){
  sock&&sock.disconnect();
  sock=io(BASE||undefined,{auth:{token:tk}});
  sock.on('connect_error',e=>{if(e.message==='No autorizado')logout()});
  sock.on('message:new',m=>{
    if(cur&&cur.chat_id===m.chat_id){add(m);if(m.sender_id!==me.id)sock.emit('message:read',{chat_id:m.chat_id})}
    refreshList()});
  sock.on('message:status',s=>s.message_ids.forEach(i=>tick(i,s.status)));
  sock.on('typing',t=>{if(cur&&cur.chat_id===t.chat_id&&subEl)subEl.textContent=t.is_typing?'escribiendo...':''})}

// ---------- Invitaciones por enlace / QR ----------
async function join(t){
  try{
    const u=await api('GET','/api/invites/'+t);
    if(!confirm('Agregar a '+u.display_name+' (@'+u.username+') como contacto?'))return;
    const r=await api('POST','/api/invites/'+t+'/accept');
    await load();drawSide();openChat({chat_id:r.chat_id,user_id:r.user.id,display_name:r.user.display_name})
  }catch(e){alert(e.message)}}

// ---------- Bloqueo con PIN (guardado solo en este dispositivo) ----------
const b64=a=>btoa(String.fromCharCode(...new Uint8Array(a))),unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function hashPin(pin,salt){
  if(!crypto.subtle)throw new Error('El PIN necesita https o localhost');
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  return b64(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:150000},k,256))}
async function setPin(pin){const s=crypto.getRandomValues(new Uint8Array(16));localStorage.setItem('pin',JSON.stringify({s:b64(s),h:await hashPin(pin,s)}));localStorage.removeItem('pf')}
async function checkPin(pin){const p=JSON.parse(localStorage.getItem('pin'));return await hashPin(pin,unb64(p.s))===p.h}
let locked=false,hiddenAt=0;
function lock(){
  if(locked||!localStorage.getItem('pin'))return;locked=true;
  const inp=h('input',{type:'password',inputmode:'numeric',maxlength:'6',placeholder:'PIN',autocomplete:'new-password'}),err=h('div',{cls:'err'});
  const ov=h('div',{cls:'lock'});
  const tryPin=async()=>{
    try{
      const wait=(+localStorage.getItem('pu')||0)-Date.now();
      if(wait>0){err.textContent='Espera '+Math.ceil(wait/1000)+' s';return}
      if(await checkPin(inp.value.trim())){localStorage.removeItem('pf');ov.remove();locked=false;return}
      const f=(+localStorage.getItem('pf')||0)+1;localStorage.setItem('pf',f);
      if(f>=5)localStorage.setItem('pu',Date.now()+30000);
      err.textContent='PIN incorrecto (intento '+Math.min(f,5)+' de 5)';inp.value='';inp.focus()
    }catch(e){err.textContent='Error: '+e.message}};
  inp.onkeydown=e=>{if(e.key==='Enter')tryPin()};
  ov.append(h('h1',{},'text'),h('p',{},'Ingresa tu PIN'),inp,err,btn('Desbloquear',tryPin),btn('Mostrar / ocultar PIN',()=>{inp.type=inp.type==='password'?'text':'password';inp.focus()},1),
    btn('Olvide mi PIN (cerrar sesion)',()=>{if(confirm('Se cerrara tu sesion y se quitara el PIN. Continuar?')){ov.remove();locked=false;logout()}},1));
  document.body.append(ov);inp.focus()}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)hiddenAt=Date.now();
  else if(hiddenAt&&Date.now()-hiddenAt>=(+localStorage.getItem('lockms')||0))lock()});

const t0=(location.hash.match(/invite=([a-f0-9]{48})/)||[])[1];
if(t0){localStorage.setItem('inv',t0);history.replaceState(null,'',location.pathname)}
theme();lock();
tk?boot():show(loginView());