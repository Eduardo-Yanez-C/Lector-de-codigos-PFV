/* ============================================================
   LECTOR PANELES CSO — lógica principal
   Malla: 10 inversores × 6 trackers = 60 trackers
          cada tracker = 72 posiciones = 3 strings de 24
          String 1: pos 1–24 | String 2: 25–48 | String 3: 49–72
   ============================================================ */

const CFG = {
  INVERSORES: 10,
  TRK_POR_INV: 6,
  POS_POR_TRK: 72,
  STR_POR_TRK: 3,
  POS_POR_STR: 24,
  META_CSO: 4320
};

// String -> rango de posiciones (continuo 1..72, NO reinicia)
function rangoString(str){
  const ini = (str-1)*CFG.POS_POR_STR + 1;
  return [ini, ini + CFG.POS_POR_STR - 1];   // S1:[1,24] S2:[25,48] S3:[49,72]
}

const DB = window.PANELES_DB || {};
const LS = {
  inst:  'cso_instalados',
  url:   'cso_syncurl',
  oper:  'cso_operario'
};

// ---- estado en memoria ----
let installs = JSON.parse(localStorage.getItem(LS.inst) || '[]');
let cur = { serial:null, inv:null, trk:null, str:null, pos:null };

// ============ UTIL ============
function $(id){ return document.getElementById(id); }
function save(){ localStorage.setItem(LS.inst, JSON.stringify(installs)); refreshCounts(); }
function toast(msg, type){
  const t=$('toast'); t.textContent=msg; t.className='toast show '+(type||'');
  setTimeout(()=>t.className='toast '+(type||''), 2200);
}
function keyTrk(inv,trk){ return inv+'-'+trk; }
// posiciones ocupadas en un tracker
function ocupadas(inv,trk){
  const set=new Set();
  installs.forEach(i=>{ if(i.inv==inv && i.trk==trk) set.add(i.pos); });
  return set;
}
// ¿serial ya instalado?
function yaInstalado(serial){ return installs.find(i=>i.serial===serial); }

// ============ NAVEGACIÓN ============
function showView(v, btn){
  document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));
  $(v).classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(v==='v-log') renderLog();
}

// ============ RESOLVER SERIAL ============
function resolveSerial(raw){
  if(!raw) return;
  // limpiar delimitadores Code39 y espacios
  let s = raw.toUpperCase().replace(/[\*\s]/g,'').trim();
  // el label físico a veces pierde la E inicial (TND...) -> normalizar
  if(s.startsWith('TND')) s = 'E'+s;
  cur = { serial:s, inv:null, trk:null, str:null, pos:null };

  $('panelCard').style.display='block';
  $('pSerial').textContent = s;
  const info = DB[s];
  const vd = $('pVerdict');
  const pInfo = $('pInfo');

  const dup = yaInstalado(s);
  if(dup){
    vd.className='verdict v-err';
    vd.innerHTML = '⛔ Ya instalado en Inv '+dup.inv+' · Trk '+dup.trk+' · Str '+dup.str+' · Pos '+dup.pos;
    pInfo.innerHTML='';
    $('ubicCard').style.display='none';
    $('btnSave').disabled=true;
    return;
  }

  if(!info){
    vd.className='verdict v-warn';
    vd.innerHTML = '⚠️ Serial NO está en la base de fábrica. Verifica la lectura. Puedes instalarlo igual, pero quedará marcado como <b>no catalogado</b>.';
    pInfo.innerHTML='';
    cur.nocat = true;
  } else {
    if(info.d){
      vd.className='verdict v-warn';
      vd.innerHTML='⚠️ Serial <b>duplicado en fábrica</b> (aparece en 2 pallets). Registrable, verifica físicamente.';
    } else {
      vd.className='verdict v-ok';
      vd.innerHTML='✓ Panel válido y en base de fábrica.';
    }
    pInfo.innerHTML = '<b>Pallet:</b> '+info.p+' &nbsp;·&nbsp; <b>Contenedor:</b> '+info.c+
                      ' &nbsp;·&nbsp; <b>Potencia:</b> '+(info.w?info.w+' W':'—');
    cur.nocat = false;
  }
  // abrir ubicación
  $('ubicCard').style.display='block';
  buildInversores();
  resetUbic();
}

// ============ MALLA / DROPDOWNS ============
function buildInversores(){
  const sel=$('selInv');
  if(sel.options.length) return; // ya construido
  sel.innerHTML='<option value="">—</option>';
  for(let i=1;i<=CFG.INVERSORES;i++)
    sel.innerHTML+='<option value="'+i+'">Inversor '+i+'</option>';
}
function resetUbic(){
  $('selInv').value=''; $('selTrk').innerHTML='<option value="">—</option>';
  $('selTrk').disabled=true;
  $('strButtons').innerHTML=''; $('posWrap').style.display='none';
  cur.inv=cur.trk=cur.str=cur.pos=null;
  $('btnSave').disabled=true;
}
function onInv(){
  cur.inv = +$('selInv').value || null;
  const sel=$('selTrk');
  sel.innerHTML='<option value="">—</option>';
  if(cur.inv){
    // trackers globales: inv 1 => 1..6, inv 2 => 7..12 ...
    const base=(cur.inv-1)*CFG.TRK_POR_INV;
    for(let t=1;t<=CFG.TRK_POR_INV;t++){
      const gt=base+t;
      sel.innerHTML+='<option value="'+gt+'">Tracker '+gt+' (T'+t+' del inv)</option>';
    }
    sel.disabled=false;
  } else sel.disabled=true;
  cur.trk=cur.str=cur.pos=null;
  $('strButtons').innerHTML=''; $('posWrap').style.display='none';
  $('btnSave').disabled=true;
}
function onTrk(){
  cur.trk = +$('selTrk').value || null;
  cur.str=cur.pos=null;
  $('posWrap').style.display='none';
  $('btnSave').disabled=true;
  const wrap=$('strButtons');
  wrap.innerHTML='';
  if(!cur.trk) return;
  const occ = ocupadas(cur.inv,cur.trk);
  for(let s=1;s<=CFG.STR_POR_TRK;s++){
    const [a,b]=rangoString(s);
    let libres=0; for(let p=a;p<=b;p++) if(!occ.has(p)) libres++;
    const btn=document.createElement('button');
    btn.className='btn-ghost btn-sm';
    btn.style.marginBottom='0';
    btn.innerHTML='String '+s+'<br><span style="font-size:10px;color:var(--muted)">'+a+'–'+b+' · '+libres+' libres</span>';
    if(libres===0){ btn.disabled=true; btn.style.opacity=.4; }
    btn.onclick=()=>selStr(s,btn);
    wrap.appendChild(btn);
  }
}
function selStr(s,btn){
  cur.str=s; cur.pos=null;
  document.querySelectorAll('#strButtons button').forEach(b=>{
    b.style.background='transparent'; b.style.color='var(--txt)'; b.style.borderColor='var(--linea)';
  });
  btn.style.background='var(--lima)'; btn.style.color='#0a1f14'; btn.style.borderColor='var(--lima)';
  buildPos();
  $('btnSave').disabled=true;
}
function buildPos(){
  const [a,b]=rangoString(cur.str);
  $('posRange').textContent='pos '+a+' a '+b;
  const occ=ocupadas(cur.inv,cur.trk);
  const grid=$('posGrid'); grid.innerHTML='';
  for(let p=a;p<=b;p++){
    const c=document.createElement('div');
    c.className='pos-cell '+(occ.has(p)?'taken':'free');
    c.textContent=p;
    if(!occ.has(p)) c.onclick=()=>selPos(p,c);
    grid.appendChild(c);
  }
  $('posWrap').style.display='block';
  // autoselección: primera posición libre
  const libre=[...Array(b-a+1).keys()].map(i=>a+i).find(p=>!occ.has(p));
  if(libre){ const cell=[...grid.children].find(x=>+x.textContent===libre); if(cell) selPos(libre,cell); }
}
function selPos(p,cell){
  cur.pos=p;
  document.querySelectorAll('.pos-cell.sel').forEach(x=>x.classList.remove('sel'));
  cell.classList.add('sel');
  $('btnSave').disabled=false;
}

// ============ GUARDAR ============
function saveInstall(){
  if(!cur.serial||!cur.inv||!cur.trk||!cur.str||!cur.pos){ toast('Faltan datos','err'); return; }
  if(yaInstalado(cur.serial)){ toast('Serial ya instalado','err'); return; }
  // doble check posición
  if(ocupadas(cur.inv,cur.trk).has(cur.pos)){ toast('Posición ocupada','err'); return; }
  const info = DB[cur.serial]||{};
  const rec = {
    serial:cur.serial, inv:cur.inv, trk:cur.trk, str:cur.str, pos:cur.pos,
    pallet:info.p||'', cont:info.c||'', w:info.w||'',
    nocat:cur.nocat?1:0,
    oper: localStorage.getItem(LS.oper)||'',
    ts: new Date().toISOString(),
    synced:0
  };
  installs.push(rec);
  save();
  toast('✓ Panel '+cur.pos+' guardado · Inv '+cur.inv+' Trk '+cur.trk+' Str '+cur.str);
  // limpiar para siguiente lectura
  $('panelCard').style.display='none';
  $('ubicCard').style.display='none';
  $('manualSerial').value='';
  cur={serial:null,inv:null,trk:null,str:null,pos:null};
  $('btnSave').disabled=true;
  // intentar sync silencioso
  if(navigator.onLine && localStorage.getItem(LS.url)) syncNow(true);
}

// ============ ESCÁNER (ZXing) ============
let codeReader=null, scanStream=null;
async function startScan(){
  if(typeof ZXing==='undefined'){ toast('Escáner no cargó, usa modo manual','err'); return; }
  $('scanArea').style.display='flex';
  try{
    codeReader = new ZXing.BrowserMultiFormatReader();
    const devices = await codeReader.listVideoInputDevices();
    // preferir cámara trasera
    let devId = devices.length? devices[devices.length-1].deviceId : undefined;
    codeReader.decodeFromVideoDevice(devId, 'video', (result, err)=>{
      if(result){
        const txt = result.getText();
        stopScan();
        if(navigator.vibrate) navigator.vibrate(120);
        $('manualSerial').value=txt.toUpperCase().replace(/[\*\s]/g,'');
        resolveSerial(txt);
        toast('Leído: '+txt);
      }
    });
  }catch(e){
    $('scanArea').style.display='none';
    toast('No se pudo abrir la cámara','err');
  }
}
function stopScan(){
  if(codeReader){ try{codeReader.reset();}catch(e){} codeReader=null; }
  $('scanArea').style.display='none';
}

// ============ REGISTRO / LOG ============
function renderLog(){
  const list=$('logList');
  if(!installs.length){ list.innerHTML='<div class="empty">Aún no hay paneles instalados</div>'; return; }
  const recent=[...installs].reverse().slice(0,50);
  list.innerHTML=recent.map(i=>`
    <div class="log-item">
      <div>
        <div class="log-serial">${i.serial}</div>
        <div class="log-loc">Inv ${i.inv} · Trk ${i.trk} · Str ${i.str} · Pos ${i.pos}${i.nocat?' · ⚠️ no cat.':''}</div>
      </div>
      <span class="badge-sync ${i.synced?'b-sync':'b-pend'}">${i.synced?'sync':'pend'}</span>
    </div>`).join('');
  $('stInst').textContent=installs.length;
  $('stPct').textContent=Math.round(installs.length/CFG.META_CSO*100)+'%';
  $('stPend').textContent=installs.filter(i=>!i.synced).length;
}

// ============ CONTADORES HEADER ============
function refreshCounts(){
  $('cntInst').textContent=installs.length;
  $('cntPend').textContent=installs.filter(i=>!i.synced).length;
}

// ============ SYNC GOOGLE SHEETS ============
function saveSyncUrl(v){ localStorage.setItem(LS.url, v.trim()); }
function saveOperario(v){ localStorage.setItem(LS.oper, v.trim()); }

async function syncNow(silent){
  const url=localStorage.getItem(LS.url);
  if(!url){ if(!silent) toast('Configura la URL primero','warn'); return; }
  const pend=installs.filter(i=>!i.synced);
  if(!pend.length){ if(!silent) toast('Nada pendiente ✓'); return; }
  if(!silent) $('syncMsg').textContent='Enviando '+pend.length+' registros...';
  try{
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'}, // evita preflight CORS
      body: JSON.stringify({registros:pend})
    });
    const out = await res.json();
    if(out.ok){
      // marcar los enviados
      const enviados=new Set(pend.map(p=>p.serial+'|'+p.inv+'|'+p.trk+'|'+p.pos));
      installs.forEach(i=>{ if(enviados.has(i.serial+'|'+i.inv+'|'+i.trk+'|'+i.pos)) i.synced=1; });
      save();
      if(!silent){ $('syncMsg').textContent='✓ '+pend.length+' sincronizados'; toast('✓ Sincronizado'); }
      renderLog();
    } else throw new Error(out.error||'error servidor');
  }catch(e){
    if(!silent){ $('syncMsg').textContent='✗ Error: '+e.message+' (guardado local sigue intacto)'; toast('Sin conexión, guardado local','warn'); }
  }
}

// ============ EXPORTAR ============
function exportCSV(){
  if(!installs.length){ toast('Nada para exportar','warn'); return; }
  const head=['Serial','Inversor','Tracker','String','Posicion','Pallet','Contenedor','Potencia_W','No_Catalogado','Operario','FechaHora'];
  const rows=installs.map(i=>[i.serial,i.inv,i.trk,i.str,i.pos,i.pallet,i.cont,i.w,i.nocat?'SI':'',i.oper,i.ts]);
  const csv=[head,...rows].map(r=>r.map(c=>`"${(c??'')}"`).join(',')).join('\n');
  download('instalados_CSO_'+stamp()+'.csv', csv, 'text/csv');
}
function exportJSON(){
  download('respaldo_CSO_'+stamp()+'.json', JSON.stringify(installs,null,2), 'application/json');
}
function download(name, content, type){
  const blob=new Blob([content],{type}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function stamp(){ return new Date().toISOString().slice(0,16).replace(/[:T]/g,'-'); }

// ============ MANTENIMIENTO ============
function marcarSincronizados(){ installs.forEach(i=>i.synced=1); save(); renderLog(); toast('Marcado ✓'); }
function borrarTodo(){
  if(confirm('¿Borrar TODO el registro local? Esto no se puede deshacer.')){
    installs=[]; save(); renderLog(); toast('Registro borrado');
  }
}

// ============ RED ============
function updateNet(){
  const on=navigator.onLine;
  $('netDot').className='dot '+(on?'on':'off');
  $('netTxt').textContent=on?'Online':'Offline';
}
window.addEventListener('online', ()=>{updateNet(); if(localStorage.getItem(LS.url)) syncNow(true);});
window.addEventListener('offline', updateNet);

// ============ INIT ============
(function init(){
  updateNet();
  refreshCounts();
  $('syncUrl').value = localStorage.getItem(LS.url)||'';
  $('operario').value = localStorage.getItem(LS.oper)||'';
  // registrar service worker para PWA offline
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
})();
