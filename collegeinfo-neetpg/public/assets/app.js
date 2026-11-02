(()=>{
"use strict";

/* ================= CONFIG =================
   csvUrl: path or full URL of the data file. Relative paths resolve next to this page,
   so GitHub Pages / Cloudflare Pages work as long as all.csv is in the same folder. */
const CONFIG={csvUrl:'/api/data',pageSize:100,searchDebounceMs:150};

const $=id=>document.getElementById(id);
const fmt=n=>n.toLocaleString('en-IN');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ================= PARSING HELPERS (display values are never changed) ================= */
// Numeric value used only for comparing / sorting. Missing or non-numeric text ("--", "#", "") -> null (never 0).
function toNum(s){
  s=String(s==null?'':s);
  if(!/\d/.test(s))return null;
  const n=Number(s.replace(/[^\d.]/g,''));
  return Number.isFinite(n)?n:null;
}
// Course -> categories. Words NBE / Bond / Stipend / PDF are ignored; "DIiploma" (typo in the file) is still Diploma.
const CATS=['Diploma','DNB','Government','Private','Public Sector'],OTHER='Other / Unclassified';
function categorise(raw){
  const s=' '+String(raw).replace(/\.pdf$/i,'').replace(/[^A-Za-z]+/g,' ').toLowerCase()+' ';
  const out=[];
  if(/ di+ploma /.test(s))out.push('Diploma');
  if(/ dnb /.test(s))out.push('DNB');
  if(/ (government|govt) /.test(s))out.push('Government');
  if(/ private /.test(s))out.push('Private');
  if(/ public sector /.test(s))out.push('Public Sector');
  return out.length?out:[OTHER];
}
const COLS=['Course','State','Institute','Stipend Year 1','Stipend Year 2','Stipend Year 3','Bond Years','Bond Penalty','BED'];

/* ================= DATA ================= */
let ROWS=[];            // [{v:[9 original strings], cats, inst(lower), st(lower), s1,s2,s3,by,bed(numbers|null), byk,bpk(lower), i}]
let VIEW=[];            // filtered + sorted
let META={total:0,dups:0,bad:0};

async function fetchCsv(){
  if(!window.Papa)throw new Error('The CSV parser (Papa Parse) could not be loaded from the CDN. Check your internet connection or content blocker and try again.');
  const sep=CONFIG.csvUrl.includes('?')?'&':'?';
  const url=CONFIG.csvUrl+sep+'v='+Date.now();             // cache-busting
  let res;
  try{res=await fetch(url,{cache:'no-store'});}
  catch(e){throw new Error('Could not reach the protected data API. Check your connection and Cloudflare deployment.');}
  if(!res.ok)throw new Error('The server answered HTTP '+res.status+(res.statusText?' ('+res.statusText+')':'')+' for '+CONFIG.csvUrl+'. Make sure all.csv sits in the same folder as this page.');
  const text=await res.text();
  if(!text.trim())throw new Error(CONFIG.csvUrl+' is empty.');
  const p=Papa.parse(text,{header:true,skipEmptyLines:'greedy',delimiter:','});
  const fields=(p.meta&&p.meta.fields)||[];
  const idx={};
  for(const c of COLS){const f=fields.find(x=>x.trim().toLowerCase()===c.toLowerCase());if(f===undefined)throw new Error('Column "'+c+'" is missing from the CSV. Columns found: '+(fields.join(', ')||'none')+'.');idx[c]=f;}
  if(p.errors.some(e=>e.type==='Quotes'))throw new Error('The CSV has an unclosed quote and cannot be read reliably (row '+(p.errors.find(e=>e.type==='Quotes').row+2)+').');
  const bad=p.errors.filter(e=>e.type==='FieldMismatch').length;
  if(!p.data.length)throw new Error('The CSV contains no data rows.');
  return {data:p.data,idx,bad};
}
function buildRows({data,idx,bad}){
  const seen=new Set(),rows=[];let dups=0;
  for(const r of data){
    const v=COLS.map(c=>r[idx[c]]==null?'':String(r[idx[c]]));
    const key=v.join('\u0001');                          // exact match on every column only
    if(seen.has(key)){dups++;continue;}
    seen.add(key);
    rows.push({v,locked:v[2].startsWith('__LOCKED_PREMIUM__'),cats:categorise(v[0]),inst:v[2].toLowerCase(),st:v[1].toLowerCase(),
      s1:toNum(v[3]),s2:toNum(v[4]),s3:toNum(v[5]),by:toNum(v[6]),bed:toNum(v[8]),
      byk:v[6].toLowerCase(),bpk:v[7].toLowerCase(),i:rows.length});
  }
  ROWS=rows;META={total:rows.length,dups,bad};
}

/* ================= MULTI-SELECT ================= */
const OPEN=new Set();
class MultiSelect{
  constructor(host,{label,all,options,search,onChange}){
    this.sel=new Set();this.all=all;this.options=options;this.onChange=onChange;this.label=label;
    const id='ms'+Math.random().toString(36).slice(2,8);
    host.innerHTML=`<span class="flabel" id="${id}-l">${esc(label)}</span>
      <button type="button" class="ms-btn" aria-haspopup="true" aria-expanded="false" aria-labelledby="${id}-l ${id}-v"><span class="ms-val" id="${id}-v"></span>
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 5 4 4 4-4"/></svg></button>
      <div class="ms-panel" hidden role="group" aria-labelledby="${id}-l">
        ${search?`<input type="search" class="input ms-search" placeholder="Search ${esc(label.toLowerCase())}…" aria-label="Search ${esc(label)}" autocomplete="off">`:''}
        <div class="ms-actions"><button type="button" data-a="all">Select All</button><button type="button" data-a="none">Clear All</button></div>
        <div class="ms-list"></div></div>`;
    this.btn=host.querySelector('.ms-btn');this.val=host.querySelector('.ms-val');this.panel=host.querySelector('.ms-panel');this.host=host;
    this.list=host.querySelector('.ms-list');this.search=host.querySelector('.ms-search');
    this.list.innerHTML=options.map((o,i)=>`<label class="ms-opt"><input type="checkbox" data-i="${i}"><span>${esc(o.label)}</span></label>`).join('')+'<div class="ms-none" hidden>No matches</div>';
    this.boxes=[...this.list.querySelectorAll('input')];
    this.btn.onclick=()=>this.toggle();
    this.list.onchange=e=>{const b=e.target;if(!b.matches('input'))return;const k=options[+b.dataset.i].key;b.checked?this.sel.add(k):this.sel.delete(k);this.sync(true);};
    this.panel.querySelector('[data-a=all]').onclick=()=>{options.forEach(o=>this.sel.add(o.key));this.sync(true);};
    this.panel.querySelector('[data-a=none]').onclick=()=>{this.sel.clear();this.sync(true);};
    if(this.search)this.search.oninput=()=>{
      const q=this.search.value.trim().toLowerCase();let any=false;
      this.boxes.forEach((b,i)=>{const m=!q||options[i].label.toLowerCase().includes(q);b.parentElement.hidden=!m;if(m)any=true;});
      this.list.querySelector('.ms-none').hidden=any;
    };
    this.sync(false);
  }
  toggle(force){
    const open=force===undefined?this.panel.hidden:force;
    if(open){closeMenus();this.panel.hidden=false;this.btn.setAttribute('aria-expanded','true');OPEN.add(this);
      if(this.search){this.search.value='';this.search.oninput();this.search.focus({preventScroll:true});}}
    else{this.panel.hidden=true;this.btn.setAttribute('aria-expanded','false');OPEN.delete(this);}
  }
  sync(notify){
    this.boxes.forEach((b,i)=>{b.checked=this.sel.has(this.options[i].key);});
    const n=this.sel.size;
    this.val.textContent=n===0?this.all:n===1?this.options.find(o=>this.sel.has(o.key)).label:n+' selected';
    this.btn.classList.toggle('on',n>0);
    if(notify)this.onChange();
  }
  reset(){this.sel.clear();this.sync(false);}
}
function closeMenus(){[...OPEN].forEach(m=>m.toggle(false));}
document.addEventListener('click',e=>{if(![...OPEN].some(m=>m.host.contains(e.target)))closeMenus();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&OPEN.size){const m=[...OPEN][0];closeMenus();m.btn.focus();}});

/* ================= STATE ================= */
const F={q:'',num:{s1:'',s2:'',s3:'',bed:''},ms:{},sort:null,page:1,byAscending:false};
const NUMKEYS={s1:'n-s1',s2:'n-s2',s3:'n-s3',bed:'n-bed'};
const numOf=k=>{const t=F.num[k].trim();return t===''?null:toNum(t);};   // invalid text -> no restriction
const terms=()=>F.q.toLowerCase().split(/\s+/).filter(Boolean);

function activeCount(){
  let n=0;
  if(terms().length)n++;
  for(const k in F.ms)if(F.ms[k].sel.size)n++;
  for(const k in F.num)if(numOf(k)!==null)n++;
  return n;
}

/* ================= FILTER + SORT ================= */
function compute(){
  const T=terms(),c=F.ms.course.sel,s=F.ms.state.sel,by=F.ms.by.sel,bp=F.ms.bp.sel;
  const gt={};for(const k in NUMKEYS)gt[k]=numOf(k);
  const out=[];
  for(const r of ROWS){
    if(r.locked){out.push(r);continue;}
    if(T.length&&!T.every(t=>r.inst.includes(t)))continue;
    if(c.size&&!r.cats.some(x=>c.has(x)))continue;
    if(s.size&&!s.has(r.st))continue;
    if(by.size&&!by.has(r.byk))continue;
    if(bp.size&&!bp.has(r.bpk))continue;
    let ok=true;
    for(const k in gt){if(gt[k]!==null&&!(r[k]!==null&&r[k]>gt[k])){ok=false;break;}}
    if(ok)out.push(r);
  }
  if(F.sort){
    const k=F.sort;
    const direction=(k==='by'&&F.byAscending)?1:-1;
    out.sort((a,b)=>{const x=a[k],y=b[k];
      if(x===null&&y===null)return a.i-b.i;
      if(x===null)return 1;if(y===null)return -1;      // missing values always last
      return direction*(x-y)||a.i-b.i;});
  }
  VIEW=out;
}

/* ================= RENDER ================= */
const LABELS=['Course','State','Institute','Stipend Year 1','Stipend Year 2','Stipend Year 3','Bond Years','Bond Penalty','BED'];
function render(){
  const total=VIEW.length,pages=Math.max(1,Math.ceil(total/CONFIG.pageSize));
  if(F.page>pages)F.page=pages;if(F.page<1)F.page=1;
  const start=(F.page-1)*CONFIG.pageSize,end=Math.min(start+CONFIG.pageSize,total);
  $('countNum').textContent=fmt(total);
  $('rangeTxt').textContent=total?`Showing ${fmt(start+1)}–${fmt(end)} of ${fmt(total)}`:'';
  const ac=activeCount(),b=$('activeBadge');
  b.hidden=ac===0;b.textContent=ac+(ac===1?' filter active':' filters active');
  $('qx').hidden=!F.q;
  document.querySelectorAll('.sbtn').forEach(x=>{x.setAttribute('aria-pressed',x.dataset.sort===F.sort);if(x.dataset.sort==='by')x.setAttribute('aria-label','Sort Bond Years '+(F.byAscending?'ascending':'descending'));});
  $('empty').hidden=total>0;$('tbody').parentElement.hidden=total===0;
  let h='';
  for(let i=start;i<end;i++){
    const r=VIEW[i],v=r.v;
    if(r.locked){h+=`<tr class="locked-row" tabindex="0" role="link" aria-label="Premium institute. Select to unlock full institute information."><td data-label="${LABELS[0]}"><span class="locked-cell">Locked</span></td><td data-label="${LABELS[1]}"><span class="locked-cell">••••••</span></td><td class="inst" data-label="${LABELS[2]}"><span class="lock-label">🔒 Premium institute · Unlock to view</span></td><td class="num" data-label="${LABELS[3]}"><span class="locked-cell">••••••</span></td><td class="num" data-label="${LABELS[4]}"><span class="locked-cell">••••••</span></td><td class="num" data-label="${LABELS[5]}"><span class="locked-cell">••••••</span></td><td class="num" data-label="${LABELS[6]}"><span class="locked-cell">••••••</span></td><td class="num" data-label="${LABELS[7]}"><span class="locked-cell">••••••</span></td><td class="num" data-label="${LABELS[8]}"><span class="locked-cell">••••••</span></td></tr>`;continue;}
    const cc=r.cats.map((x,j)=>`<span class="pill${j===0?' t':''}">${esc(x)}</span>`).join('');
    h+=`<tr><td data-label="${LABELS[0]}" title="${esc(v[0])}">${cc}</td><td data-label="${LABELS[1]}">${esc(v[1])}</td><td class="inst" data-label="${LABELS[2]}">${esc(v[2])}</td>`
      +`<td class="num" data-label="${LABELS[3]}">${esc(v[3])}</td><td class="num" data-label="${LABELS[4]}">${esc(v[4])}</td><td class="num" data-label="${LABELS[5]}">${esc(v[5])}</td>`
      +`<td class="num" data-label="${LABELS[6]}">${esc(v[6])}</td><td class="num" data-label="${LABELS[7]}">${esc(v[7])}</td><td class="num" data-label="${LABELS[8]}">${esc(v[8])}</td></tr>`;
  }
  $('tbody').innerHTML=h;
  $('pager').hidden=total===0;
  $('pagerInfo').textContent=total?`${fmt(start+1)}–${fmt(end)} of ${fmt(total)}`:'';
  $('pgTxt').textContent=`Page ${fmt(F.page)} of ${fmt(pages)}`;
  $('prev').disabled=F.page<=1;$('next').disabled=F.page>=pages;
}
function update(resetPage=true){if(resetPage)F.page=1;compute();render();}

/* ================= CONTROLS ================= */
function optionsFrom(values,labelOf,cmp){
  const m=new Map();for(const v of values){const k=v.toLowerCase();if(!m.has(k))m.set(k,v);}
  let a=[...m].map(([key,raw])=>({key,label:labelOf(raw)}));
  if(cmp)a.sort(cmp);return a;
}
function buildControls(){
  const available=ROWS.filter(r=>!r.locked);
  const catsPresent=new Set(available.flatMap(r=>r.cats));
  const courseOpts=[...CATS,OTHER].filter(c=>catsPresent.has(c)).map(c=>({key:c,label:c}));
  const num=(a,b)=>{const x=toNum(a.label),y=toNum(b.label);if(x===null&&y===null)return a.label.localeCompare(b.label);if(x===null)return 1;if(y===null)return -1;return x-y;};
  const blank=s=>s;
  F.ms.course=new MultiSelect($('f-course'),{label:'Course',all:'All courses',options:courseOpts,onChange:()=>update()});
  F.ms.state=new MultiSelect($('f-state'),{label:'State',all:'All states',search:true,onChange:()=>update(),
    options:optionsFrom(available.map(r=>r.v[1]),s=>s,(a,b)=>a.label.localeCompare(b.label))});
  F.ms.by=new MultiSelect($('f-by'),{label:'Bond Years',all:'All values',onChange:()=>update(),
    options:optionsFrom(available.map(r=>r.v[6]).filter(s=>s.trim()!==''&&s.trim()!=='#'&&s.trim().toLowerCase()!=='(blank)'),blank,num)});
  F.ms.bp=new MultiSelect($('f-bp'),{label:'Bond Penalty',all:'All values',onChange:()=>update(),
    options:optionsFrom(available.map(r=>r.v[7]).filter(s=>s.trim()!==''&&s.trim()!=='#'&&s.trim()!=='0'&&s.trim().toLowerCase()!=='(blank)'),blank,num)});
}
function wire(){
  let t;
  $('q').addEventListener('input',e=>{clearTimeout(t);const val=e.target.value;$('qx').hidden=!val;
    t=setTimeout(()=>{F.q=val;update();},CONFIG.searchDebounceMs);});
  $('qx').onclick=()=>{clearTimeout(t);$('q').value='';F.q='';update();$('q').focus();};
  for(const k in NUMKEYS){
    const el=$(NUMKEYS[k]);
    el.addEventListener('input',()=>{F.num[k]=el.value;el.setAttribute('aria-invalid',el.value.trim()!==''&&toNum(el.value)===null);update();});
  }
  document.querySelectorAll('.sbtn').forEach(b=>b.onclick=()=>{if(b.dataset.sort==='by'){if(F.sort==='by')F.byAscending=!F.byAscending;else{F.sort='by';F.byAscending=false;}}else F.sort=F.sort===b.dataset.sort?null:b.dataset.sort;update();});
  $('prev').onclick=()=>go(F.page-1);$('next').onclick=()=>go(F.page+1);
  const clear=()=>{
    F.q='';$('q').value='';
    for(const k in NUMKEYS){F.num[k]='';$(NUMKEYS[k]).value='';$(NUMKEYS[k]).removeAttribute('aria-invalid');}
    for(const k in F.ms)F.ms[k].reset();
    closeMenus();update();
  };
  $('clearAll').onclick=clear;$('emptyClear').onclick=clear;
}
function go(p){
  F.page=p;render();
  $('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
}

/* ================= LOAD ================= */
function setStatus(kind,title,msg){
  const s=$('status');s.hidden=false;$('app').hidden=true;
  s.className='status'+(kind==='err'?' err':'');
  s.innerHTML=kind==='err'
    ?`<h2>${esc(title)}</h2><p>${esc(msg)}</p><button type="button" class="btn primary" id="retry">Try again</button>`
    :`<div class="spin" aria-hidden="true"></div><h2>${esc(title)}</h2><p>${esc(msg)}</p>`;
  const r=$('retry');if(r)r.onclick=load;
}
let wired=false;
async function load(){
  setStatus('load','Loading the latest data…','Fetching the college list.');
  try{
    buildRows(await fetchCsv());
    if(!ROWS.length)throw new Error('No usable rows were found in the CSV.');
  }catch(err){
    console.error(err);
    setStatus('err','The data could not be loaded',err.message);
    return;
  }
  Object.values(F.ms).forEach(m=>m.host.innerHTML='');
  buildControls();
  if(!wired){wire();wired=true;}
  $('status').hidden=true;$('app').hidden=false;
  update();
}

/* ================= NAVIGATION ================= */
function route(){
  const r=location.hash==='#contact'?'contact':location.hash==='#premium'?'premium':'home';
  $('page-home').hidden=r!=='home';$('page-contact').hidden=r!=='contact';$('page-premium').hidden=r!=='premium';
  document.querySelectorAll('.navbtn').forEach(b=>{r===b.dataset.route?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current');});
  closeMenus();
  window.scrollTo(0,0);
}
document.querySelectorAll('.navbtn').forEach(b=>b.onclick=()=>{location.hash='#'+b.dataset.route;});
document.addEventListener('click',e=>{if(e.target.closest('.locked-row'))location.hash='#premium';});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.locked-row')){e.preventDefault();location.hash='#premium';}});
window.addEventListener('hashchange',route);
route();
load();
})();
