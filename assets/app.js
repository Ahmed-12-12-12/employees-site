/* منظومة إدارة الموظفين السعوديين — كل البيانات تُحفظ في متصفح المستخدم (IndexedDB) */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls = { get(k){ try{return localStorage.getItem(k)}catch(e){return null} }, set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v) }catch(e){} } };
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'),2600); }

/* ---------- storage ---------- */
let db;
function openDB(){ return new Promise((res,rej)=>{ const r=indexedDB.open('saudi-emp-db',1);
  r.onupgradeneeded=()=>{ const d=r.result; d.createObjectStore('emps',{keyPath:'uid'}); d.createObjectStore('photos',{keyPath:'nid'}); };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function tx(store,mode,fn){ return new Promise((res,rej)=>{ const t=db.transaction(store,mode); const s=t.objectStore(store); const out=fn(s); t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out); t.onerror=()=>rej(t.error); }); }
const getAll = st => tx(st,'readonly',s=>s.getAll());
const put = (st,v) => tx(st,'readwrite',s=>{ s.put(v); });
const del = (st,k) => tx(st,'readwrite',s=>{ s.delete(k); });
const clear = st => tx(st,'readwrite',s=>{ s.clear(); });
const getOne = (st,k) => tx(st,'readonly',s=>s.get(k));

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2,'0');
function todayISO(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function isoToUTC(iso){ const [y,m,d]=iso.split('-').map(Number); return Date.UTC(y,m-1,d); }
function utcToISO(t){ const d=new Date(t); return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate()); }
function daysLeft(iso){ if(!iso) return null; return Math.round((isoToUTC(iso)-isoToUTC(todayISO()))/864e5); }
function addMonths(iso,n){ if(!iso) return ''; const [y,m,d]=iso.split('-').map(Number); const last=new Date(Date.UTC(y,m-1+n+1,0)).getUTCDate(); return utcToISO(Date.UTC(y,m-1+n,Math.min(d,last))); }
function age(iso){ if(!iso) return null; const [y,m,d]=iso.split('-').map(Number); const t=todayISO().split('-').map(Number); let a=t[0]-y; if(t[1]<m||(t[1]===m&&t[2]<d)) a--; return a>=0?a:null; }
function fmt(iso){ if(!iso) return ''; const [y,m,d]=iso.split('-'); return d+'/'+m+'/'+y; }

let hijriFmt=null;
try{ hijriFmt=new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'numeric',year:'numeric',timeZone:'UTC'}); }catch(e){}
function g2h(iso){ if(!iso||!hijriFmt) return null; const p={}; hijriFmt.formatToParts(new Date(isoToUTC(iso))).forEach(x=>p[x.type]=x.value); return {y:+String(p.year).replace(/\D/g,''),m:+p.month,d:+p.day}; }
function g2hStr(iso){ const h=g2h(iso); return h?pad(h.d)+'/'+pad(h.m)+'/'+h.y:''; }
function h2g(str){ const m=String(str||'').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{3,4})$/); if(!m||!hijriFmt) return null;
  const hd=+m[1], hm=+m[2], hy=+m[3]; if(hm<1||hm>12||hd<1||hd>30) return null;
  let t=Date.UTC(Math.round(hy*0.970229+621.5643),0,1);
  for(let i=0;i<6;i++){ const c=g2h(utcToISO(t)); const diff=Math.round((hy-c.y)*354.367+(hm-c.m)*29.5306+(hd-c.d)); if(!diff) break; t+=diff*864e5; }
  for(let k=-3;k<=3;k++){ const iso=utcToISO(t+k*864e5), c=g2h(iso); if(c.y===hy&&c.m===hm&&c.d===hd) return iso; }
  return null; }

/* ---------- model ---------- */
let emps=[];          // sorted by ord asc
let photoSet=new Set();
function enrich(e){
  const sup=addMonths(e.join,3);
  return Object.assign({},e,{ age:age(e.dob), dobH:e.dobH||g2hStr(e.dob), idDays:daysLeft(e.idExp), cardDays:daysLeft(e.cardExp), sup, supDays:daysLeft(sup) });
}
function state(d){ return d==null?'none':d<0?'dead':d<=30?'warn':'ok'; }
function pill(d){ const s=state(d); if(s==='none') return '<span class="s-none">—</span>';
  const txt = d<0 ? 'منتهية · '+(-d)+' يوم' : d+' يوم'; return '<span class="pill s-'+s+'">'+txt+'</span>'; }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
async function load(){ emps=(await getAll('emps')).sort((a,b)=>a.ord-b.ord); photoSet=new Set((await tx('photos','readonly',s=>s.getAllKeys()))); }
function rows(){ return emps.map((e,i)=>Object.assign(enrich(e),{n:i+1})); }

function alertsList(){
  const out=[];
  rows().forEach(r=>{
    [['الهوية',r.idExp,r.idDays],['بطاقة الصراف',r.cardExp,r.cardDays],['الدعم',r.sup,r.supDays]].forEach(([t,dt,d])=>{
      const s=state(d); if(s==='dead'||s==='warn') out.push({name:r.name,uid:r.uid,type:t,date:dt,days:d,s});
    });
  });
  return out.sort((a,b)=>a.days-b.days);
}

/* ---------- render ---------- */
function renderAll(){ renderDash(); renderList(); renderAlerts(); }
function renderDash(){
  const R=rows(); const c=k=>R.filter(k).length;
  const k=[
    ['إجمالي الموظفين',R.length,''],
    ['هويات منتهية',c(r=>state(r.idDays)==='dead'),'bad'],
    ['هويات قريبة',c(r=>state(r.idDays)==='warn'),'warn'],
    ['بطاقات منتهية',c(r=>state(r.cardDays)==='dead'),'bad'],
    ['بطاقات قريبة',c(r=>state(r.cardDays)==='warn'),'warn'],
    ['دعم منتهٍ',c(r=>state(r.supDays)==='dead'),'bad'],
    ['دعم قريب',c(r=>state(r.supDays)==='warn'),'warn'],
  ];
  $('#kpis').innerHTML=k.map(([l,v,cl])=>'<div class="card kpi '+cl+'"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>').join('');
  const all=[]; R.forEach(r=>[r.idDays,r.cardDays,r.supDays].forEach(d=>all.push(state(d))));
  const st=[['منتهية',all.filter(s=>s==='dead').length,'f-bad'],['قريب الانتهاء',all.filter(s=>s==='warn').length,'f-warn'],['ساري',all.filter(s=>s==='ok').length,'f-ok']];
  const mx=Math.max(1,...st.map(x=>x[1]));
  $('#chartStatus').innerHTML=st.map(([l,n,f])=>'<div class="bar"><span>'+l+'</span><div class="t"><div class="f '+f+'" style="width:'+(n/mx*100)+'%"></div></div><span class="n">'+n+'</span></div>').join('');
  const ty=[['الهوية','idDays'],['بطاقة الصراف','cardDays'],['الدعم','supDays']].map(([l,key])=>[l,c(r=>state(r[key])==='dead'),c(r=>state(r[key])==='warn')]);
  const mx2=Math.max(1,...ty.map(x=>x[1]+x[2]));
  $('#chartType').innerHTML=ty.map(([l,d,w])=>'<div class="bar"><span>'+l+'</span><div class="t" style="display:flex"><div class="f f-bad" style="width:'+(d/mx2*100)+'%;border-radius:0"></div><div class="f f-warn" style="width:'+(w/mx2*100)+'%;border-radius:0"></div></div><span class="n">'+(d+w)+'</span></div>').join('');
  const n=alertsList().length; const ac=$('#alertCount'); ac.hidden=!n; ac.textContent=n;
}

let sortK='n', sortDir=1;
function renderList(){
  const q=$('#q').value.trim().toLowerCase(), f=$('#qField').value, st=$('#qStatus').value;
  const fields=f==='all'?['name','nid','job','card','phone','email']:[f];
  let R=rows().filter(r=>{
    if(q && !fields.some(k=>String(r[k]||'').toLowerCase().includes(q))) return false;
    const ss=[r.idDays,r.cardDays,r.supDays].map(state);
    if(st==='exp'&&!ss.includes('dead')) return false;
    if(st==='soon'&&!ss.includes('warn')) return false;
    return true;
  });
  R.sort((a,b)=>{ const x=a[sortK],y=b[sortK]; if(x==null||x==='') return 1; if(y==null||y==='') return -1; return (typeof x==='number'?x-y:String(x).localeCompare(String(y),'ar'))*sortDir; });
  if(!emps.length){
    $('#tb').innerHTML='<tr><td colspan="18"><div class="empty"><div class="h2">لا يوجد موظفون بعد</div>أضف موظفًا جديدًا أو استورد ملف Excel الحالي (.xlsm).<br><button class="btn primary" onclick="document.getElementById(\'fileImport\').click()">⬆ استيراد ملف Excel</button></div></td></tr>';
    $('#listFoot').textContent=''; return;
  }
  $('#tb').innerHTML=R.map(r=>'<tr>'+
    '<td class="num">'+r.n+'</td><td class="name">'+esc(r.name)+'</td><td class="num">'+fmt(r.dob)+'</td><td class="num">'+esc(r.dobH)+'</td>'+
    '<td class="num">'+(r.age??'')+'</td><td class="num">'+esc(r.nid)+'</td><td class="num">'+fmt(r.idExp)+'</td><td>'+pill(r.idDays)+'</td>'+
    '<td>'+esc(r.job)+'</td><td class="num">'+esc(r.card)+'</td><td class="num">'+fmt(r.cardExp)+'</td><td>'+pill(r.cardDays)+'</td>'+
    '<td class="num">'+fmt(r.join)+'</td><td class="num">'+fmt(r.sup)+'</td><td>'+pill(r.supDays)+'</td>'+
    '<td class="num">'+esc(r.phone)+'</td><td>'+esc(r.email)+'</td>'+
    '<td><div class="acts"><button class="btn sm" data-edit="'+r.uid+'" title="تعديل">✎</button><button class="btn sm" data-id="'+r.uid+'" title="صورة الهوية">🪪'+(r.nid&&photoSet.has(String(r.nid))?' ✓':'')+'</button><button class="btn sm danger" data-del="'+r.uid+'" title="حذف">🗑</button></div></td></tr>').join('')
    || '<tr><td colspan="18"><div class="empty">لا توجد نتائج مطابقة</div></td></tr>';
  $('#listFoot').textContent='عرض '+R.length+' من '+emps.length+' موظف';
}
function renderAlerts(){
  const t=$('#aType').value, s=$('#aState').value;
  const A=alertsList().filter(a=>(!t||a.type===t)&&(!s||a.s===s));
  $('#atb').innerHTML=A.map(a=>'<tr><td class="name">'+esc(a.name)+'</td><td>'+a.type+'</td><td class="num">'+fmt(a.date)+'</td><td class="num">'+a.days+'</td><td><span class="pill s-'+a.s+'">'+(a.s==='dead'?'منتهية':'قريب الانتهاء')+'</span></td></tr>').join('')
    || '<tr><td colspan="5"><div class="empty">لا توجد تنبيهات 👍</div></td></tr>';
}

/* ---------- tabs ---------- */
function show(v){ $$('nav.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===v)); $$('section.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v)); ls.set('tab',v); }
$$('nav.tabs button').forEach(b=>b.onclick=()=>show(b.dataset.v));
$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());

/* ---------- list events ---------- */
['q','qField','qStatus'].forEach(id=>$('#'+id).addEventListener('input',renderList));
['aType','aState'].forEach(id=>$('#'+id).addEventListener('input',renderAlerts));
$('#btnShowAll').onclick=()=>{ $('#q').value=''; $('#qField').value='all'; $('#qStatus').value=''; sortK='n'; sortDir=1; renderList(); };
$$('#v-list th[data-k]').forEach(th=>th.onclick=()=>{ const k=th.dataset.k; if(sortK===k) sortDir*=-1; else { sortK=k; sortDir=1; } renderList(); });
$('#tb').addEventListener('click',async ev=>{
  const b=ev.target.closest('button'); if(!b) return;
  if(b.dataset.edit) openForm(emps.find(e=>e.uid===b.dataset.edit));
  if(b.dataset.id) openId(emps.find(e=>e.uid===b.dataset.id));
  if(b.dataset.del){ const e=emps.find(x=>x.uid===b.dataset.del); if(confirm('حذف الموظف «'+e.name+'»؟')){ await del('emps',e.uid); await load(); renderAll(); toast('تم الحذف'); } }
});

/* ---------- form ---------- */
let editing=null;
const F=$('#empForm');
function openForm(e){
  editing=e||null; F.reset(); $('#empTitle').textContent=e?'تعديل بيانات موظف':'إضافة موظف';
  if(e) ['name','dob','dobH','nid','idExp','job','card','cardExp','join','phone','email'].forEach(k=>F.elements[k].value=e[k]||'');
  if(e&&!e.dobH&&e.dob) F.elements.dobH.value=g2hStr(e.dob);
  hints(); $('#dlgEmp').showModal();
}
function hints(){ const a=age(F.elements.dob.value); $('#ageHint').textContent=a!=null?'العمر: '+a+' سنة':'';
  const s=addMonths(F.elements.join.value,3); $('#supHint').textContent=s?'تاريخ استحقاق الدعم: '+fmt(s):''; }
F.elements.dob.addEventListener('change',()=>{ F.elements.dobH.value=g2hStr(F.elements.dob.value); hints(); });
F.elements.dobH.addEventListener('change',()=>{ const g=h2g(F.elements.dobH.value); if(g){ F.elements.dob.value=g; hints(); } else if(F.elements.dobH.value) toast('صيغة التاريخ الهجري غير صحيحة'); });
F.elements.join.addEventListener('change',hints);
$('#btnAdd').onclick=()=>openForm(null);
F.addEventListener('submit',async ev=>{
  const v={}; ['name','dob','dobH','nid','idExp','job','card','cardExp','join','phone','email'].forEach(k=>v[k]=F.elements[k].value.trim());
  if(!v.name){ ev.preventDefault(); return; }
  if(editing){ const oldNid=editing.nid; Object.assign(editing,v); await put('emps',editing);
    if(oldNid&&v.nid&&oldNid!==v.nid&&photoSet.has(oldNid)){ const p=await getOne('photos',oldNid); await del('photos',oldNid); p.nid=v.nid; await put('photos',p); }
    toast('تم حفظ التعديلات'); }
  else { const minOrd=emps.length?emps[0].ord:0; await put('emps',Object.assign({uid:uid(),ord:minOrd-1},v)); toast('تمت إضافة الموظف برقم 1'); $('#btnShowAll').click(); }
  await load(); renderAll();
});

/* ---------- ID photos ---------- */
let idEmp=null;
async function openId(e){
  idEmp=e; $('#idTitle').textContent='صورة الهوية — '+e.name;
  if(!e.nid){ $('#idBody').innerHTML='<p class="muted">أدخل رقم الهوية للموظف أولًا لربط الصورة به.</p>'; $('#dlgId').showModal(); return; }
  const p=await getOne('photos',String(e.nid));
  $('#idBody').innerHTML=p?'<img class="idimg" alt="صورة الهوية" src="'+p.data+'">':'<p class="muted">لا توجد صورة هوية مرفقة لهذا الموظف.</p>';
  $('#idDel').hidden=!p; $('#dlgId').showModal();
}
function shrink(file){ return new Promise((res,rej)=>{ const img=new Image(); const u=URL.createObjectURL(file);
  img.onload=()=>{ const mx=1600, sc=Math.min(1,mx/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg',.85)); };
  img.onerror=rej; img.src=u; }); }
$('#idFile').onchange=async ev=>{ const f=ev.target.files[0]; ev.target.value=''; if(!f||!idEmp||!idEmp.nid) return;
  await put('photos',{nid:String(idEmp.nid),data:await shrink(f)}); await load(); renderList(); openId(idEmp); toast('تم حفظ صورة الهوية'); };
$('#idDel').onclick=async()=>{ if(idEmp&&confirm('حذف صورة الهوية؟')){ await del('photos',String(idEmp.nid)); await load(); renderList(); openId(idEmp); } };

/* ---------- Excel import / export ---------- */
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
  const f=ev.target.files[0]; ev.target.value=''; if(!f) return;
  if(typeof XLSX==='undefined'){ alert('تعذّر تحميل مكتبة Excel. تأكد من اتصال الإنترنت.'); return; }
  try{
    const wb=XLSX.read(await f.arrayBuffer(),{type:'array'}); const list=parseWorkbook(wb);
    if(!list||!list.length){ alert('لم يتم العثور على جدول موظفين في الملف. يجب أن يحتوي على عمود «اسم المشترك» وعمود «رقم الهوية».'); return; }
    if(emps.length&&!confirm('سيتم استبدال البيانات الحالية ('+emps.length+' موظف) بـ '+list.length+' موظف من الملف. متابعة؟')) return;
    await clear('emps'); for(let i=0;i<list.length;i++) await put('emps',Object.assign({uid:uid(),ord:i},list[i]));
    await load(); renderAll(); show('list'); toast('تم استيراد '+list.length+' موظف');
  }catch(e){ console.error(e); alert('تعذّرت قراءة الملف: '+e.message); }
};
$('#btnExport').onclick=()=>{
  if(typeof XLSX==='undefined'){ alert('تعذّر تحميل مكتبة Excel. تأكد من اتصال الإنترنت.'); return; }
  const H=['#','اسم المشترك','تاريخ الميلاد','تاريخ الميلاد (هجري)','العمر','رقم الهوية','تاريخ انتهاء الهوية','الأيام المتبقية (الهوية)','المهنة','رقم بطاقة الصراف','تاريخ انتهاء بطاقة الصراف','الأيام المتبقية (بطاقة الصراف)','تاريخ الالتحاق','تاريخ الدعم','الأيام المتبقية (الدعم)','رقم الجوال','البريد الإلكتروني'];
  const D=v=>v?new Date(isoToUTC(v)+new Date(isoToUTC(v)).getTimezoneOffset()*6e4):'';
  const data=[H].concat(rows().map(r=>[r.n,r.name,D(r.dob),r.dobH,r.age??'',r.nid,D(r.idExp),r.idDays??'',r.job,r.card,D(r.cardExp),r.cardDays??'',D(r.join),D(r.sup),r.supDays??'',r.phone,r.email]));
  const ws=XLSX.utils.aoa_to_sheet(data,{cellDates:true,dateNF:'dd/mm/yyyy'});
  ws['!cols']=H.map((h,i)=>({wch:i===1?32:Math.max(12,h.length+2)}));
  const wb=XLSX.utils.book_new(); wb.Workbook={Views:[{RTL:true}]}; XLSX.utils.book_append_sheet(wb,ws,'سجل الموظفين');
  XLSX.writeFile(wb,'سجل الموظفين '+todayISO()+'.xlsx');
};

/* ---------- alerts popup / print ---------- */
function popup(){
  const A=alertsList(); if(!A.length) return;
  try{ if(sessionStorage.getItem('popShown')) return; sessionStorage.setItem('popShown','1'); }catch(e){}
  $('#popList').innerHTML=A.slice(0,40).map(a=>'<li><span><b>'+esc(a.name)+'</b> — '+a.type+'</span><span class="pill s-'+a.s+'">'+(a.days<0?'منتهية منذ '+(-a.days)+' يوم':'باقي '+a.days+' يوم')+'</span></li>').join('')+(A.length>40?'<li class="muted">و '+(A.length-40)+' تنبيهات أخرى…</li>':'');
  $('#dlgAlerts').showModal();
}
$('#popGo').onclick=()=>{ $('#dlgAlerts').close(); show('alerts'); };
$('#btnPrint').onclick=()=>{ const s=$('#v-alerts'); s.classList.add('printing'); window.print(); setTimeout(()=>s.classList.remove('printing'),500); };

/* ---------- settings ---------- */
async function hash(s){ try{ const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('emp:'+s)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }catch(e){ let h=5381; for(const c of 'emp:'+s) h=(h*33^c.charCodeAt(0))>>>0; return 'x'+h; } }
$('#btnSettings').onclick=()=>{ $('#setPin').value=''; $('#theme').value=ls.get('theme')||''; $('#dlgSet').showModal(); };
$('#savePin').onclick=async()=>{ const v=$('#setPin').value.trim(); ls.set('pin',v?await hash(v):null); toast(v?'تم حفظ الرمز السري':'تم إلغاء القفل'); };
function applyTheme(){ const t=ls.get('theme'); if(t) document.documentElement.dataset.theme=t; else delete document.documentElement.dataset.theme; }
$('#theme').onchange=e=>{ ls.set('theme',e.target.value||null); applyTheme(); };
$('#bkSave').onclick=async()=>{
  const blob=new Blob([JSON.stringify({app:'saudi-emp',v:1,emps:await getAll('emps'),photos:await getAll('photos')})],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='نسخة احتياطية الموظفين '+todayISO()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
};
$('#bkLoad').onchange=async ev=>{ const f=ev.target.files[0]; ev.target.value=''; if(!f) return;
  try{ const j=JSON.parse(await f.text()); if(j.app!=='saudi-emp') throw new Error('ملف غير صالح');
    if(!confirm('استعادة النسخة ستستبدل جميع البيانات الحالية. متابعة؟')) return;
    await clear('emps'); await clear('photos'); for(const e of j.emps) await put('emps',e); for(const p of j.photos||[]) await put('photos',p);
    await load(); renderAll(); $('#dlgSet').close(); toast('تمت الاستعادة'); }catch(e){ alert('تعذّرت الاستعادة: '+e.message); } };
$('#wipe').onclick=async()=>{ if(confirm('سيتم حذف جميع الموظفين وصور الهويات من هذا الجهاز نهائيًا. هل أنت متأكد؟')&&confirm('تأكيد أخير: لا يمكن التراجع.')){ await clear('emps'); await clear('photos'); await load(); renderAll(); $('#dlgSet').close(); toast('تم حذف كل البيانات'); } };

/* ---------- lock + boot ---------- */
async function unlock(){ return new Promise(res=>{ const h=ls.get('pin'); if(!h) return res();
  $('#lock').classList.add('on'); $('#lockPin').focus();
  const go=async()=>{ if(await hash($('#lockPin').value.trim())===h){ $('#lock').classList.remove('on'); res(); } else { $('#lockErr').textContent='الرمز غير صحيح'; $('#lockPin').select(); } };
  $('#lockBtn').onclick=go; $('#lockPin').onkeydown=e=>{ if(e.key==='Enter') go(); }; }); }

(async function boot(){
  applyTheme();
  await unlock();
  try{ db=await openDB(); }catch(e){ alert('المتصفح لا يسمح بحفظ البيانات (ربما في وضع التصفح الخفي).'); return; }
  await load(); renderAll();
  const t=ls.get('tab'); if(t&&$('#v-'+t)) show(t); else if(!emps.length) show('list');
  popup();
})();
})();
