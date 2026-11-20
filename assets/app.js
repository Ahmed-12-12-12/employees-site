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
async function loadEmps(){ emps=(await api('emps_list')).emps.map(fromServer); fillJobs(); }
async function loadMeta(){ const [a,b]=await Promise.all([api('sites_list'),api('shifts_list')]); sites=a.sites; shifts=b.shifts; fillSelects(); }
async function loadToday(){ todayAtt=(await api('att_list',{from:todayISO(),to:todayISO()})).rows; }

function alertsList(){
  const out=[];
  rows().forEach(r=>{
    [['الهوية',r.idExp,r.idDays],['بطاقة الصراف',r.cardExp,r.cardDays],['الدعم',r.sup,r.supDays]].forEach(([t,dt,d])=>{
      const s=state(d); if(s==='dead'||s==='warn') out.push({id:r.id,name:r.name,job:r.job,type:t,date:dt,days:d,s});
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
let weekAtt=[];
async function loadWeek(){ const d=new Date(); d.setDate(d.getDate()-6); const from=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  weekAtt=(await api('att_list',{from,to:todayISO()})).rows; todayAtt=weekAtt.filter(r=>r.work_date===todayISO()); }
function renderAll(){ renderDash(); renderList(); renderAlerts(); }
const ic=(n,c)=>'<svg class="i'+(c?' '+c:'')+'"><use href="#i-'+n+'"/></svg>';
const TONE={ok:'var(--ok-dot)',warn:'var(--warn-dot)',bad:'var(--bad-dot)',info:'var(--info-dot)',brand:'var(--amber)',none:'var(--faint)'};
/* avatar بالأحرف الأولى — لون ثابت لكل اسم */
const AVC=[['#efe9dc','#6b5a35'],['#e5edf0','#3e5f68'],['#ebe8f1','#594d72'],['#e8efe5','#4a6440'],['#f3e6e1','#7a4a3c'],['#e7e9f0','#465170']];
function avInit(name){ const w=String(name||'').trim().split(/\s+/).filter(Boolean); const a=(w[0]||'؟')[0], b=w.length>1?w[1][0]:''; return a+(b?'\u200c'+b:''); }
function avCol(name){ let h=0; for(const ch of String(name||'')) h=(h*31+ch.charCodeAt(0))%997; return AVC[h%AVC.length]; }
function av(name,cls){ const c=avCol(name); return '<span class="av'+(cls?' '+cls:'')+'" style="--av-bg:'+c[0]+';--av:'+c[1]+'">'+esc(avInit(name))+'</span>'; }
function kpi(l,v,sub,tone){ return '<div class="kpi"><div class="lbl"><i style="--k:'+(TONE[tone]||TONE.none)+'"></i>'+l+'</div><div class="num">'+v+'</div>'+(sub?'<div class="sub">'+sub+'</div>':'')+'</div>'; }
let charts={};
const C={ok:'#3f9a70',warn:'#e3a12f',bad:'#d0605a',none:'#e7e5df',brand:'#f5ad1b',ink:'#1c1c1b',slate:'#aeaca5',blue:'#6b8db3',sand:'#e6d6b0'};
function chart(id,cfg){ if(typeof Chart==='undefined') return; if(charts[id]) charts[id].destroy();
  const base={responsive:true,maintainAspectRatio:false,animation:{duration:500},
    plugins:{legend:{position:'bottom',rtl:true,textDirection:'rtl',labels:{font:{family:'Cairo',size:12,weight:'500'},color:'#4b4a47',usePointStyle:true,pointStyle:'rectRounded',boxWidth:8,boxHeight:8,padding:14}},
      tooltip:{backgroundColor:'#151515',titleFont:{family:'Cairo',weight:'600'},bodyFont:{family:'Cairo'},padding:10,cornerRadius:8,displayColors:false,rtl:true}}};
  const o=cfg.options||{}; cfg.options=Object.assign({},base,o,{plugins:Object.assign({},base.plugins,o.plugins||{})});
  if(cfg.options.scales) Object.values(cfg.options.scales).forEach(s=>{ s.grid=Object.assign({color:'#efeee9',drawTicks:false},s.grid||{}); s.border={display:false}; s.ticks=Object.assign({color:'#85837d',padding:8,font:{family:'Cairo',size:11.5}},s.ticks||{}); });
  charts[id]=new Chart(document.getElementById(id),cfg); }
if(typeof Chart!=='undefined'){ Chart.defaults.font.family='Cairo'; Chart.defaults.color='#77767c'; }
function isOff(sh,iso){ return String(sh.off_days).split(',').filter(Boolean).map(Number).includes(new Date(iso+'T12:00:00').getDay()); }
const donut={cutout:'76%',layout:{padding:4},plugins:{legend:{position:'bottom'}}};
/* رقم الإجمالي في منتصف الدائرة */
if(typeof Chart!=='undefined') Chart.register({id:'centerTotal',afterDraw(ch){ if(ch.config.type!=='doughnut') return;
  const m=ch.getDatasetMeta(0); if(!m.data.length) return; const {x,y}=m.data[0]; const tot=ch.data.datasets[0].data.reduce((a,b)=>a+(+b||0),0);
  const c=ch.ctx; c.save(); c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#151515'; c.font='800 24px Cairo'; c.fillText(tot,x,y-6);
  c.fillStyle='#85837d'; c.font='600 11.5px Cairo'; c.fillText('الإجمالي',x,y+16); c.restore(); }});
function renderDash(){
  const R=rows(), N=R.length, c=k=>R.filter(k).length, pct=n=>N?Math.round(100*n/N)+'% من الموظفين':'—';
  const idS=k=>c(r=>state(r.idDays)===k), cdS=k=>c(r=>state(r.cardDays)===k), spS=k=>c(r=>state(r.supDays)===k);
  const now=new Date(), hr=now.getHours();
  $('#greet').textContent=hr<12?'صباح الخير':'مساء الخير';
  $('#todayLbl').textContent='نظرة عامة';
  $('#todayLine').textContent=now.toLocaleDateString('ar-SA-u-nu-latn-ca-gregory',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+' · '+now.toLocaleDateString('ar-SA-u-nu-latn-ca-islamic-umalqura',{year:'numeric',month:'long',day:'numeric'});
  $('#uploadBox').hidden=N>0;
  /* attendance today */
  const came=new Set(todayAtt.map(r=>+r.emp_id)), inside=new Set(todayAtt.filter(r=>!r.out_time).map(r=>+r.emp_id));
  const expected=emps.filter(e=>{ const sh=shiftById(e.shift_id); return sh&&!isOff(sh,todayISO()); });
  const absent=expected.filter(e=>!came.has(e.id)&&now>new Date(todayISO()+'T'+shiftById(e.shift_id).start_time+':00')).length;
  const late=new Set(todayAtt.filter(r=>lateOf(r)>0).map(r=>+r.emp_id)).size;
  const unbound=emps.filter(e=>!e.bound).length;
  const expN=expected.length, cameExp=expected.filter(e=>came.has(e.id)).length, pending=Math.max(0,expN-cameExp-absent);
  const onTime=Math.max(0,came.size-late), base=Math.max(1,came.size+absent+pending), w=x=>(100*x/base).toFixed(2)+'%';
  const pctTxt=expN?Math.round(100*cameExp/expN)+'%':'';
  const hs=(t,v,icn,col,sub,go)=>'<div'+(go?' data-goto="'+go+'"':'')+'><div class="t" style="--c:'+col+'">'+ic(icn)+t+'</div><b>'+v+'</b><small>'+sub+'</small></div>';
  $('#hero').innerHTML='<div><div class="h-lbl"><span class="live"></span>الحضور اليوم · '+DAYS[now.getDay()]+' '+fmt(todayISO())+'</div>'+
    '<div class="h-big"><b>'+came.size+'</b><span>'+(expN?'حضروا من '+expN+' متوقع':'حضروا اليوم')+'</span>'+(pctTxt?'<em>'+pctTxt+'</em>':'')+'</div>'+
    '<div class="h-note">'+(expN?'يُحسب الغياب بعد بداية وردية كل موظف':'حدّد ورديات للموظفين ليظهر الغياب والتأخير بدقة')+'</div>'+
    '<div class="seg" role="img" aria-label="توزيع الحضور اليوم"><i style="width:'+w(onTime)+';background:#3f9a70"></i><i style="width:'+w(late)+';background:#f5ad1b"></i><i style="width:'+w(absent)+';background:#d0605a"></i><i style="width:'+w(pending)+';background:#4a4a48"></i></div>'+
    '<div class="seg-legend"><span style="--c:#3f9a70">في الوقت <b>'+onTime+'</b></span><span style="--c:#f5ad1b">متأخر <b>'+late+'</b></span><span style="--c:#d0605a">غائب <b>'+absent+'</b></span><span style="--c:#4a4a48">لم تبدأ ورديته <b>'+pending+'</b></span></div></div>'+
    '<div class="hero-stats">'+hs('داخل العمل الآن',inside.size,'in','#3f9a70','لم يسجلوا انصرافًا','att')+hs('متأخرون',late,'clock','#f5ad1b','بعد فترة السماح','att')+
    hs('لم يحضروا بعد',absent,'userx','#d0605a','بعد بداية الوردية','att')+hs('بلا جوال مفعّل',unbound,'phone','#a9a7a1',unbound?'يحتاجون رمز تفعيل':'الجميع مفعّل','list')+'</div>';
  /* document KPIs */
  $('#kpis').innerHTML=
    kpi('إجمالي الموظفين',N,'سجل نشط','none')+
    kpi('هويات منتهية',idS('dead'),pct(idS('dead')),'bad')+
    kpi('هويات تنتهي خلال 30 يوم',idS('warn'),'تحتاج تجديد','warn')+
    kpi('بطاقات صراف تحتاج إجراء',cdS('dead')+cdS('warn'),'منتهية <b>'+cdS('dead')+'</b> · قريبة <b>'+cdS('warn')+'</b>','info')+
    kpi('دعم مستحق خلال 30 يوم',spS('warn'),'مستحق سابقًا <b>'+spS('dead')+'</b>','brand');
  /* charts */
  const days=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())); }
  const pres=days.map(d=>new Set(weekAtt.filter(r=>r.work_date===d).map(r=>+r.emp_id)).size);
  const lates=days.map(d=>new Set(weekAtt.filter(r=>r.work_date===d&&lateOf(r)>0).map(r=>+r.emp_id)).size);
  chart('chWeek',{type:'bar',data:{labels:days.map(d=>DAYS[new Date(d+'T12:00:00').getDay()]),datasets:[{label:'حاضرون',data:pres,backgroundColor:C.ink,borderRadius:6,maxBarThickness:26,categoryPercentage:.6},{label:'منهم متأخرون',data:lates,backgroundColor:C.brand,borderRadius:6,maxBarThickness:26,categoryPercentage:.6}]},options:{scales:{x:{grid:{display:false}},y:{beginAtZero:true,ticks:{precision:0}}}}});
  chart('chStatus',{type:'doughnut',data:{labels:['منتهية','خلال 30 يوم','سارية','بدون تاريخ'],datasets:[{data:[idS('dead'),idS('warn'),idS('ok'),idS('none')],backgroundColor:[C.bad,C.warn,C.ok,C.none],borderWidth:0,spacing:2}]},options:donut});
  const jm={}; R.forEach(r=>{ const j=(r.job||'').trim()||'بدون مهنة'; jm[j]=(jm[j]||0)+1; });
  const top=Object.entries(jm).sort((a,b)=>b[1]-a[1]).slice(0,7);
  chart('chJobs',{type:'bar',data:{labels:top.map(x=>x[0].length>22?x[0].slice(0,21)+'…':x[0]),datasets:[{data:top.map(x=>x[1]),backgroundColor:C.sand,hoverBackgroundColor:C.brand,borderRadius:4,maxBarThickness:14}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{precision:0}},y:{grid:{display:false},ticks:{color:'#3d3d40'}}}}});
  const bins={'18–25':0,'26–35':0,'36–50':0,'51+':0}; R.forEach(r=>{ const a=r.age; if(!a) return; if(a<=25)bins['18–25']++; else if(a<=35)bins['26–35']++; else if(a<=50)bins['36–50']++; else bins['51+']++; });
  chart('chAge',{type:'doughnut',data:{labels:Object.keys(bins),datasets:[{data:Object.values(bins),backgroundColor:[C.sand,C.brand,C.ink,C.slate],borderWidth:0,spacing:2}]},options:donut});
  chart('chAtm',{type:'doughnut',data:{labels:['منتهية','قريبة','سارية','بدون تاريخ'],datasets:[{data:[cdS('dead'),cdS('warn'),cdS('ok'),cdS('none')],backgroundColor:[C.bad,C.warn,C.ok,C.none],borderWidth:0,spacing:2}]},options:donut});
  /* alerts + last punches */
  const A=alertsList().slice(0,25);
  $('#alertsBox').innerHTML=A.map(a=>'<div class="alert-item" data-emp="'+a.id+'"><div class="who">'+av(a.name)+'<div style="min-width:0"><div class="d">'+esc(a.name)+'</div><div class="m">'+a.type+' · '+fmt(a.date)+'</div></div></div><span class="dot s-'+a.s+'">'+(a.days<0?'منتهية':'باقي '+a.days+' يوم')+'</span></div>').join('')||'<div class="empty-mini">لا توجد تنبيهات عاجلة</div>';
  const P=[]; todayAtt.forEach(r=>{ P.push({t:r.in_time,type:'حضور',r}); if(r.out_time) P.push({t:r.out_time,type:'انصراف',r}); });
  P.sort((a,b)=>b.t.localeCompare(a.t));
  $('#lastPunches').innerHTML=P.slice(0,30).map(p=>'<div class="alert-item" data-emp="'+p.r.emp_id+'"><div class="who">'+av(p.r.name)+'<div style="min-width:0"><div class="d">'+esc(p.r.name)+'</div><div class="m">'+p.type+(((p.type==='حضور'?p.r.in_site_name:p.r.out_site_name))?' · '+esc(p.type==='حضور'?p.r.in_site_name:p.r.out_site_name):'')+'</div></div></div><span class="dot '+(p.type==='حضور'?'s-ok':'none')+'"><span class="tm">'+hm(p.t)+'</span></span></div>').join('')||'<div class="empty-mini">لا توجد تسجيلات اليوم بعد</div>';
  const n=alertsList().length; const ac=$('#alertCount'); ac.hidden=!n; ac.textContent=n;
}
['#alertsBox','#lastPunches'].forEach(s=>$(s).addEventListener('click',ev=>{ const it=ev.target.closest('[data-emp]'); if(it) showDetail(+it.dataset.emp); }));

/* ---------- render: employees ---------- */
let sortK='n', sortDir=1;
function emptyRow(cols,title,text,btn){ return '<tr><td colspan="'+cols+'"><div class="empty"><div class="ic">'+ic('users','lg')+'</div><div class="h2">'+title+'</div><div>'+text+'</div>'+(btn?'<br>'+btn:'')+'</div></td></tr>'; }
function renderList(){
  const q=$('#q').value.trim().toLowerCase(), fj=$('#fJob').value, fs=$('#fStatus').value, fa=$('#fAtm').value, fd=$('#fDev').value;
  let R=rows().filter(r=>{
    if(q && !['name','nid','job','card','phone','email'].some(k=>String(r[k]||'').toLowerCase().includes(q))) return false;
    if(fj && ((r.job||'').trim()||'بدون مهنة')!==fj) return false;
    if(fs && state(r.idDays)!==fs) return false;
    if(fa && state(r.cardDays)!==fa) return false;
    if(fd!=='' && String(r.bound)!==fd) return false;
    return true;
  });
  R.sort((a,b)=>{ const x=a[sortK],y=b[sortK]; if(x==null||x==='') return 1; if(y==null||y==='') return -1; return (typeof x==='number'?x-y:String(x).localeCompare(String(y),'ar'))*sortDir; });
  if(!emps.length){
    $('#tb').innerHTML=emptyRow(9,'لا يوجد موظفون بعد','أضف موظفًا أو ارفع ملف Excel الحالي (.xlsm).','<button class="btn accent" data-do="import">'+ic('upload')+'رفع ملف Excel</button>');
    $('#listFoot').textContent=''; return;
  }
  const dcell=(date,d)=>'<div class="dcell">'+dot(d)+(date?'<small>'+fmt(date)+'</small>':'')+'</div>';
  $('#tb').innerHTML=R.map(r=>'<tr class="click" data-emp="'+r.id+'">'+
    '<td class="num muted">'+r.n+'</td><td class="name"><div class="who">'+av(r.name)+'<div>'+esc(r.name)+'<small class="mono">'+esc(r.nid||'بدون رقم هوية')+(r.age!=null?' · '+r.age+' سنة':'')+'</small></div></div></td>'+
    '<td>'+dcell(r.idExp,r.idDays)+'</td><td>'+(r.job?'<span class="job-tag">'+esc(r.job)+'</span>':'<span class="s-none">—</span>')+'</td>'+
    '<td>'+dcell(r.cardExp,r.cardDays)+'</td><td>'+dcell(r.sup,r.supDays)+'</td>'+
    '<td class="mono">'+esc(r.phone||'—')+'</td><td>'+esc(r.shiftName||'—')+'</td>'+
    '<td>'+(r.bound?'<span class="dot s-ok">مفعّل</span>':r.code?'<span class="dot s-warn">بانتظار التفعيل</span>':'<span class="s-none">—</span>')+'</td></tr>').join('')
    || '<tr><td colspan="9"><div class="empty">لا توجد نتائج مطابقة للفلاتر</div></td></tr>';
  $('#listFoot').textContent='عرض '+R.length+' من '+emps.length+' موظف';
}
function dot(d){ const s=state(d); if(s==='none') return '<span class="dot none">—</span>';
  return '<span class="dot s-'+s+'">'+(d<0?'منتهية منذ '+(-d)+' يوم':'باقي '+d+' يوم')+'</span>'; }
function renderAlerts(){
  const t=$('#aType').value, s=$('#aState').value;
  const A=alertsList().filter(a=>(!t||a.type===t)&&(!s||a.s===s));
  $('#atb').innerHTML=A.map(a=>'<tr class="click" data-emp="'+a.id+'"><td class="name"><div class="who">'+av(a.name)+'<div>'+esc(a.name)+'</div></div></td><td>'+a.type+'</td><td class="num">'+fmt(a.date)+'</td><td class="num">'+a.days+'</td><td><span class="pill s-'+a.s+'">'+(a.s==='dead'?'منتهية':'قريب الانتهاء')+'</span></td></tr>').join('')
    || '<tr><td colspan="5"><div class="empty">لا توجد تنبيهات</div></td></tr>';
}
$('#atb').addEventListener('click',ev=>{ const tr=ev.target.closest('[data-emp]'); if(tr) showDetail(+tr.dataset.emp); });

/* ---------- employee detail card ---------- */
let detailEmp=null;
function showDetail(id){
  const e=rows().find(x=>x.id===+id); if(!e) return; detailEmp=e;
  $('#dName').textContent=e.name;
  const c=avCol(e.name), A=$('#dAv'); A.textContent=avInit(e.name); A.style.setProperty('--av-bg',c[0]); A.style.setProperty('--av',c[1]);
  $('#dSub').textContent=[e.job,e.nid].filter(Boolean).join(' · ')||'—';
  const tile=(k,date,d)=>'<div class="tile"><span>'+k+'</span><b>'+(date?fmt(date):'—')+'</b>'+dot(d)+'</div>';
  $('#dTiles').innerHTML=tile('انتهاء الهوية',e.idExp,e.idDays)+tile('انتهاء بطاقة الصراف',e.cardExp,e.cardDays)+tile('تاريخ الدعم',e.sup,e.supDays);
  const row=(k,v)=>'<div><span>'+k+'</span><b>'+(v===''||v==null?'—':v)+'</b></div>';
  const dd=d=>d==null?'':' <span class="pill s-'+state(d)+'">'+(d<0?'منتهية '+(-d)+' يوم':d+' يوم')+'</span>';
  const ta=todayAtt.filter(r=>+r.emp_id===e.id);
  $('#dBody').innerHTML=row('رقم الهوية','<span class="mono">'+esc(e.nid||'—')+'</span>')+row('المهنة',esc(e.job))+row('العمر',e.age)+row('الميلاد ميلادي',fmt(e.dob))+row('الميلاد هجري',esc(e.dobH))+
    row('رقم بطاقة الصراف','<span class="mono">'+esc(e.card||'—')+'</span>')+row('تاريخ الالتحاق',fmt(e.join))+row('الجوال','<span class="mono">'+esc(e.phone||'—')+'</span>')+row('البريد',esc(e.email))+
    row('الوردية',esc(e.shiftName))+row('المواقع المسموحة',e.sites.length?e.sites.map(s=>esc((siteById(s)||{}).name||'')).join('، '):'كل المواقع')+
    row('جوال الحضور',e.bound?'<span class="dot s-ok">مفعّل</span>':e.code?'<span class="dot s-warn">بانتظار التفعيل</span>':'غير مفعّل')+
    row('حضور اليوم',ta.length?ta.map(r=>hm(r.in_time)+' ← '+(r.out_time?hm(r.out_time):'داخل')).join(' / '):'لم يسجّل');
  $('#dlgDetail').showModal();
}
$('#tb').addEventListener('click',ev=>{ const tr=ev.target.closest('tr[data-emp]'); if(tr) showDetail(+tr.dataset.emp); });
$('#dEdit').onclick=()=>{ $('#dlgDetail').close(); openForm(emps.find(x=>x.id===detailEmp.id)); };
$('#dDev').onclick=()=>{ $('#dlgDetail').close(); openDev(emps.find(x=>x.id===detailEmp.id)); };
$('#dId').onclick=()=>{ $('#dlgDetail').close(); openId(emps.find(x=>x.id===detailEmp.id)); };
$('#dAtt').onclick=()=>{ $('#dlgDetail').close(); const d=new Date(); d.setDate(1);
  $('#attFrom').value=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-01'; $('#attTo').value=todayISO(); $('#attQ').value=detailEmp.nid||detailEmp.name; show('att'); };
$('#dDel').onclick=()=>{ const e=detailEmp; if(confirm('حذف الموظف «'+e.name+'» وكل سجلات حضوره؟')) act(async()=>{ await api('emp_delete',{id:e.id}); $('#dlgDetail').close(); await loadEmps(); renderAll(); toast('تم الحذف'); }); };

/* ---------- navigation ---------- */
const loaders={ att:loadAtt, report:loadReport, sites:renderSites, shifts:renderShifts, dash:async()=>{ await loadWeek(); renderDash(); } };
function show(v){ $$('aside [data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===v)); $$('section.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v));
  document.body.classList.remove('menu'); ls.set('tab',v); window.scrollTo(0,0); if(loaders[v]) act(loaders[v]); }
$$('aside [data-v]').forEach(b=>b.onclick=()=>show(b.dataset.v));
document.addEventListener('click',ev=>{ const g=ev.target.closest('[data-goto]'); if(g) show(g.dataset.goto); });
$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('#menuBtn').onclick=()=>document.body.classList.toggle('menu');
document.addEventListener('click',ev=>{ if(document.body.classList.contains('menu')&&!ev.target.closest('aside')&&!ev.target.closest('#menuBtn')) document.body.classList.remove('menu'); });
document.addEventListener('click',ev=>{ const b=ev.target.closest('[data-do]'); if(!b) return; const d=b.dataset.do;
  if(d==='import') $('#fileImport').click(); if(d==='template') downloadTemplate(); if(d==='export') exportEmps(); if(d==='add') openForm(null); });

/* ---------- employees events ---------- */
['q','fJob','fStatus','fAtm','fDev'].forEach(id=>$('#'+id).addEventListener('input',renderList));
['aType','aState'].forEach(id=>$('#'+id).addEventListener('input',renderAlerts));
$('#btnShowAll').onclick=()=>{ ['q','fJob','fStatus','fAtm','fDev'].forEach(id=>$('#'+id).value=''); sortK='n'; sortDir=1; renderList(); };
$$('#v-list th[data-k]').forEach(th=>th.onclick=()=>{ const k=th.dataset.k; if(sortK===k) sortDir*=-1; else { sortK=k; sortDir=1; } renderList(); });

function fillSelects(){
  $('#empForm').elements.shift.innerHTML='<option value="">بدون وردية</option>'+shifts.map(s=>'<option value="'+s.id+'">'+esc(s.name)+' ('+s.start_time+'–'+s.end_time+')</option>').join('');
  $('#empSites').innerHTML=sites.map(s=>'<label><input type="checkbox" value="'+s.id+'"> '+esc(s.name)+'</label>').join('')||'<span class="muted">لا توجد مواقع بعد</span>';
  const cur=$('#attSite').value; $('#attSite').innerHTML='<option value="">كل المواقع</option>'+sites.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join(''); $('#attSite').value=cur;
}
function fillJobs(){
  const m={}; emps.forEach(e=>{ const j=(e.job||'').trim()||'بدون مهنة'; m[j]=(m[j]||0)+1; });
  const cur=$('#fJob').value;
  $('#fJob').innerHTML='<option value="">كل المهن</option>'+Object.keys(m).sort((a,b)=>a.localeCompare(b,'ar')).map(j=>'<option value="'+esc(j)+'">'+esc(j)+' ('+m[j]+')</option>').join('');
  $('#fJob').value=cur;
  $('#jobList').innerHTML=Object.keys(m).filter(j=>j!=='بدون مهنة').map(j=>'<option value="'+esc(j)+'">').join('');
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
  else if(e.bound) h='<p style="margin-bottom:8px"><span class="pill s-ok">مفعّل</span> <span class="muted">منذ '+esc(e.deviceAt)+'</span></p><p class="muted">إنشاء رمز جديد سيلغي ربط الجوال الحالي.</p>';
  else if(e.code) h=devMsg(e);
  else h='<p class="muted">لم يُفعَّل جوال لهذا الموظف بعد. أنشئ رمز تفعيل وأرسله له.</p>';
  $('#devBody').innerHTML=h; $('#devGen').hidden=!e.nid; $('#dlgDev').showModal();
}
function devMsg(e){
  const text='مرحبًا '+e.name+'\nلتسجيل الحضور والانصراف افتح الرابط من جوالك:\n'+attUrl()+'\nرقم الهوية: '+e.nid+'\nرمز التفعيل: '+e.code;
  return '<p class="muted">أرسل للموظف الرابط ورمز التفعيل التالي:</p><div class="code-box num" dir="ltr">'+esc(e.code)+'</div>'+
    '<p class="muted" style="font-size:13px;margin-bottom:12px">الرابط: <span dir="ltr">'+esc(attUrl())+'</span></p>'+
    '<div class="row"><button class="btn" id="devCopy">'+ic('copy')+'نسخ الرسالة</button>'+(e.phone?'<a class="btn" target="_blank" rel="noopener" href="https://wa.me/'+esc(waNum(e.phone))+'?text='+encodeURIComponent(text)+'">'+ic('send')+'إرسال واتساب</a>':'')+'</div>'+
    '<textarea id="devText" hidden>'+esc(text)+'</textarea>';
}
function waNum(p){ p=String(p).replace(/\D/g,''); if(p.startsWith('05')) p='966'+p.slice(1); else if(p.startsWith('5')&&p.length===9) p='966'+p; return p; }
$('#devGen').onclick=()=>{ if(devEmp.bound&&!confirm('سيتم إلغاء ربط الجوال الحالي. متابعة؟')) return;
  act(async()=>{ const r=await api('emp_code',{id:devEmp.id}); devEmp.code=r.code; devEmp.bound=0; $('#devBody').innerHTML=devMsg(devEmp); await loadEmps(); renderList(); }); };
$('#devBody').addEventListener('click',ev=>{ if(ev.target.closest('#devCopy')){ navigator.clipboard.writeText($('#devText').value).then(()=>toast('تم نسخ الرسالة'),()=>toast('تعذّر النسخ')); } });

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
  return '<div class="time-cell"><b class="num">'+hm(t)+'</b><span class="pill plain '+(m==='manual'?'s-warn':m==='qr'?'s-info':'neutral')+'">'+(METHOD[m]||m||'')+'</span>'+(site?'<span class="src">'+esc(site)+'</span>':'')+
    (lat!=null?'<a class="map-link" href="https://maps.google.com/?q='+lat+','+lng+'" target="_blank" rel="noopener" title="عرض الموقع على الخريطة">'+ic('pin','sm')+'</a>':'')+'</div>'; }
async function loadAtt(){
  if(!$('#attFrom').value){ $('#attFrom').value=todayISO(); $('#attTo').value=todayISO(); }
  attRows=(await api('att_list',{from:$('#attFrom').value,to:$('#attTo').value||$('#attFrom').value})).rows; renderAtt();
}
function renderAtt(){
  const q=$('#attQ').value.trim().toLowerCase(), si=$('#attSite').value, st=$('#attState').value;
  const R=attRows.filter(r=>(!q||String(r.name).toLowerCase().includes(q)||String(r.nid||'').includes(q))&&(!si||+r.in_site===+si||+r.out_site===+si)&&(!st||(st==='open'?!r.out_time:st==='late'?lateOf(r)>0:!!r.edited_by)));
  $('#attTb').innerHTML=R.map(r=>{ const l=lateOf(r);
    return '<tr><td class="name">'+esc(r.name)+'</td><td class="num">'+fmt(r.work_date)+'</td>'+
    '<td>'+cell(r.in_time,r.in_method,r.in_site_name,r.in_lat,r.in_lng)+'</td><td>'+cell(r.out_time,r.out_method,r.out_site_name,r.out_lat,r.out_lng)+'</td>'+
    '<td class="num">'+(r.out_time?dur(minsBetween(r.in_time,r.out_time)):'<span class="pill s-ok">داخل الآن</span>')+'</td>'+
    '<td>'+(l?'<span class="pill s-warn">'+l+' دقيقة</span>':l===0?'<span class="s-none">0</span>':'')+'</td>'+
    '<td style="white-space:normal;min-width:120px">'+esc(r.note||'')+(r.edited_by?' <span class="muted" style="font-size:12px">· '+esc(r.edited_by)+'</span>':'')+'</td>'+
    '<td><div class="acts"><button class="btn icon" title="تعديل" data-aedit="'+r.id+'">'+ic('edit')+'</button><button class="btn icon danger" title="حذف" data-adel="'+r.id+'">'+ic('trash')+'</button></div></td></tr>'; }).join('')
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
    $('#dlgAtt').close(); toast('تم الحفظ'); await loadAtt(); await loadWeek(); renderDash(); }); });
$('#attExport').onclick=()=>{ if(!xlsxOk()) return;
  const H=['الموظف','رقم الهوية','التاريخ','الحضور','طريقة الحضور','موقع الحضور','الانصراف','طريقة الانصراف','موقع الانصراف','المدة (ساعة:دقيقة)','التأخير (دقيقة)','ملاحظة','عُدّل بواسطة'];
  const D=attRows.map(r=>[r.name,r.nid||'',r.work_date,hm(r.in_time),METHOD[r.in_method]||'',r.in_site_name||'',hm(r.out_time),METHOD[r.out_method]||'',r.out_site_name||'',r.out_time?dur(minsBetween(r.in_time,r.out_time)):'',lateOf(r)??'',r.note||'',r.edited_by||'']);
  saveXlsx([H].concat(D),'الحضور','الحضور '+$('#attFrom').value+' إلى '+$('#attTo').value); };

/* ---------- monthly report ---------- */
let repRows=[];
async function loadReport(){ if(!$('#repMonth').value) $('#repMonth').value=todayISO().slice(0,7); repRows=(await api('report',{month:$('#repMonth').value})).rows; renderReport(); }
function renderReport(){
  const sum=k=>repRows.reduce((a,r)=>a+(+r[k]||0),0);
  $('#repKpis').innerHTML=
    kpi('أيام الحضور',sum('present'),'لكل الموظفين هذا الشهر','ok','check')+
    kpi('أيام الغياب',sum('absent'),'لمن لديهم وردية','bad','userx')+
    kpi('إجمالي التأخير',dur(sum('late')),'ساعة:دقيقة','warn','clock')+
    kpi('إجمالي الإضافي',dur(sum('over')),'ساعة:دقيقة','brand','activity')+
    kpi('ساعات العمل',dur(sum('mins')),'ساعة:دقيقة','none','chart');
  const q=$('#repQ').value.trim().toLowerCase();
  $('#repTb').innerHTML=repRows.filter(r=>!q||String(r.name).toLowerCase().includes(q)||String(r.nid||'').includes(q)).map(r=>'<tr><td class="name">'+esc(r.name)+'</td><td>'+esc(r.shift||'—')+'</td><td class="num">'+r.present+'</td>'+
    '<td class="num">'+(r.absent==null?'—':r.absent?'<span class="pill s-dead plain">'+r.absent+'</span>':0)+'</td>'+
    '<td class="num">'+(r.late?'<span class="pill s-warn plain">'+dur(r.late)+'</span>':'<span class="s-none">0</span>')+'</td><td class="num">'+(r.early?dur(r.early):'0')+'</td>'+
    '<td class="num">'+(r.over?'<span class="pill s-ok plain">'+dur(r.over)+'</span>':'<span class="s-none">0</span>')+'</td><td class="num"><b>'+dur(r.mins)+'</b></td><td class="num">'+(r.open||'')+'</td></tr>').join('')
    || '<tr><td colspan="9"><div class="empty">لا يوجد موظفون</div></td></tr>';
}
$('#repMonth').addEventListener('change',()=>act(loadReport));
$('#repQ').addEventListener('input',renderReport);
$('#repExport').onclick=()=>{ if(!xlsxOk()) return;
  const H=['الموظف','رقم الهوية','المهنة','الوردية','أيام الحضور','أيام الغياب','التأخير (ساعة:دقيقة)','خروج مبكر','إضافي','ساعات العمل','سجلات بدون انصراف'];
  saveXlsx([H].concat(repRows.map(r=>[r.name,r.nid||'',r.job||'',r.shift||'',r.present,r.absent??'',dur(r.late),dur(r.early),dur(r.over),dur(r.mins),r.open])),'التقرير الشهري','تقرير الحضور '+$('#repMonth').value); };
$('#repPrint').onclick=()=>printView('#v-report');

/* ---------- sites ---------- */
const kioskUrl=s=>new URL('kiosk.html?site='+s.id+'&k='+s.kiosk_key,location.href).href;
function renderSites(){
  $('#siteTb').innerHTML=sites.map(s=>'<tr><td class="name">'+esc(s.name)+'</td>'+
    '<td class="num" dir="ltr">'+(s.lat!=null?'<a href="https://maps.google.com/?q='+s.lat+','+s.lng+'" target="_blank" rel="noopener">'+(+s.lat).toFixed(5)+', '+(+s.lng).toFixed(5)+'</a>':'—')+'</td>'+
    '<td class="num">'+s.radius+' متر</td><td><div class="row" style="gap:6px">'+(+s.allow_qr?'<span class="pill s-info plain">باركود</span>':'')+(+s.allow_gps?'<span class="pill neutral plain">موقع جغرافي</span>':'')+'</div></td>'+
    '<td>'+(+s.allow_qr?'<div class="acts"><a class="btn sm" href="'+esc(kioskUrl(s))+'" target="_blank" rel="noopener">'+ic('qr','sm')+'فتح الشاشة</a><button class="btn sm" data-scopy="'+s.id+'">'+ic('copy','sm')+'نسخ الرابط</button><button class="btn icon" data-skey="'+s.id+'" title="تغيير الرابط (إذا تسرّب)">'+ic('refresh')+'</button></div>':'')+'</td>'+
    '<td><div class="acts"><button class="btn icon" title="تعديل" data-sedit="'+s.id+'">'+ic('edit')+'</button><button class="btn icon danger" title="حذف" data-sdel="'+s.id+'">'+ic('trash')+'</button></div></td></tr>').join('')
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
function radHint(){ const r=+SF.elements.radius.value; $('#radHint').textContent=r<20?'تنبيه: نطاق صغير جدًا: دقة GPS في الجوال 5–20 م، وقد يُرفض تسجيل موظفين داخل الموقع. ننصح بـ 30–100 م.':''; }
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
  $('#shiftTb').innerHTML=shifts.map(s=>'<tr><td class="name">'+esc(s.name)+'</td><td class="num">'+s.start_time+'</td><td class="num">'+s.end_time+(s.end_time<=s.start_time?' <span class="muted">(ليلية)</span>':'')+'</td><td class="num">'+s.grace+' دقيقة</td>'+
    '<td>'+String(s.off_days).split(',').filter(Boolean).map(d=>DAYS[+d]).join('، ')+'</td><td class="num">'+emps.filter(e=>e.shift_id===+s.id).length+'</td>'+
    '<td><div class="acts"><button class="btn icon" title="تعديل" data-hedit="'+s.id+'">'+ic('edit')+'</button><button class="btn icon danger" title="حذف" data-hdel="'+s.id+'">'+ic('trash')+'</button></div></td></tr>').join('')
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
function downloadTemplate(){ if(!xlsxOk()) return;
  const H=['#','اسم المشترك','تاريخ الميلاد','تاريخ الميلاد (هجري)','رقم الهوية','تاريخ انتهاء الهوية','المهنة','رقم بطاقة الصراف','تاريخ انتهاء بطاقة الصراف','تاريخ الالتحاق','رقم الجوال','البريد الإلكتروني'];
  saveXlsx([H,[1,'مثال: محمد عبدالله السبيعي','2000-01-01','','1000000000','2028-01-01','مندوب مبيعات','','2027-01-01','2024-01-01','0500000000','']],'سجل الموظفين','قالب الموظفين'); }
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
function exportEmps(){ if(!xlsxOk()) return;
  const H=['#','اسم المشترك','تاريخ الميلاد','تاريخ الميلاد (هجري)','العمر','رقم الهوية','تاريخ انتهاء الهوية','الأيام المتبقية (الهوية)','المهنة','رقم بطاقة الصراف','تاريخ انتهاء بطاقة الصراف','الأيام المتبقية (بطاقة الصراف)','تاريخ الالتحاق','تاريخ الدعم','الأيام المتبقية (الدعم)','رقم الجوال','البريد الإلكتروني','الوردية'];
  const D=v=>v?new Date(isoToUTC(v)+new Date(isoToUTC(v)).getTimezoneOffset()*6e4):'';
  saveXlsx([H].concat(rows().map(r=>[r.n,r.name,D(r.dob),r.dobH,r.age??'',r.nid,D(r.idExp),r.idDays??'',r.job,r.card,D(r.cardExp),r.cardDays??'',D(r.join),D(r.sup),r.supDays??'',r.phone,r.email,r.shiftName])),'سجل الموظفين','سجل الموظفين '+todayISO());
};

/* ---------- alerts popup / print ---------- */
function popup(){
  const A=alertsList(); if(!A.length) return;
  try{ if(localStorage.getItem('popDay')===todayISO()) return; localStorage.setItem('popDay',todayISO()); }catch(e){}
  $('#popList').innerHTML=A.slice(0,40).map(a=>'<li><span><b>'+esc(a.name)+'</b> <span class="muted">· '+a.type+'</span></span><span class="dot s-'+a.s+'">'+(a.days<0?'منتهية منذ '+(-a.days)+' يوم':'باقي '+a.days+' يوم')+'</span></li>').join('')+(A.length>40?'<li class="muted">و '+(A.length-40)+' تنبيهات أخرى…</li>':'');
  $('#dlgAlerts').showModal();
}
$('#popGo').onclick=()=>{ $('#dlgAlerts').close(); show('alerts'); };
function printView(sel){ const s=$(sel); s.classList.add('printing'); window.print(); setTimeout(()=>s.classList.remove('printing'),500); }
$('#btnPrint').onclick=()=>printView('#v-alerts');

/* ---------- settings ---------- */
$('#btnSettings').onclick=()=>{ $('#pwOld').value=$('#pwNew').value=$('#adU').value=$('#adP').value=''; document.body.classList.remove('menu'); $('#dlgSet').showModal(); };
$('#pwSave').onclick=()=>act(async()=>{ await api('admin_pass',{old:$('#pwOld').value,new:$('#pwNew').value}); toast('تم تغيير كلمة المرور'); $('#pwOld').value=$('#pwNew').value=''; });
$('#adSave').onclick=()=>act(async()=>{ await api('admin_add',{u:$('#adU').value.trim(),p:$('#adP').value}); toast('تمت إضافة المدير'); $('#adU').value=$('#adP').value=''; });
$('#logout').onclick=()=>act(async()=>{ await api('logout'); location.reload(); });

/* ---------- login + boot ---------- */
function showLogin(){ $('#lock').classList.add('on'); setTimeout(()=>$('#lu').focus(),50); }
$('#loginForm').addEventListener('submit',async ev=>{ ev.preventDefault(); $('#lockErr').textContent='';
  try{ await api('login',{u:$('#lu').value.trim(),p:$('#lp').value}); $('#lp').value=''; $('#lock').classList.remove('on'); start(); }
  catch(e){ $('#lockErr').textContent=e.message; } });

async function start(){
  try{ await Promise.all([loadMeta(),loadEmps(),loadWeek()]); }catch(e){ $('#lockErr').textContent=e.message; return; }
  renderAll();
  const t=ls.get('tab'); if(t&&$('#v-'+t)) show(t); else if(!emps.length) show('dash');
  popup();
  clearInterval(start._t); start._t=setInterval(()=>{ if(document.hidden) return; const v=ls.get('tab')||'dash'; if(v==='dash') act(async()=>{ await loadWeek(); renderDash(); }); else if(v==='att'&&$('#attTo').value>=todayISO()) act(loadAtt); },60000);
}
(async function boot(){
  try{ const me=await api('me'); if(!me.user){ showLogin(); return; } start(); }
  catch(e){ $('#lockErr').textContent=e.message; showLogin(); }
})();
})();
