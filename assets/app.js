/* منظومة إدارة الموظفين السعوديين — لوحة الإدارة (البيانات على الخادم عبر api.php) */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls = { get(k){ try{return localStorage.getItem(k)}catch(e){return null} }, set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v) }catch(e){} } };
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'),2800); }

/* ---------- API ---------- */
async function api(a, body){
  let r;
  try{ r=await fetch('api.php?a='+a,{method:'POST',headers:{'Content-Type':'application/json','X-Req':'1'},credentials:'same-origin',body:JSON.stringify(body||{})}); }
  catch(e){ throw new Error('تعذّر الاتصال بالخادم'); }
  let j={}; try{ j=await r.json(); }catch(e){ throw new Error('استجابة غير صالحة من الخادم ('+r.status+')'); }
  if(r.status===401 && a!=='login'){ showLogin(); throw new Error(j.error||'يجب تسجيل الدخول'); }
  if(!r.ok||j.error) throw new Error(j.error||('خطأ '+r.status));
  return j;
}
async function act(fn){ try{ return await fn(); }catch(e){ alert(e.message); } }

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2,'0');
function todayISO(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function isoToUTC(iso){ const [y,m,d]=iso.split('-').map(Number); return Date.UTC(y,m-1,d); }
function utcToISO(t){ const d=new Date(t); return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate()); }
function daysLeft(iso){ if(!iso) return null; return Math.round((isoToUTC(iso)-isoToUTC(todayISO()))/864e5); }
function addMonths(iso,n){ if(!iso) return ''; const [y,m,d]=iso.split('-').map(Number); const last=new Date(Date.UTC(y,m-1+n+1,0)).getUTCDate(); return utcToISO(Date.UTC(y,m-1+n,Math.min(d,last))); }
function age(iso){ if(!iso) return null; const [y,m,d]=iso.split('-').map(Number); const t=todayISO().split('-').map(Number); let a=t[0]-y; if(t[1]<m||(t[1]===m&&t[2]<d)) a--; return a>=0?a:null; }
function fmt(iso){ if(!iso) return ''; const [y,m,d]=iso.slice(0,10).split('-'); return d+'/'+m+'/'+y; }
const hm = dt => dt ? dt.slice(11,16) : '';
const dur = mins => { if(mins==null||isNaN(mins)) return ''; mins=Math.round(mins); return Math.floor(mins/60)+':'+pad(mins%60); };
const minsBetween = (a,b) => (new Date(b.replace(' ','T'))-new Date(a.replace(' ','T')))/6e4;
const DAYS=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

let hijriFmt=null;
try{ hijriFmt=new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'numeric',year:'numeric',timeZone:'UTC'}); }catch(e){}
function g2h(iso){ if(!iso||!hijriFmt) return null; const p={}; hijriFmt.formatToParts(new Date(isoToUTC(iso))).forEach(x=>p[x.type]=x.value); return {y:+String(p.year).replace(/\D/g,''),m:+p.month,d:+p.day}; }
function g2hStr(iso){ const h=g2h(iso); return h?pad(h.d)+'/'+pad(h.m)+'/'+h.y:''; }
function h2g(str){ const m=String(str||'').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{3,4})$/); if(!m||!hijriFmt) return null;
  const hd=+m[1], hmn=+m[2], hy=+m[3]; if(hmn<1||hmn>12||hd<1||hd>30) return null;
  let t=Date.UTC(Math.round(hy*0.970229+621.5643),0,1);
  for(let i=0;i<6;i++){ const c=g2h(utcToISO(t)); const diff=Math.round((hy-c.y)*354.367+(hmn-c.m)*29.5306+(hd-c.d)); if(!diff) break; t+=diff*864e5; }
  for(let k=-3;k<=3;k++){ const iso=utcToISO(t+k*864e5), c=g2h(iso); if(c.y===hy&&c.m===hmn&&c.d===hd) return iso; }
  return null; }

/* ---------- model ---------- */
let emps=[], sites=[], shifts=[], todayAtt=[];
const shiftById = id => shifts.find(s=>+s.id===+id);
const siteById = id => sites.find(s=>+s.id===+id);
function fromServer(e){ return { id:+e.id, name:e.name, dob:e.dob||'', dobH:e.dob_h||'', nid:e.nid||'', idExp:e.id_exp||'', job:e.job||'', card:e.card||'', cardExp:e.card_exp||'', join:e.join_date||'', phone:e.phone||'', email:e.email||'', shift_id:e.shift_id?+e.shift_id:null, sites:e.sites||[], bound:+e.bound, code:e.act_code||'', deviceAt:e.device_at||'', photo:+e.photo }; }
function toServer(v){ return { name:v.name, dob:v.dob, dob_h:v.dobH, nid:v.nid, id_exp:v.idExp, job:v.job, card:v.card, card_exp:v.cardExp, join_date:v.join, phone:v.phone, email:v.email }; }
function enrich(e){ const sup=addMonths(e.join,3); const sh=shiftById(e.shift_id);
  return Object.assign({},e,{ age:age(e.dob), dobH:e.dobH||g2hStr(e.dob), idDays:daysLeft(e.idExp), cardDays:daysLeft(e.cardExp), sup, supDays:daysLeft(sup), shiftName:sh?sh.name:'' }); }
function state(d){ return d==null?'none':d<0?'dead':d<=30?'warn':'ok'; }
function pill(d){ const s=state(d); if(s==='none') return '<span class="s-none">—</span>';
  return '<span class="pill s-'+s+'">'+(d<0?'منتهية · '+(-d)+' يوم':d+' يوم')+'</span>'; }
function rows(){ return emps.map((e,i)=>Object.assign(enrich(e),{n:i+1})); }
async function loadEmps(){ emps=(await api('emps_list')).emps.map(fromServer); }
async function loadMeta(){ const [a,b]=await Promise.all([api('sites_list'),api('shifts_list')]); sites=a.sites; shifts=b.shifts; fillSelects(); }
async function loadToday(){ todayAtt=(await api('att_list',{from:todayISO(),to:todayISO()})).rows; }

function alertsList(){
  const out=[];
  rows().forEach(r=>{
    [['الهوية',r.idExp,r.idDays],['بطاقة الصراف',r.cardExp,r.cardDays],['الدعم',r.sup,r.supDays]].forEach(([t,dt,d])=>{
      const s=state(d); if(s==='dead'||s==='warn') out.push({name:r.name,type:t,date:dt,days:d,s});
    });
  });
  return out.sort((a,b)=>a.days-b.days);
}

/* late minutes for one attendance row */
function lateOf(r){ const e=emps.find(x=>x.id===+r.emp_id); const sh=e&&shiftById(e.shift_id); if(!sh) return null;
  const s0=new Date(r.work_date+'T'+sh.start_time+':00'), inT=new Date(r.in_time.replace(' ','T'));
  if(String(sh.off_days).split(',').filter(Boolean).map(Number).includes(new Date(r.work_date+'T12:00:00').getDay())) return null;
  const m=(inT-s0)/6e4; return m>+sh.grace?Math.round(m):0; }

/* ---------- render: dashboard ---------- */
function renderAll(){ renderDash(); renderList(); renderAlerts(); }
function kpi(l,v,cl){ return '<div class="card kpi '+(cl||'')+'"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>'; }
function renderDash(){
  const R=rows(); const c=k=>R.filter(k).length;
  const dow=new Date().getDay();
  const came=new Set(todayAtt.map(r=>+r.emp_id));
  const inside=new Set(todayAtt.filter(r=>!r.out_time).map(r=>+r.emp_id));
  const expected=emps.filter(e=>{ const sh=shiftById(e.shift_id); return sh && !String(sh.off_days).split(',').filter(Boolean).map(Number).includes(dow); });
  const now=new Date(); const absent=expected.filter(e=>{ const sh=shiftById(e.shift_id); return !came.has(e.id) && now>new Date(todayISO()+'T'+sh.start_time+':00'); }).length;
  const late=new Set(todayAtt.filter(r=>lateOf(r)>0).map(r=>+r.emp_id)).size;
  $('#todayLbl').textContent='— '+DAYS[dow]+' '+fmt(todayISO());
  $('#kpisAtt').innerHTML=kpi('داخل العمل الآن',inside.size,'')+kpi('حضروا اليوم',came.size,'')+kpi('متأخرون اليوم',late,'warn')+kpi('لم يحضروا بعد',absent,'bad')+kpi('بلا جوال مفعّل',emps.filter(e=>!e.bound).length,'');
  $('#kpis').innerHTML=[
    ['إجمالي الموظفين',R.length,''],['هويات منتهية',c(r=>state(r.idDays)==='dead'),'bad'],['هويات قريبة',c(r=>state(r.idDays)==='warn'),'warn'],
    ['بطاقات منتهية',c(r=>state(r.cardDays)==='dead'),'bad'],['بطاقات قريبة',c(r=>state(r.cardDays)==='warn'),'warn'],
    ['دعم منتهٍ',c(r=>state(r.supDays)==='dead'),'bad'],['دعم قريب',c(r=>state(r.supDays)==='warn'),'warn'],
  ].map(([l,v,cl])=>kpi(l,v,cl)).join('');
  const all=[]; R.forEach(r=>[r.idDays,r.cardDays,r.supDays].forEach(d=>all.push(state(d))));
  const st=[['منتهية',all.filter(s=>s==='dead').length,'f-bad'],['قريب الانتهاء',all.filter(s=>s==='warn').length,'f-warn'],['ساري',all.filter(s=>s==='ok').length,'f-ok']];
  const mx=Math.max(1,...st.map(x=>x[1]));
  $('#chartStatus').innerHTML=st.map(([l,n,f])=>'<div class="bar"><span>'+l+'</span><div class="t"><div class="f '+f+'" style="width:'+(n/mx*100)+'%"></div></div><span class="n">'+n+'</span></div>').join('');
  const ty=[['الهوية','idDays'],['بطاقة الصراف','cardDays'],['الدعم','supDays']].map(([l,key])=>[l,c(r=>state(r[key])==='dead'),c(r=>state(r[key])==='warn')]);
  const mx2=Math.max(1,...ty.map(x=>x[1]+x[2]));
  $('#chartType').innerHTML=ty.map(([l,d,w])=>'<div class="bar"><span>'+l+'</span><div class="t" style="display:flex"><div class="f f-bad" style="width:'+(d/mx2*100)+'%;border-radius:0"></div><div class="f f-warn" style="width:'+(w/mx2*100)+'%;border-radius:0"></div></div><span class="n">'+(d+w)+'</span></div>').join('');
  const n=alertsList().length; const ac=$('#alertCount'); ac.hidden=!n; ac.textContent=n;
}

/* ---------- render: employees ---------- */
let sortK='n', sortDir=1;
function renderList(){
  const q=$('#q').value.trim().toLowerCase(), f=$('#qField').value, st=$('#qStatus').value;
  const fields=f==='all'?['name','nid','job','card','phone','email']:[f];
  let R=rows().filter(r=>{
    if(q && !fields.some(k=>String(r[k]||'').toLowerCase().includes(q))) return false;
    const ss=[r.idDays,r.cardDays,r.supDays].map(state);
    if(st==='exp'&&!ss.includes('dead')) return false;
    if(st==='soon'&&!ss.includes('warn')) return false;
    if(st==='nodev'&&r.bound) return false;
    return true;
  });
  R.sort((a,b)=>{ const x=a[sortK],y=b[sortK]; if(x==null||x==='') return 1; if(y==null||y==='') return -1; return (typeof x==='number'?x-y:String(x).localeCompare(String(y),'ar'))*sortDir; });
  if(!emps.length){
    $('#tb').innerHTML='<tr><td colspan="20"><div class="empty"><div class="h2">لا يوجد موظفون بعد</div>أضف موظفًا جديدًا أو استورد ملف Excel الحالي (.xlsm).<br><button class="btn primary" onclick="document.getElementById(\'fileImport\').click()">⬆ استيراد ملف Excel</button></div></td></tr>';
    $('#listFoot').textContent=''; return;
  }
  $('#tb').innerHTML=R.map(r=>'<tr>'+
    '<td class="num">'+r.n+'</td><td class="name">'+esc(r.name)+'</td><td class="num">'+fmt(r.dob)+'</td><td class="num">'+esc(r.dobH)+'</td>'+
    '<td class="num">'+(r.age??'')+'</td><td class="num">'+esc(r.nid)+'</td><td class="num">'+fmt(r.idExp)+'</td><td>'+pill(r.idDays)+'</td>'+
    '<td>'+esc(r.job)+'</td><td class="num">'+esc(r.card)+'</td><td class="num">'+fmt(r.cardExp)+'</td><td>'+pill(r.cardDays)+'</td>'+
    '<td class="num">'+fmt(r.join)+'</td><td class="num">'+fmt(r.sup)+'</td><td>'+pill(r.supDays)+'</td>'+
    '<td class="num">'+esc(r.phone)+'</td><td>'+esc(r.email)+'</td><td>'+esc(r.shiftName||'—')+'</td>'+
    '<td>'+(r.bound?'<span class="pill s-ok">مفعّل</span>':r.code?'<span class="pill s-warn">بانتظار التفعيل</span>':'<span class="s-none">—</span>')+'</td>'+
    '<td><div class="acts"><button class="btn sm" data-edit="'+r.id+'" title="تعديل">✎</button><button class="btn sm" data-dev="'+r.id+'" title="جوال الحضور">📱</button><button class="btn sm" data-id="'+r.id+'" title="صورة الهوية">🪪'+(r.photo?' ✓':'')+'</button><button class="btn sm danger" data-del="'+r.id+'" title="حذف">🗑</button></div></td></tr>').join('')
    || '<tr><td colspan="20"><div class="empty">لا توجد نتائج مطابقة</div></td></tr>';
  $('#listFoot').textContent='عرض '+R.length+' من '+emps.length+' موظف';
}
function renderAlerts(){
  const t=$('#aType').value, s=$('#aState').value;
  const A=alertsList().filter(a=>(!t||a.type===t)&&(!s||a.s===s));
  $('#atb').innerHTML=A.map(a=>'<tr><td class="name">'+esc(a.name)+'</td><td>'+a.type+'</td><td class="num">'+fmt(a.date)+'</td><td class="num">'+a.days+'</td><td><span class="pill s-'+a.s+'">'+(a.s==='dead'?'منتهية':'قريب الانتهاء')+'</span></td></tr>').join('')
    || '<tr><td colspan="5"><div class="empty">لا توجد تنبيهات 👍</div></td></tr>';
}

/* ---------- tabs ---------- */
const loaders={ att:loadAtt, report:loadReport, sites:renderSites, shifts:renderShifts, dash:async()=>{ await loadToday(); renderDash(); } };
function show(v){ $$('nav.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===v)); $$('section.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v)); ls.set('tab',v); if(loaders[v]) act(loaders[v]); }
$$('nav.tabs button').forEach(b=>b.onclick=()=>show(b.dataset.v));
$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());

/* ---------- employees events ---------- */
['q','qField','qStatus'].forEach(id=>$('#'+id).addEventListener('input',renderList));
['aType','aState'].forEach(id=>$('#'+id).addEventListener('input',renderAlerts));
$('#btnShowAll').onclick=()=>{ $('#q').value=''; $('#qField').value='all'; $('#qStatus').value=''; sortK='n'; sortDir=1; renderList(); };
$$('#v-list th[data-k]').forEach(th=>th.onclick=()=>{ const k=th.dataset.k; if(sortK===k) sortDir*=-1; else { sortK=k; sortDir=1; } renderList(); });
$('#tb').addEventListener('click',ev=>{
  const b=ev.target.closest('button'); if(!b) return;
  const e=emps.find(x=>x.id===+(b.dataset.edit||b.dataset.id||b.dataset.del||b.dataset.dev));
  if(b.dataset.edit) openForm(e);
  if(b.dataset.id) openId(e);
  if(b.dataset.dev) openDev(e);
  if(b.dataset.del && confirm('حذف الموظف «'+e.name+'» وكل سجلات حضوره؟')) act(async()=>{ await api('emp_delete',{id:e.id}); await loadEmps(); renderAll(); toast('تم الحذف'); });
});

function fillSelects(){
  $('#empForm').elements.shift.innerHTML='<option value="">بدون وردية</option>'+shifts.map(s=>'<option value="'+s.id+'">'+esc(s.name)+' ('+s.start_time+'–'+s.end_time+')</option>').join('');
  $('#empSites').innerHTML=sites.map(s=>'<label><input type="checkbox" value="'+s.id+'"> '+esc(s.name)+'</label>').join('')||'<span class="muted">لا توجد مواقع بعد</span>';
  const cur=$('#attSite').value; $('#attSite').innerHTML='<option value="">كل المواقع</option>'+sites.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join(''); $('#attSite').value=cur;
}

/* ---------- employee form ---------- */
let editing=null;
const F=$('#empForm');
const FIELDS=['name','dob','dobH','nid','idExp','job','card','cardExp','join','phone','email'];
function openForm(e){
  editing=e||null; F.reset(); $('#empTitle').textContent=e?'تعديل بيانات موظف':'إضافة موظف';
  if(e) FIELDS.forEach(k=>F.elements[k].value=e[k]||'');
  if(e&&!e.dobH&&e.dob) F.elements.dobH.value=g2hStr(e.dob);
  F.elements.shift.value=e&&e.shift_id?e.shift_id:'';
  $$('#empSites input').forEach(c=>c.checked=!!(e&&e.sites.includes(+c.value)));
  hints(); $('#dlgEmp').showModal();
}
function hints(){ const a=age(F.elements.dob.value); $('#ageHint').textContent=a!=null?'العمر: '+a+' سنة':'';
  const s=addMonths(F.elements.join.value,3); $('#supHint').textContent=s?'تاريخ استحقاق الدعم: '+fmt(s):''; }
F.elements.dob.addEventListener('change',()=>{ F.elements.dobH.value=g2hStr(F.elements.dob.value); hints(); });
F.elements.dobH.addEventListener('change',()=>{ const g=h2g(F.elements.dobH.value); if(g){ F.elements.dob.value=g; hints(); } else if(F.elements.dobH.value) toast('صيغة التاريخ الهجري غير صحيحة'); });
F.elements.join.addEventListener('change',hints);
$('#btnAdd').onclick=()=>openForm(null);
F.addEventListener('submit',ev=>{
  ev.preventDefault();
  const v={}; FIELDS.forEach(k=>v[k]=F.elements[k].value.trim());
  if(!v.name) return;
  const body=Object.assign(toServer(v),{ id:editing?editing.id:0, shift_id:F.elements.shift.value||null, sites:$$('#empSites input:checked').map(c=>+c.value) });
  act(async()=>{ await api('emp_save',body); $('#dlgEmp').close();
    toast(editing?'تم حفظ التعديلات':'تمت إضافة الموظف برقم 1'); if(!editing) $('#btnShowAll').click();
    await loadEmps(); renderAll(); });
});

/* ---------- device activation ---------- */
let devEmp=null;
const attUrl=()=>new URL('att.html',location.href).href;
function openDev(e){
  devEmp=e; $('#devTitle').textContent='جوال الحضور — '+e.name;
  let h='';
  if(!e.nid) h='<p class="muted">أدخل رقم هوية الموظف أولًا، فهو يُستخدم في التفعيل.</p>';
  else if(e.bound) h='<p><span class="pill s-ok">مفعّل</span> منذ '+esc(e.deviceAt)+'</p><p class="muted">إنشاء رمز جديد سيلغي ربط الجوال الحالي.</p>';
  else if(e.code) h=devMsg(e);
  else h='<p class="muted">لم يُفعَّل جوال لهذا الموظف بعد. أنشئ رمز تفعيل وأرسله له.</p>';
  $('#devBody').innerHTML=h; $('#devGen').hidden=!e.nid; $('#dlgDev').showModal();
}
function devMsg(e){
  const text='مرحبًا '+e.name+'\nلتسجيل الحضور والانصراف افتح الرابط من جوالك:\n'+attUrl()+'\nرقم الهوية: '+e.nid+'\nرمز التفعيل: '+e.code;
  return '<p>رمز التفعيل:</p><div style="font-size:34px;font-weight:800;letter-spacing:6px;text-align:center;background:var(--brand-soft);border-radius:12px;padding:8px" dir="ltr">'+esc(e.code)+'</div>'+
    '<p class="muted">الرابط: <span dir="ltr">'+esc(attUrl())+'</span></p>'+
    '<div class="row"><button class="btn" id="devCopy">📋 نسخ الرسالة</button>'+(e.phone?'<a class="btn" target="_blank" rel="noopener" href="https://wa.me/'+esc(waNum(e.phone))+'?text='+encodeURIComponent(text)+'">إرسال واتساب</a>':'')+'</div>'+
    '<textarea id="devText" hidden>'+esc(text)+'</textarea>';
}
function waNum(p){ p=String(p).replace(/\D/g,''); if(p.startsWith('05')) p='966'+p.slice(1); else if(p.startsWith('5')&&p.length===9) p='966'+p; return p; }
$('#devGen').onclick=()=>{ if(devEmp.bound&&!confirm('سيتم إلغاء ربط الجوال الحالي. متابعة؟')) return;
  act(async()=>{ const r=await api('emp_code',{id:devEmp.id}); devEmp.code=r.code; devEmp.bound=0; $('#devBody').innerHTML=devMsg(devEmp); await loadEmps(); renderList(); }); };
$('#devBody').addEventListener('click',ev=>{ if(ev.target.id==='devCopy'){ navigator.clipboard.writeText($('#devText').value).then(()=>toast('تم نسخ الرسالة'),()=>toast('تعذّر النسخ')); } });

/* ---------- ID photos ---------- */
let idEmp=null;
async function openId(e){
  idEmp=e; $('#idTitle').textContent='صورة الهوية — '+e.name;
  if(!e.nid){ $('#idBody').innerHTML='<p class="muted">أدخل رقم الهوية للموظف أولًا لربط الصورة به.</p>'; $('#idDel').hidden=true; $('#dlgId').showModal(); return; }
  $('#idBody').innerHTML='<p class="muted">جارٍ التحميل…</p>'; $('#dlgId').showModal();
  const r=await act(()=>api('photo_get',{nid:e.nid})); const d=r&&r.data;
  $('#idBody').innerHTML=d?'<img class="idimg" alt="صورة الهوية" src="'+esc(d)+'">':'<p class="muted">لا توجد صورة هوية مرفقة لهذا الموظف.</p>';
  $('#idDel').hidden=!d;
}
function shrink(file){ return new Promise((res,rej)=>{ const img=new Image(); const u=URL.createObjectURL(file);
  img.onload=()=>{ const mx=1600, sc=Math.min(1,mx/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg',.85)); };
  img.onerror=rej; img.src=u; }); }
$('#idFile').onchange=async ev=>{ const f=ev.target.files[0]; ev.target.value=''; if(!f||!idEmp||!idEmp.nid) return;
  await act(async()=>{ await api('photo_put',{nid:idEmp.nid,data:await shrink(f)}); toast('تم حفظ صورة الهوية'); await loadEmps(); renderList(); openId(emps.find(x=>x.id===idEmp.id)); }); };
$('#idDel').onclick=()=>{ if(idEmp&&confirm('حذف صورة الهوية؟')) act(async()=>{ await api('photo_del',{nid:idEmp.nid}); await loadEmps(); renderList(); openId(idEmp); }); };

/* ---------- attendance ---------- */
let attRows=[];
const METHOD={qr:'باركود',gps:'موقع',manual:'يدوي'};
function cell(t,m,site,lat,lng){ if(!t) return '<span class="s-none">—</span>';
  return '<b class="num">'+hm(t)+'</b> <span class="pill s-'+(m==='manual'?'warn':'ok')+'" style="font-weight:600">'+(METHOD[m]||m||'')+'</span>'+(site?' <span class="muted">'+esc(site)+'</span>':'')+
    (lat!=null?' <a href="https://maps.google.com/?q='+lat+','+lng+'" target="_blank" rel="noopener" title="عرض الموقع على الخريطة">📍</a>':''); }
async function loadAtt(){
  if(!$('#attFrom').value){ $('#attFrom').value=todayISO(); $('#attTo').value=todayISO(); }
  attRows=(await api('att_list',{from:$('#attFrom').value,to:$('#attTo').value||$('#attFrom').value})).rows; renderAtt();
}
function renderAtt(){
  const q=$('#attQ').value.trim().toLowerCase(), si=$('#attSite').value, st=$('#attState').value;
  const R=attRows.filter(r=>(!q||String(r.name).toLowerCase().includes(q)||String(r.nid||'').includes(q))&&(!si||+r.in_site===+si||+r.out_site===+si)&&(!st||(st==='open'?!r.out_time:!!r.edited_by)));
  $('#attTb').innerHTML=R.map(r=>{ const l=lateOf(r);
    return '<tr><td class="name">'+esc(r.name)+'</td><td class="num">'+fmt(r.work_date)+'</td>'+
    '<td>'+cell(r.in_time,r.in_method,r.in_site_name,r.in_lat,r.in_lng)+'</td><td>'+cell(r.out_time,r.out_method,r.out_site_name,r.out_lat,r.out_lng)+'</td>'+
    '<td class="num">'+(r.out_time?dur(minsBetween(r.in_time,r.out_time)):'<span class="pill s-ok">داخل</span>')+'</td>'+
    '<td>'+(l?'<span class="pill s-warn">'+l+' د</span>':l===0?'<span class="s-none">0</span>':'')+'</td>'+
    '<td style="white-space:normal;min-width:120px">'+esc(r.note||'')+(r.edited_by?' <span class="muted">('+esc(r.edited_by)+')</span>':'')+'</td>'+
    '<td><div class="acts"><button class="btn sm" data-aedit="'+r.id+'">✎</button><button class="btn sm danger" data-adel="'+r.id+'">🗑</button></div></td></tr>'; }).join('')
    || '<tr><td colspan="8"><div class="empty">لا توجد سجلات في هذه الفترة</div></td></tr>';
  $('#attFoot').textContent=R.length+' سجل';
}
['attFrom','attTo'].forEach(id=>$('#'+id).addEventListener('change',()=>{ if($('#attTo').value<$('#attFrom').value) $('#attTo').value=$('#attFrom').value; act(loadAtt); }));
['attQ','attSite','attState'].forEach(id=>$('#'+id).addEventListener('input',renderAtt));
let attEditing=null; const AF=$('#attForm');
function openAtt(r){
  attEditing=r||null; AF.reset(); $('#attTitle').textContent=r?'تعديل سجل حضور':'تسجيل يدوي';
  AF.elements.emp.innerHTML=emps.map(e=>'<option value="'+e.id+'">'+esc(e.name)+'</option>').join('');
  AF.elements.emp.disabled=!!r;
  if(r){ AF.elements.emp.value=r.emp_id; AF.elements.in.value=r.in_time.replace(' ','T').slice(0,16); AF.elements.out.value=r.out_time?r.out_time.replace(' ','T').slice(0,16):''; AF.elements.note.value=r.note||''; }
  else AF.elements.in.value=todayISO()+'T08:00';
  $('#dlgAtt').showModal();
}
$('#attAdd').onclick=()=>openAtt(null);
$('#attTb').addEventListener('click',ev=>{ const b=ev.target.closest('button'); if(!b) return;
  const r=attRows.find(x=>+x.id===+(b.dataset.aedit||b.dataset.adel));
  if(b.dataset.aedit) openAtt(r);
  if(b.dataset.adel&&confirm('حذف سجل '+r.name+' بتاريخ '+fmt(r.work_date)+'؟')) act(async()=>{ await api('att_delete',{id:r.id}); await loadAtt(); toast('تم الحذف'); });
});
AF.addEventListener('submit',ev=>{ ev.preventDefault();
  act(async()=>{ await api('att_save',{id:attEditing?attEditing.id:0,emp_id:+AF.elements.emp.value,in_time:AF.elements.in.value,out_time:AF.elements.out.value,note:AF.elements.note.value});
    $('#dlgAtt').close(); toast('تم الحفظ'); await loadAtt(); await loadToday(); renderDash(); }); });
$('#attExport').onclick=()=>{ if(!xlsxOk()) return;
  const H=['الموظف','رقم الهوية','التاريخ','الحضور','طريقة الحضور','موقع الحضور','الانصراف','طريقة الانصراف','موقع الانصراف','المدة (ساعة:دقيقة)','التأخير (دقيقة)','ملاحظة','عُدّل بواسطة'];
  const D=attRows.map(r=>[r.name,r.nid||'',r.work_date,hm(r.in_time),METHOD[r.in_method]||'',r.in_site_name||'',hm(r.out_time),METHOD[r.out_method]||'',r.out_site_name||'',r.out_time?dur(minsBetween(r.in_time,r.out_time)):'',lateOf(r)??'',r.note||'',r.edited_by||'']);
  saveXlsx([H].concat(D),'الحضور','الحضور '+$('#attFrom').value+' إلى '+$('#attTo').value); };

/* ---------- monthly report ---------- */
let repRows=[];
async function loadReport(){ if(!$('#repMonth').value) $('#repMonth').value=todayISO().slice(0,7); repRows=(await api('report',{month:$('#repMonth').value})).rows; renderReport(); }
function renderReport(){
  $('#repTb').innerHTML=repRows.map(r=>'<tr><td class="name">'+esc(r.name)+'</td><td>'+esc(r.shift||'—')+'</td><td class="num">'+r.present+'</td>'+
    '<td class="num">'+(r.absent==null?'—':r.absent?'<span class="pill s-dead">'+r.absent+'</span>':0)+'</td>'+
    '<td class="num">'+(r.late?'<span class="pill s-warn">'+dur(r.late)+'</span>':'0')+'</td><td class="num">'+(r.early?dur(r.early):'0')+'</td>'+
    '<td class="num">'+(r.over?'<span class="pill s-ok">'+dur(r.over)+'</span>':'0')+'</td><td class="num"><b>'+dur(r.mins)+'</b></td><td class="num">'+(r.open||'')+'</td></tr>').join('')
    || '<tr><td colspan="9"><div class="empty">لا يوجد موظفون</div></td></tr>';
}
$('#repMonth').addEventListener('change',()=>act(loadReport));
$('#repExport').onclick=()=>{ if(!xlsxOk()) return;
  const H=['الموظف','رقم الهوية','المهنة','الوردية','أيام الحضور','أيام الغياب','التأخير (ساعة:دقيقة)','خروج مبكر','إضافي','ساعات العمل','سجلات بدون انصراف'];
  saveXlsx([H].concat(repRows.map(r=>[r.name,r.nid||'',r.job||'',r.shift||'',r.present,r.absent??'',dur(r.late),dur(r.early),dur(r.over),dur(r.mins),r.open])),'التقرير الشهري','تقرير الحضور '+$('#repMonth').value); };
$('#repPrint').onclick=()=>printView('#v-report');

/* ---------- sites ---------- */
const kioskUrl=s=>new URL('kiosk.html?site='+s.id+'&k='+s.kiosk_key,location.href).href;
function renderSites(){
  $('#siteTb').innerHTML=sites.map(s=>'<tr><td class="name">'+esc(s.name)+'</td>'+
    '<td class="num" dir="ltr">'+(s.lat!=null?'<a href="https://maps.google.com/?q='+s.lat+','+s.lng+'" target="_blank" rel="noopener">'+(+s.lat).toFixed(5)+', '+(+s.lng).toFixed(5)+'</a>':'—')+'</td>'+
    '<td class="num">'+s.radius+' م</td><td>'+(+s.allow_qr?'<span class="pill s-ok">باركود</span> ':'')+(+s.allow_gps?'<span class="pill s-ok">موقع</span>':'')+'</td>'+
    '<td>'+(+s.allow_qr?'<div class="acts"><a class="btn sm" href="'+esc(kioskUrl(s))+'" target="_blank" rel="noopener">فتح الشاشة</a><button class="btn sm" data-scopy="'+s.id+'">نسخ الرابط</button><button class="btn sm" data-skey="'+s.id+'" title="إذا تسرّب رابط الشاشة">تغيير الرابط</button></div>':'')+'</td>'+
    '<td><div class="acts"><button class="btn sm" data-sedit="'+s.id+'">✎</button><button class="btn sm danger" data-sdel="'+s.id+'">🗑</button></div></td></tr>').join('')
    || '<tr><td colspan="6"><div class="empty">أضف أول موقع (مصنع أو موقع عمل) لبدء تسجيل الحضور.</div></td></tr>';
}
$('#siteTb').addEventListener('click',ev=>{ const b=ev.target.closest('button'); if(!b) return;
  const s=siteById(b.dataset.sedit||b.dataset.sdel||b.dataset.scopy||b.dataset.skey);
  if(b.dataset.sedit) openSite(s);
  if(b.dataset.scopy) navigator.clipboard.writeText(kioskUrl(s)).then(()=>toast('تم نسخ رابط الشاشة'));
  if(b.dataset.skey&&confirm('سيتوقف رابط الشاشة الحالي عن العمل وتحتاج فتح الرابط الجديد على الشاشة. متابعة؟')) act(async()=>{ await api('site_rekey',{id:s.id}); await loadMeta(); renderSites(); toast('تم تغيير الرابط'); });
  if(b.dataset.sdel&&confirm('حذف الموقع «'+s.name+'»؟ سجلات الحضور السابقة تبقى.')) act(async()=>{ await api('site_delete',{id:s.id}); await loadMeta(); renderSites(); });
});
let siteEditing=null; const SF=$('#siteForm');
function openSite(s){ siteEditing=s||null; SF.reset(); $('#siteTitle').textContent=s?'تعديل موقع':'إضافة موقع'; $('#siteHereHint').textContent='';
  if(s){ SF.elements.name.value=s.name; SF.elements.lat.value=s.lat??''; SF.elements.lng.value=s.lng??''; SF.elements.radius.value=s.radius; SF.elements.qr.checked=!!+s.allow_qr; SF.elements.gps.checked=!!+s.allow_gps; }
  radHint(); mapLink(); $('#dlgSite').showModal(); }
function radHint(){ const r=+SF.elements.radius.value; $('#radHint').textContent=r<20?'⚠ نطاق صغير جدًا: دقة GPS في الجوال 5–20 م، وقد يُرفض تسجيل موظفين داخل الموقع. ننصح بـ 30–100 م.':''; }
function mapLink(){ const a=$('#siteMap'), la=SF.elements.lat.value, lo=SF.elements.lng.value; a.hidden=!(la&&lo); a.href='https://maps.google.com/?q='+la+','+lo; }
SF.elements.radius.addEventListener('input',radHint); [SF.elements.lat,SF.elements.lng].forEach(i=>i.addEventListener('input',mapLink));
$('#siteHere').onclick=()=>{ if(!navigator.geolocation) return alert('المتصفح لا يدعم تحديد الموقع');
  $('#siteHereHint').textContent='جارٍ تحديد الموقع…';
  navigator.geolocation.getCurrentPosition(p=>{ SF.elements.lat.value=p.coords.latitude.toFixed(7); SF.elements.lng.value=p.coords.longitude.toFixed(7); $('#siteHereHint').textContent='الدقة: '+Math.round(p.coords.accuracy)+' م'; mapLink(); },
    e=>{ $('#siteHereHint').textContent='تعذّر تحديد الموقع: '+e.message; },{enableHighAccuracy:true,timeout:20000,maximumAge:0}); };
$('#siteAdd').onclick=()=>openSite(null);
SF.addEventListener('submit',ev=>{ ev.preventDefault();
  act(async()=>{ await api('site_save',{id:siteEditing?siteEditing.id:0,name:SF.elements.name.value,lat:SF.elements.lat.value,lng:SF.elements.lng.value,radius:+SF.elements.radius.value,allow_qr:SF.elements.qr.checked,allow_gps:SF.elements.gps.checked});
    $('#dlgSite').close(); toast('تم حفظ الموقع'); await loadMeta(); renderSites(); }); });

/* ---------- shifts ---------- */
function renderShifts(){
  $('#shiftTb').innerHTML=shifts.map(s=>'<tr><td class="name">'+esc(s.name)+'</td><td class="num">'+s.start_time+'</td><td class="num">'+s.end_time+(s.end_time<=s.start_time?' <span class="muted">(ليلية)</span>':'')+'</td><td class="num">'+s.grace+' د</td>'+
    '<td>'+String(s.off_days).split(',').filter(Boolean).map(d=>DAYS[+d]).join('، ')+'</td><td class="num">'+emps.filter(e=>e.shift_id===+s.id).length+'</td>'+
    '<td><div class="acts"><button class="btn sm" data-hedit="'+s.id+'">✎</button><button class="btn sm danger" data-hdel="'+s.id+'">🗑</button></div></td></tr>').join('')
    || '<tr><td colspan="7"><div class="empty">أضف وردية لحساب التأخير والغياب.</div></td></tr>';
}
$('#offDays').innerHTML=DAYS.map((d,i)=>'<label><input type="checkbox" value="'+i+'"> '+d+'</label>').join('');
$('#shiftTb').addEventListener('click',ev=>{ const b=ev.target.closest('button'); if(!b) return;
  const s=shiftById(b.dataset.hedit||b.dataset.hdel);
  if(b.dataset.hedit) openShift(s);
  if(b.dataset.hdel&&confirm('حذف الوردية «'+s.name+'»؟ سيصبح موظفوها بدون وردية.')) act(async()=>{ await api('shift_delete',{id:s.id}); await loadMeta(); await loadEmps(); renderShifts(); renderList(); });
});
let shiftEditing=null; const HF=$('#shiftForm');
function openShift(s){ shiftEditing=s||null; HF.reset(); $('#shiftTitle').textContent=s?'تعديل وردية':'إضافة وردية';
  const off=s?String(s.off_days).split(',').filter(Boolean).map(Number):[5];
  if(s){ HF.elements.name.value=s.name; HF.elements.start.value=s.start_time; HF.elements.end.value=s.end_time; HF.elements.grace.value=s.grace; }
  $$('#offDays input').forEach(c=>c.checked=off.includes(+c.value)); $('#dlgShift').showModal(); }
$('#shiftAdd').onclick=()=>openShift(null);
HF.addEventListener('submit',ev=>{ ev.preventDefault();
  act(async()=>{ await api('shift_save',{id:shiftEditing?shiftEditing.id:0,name:HF.elements.name.value,start_time:HF.elements.start.value,end_time:HF.elements.end.value,grace:+HF.elements.grace.value,off_days:$$('#offDays input:checked').map(c=>+c.value)});
    $('#dlgShift').close(); toast('تم حفظ الوردية'); await loadMeta(); renderShifts(); renderList(); }); });

/* ---------- Excel import / export ---------- */
const xlsxOk=()=>{ if(typeof XLSX==='undefined'){ alert('تعذّر تحميل مكتبة Excel. تأكد من اتصال الإنترنت.'); return false; } return true; };
function saveXlsx(aoa,sheet,file){ const ws=XLSX.utils.aoa_to_sheet(aoa,{cellDates:true,dateNF:'dd/mm/yyyy'});
  ws['!cols']=aoa[0].map((h,i)=>({wch:i===0?30:Math.max(12,String(h).length+2)}));
  const wb=XLSX.utils.book_new(); wb.Workbook={Views:[{RTL:true}]}; XLSX.utils.book_append_sheet(wb,ws,sheet); XLSX.writeFile(wb,file+'.xlsx'); }
function cellToISO(v){
  if(v==null||v==='') return '';
  if(v instanceof Date) return v.getFullYear()+'-'+pad(v.getMonth()+1)+'-'+pad(v.getDate());
  if(typeof v==='number'&&v>1000&&v<80000) return utcToISO(Math.round((v-25569)*864e5));
  const s=String(v).trim(); let m;
  if((m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  if((m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))){ if(+m[3]<1600) return h2g(s)||''; return m[3]+'-'+pad(m[2])+'-'+pad(m[1]); }
  return '';
}
function txt(v){ if(v==null) return ''; if(typeof v==='number') return v.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:0}); return String(v).trim(); }
const COLS=[['name',h=>h.includes('اسم')],['dobH',h=>h.includes('هجري')],['dob',h=>h.includes('الميلاد')],['idExp',h=>h.includes('انتهاء')&&h.includes('الهوية')],
  ['nid',h=>h.includes('رقم الهوية')||h==='الهوية'],['cardExp',h=>h.includes('انتهاء')&&h.includes('بطاقة')],['card',h=>h.includes('بطاقة')&&!h.includes('المتبقية')],
  ['job',h=>h.includes('المهنة')],['join',h=>h.includes('الالتحاق')],['phone',h=>h.includes('الجوال')],['email',h=>h.includes('البريد')]];
function parseWorkbook(wb){
  for(const sn of wb.SheetNames){
    const A=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true,defval:null});
    for(let r=0;r<Math.min(A.length,30);r++){
      const hdr=(A[r]||[]).map(x=>String(x??'').trim());
      if(!hdr.some(h=>h.includes('اسم'))||!hdr.some(h=>h.includes('الهوية'))) continue;
      const map={};
      hdr.forEach((h,i)=>{ if(!h||h.includes('المتبقية')||h.includes('العمر')||h.includes('عرض')) return; for(const [k,t] of COLS){ if(map[k]==null&&t(h)){ map[k]=i; break; } } });
      if(map.name==null) continue;
      const out=[];
      for(let i=r+1;i<A.length;i++){ const row=A[i]||[]; const name=txt(row[map.name]); if(!name) continue;
        const e={name}; ['nid','job','card','phone','email'].forEach(k=>e[k]=map[k]!=null?txt(row[map[k]]):'');
        ['dob','idExp','cardExp','join'].forEach(k=>e[k]=map[k]!=null?cellToISO(row[map[k]]):'');
        e.dobH=map.dobH!=null?txt(row[map.dobH]):''; if(!e.dob&&e.dobH) e.dob=h2g(e.dobH)||''; if(!e.dobH&&e.dob) e.dobH=g2hStr(e.dob);
        if(e.nid==='0') e.nid='';
        out.push(e); }
      return out;
    }
  }
  return null;
}
$('#btnImport').onclick=()=>$('#fileImport').click();
$('#fileImport').onchange=async ev=>{
  const f=ev.target.files[0]; ev.target.value=''; if(!f||!xlsxOk()) return;
  await act(async()=>{
    const list=parseWorkbook(XLSX.read(await f.arrayBuffer(),{type:'array'}));
    if(!list||!list.length) throw new Error('لم يتم العثور على جدول موظفين في الملف. يجب أن يحتوي على عمود «اسم المشترك» وعمود «رقم الهوية».');
    if(!confirm('سيتم تحديث/إضافة '+list.length+' موظف من الملف (المطابقة برقم الهوية، ولن يُحذف أحد). متابعة؟')) return;
    const r=await api('emps_import',{list:list.map(toServer)});
    await loadEmps(); renderAll(); show('list'); toast('أُضيف '+r.added+' وحُدِّث '+r.updated+' موظف');
  });
};
$('#btnExport').onclick=()=>{ if(!xlsxOk()) return;
  const H=['#','اسم المشترك','تاريخ الميلاد','تاريخ الميلاد (هجري)','العمر','رقم الهوية','تاريخ انتهاء الهوية','الأيام المتبقية (الهوية)','المهنة','رقم بطاقة الصراف','تاريخ انتهاء بطاقة الصراف','الأيام المتبقية (بطاقة الصراف)','تاريخ الالتحاق','تاريخ الدعم','الأيام المتبقية (الدعم)','رقم الجوال','البريد الإلكتروني','الوردية'];
  const D=v=>v?new Date(isoToUTC(v)+new Date(isoToUTC(v)).getTimezoneOffset()*6e4):'';
  saveXlsx([H].concat(rows().map(r=>[r.n,r.name,D(r.dob),r.dobH,r.age??'',r.nid,D(r.idExp),r.idDays??'',r.job,r.card,D(r.cardExp),r.cardDays??'',D(r.join),D(r.sup),r.supDays??'',r.phone,r.email,r.shiftName])),'سجل الموظفين','سجل الموظفين '+todayISO());
};

/* ---------- alerts popup / print ---------- */
function popup(){
  const A=alertsList(); if(!A.length) return;
  try{ if(sessionStorage.getItem('popShown')) return; sessionStorage.setItem('popShown','1'); }catch(e){}
  $('#popList').innerHTML=A.slice(0,40).map(a=>'<li><span><b>'+esc(a.name)+'</b> — '+a.type+'</span><span class="pill s-'+a.s+'">'+(a.days<0?'منتهية منذ '+(-a.days)+' يوم':'باقي '+a.days+' يوم')+'</span></li>').join('')+(A.length>40?'<li class="muted">و '+(A.length-40)+' تنبيهات أخرى…</li>':'');
  $('#dlgAlerts').showModal();
}
$('#popGo').onclick=()=>{ $('#dlgAlerts').close(); show('alerts'); };
function printView(sel){ const s=$(sel); s.classList.add('printing'); window.print(); setTimeout(()=>s.classList.remove('printing'),500); }
$('#btnPrint').onclick=()=>printView('#v-alerts');

/* ---------- settings ---------- */
$('#btnSettings').onclick=()=>{ $('#pwOld').value=$('#pwNew').value=$('#adU').value=$('#adP').value=''; $('#theme').value=ls.get('theme')||''; $('#dlgSet').showModal(); };
$('#pwSave').onclick=()=>act(async()=>{ await api('admin_pass',{old:$('#pwOld').value,new:$('#pwNew').value}); toast('تم تغيير كلمة المرور'); $('#pwOld').value=$('#pwNew').value=''; });
$('#adSave').onclick=()=>act(async()=>{ await api('admin_add',{u:$('#adU').value.trim(),p:$('#adP').value}); toast('تمت إضافة المدير'); $('#adU').value=$('#adP').value=''; });
function applyTheme(){ const t=ls.get('theme'); if(t) document.documentElement.dataset.theme=t; else delete document.documentElement.dataset.theme; }
$('#theme').onchange=e=>{ ls.set('theme',e.target.value||null); applyTheme(); };
$('#logout').onclick=()=>act(async()=>{ await api('logout'); location.reload(); });

/* ---------- login + boot ---------- */
function showLogin(){ $('#lock').classList.add('on'); setTimeout(()=>$('#lu').focus(),50); }
$('#loginForm').addEventListener('submit',async ev=>{ ev.preventDefault(); $('#lockErr').textContent='';
  try{ await api('login',{u:$('#lu').value.trim(),p:$('#lp').value}); $('#lp').value=''; $('#lock').classList.remove('on'); start(); }
  catch(e){ $('#lockErr').textContent=e.message; } });

async function start(){
  try{ await Promise.all([loadMeta(),loadEmps(),loadToday()]); }catch(e){ $('#lockErr').textContent=e.message; return; }
  $('#meLbl').textContent='';
  renderAll();
  const t=ls.get('tab'); if(t&&$('#v-'+t)) show(t); else if(!emps.length) show('list');
  popup();
  clearInterval(start._t); start._t=setInterval(()=>{ if(document.hidden) return; const v=ls.get('tab'); if(v==='dash'||v===null) act(async()=>{ await loadToday(); renderDash(); }); else if(v==='att'&&$('#attTo').value>=todayISO()) act(loadAtt); },60000);
}
(async function boot(){
  applyTheme();
  try{ const me=await api('me'); if(!me.user){ showLogin(); return; } start(); }
  catch(e){ $('#lockErr').textContent=e.message; showLogin(); }
})();
})();
