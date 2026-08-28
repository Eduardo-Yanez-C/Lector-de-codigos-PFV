/* ============================================================
   LECTOR PANELES CSO — v2
   Mejoras: escáner reforzado · prefijo configurable · modo lote
   Malla: 10 inv × 6 trk = 60 trk · trk=72 pos · 3 strings de 24
          S1:1–24  S2:25–48  S3:49–72  (posición continua 1..72)
   ============================================================ */

const CFG = {
  INVERSORES:10, TRK_POR_INV:6, POS_POR_TRK:72,
  STR_POR_TRK:3, POS_POR_STR:24, META_CSO:4320,
  PREFIX_DEFAULT:'ETND1314', SERIAL_LEN:17
};
function rangoString(str){ const ini=(str-1)*CFG.POS_POR_STR+1; return [ini, ini+CFG.POS_POR_STR-1]; }

const DB = window.PANELES_DB || {};
const LS = { inst:'cso_instalados', url:'cso_syncurl', oper:'cso_operario', pref:'cso_prefix' };

let installs = JSON.parse(localStorage.getItem(LS.inst)||'[]');
let cur = { serial:null, inv:null, trk:null, str:null, pos:null, nocat:false };
let mode = 'uno';                 // 'uno' | 'lote'
let queue = [];                   // cola del modo lote
let loteDest = { inv:null, trk:null, str:null };

// ============ UTIL ============
function $(id){ return document.getElementById(id); }
function save(){ localStorage.setItem(LS.inst, JSON.stringify(installs)); refreshCounts(); }
function getPrefix(){ return (localStorage.getItem(LS.pref)||CFG.PREFIX_DEFAULT).toUpperCase(); }
function toast(msg,type){ const t=$('toast'); t.textContent=msg; t.className='toast show '+(type||''); setTimeout(()=>t.className='toast '+(type||''),2000); }
function beep(ok){ if(navigator.vibrate) navigator.vibrate(ok?90:[60,50,60]); }
function ocupadas(inv,trk){ const s=new Set(); installs.forEach(i=>{ if(i.inv==inv&&i.trk==trk) s.add(i.pos); }); return s; }
function yaInstalado(serial){ return installs.find(i=>i.serial===serial); }

// normaliza cualquier lectura/tipeo a serial completo
function normalizeSerial(raw){
  let s=(raw||'').toUpperCase().replace(/[\*\s]/g,'').trim();
  if(!s) return '';
  const pref=getPrefix();
  if(s.startsWith('TND')) s='E'+s;               // etiqueta física tapada
  // si el usuario solo escribió la parte variable, anteponer prefijo
  if(!s.startsWith(pref) && (pref.startsWith(s.slice(0,4))===false) && s.length < CFG.SERIAL_LEN){
    // heurística: si no empieza con el prefijo y es corto, es la parte variable
    if(!/^E?TND/.test(s)) s = pref + s;
  }
  return s;
}

// ============ NAVEGACIÓN ============
function showView(v,btn){
  document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));
  $(v).classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(v==='v-log') renderLog();
}

// ============ MODO uno / lote ============
function setMode(m){
  mode=m;
  $('modeUno').classList.toggle('on', m==='uno');
  $('modeLote').classList.toggle('on', m==='lote');
  $('unoBlock').style.display = m==='uno'?'block':'none';
  $('loteBlock').style.display = m==='lote'?'block':'none';
  $('loteDest').style.display = m==='lote'?'block':'none';
  // limpiar
  $('panelCard').style.display='none'; $('ubicCard').style.display='none';
  $('btnSave').disabled=true; $('manualSerial').value='';
  if(m==='lote'){ buildInv($('lSelInv')); }
}

// ============ MALLA (dropdowns) ============
function buildInv(sel){
  if(sel.options.length) return;
  sel.innerHTML='<option value="">—</option>';
  for(let i=1;i<=CFG.INVERSORES;i++) sel.innerHTML+='<option value="'+i+'">Inversor '+i+'</option>';
}
function trackersDeInv(inv){ const base=(inv-1)*CFG.TRK_POR_INV; return Array.from({length:CFG.TRK_POR_INV},(_,k)=>base+k+1); }

/* ---- INDIVIDUAL ---- */
function onInv(){
  cur.inv=+$('selInv').value||null;
  const sel=$('selTrk'); sel.innerHTML='<option value="">—</option>';
  if(cur.inv){ trackersDeInv(cur.inv).forEach((gt,k)=>sel.innerHTML+='<option value="'+gt+'">Tracker '+gt+' (T'+(k+1)+')</option>'); sel.disabled=false; }
  else sel.disabled=true;
  cur.trk=cur.str=cur.pos=null; $('strButtons').innerHTML=''; $('posWrap').style.display='none'; $('btnSave').disabled=true;
}
function onTrk(){
  cur.trk=+$('selTrk').value||null; cur.str=cur.pos=null;
  $('posWrap').style.display='none'; $('btnSave').disabled=true;
  const wrap=$('strButtons'); wrap.innerHTML='';
  if(!cur.trk) return;
  const occ=ocupadas(cur.inv,cur.trk);
  for(let s=1;s<=CFG.STR_POR_TRK;s++){
    const [a,b]=rangoString(s); let libres=0; for(let p=a;p<=b;p++) if(!occ.has(p)) libres++;
    const btn=document.createElement('button'); btn.className='btn-ghost btn-sm'; btn.style.marginBottom='0';
    btn.innerHTML='String '+s+'<br><span style="font-size:10px;color:var(--muted)">'+a+'–'+b+' · '+libres+' libres</span>';
    if(libres===0){ btn.disabled=true; btn.style.opacity=.4; }
    btn.onclick=()=>selStr(s,btn); wrap.appendChild(btn);
  }
}
function selStr(s,btn){
  cur.str=s; cur.pos=null;
  document.querySelectorAll('#strButtons button').forEach(b=>{b.style.background='transparent';b.style.color='var(--txt)';b.style.borderColor='var(--linea)';});
  btn.style.background='var(--lima)'; btn.style.color='#0a1f14'; btn.style.borderColor='var(--lima)';
  buildPos(); $('btnSave').disabled=true;
}
function buildPos(){
  const [a,b]=rangoString(cur.str); $('posRange').textContent='pos '+a+' a '+b;
  const occ=ocupadas(cur.inv,cur.trk); const grid=$('posGrid'); grid.innerHTML='';
  for(let p=a;p<=b;p++){ const c=document.createElement('div'); c.className='pos-cell '+(occ.has(p)?'taken':'free'); c.textContent=p; if(!occ.has(p)) c.onclick=()=>selPos(p,c); grid.appendChild(c); }
  $('posWrap').style.display='block';
  const libre=[...Array(b-a+1).keys()].map(i=>a+i).find(p=>!occ.has(p));
  if(libre){ const cell=[...grid.children].find(x=>+x.textContent===libre); if(cell) selPos(libre,cell); }
}
function selPos(p,cell){ cur.pos=p; document.querySelectorAll('.pos-cell.sel').forEach(x=>x.classList.remove('sel')); cell.classList.add('sel'); $('btnSave').disabled=false; }

/* ---- LOTE destino ---- */
function lOnInv(){
  loteDest.inv=+$('lSelInv').value||null;
  const sel=$('lSelTrk'); sel.innerHTML='<option value="">—</option>';
  if(loteDest.inv){ trackersDeInv(loteDest.inv).forEach((gt,k)=>sel.innerHTML+='<option value="'+gt+'">Tracker '+gt+' (T'+(k+1)+')</option>'); sel.disabled=false; }
  else sel.disabled=true;
  loteDest.trk=loteDest.str=null; $('lStrButtons').innerHTML=''; updateLoteInfo();
}
function lOnTrk(){
  loteDest.trk=+$('lSelTrk').value||null; loteDest.str=null;
  const wrap=$('lStrButtons'); wrap.innerHTML='';
  if(!loteDest.trk){ updateLoteInfo(); return; }
  const occ=ocupadas(loteDest.inv,loteDest.trk);
  for(let s=1;s<=CFG.STR_POR_TRK;s++){
    const [a,b]=rangoString(s); let libres=0; for(let p=a;p<=b;p++) if(!occ.has(p)) libres++;
    const btn=document.createElement('button'); btn.className='btn-ghost btn-sm'; btn.style.marginBottom='0';
    btn.innerHTML='String '+s+'<br><span style="font-size:10px;color:var(--muted)">'+a+'–'+b+' · '+libres+' libres</span>';
    if(libres===0){ btn.disabled=true; btn.style.opacity=.4; }
    btn.onclick=()=>lSelStr(s,btn); wrap.appendChild(btn);
  }
  updateLoteInfo();
}
function lSelStr(s,btn){
  loteDest.str=s;
  document.querySelectorAll('#lStrButtons button').forEach(b=>{b.style.background='transparent';b.style.color='var(--txt)';b.style.borderColor='var(--linea)';});
  btn.style.background='var(--lima)'; btn.style.color='#0a1f14'; btn.style.borderColor='var(--lima)';
  updateLoteInfo();
}
function updateLoteInfo(){
  const el=$('lInfo');
  if(loteDest.inv&&loteDest.trk&&loteDest.str){
    const [a,b]=rangoString(loteDest.str);
    el.innerHTML='✓ Destino: <b>Inv '+loteDest.inv+' · Trk '+loteDest.trk+' · String '+loteDest.str+'</b> (pos '+a+'–'+b+'). Ahora escanea los paneles.';
  } else el.innerHTML='Selecciona inversor, tracker y string antes de escanear.';
}
// próximas posiciones libres del string destino (considerando ya-instalados + cola)
function nextPosLote(){
  if(!loteDest.str) return null;
  const [a,b]=rangoString(loteDest.str);
  const occ=ocupadas(loteDest.inv,loteDest.trk);
  const enCola=new Set(queue.filter(q=>!q.dup&&q.pos).map(q=>q.pos));
  for(let p=a;p<=b;p++) if(!occ.has(p)&&!enCola.has(p)) return p;
  return null; // string lleno
}

// ============ INGRESO (manual + scan) unificado ============
function manualEnter(){
  const s=normalizeSerial($('manualSerial').value);
  if(!s){ toast('Ingresa un serial','warn'); return; }
  handleSerial(s);
  $('manualSerial').value='';
}
// punto único de entrada para un serial (venga de scan o manual)
function handleSerial(serial){
  if(mode==='lote') return addToQueue(serial);
  // individual
  cur={serial:serial, inv:cur.inv, trk:cur.trk, str:cur.str, pos:null, nocat:false};
  $('panelCard').style.display='block';
  $('pSerial').textContent=serial;
  const info=DB[serial]; const vd=$('pVerdict'); const pInfo=$('pInfo');
  const dup=yaInstalado(serial);
  if(dup){ vd.className='verdict v-err'; vd.innerHTML='⛔ Ya instalado en Inv '+dup.inv+' · Trk '+dup.trk+' · Str '+dup.str+' · Pos '+dup.pos; pInfo.innerHTML=''; $('ubicCard').style.display='none'; $('btnSave').disabled=true; beep(false); return; }
  if(!info){ vd.className='verdict v-warn'; vd.innerHTML='⚠️ Serial NO está en la base de fábrica. Verifica la lectura. Instalable, quedará marcado como <b>no catalogado</b>.'; pInfo.innerHTML=''; cur.nocat=true; }
  else { if(info.d){ vd.className='verdict v-warn'; vd.innerHTML='⚠️ Serial <b>duplicado en fábrica</b> (2 pallets). Registrable, verifica físicamente.'; } else { vd.className='verdict v-ok'; vd.innerHTML='✓ Panel válido y en base de fábrica.'; } pInfo.innerHTML='<b>Pallet:</b> '+info.p+' · <b>Cont:</b> '+info.c+' · <b>Pot:</b> '+(info.w?info.w+' W':'—'); cur.nocat=false; }
  $('ubicCard').style.display='block'; buildInv($('selInv'));
  // conservar inv/trk/str si ya estaban elegidos (agiliza cargar seguido)
  if(cur.inv){ $('selInv').value=cur.inv; onInv(); if(cur.trk){ $('selTrk').value=cur.trk; onTrk(); } }
  beep(true);
}

// ============ COLA (modo lote) ============
function addToQueue(serial){
  if(!loteDest.inv||!loteDest.trk||!loteDest.str){ toast('Primero fija el destino del lote','warn'); beep(false); return; }
  // duplicados: ya instalado, o ya en cola
  const yaInst=yaInstalado(serial);
  const enCola=queue.find(q=>q.serial===serial);
  let dup=false, motivo='';
  if(yaInst){ dup=true; motivo='ya instalado'; }
  else if(enCola){ dup=true; motivo='repetido en cola'; }
  const info=DB[serial]||{};
  let pos=null;
  if(!dup){ pos=nextPosLote(); if(pos===null){ toast('String lleno, no caben más','err'); beep(false); return; } }
  queue.push({serial, pos, dup, motivo, nocat:info.p?0:1, w:info.w||'', pallet:info.p||'', cont:info.c||''});
  renderQueue(); beep(!dup);
  if(dup) toast('⚠️ '+serial+' — '+motivo,'warn');
}
function renderQueue(){
  const list=$('queueList');
  const validos=queue.filter(q=>!q.dup).length;
  $('qCount').textContent='('+validos+' válidos'+(queue.length-validos?' · '+(queue.length-validos)+' desc.':'')+')';
  $('scanCount').textContent=validos+' en cola';
  if(!queue.length){ list.innerHTML='<div class="empty">Escanea paneles para agregarlos a la cola</div>'; $('btnSaveLote').disabled=true; return; }
  list.innerHTML=queue.map((q,idx)=>`
    <div class="queue-item ${q.dup?'dup':''}">
      <div>
        <div class="q-serial">${q.serial}</div>
        <div class="q-meta">${q.dup?'⛔ '+q.motivo : (q.nocat?'⚠️ no catalogado':'✓ ok')}</div>
      </div>
      <span class="q-pos ${q.dup?'bad':''}">${q.dup?'—':'pos '+q.pos}</span>
      <button class="q-del" onclick="delQueue(${idx})">✕</button>
    </div>`).join('');
  $('btnSaveLote').disabled = validos===0;
}
function delQueue(idx){ queue.splice(idx,1); recomputeQueuePos(); renderQueue(); }
function clearQueue(){ queue=[]; renderQueue(); }
// recalcular posiciones tras borrar (mantener orden de llegada)
function recomputeQueuePos(){
  if(!loteDest.str) return;
  const [a,b]=rangoString(loteDest.str);
  const occ=ocupadas(loteDest.inv,loteDest.trk);
  let p=a;
  queue.forEach(q=>{
    if(q.dup){ return; }
    while(p<=b && occ.has(p)) p++;
    q.pos = p<=b ? p : null;
    if(q.pos===null){ q.dup=true; q.motivo='string lleno'; } else p++;
  });
}
function saveQueue(){
  const validos=queue.filter(q=>!q.dup&&q.pos);
  if(!validos.length){ toast('Nada válido que guardar','warn'); return; }
  const oper=localStorage.getItem(LS.oper)||'';
  validos.forEach(q=>{
    installs.push({ serial:q.serial, inv:loteDest.inv, trk:loteDest.trk, str:loteDest.str, pos:q.pos,
      pallet:q.pallet, cont:q.cont, w:q.w, nocat:q.nocat, oper, ts:new Date().toISOString(), synced:0 });
  });
  save();
  toast('✓ '+validos.length+' paneles guardados en Inv '+loteDest.inv+' Trk '+loteDest.trk+' Str '+loteDest.str);
  queue=[]; renderQueue();
  // refrescar libres del string destino
  lOnTrk(); if(loteDest.str){ const btns=document.querySelectorAll('#lStrButtons button'); if(btns[loteDest.str-1]) lSelStr(loteDest.str, btns[loteDest.str-1]); }
  if(navigator.onLine && localStorage.getItem(LS.url)) syncNow(true);
}

// ============ GUARDAR INDIVIDUAL ============
function saveInstall(){
  if(!cur.serial||!cur.inv||!cur.trk||!cur.str||!cur.pos){ toast('Faltan datos','err'); return; }
  if(yaInstalado(cur.serial)){ toast('Serial ya instalado','err'); return; }
  if(ocupadas(cur.inv,cur.trk).has(cur.pos)){ toast('Posición ocupada','err'); return; }
  const info=DB[cur.serial]||{};
  installs.push({ serial:cur.serial, inv:cur.inv, trk:cur.trk, str:cur.str, pos:cur.pos,
    pallet:info.p||'', cont:info.c||'', w:info.w||'', nocat:cur.nocat?1:0,
    oper:localStorage.getItem(LS.oper)||'', ts:new Date().toISOString(), synced:0 });
  save();
  toast('✓ Panel '+cur.pos+' guardado · Inv '+cur.inv+' Trk '+cur.trk+' Str '+cur.str);
  $('panelCard').style.display='none'; $('ubicCard').style.display='none'; $('manualSerial').value='';
  // conservar inv/trk/str para el siguiente (agiliza), limpiar serial+pos
  cur={serial:null, inv:cur.inv, trk:cur.trk, str:cur.str, pos:null, nocat:false};
  $('btnSave').disabled=true;
  if(navigator.onLine && localStorage.getItem(LS.url)) syncNow(true);
}

// ============ ESCÁNER REFORZADO ============
let codeReader=null, scanTrack=null, torchOn=false, lastScanTxt='', lastScanTime=0;
async function startScan(){
  if(typeof ZXing==='undefined'){ toast('Escáner no cargó, usa modo manual','err'); return; }
  if(mode==='lote' && (!loteDest.inv||!loteDest.trk||!loteDest.str)){ toast('Fija el destino del lote primero','warn'); return; }
  $('scanArea').style.display='flex';
  $('scanCount').style.display = mode==='lote'?'block':'none';
  $('scanLast').style.display='none';
  $('scanHint').textContent = mode==='lote' ? 'Modo lote: escanea uno tras otro' : 'Apunta al código de barras';

  try{
    // Restringir a los formatos del panel => más rápido y preciso (Code 39 principal)
    const hints=new Map();
    const F=ZXing.BarcodeFormat;
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [F.CODE_39, F.CODE_128, F.CODE_93, F.ITF]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    codeReader = new ZXing.BrowserMultiFormatReader(hints, 250); // reintento cada 250ms

    // Pedir cámara trasera a buena resolución con enfoque continuo
    const constraints={ audio:false, video:{
      facingMode:{ideal:'environment'},
      width:{ideal:1920}, height:{ideal:1080},
      focusMode:'continuous', advanced:[{focusMode:'continuous'}]
    }};
    const stream=await navigator.mediaDevices.getUserMedia(constraints);
    const video=$('video'); video.srcObject=stream; await video.play();
    scanTrack=stream.getVideoTracks()[0];

    // botón linterna si el dispositivo lo soporta
    const caps=scanTrack.getCapabilities?scanTrack.getCapabilities():{};
    $('torchBtn').style.display = caps.torch ? 'block':'none';

    // intentar mejorar enfoque si hay soporte
    if(caps.focusMode && caps.focusMode.includes('continuous')){
      try{ await scanTrack.applyConstraints({advanced:[{focusMode:'continuous'}]}); }catch(e){}
    }

    codeReader.decodeFromStream(stream, video, (result, err)=>{
      if(result){
        const txt=result.getText();
        const now=Date.now();
        // anti-rebote: ignora la misma lectura repetida en < 1.2s
        if(txt===lastScanTxt && now-lastScanTime<1200) return;
        lastScanTxt=txt; lastScanTime=now;
        const serial=normalizeSerial(txt);
        onScanHit(serial);
      }
    });
  }catch(e){
    $('scanArea').style.display='none';
    toast('No se pudo abrir la cámara: '+(e.name||e.message),'err');
  }
}
function onScanHit(serial){
  flashOk();
  $('scanLast').style.display='block';
  $('scanLast').textContent='✓ '+serial;
  if(mode==='lote'){
    addToQueue(serial);           // sigue escaneando sin cerrar
  } else {
    stopScan();                   // individual: cierra y muestra ubicación
    $('manualSerial').value=serial.replace(getPrefix(),'');
    handleSerial(serial);
    toast('Leído: '+serial);
  }
}
function flashOk(){ const f=$('scanFlash'); f.classList.add('show'); setTimeout(()=>f.classList.remove('show'),140); }
async function toggleTorch(){
  if(!scanTrack) return;
  try{ torchOn=!torchOn; await scanTrack.applyConstraints({advanced:[{torch:torchOn}]}); $('torchBtn').textContent=torchOn?'🔦 Apagar':'🔦 Linterna'; }
  catch(e){ toast('Linterna no disponible','warn'); }
}
function stopScan(){
  if(codeReader){ try{codeReader.reset();}catch(e){} codeReader=null; }
  if(scanTrack){ try{scanTrack.stop();}catch(e){} scanTrack=null; }
  const v=$('video'); if(v&&v.srcObject){ v.srcObject.getTracks().forEach(t=>t.stop()); v.srcObject=null; }
  torchOn=false; lastScanTxt='';
  $('scanArea').style.display='none';
  if(mode==='lote') renderQueue();
}

// ============ REGISTRO / LOG ============
function renderLog(){
  const list=$('logList');
  if(!installs.length){ list.innerHTML='<div class="empty">Aún no hay paneles instalados</div>'; $('stInst').textContent=0; $('stPct').textContent='0%'; $('stPend').textContent=0; return; }
  const recent=[...installs].reverse().slice(0,60);
  list.innerHTML=recent.map(i=>`
    <div class="log-item">
      <div><div class="log-serial">${i.serial}</div>
        <div class="log-loc">Inv ${i.inv} · Trk ${i.trk} · Str ${i.str} · Pos ${i.pos}${i.nocat?' · ⚠️ no cat.':''}</div></div>
      <span class="badge-sync ${i.synced?'b-sync':'b-pend'}">${i.synced?'sync':'pend'}</span>
    </div>`).join('');
  $('stInst').textContent=installs.length;
  $('stPct').textContent=Math.round(installs.length/CFG.META_CSO*100)+'%';
  $('stPend').textContent=installs.filter(i=>!i.synced).length;
}
function refreshCounts(){ $('cntInst').textContent=installs.length; $('cntPend').textContent=installs.filter(i=>!i.synced).length; }

// ============ SYNC ============
function saveSyncUrl(v){ localStorage.setItem(LS.url, v.trim()); }
function saveOperario(v){ localStorage.setItem(LS.oper, v.trim()); }
function savePrefix(v){ const p=v.toUpperCase().trim()||CFG.PREFIX_DEFAULT; localStorage.setItem(LS.pref,p); $('prefixTag').textContent=p; }

async function syncNow(silent){
  const url=localStorage.getItem(LS.url);
  if(!url){ if(!silent) toast('Configura la URL primero','warn'); return; }
  const pend=installs.filter(i=>!i.synced);
  if(!pend.length){ if(!silent) toast('Nada pendiente ✓'); return; }
  if(!silent) $('syncMsg').textContent='Enviando '+pend.length+' registros...';
  try{
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({registros:pend})});
    const out=await res.json();
    if(out.ok){
      const env=new Set(pend.map(p=>p.serial+'|'+p.inv+'|'+p.trk+'|'+p.pos));
      installs.forEach(i=>{ if(env.has(i.serial+'|'+i.inv+'|'+i.trk+'|'+i.pos)) i.synced=1; });
      save(); renderLog();
      if(!silent){ $('syncMsg').textContent='✓ '+pend.length+' sincronizados'; toast('✓ Sincronizado'); }
    } else throw new Error(out.error||'error servidor');
  }catch(e){ if(!silent){ $('syncMsg').textContent='✗ '+e.message+' (guardado local intacto)'; toast('Sin conexión, guardado local','warn'); } }
}

// ============ EXPORTAR ============
function exportCSV(){
  if(!installs.length){ toast('Nada para exportar','warn'); return; }
  const head=['Serial','Inversor','Tracker','String','Posicion','Pallet','Contenedor','Potencia_W','No_Catalogado','Operario','FechaHora'];
  const rows=installs.map(i=>[i.serial,i.inv,i.trk,i.str,i.pos,i.pallet,i.cont,i.w,i.nocat?'SI':'',i.oper,i.ts]);
  download('instalados_CSO_'+stamp()+'.csv',[head,...rows].map(r=>r.map(c=>`"${c??''}"`).join(',')).join('\n'),'text/csv');
}
function exportJSON(){ download('respaldo_CSO_'+stamp()+'.json',JSON.stringify(installs,null,2),'application/json'); }
function download(name,content,type){ const b=new Blob([content],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function stamp(){ return new Date().toISOString().slice(0,16).replace(/[:T]/g,'-'); }

// ============ MANTENIMIENTO ============
function marcarSincronizados(){ installs.forEach(i=>i.synced=1); save(); renderLog(); toast('Marcado ✓'); }
function borrarTodo(){ if(confirm('¿Borrar TODO el registro local? No se puede deshacer.')){ installs=[]; save(); renderLog(); toast('Registro borrado'); } }

// ============ RED ============
function updateNet(){ const on=navigator.onLine; $('netDot').className='dot '+(on?'on':'off'); $('netTxt').textContent=on?'Online':'Offline'; }
window.addEventListener('online',()=>{updateNet(); if(localStorage.getItem(LS.url)) syncNow(true);});
window.addEventListener('offline',updateNet);

// ============ INIT ============
(function init(){
  updateNet(); refreshCounts();
  const pref=getPrefix(); $('prefixTag').textContent=pref;
  $('cfgPrefix').value=pref;
  $('syncUrl').value=localStorage.getItem(LS.url)||'';
  $('operario').value=localStorage.getItem(LS.oper)||'';
  buildInv($('selInv'));
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
