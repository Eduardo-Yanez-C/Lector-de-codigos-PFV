/* ============================================================
   LECTOR PANELES CSO — v3
   Escáner HÍBRIDO: código de barras → si falla, OCR de los números
   OCR local (Tesseract, offline) + corrección inteligente contra
   los 5.939 seriales de fábrica (arregla confusiones O/0, I/1, S/5…)
   Malla: 10 inv × 6 trk = 60 trk · trk=72 pos · 3 strings de 24
          S1:1–24  S2:25–48  S3:49–72  (posición continua 1..72)
   ============================================================ */

const CFG = {
  INVERSORES:10, TRK_POR_INV:6, POS_POR_TRK:72, STR_POR_TRK:3, POS_POR_STR:24, META_CSO:4320,
  PREFIX_DEFAULT:'ETND1314', SERIAL_LEN:17
};
function rangoString(str){ const ini=(str-1)*CFG.POS_POR_STR+1; return [ini, ini+CFG.POS_POR_STR-1]; }

const DB = window.PANELES_DB || {};
const DB_KEYS = Object.keys(DB);
const LS = { inst:'cso_instalados', url:'cso_syncurl', oper:'cso_operario', pref:'cso_prefix', ocrd:'cso_ocrdelay' };

let installs = JSON.parse(localStorage.getItem(LS.inst)||'[]');
// Helpers para que auth.js modifique installs sin reasignar la variable (falla cross-archivo en móvil)
function removeLocalInstall(serial){
  for(let i=installs.length-1;i>=0;i--){ if(installs[i].serial===serial) installs.splice(i,1); }
  save(); if(typeof renderLog==='function') renderLog();
}
function updateLocalInstall(serial,inv,trk,str,pos){
  installs.forEach(i=>{ if(i.serial===serial){ i.inv=inv; i.trk=trk; i.str=str; i.pos=pos; } });
  save(); if(typeof renderLog==='function') renderLog();
}
function clearSyncedLocal(){ // borra de local todo lo que ya está sincronizado
  for(let i=installs.length-1;i>=0;i--){ if(installs[i].synced) installs.splice(i,1); }
  save();
}
let cur = { serial:null, inv:null, trk:null, str:null, pos:null, nocat:false };
let mode='uno', queue=[], loteDest={inv:null,trk:null,str:null};

// ============ UTIL ============
function $(id){ return document.getElementById(id); }
function save(){ localStorage.setItem(LS.inst, JSON.stringify(installs)); refreshCounts(); }
function getPrefix(){ return (localStorage.getItem(LS.pref)||CFG.PREFIX_DEFAULT).toUpperCase(); }
function getOcrDelay(){ return (parseInt(localStorage.getItem(LS.ocrd))||3)*1000; }
function toast(msg,type){ const t=$('toast'); t.textContent=msg; t.className='toast show '+(type||''); setTimeout(()=>t.className='toast '+(type||''),2200); }
function beep(ok){ if(navigator.vibrate) navigator.vibrate(ok?90:[60,50,60]); }
function ocupadas(inv,trk){ const s=new Set(); installs.forEach(i=>{ if(i.inv==inv&&i.trk==trk) s.add(i.pos); }); return s; }
function yaInstalado(serial){ return installs.find(i=>i.serial===serial); }

// ---- normaliza texto de barras/manual a serial completo ----
function normalizeSerial(raw){
  let s=(raw||'').toUpperCase().replace(/[\*\s]/g,'').trim();
  if(!s) return '';
  const pref=getPrefix();
  if(s.startsWith('TND')) s='E'+s;
  if(!s.startsWith(pref) && s.length < CFG.SERIAL_LEN && !/^E?TND/.test(s)) s = pref + s;
  return s;
}

/* ============================================================
   CORRECTOR INTELIGENTE (para OCR)
   El OCR confunde caracteres. Como TODOS los seriales están en
   la base, corregimos la lectura al serial real más parecido.
   ============================================================ */
// mapa de confusiones típicas del OCR
const OCR_FIX = { 'O':'0','Q':'0','D':'0','I':'1','L':'1','|':'1','Z':'2','S':'5','B':'8','G':'6','A':'4','T':'7' };
function cleanOcrText(txt){
  // quedarnos con la línea que parece el serial
  let up = (txt||'').toUpperCase();
  // buscar patrón ETND + dígitos (permitiendo ruido)
  let m = up.replace(/[^A-Z0-9]/g,'');
  // localizar 'ETND' o 'TND'
  let idx = m.indexOf('ETND'); if(idx<0){ let t=m.indexOf('TND'); if(t>=0){ m='E'+m.slice(t);} }
  else m=m.slice(idx);
  return m;
}
function distance(a,b){ // hamming sobre misma longitud (seriales fijos 17)
  let d=0; const n=Math.max(a.length,b.length);
  for(let i=0;i<n;i++) if(a[i]!==b[i]) d++;
  return d;
}
// intenta resolver un texto OCR a un serial real; devuelve {serial, exact, sugerido, alt}
function resolveOcr(rawText){
  let s = cleanOcrText(rawText);
  const pref=getPrefix();
  // corregir la parte del prefijo con el prefijo conocido
  if(s.length>=8) s = pref + s.slice(8);
  // convertir letras confundidas a dígitos SOLO en la parte numérica (tras prefijo)
  if(s.length>8){
    let head=s.slice(0,8), tail=s.slice(8).split('').map(c=>OCR_FIX[c]||c).join('');
    s=head+tail;
  }
  // exacto?
  if(DB[s]) return {serial:s, exact:true};
  // recortar/rellenar a longitud esperada
  if(s.length>CFG.SERIAL_LEN) s=s.slice(0,CFG.SERIAL_LEN);
  if(DB[s]) return {serial:s, exact:true};
  // buscar el más parecido en la base (solo entre los que comparten prefijo, rápido)
  let best=null,bestD=99,second=99;
  for(const k of DB_KEYS){
    const d=distance(s,k);
    if(d<bestD){ second=bestD; bestD=d; best=k; }
    else if(d<second){ second=d; }
    if(bestD===0) break;
  }
  // aceptamos sugerencia si difiere en 1-2 chars y es claramente la mejor
  if(best && bestD<=2 && bestD<second) return {serial:s, exact:false, sugerido:best, dist:bestD};
  return {serial:s, exact:false};
}

// ============ NAVEGACIÓN ============
function showView(v,btn){
  document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));
  const view=$(v); if(view) view.classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(v==='v-log') renderLog();
}
function setMode(m){
  mode=m;
  $('modeUno').classList.toggle('on',m==='uno'); $('modeLote').classList.toggle('on',m==='lote');
  $('unoBlock').style.display=m==='uno'?'block':'none';
  $('loteBlock').style.display=m==='lote'?'block':'none';
  $('loteDest').style.display=m==='lote'?'block':'none';
  $('panelCard').style.display='none'; $('ubicCard').style.display='none';
  $('btnSave').disabled=true; $('manualSerial').value='';
  if(m==='lote') buildInv($('lSelInv'));
}

// ============ MALLA ============
function buildInv(sel){ if(sel.options.length) return; sel.innerHTML='<option value="">—</option>'; for(let i=1;i<=CFG.INVERSORES;i++) sel.innerHTML+='<option value="'+i+'">Inversor '+i+'</option>'; }
function trackersDeInv(inv){ const b=(inv-1)*CFG.TRK_POR_INV; return Array.from({length:CFG.TRK_POR_INV},(_,k)=>b+k+1); }

function onInv(){
  cur.inv=+$('selInv').value||null;
  const sel=$('selTrk'); sel.innerHTML='<option value="">—</option>';
  if(cur.inv){ trackersDeInv(cur.inv).forEach((gt,k)=>sel.innerHTML+='<option value="'+gt+'">Tracker '+gt+' (T'+(k+1)+')</option>'); sel.disabled=false; } else sel.disabled=true;
  cur.trk=cur.str=cur.pos=null; $('strButtons').innerHTML=''; $('posWrap').style.display='none'; $('btnSave').disabled=true;
}
function onTrk(){
  cur.trk=+$('selTrk').value||null; cur.str=cur.pos=null; $('posWrap').style.display='none'; $('btnSave').disabled=true;
  const wrap=$('strButtons'); wrap.innerHTML=''; if(!cur.trk) return;
  const occ=ocupadas(cur.inv,cur.trk);
  for(let s=1;s<=CFG.STR_POR_TRK;s++){ const [a,b]=rangoString(s); let libres=0; for(let p=a;p<=b;p++) if(!occ.has(p)) libres++;
    const btn=document.createElement('button'); btn.className='btn-ghost btn-sm'; btn.style.marginBottom='0';
    btn.innerHTML='String '+s+'<br><span style="font-size:10px;color:var(--muted)">'+a+'–'+b+' · '+libres+' libres</span>';
    if(libres===0){ btn.disabled=true; btn.style.opacity=.4; } btn.onclick=()=>selStr(s,btn); wrap.appendChild(btn); }
}
function selStr(s,btn){ cur.str=s; cur.pos=null;
  document.querySelectorAll('#strButtons button').forEach(b=>{b.style.background='transparent';b.style.color='var(--txt)';b.style.borderColor='var(--linea)';});
  btn.style.background='var(--lima)'; btn.style.color='#0a1f14'; btn.style.borderColor='var(--lima)'; buildPos(); $('btnSave').disabled=true; }
function buildPos(){ const [a,b]=rangoString(cur.str); $('posRange').textContent='pos '+a+' a '+b;
  const occ=ocupadas(cur.inv,cur.trk); const grid=$('posGrid'); grid.innerHTML='';
  for(let p=a;p<=b;p++){ const c=document.createElement('div'); c.className='pos-cell '+(occ.has(p)?'taken':'free'); c.textContent=p; if(!occ.has(p)) c.onclick=()=>selPos(p,c); grid.appendChild(c); }
  $('posWrap').style.display='block';
  const libre=[...Array(b-a+1).keys()].map(i=>a+i).find(p=>!occ.has(p));
  if(libre){ const cell=[...grid.children].find(x=>+x.textContent===libre); if(cell) selPos(libre,cell); } }
function selPos(p,cell){ cur.pos=p; document.querySelectorAll('.pos-cell.sel').forEach(x=>x.classList.remove('sel')); cell.classList.add('sel'); $('btnSave').disabled=false; }

/* LOTE destino */
function lOnInv(){ loteDest.inv=+$('lSelInv').value||null; const sel=$('lSelTrk'); sel.innerHTML='<option value="">—</option>';
  if(loteDest.inv){ trackersDeInv(loteDest.inv).forEach((gt,k)=>sel.innerHTML+='<option value="'+gt+'">Tracker '+gt+' (T'+(k+1)+')</option>'); sel.disabled=false; } else sel.disabled=true;
  loteDest.trk=loteDest.str=null; $('lStrButtons').innerHTML=''; updateLoteInfo(); }
function lOnTrk(){ loteDest.trk=+$('lSelTrk').value||null; loteDest.str=null; const wrap=$('lStrButtons'); wrap.innerHTML='';
  if(!loteDest.trk){ updateLoteInfo(); return; } const occ=ocupadas(loteDest.inv,loteDest.trk);
  for(let s=1;s<=CFG.STR_POR_TRK;s++){ const [a,b]=rangoString(s); let libres=0; for(let p=a;p<=b;p++) if(!occ.has(p)) libres++;
    const btn=document.createElement('button'); btn.className='btn-ghost btn-sm'; btn.style.marginBottom='0';
    btn.innerHTML='String '+s+'<br><span style="font-size:10px;color:var(--muted)">'+a+'–'+b+' · '+libres+' libres</span>';
    if(libres===0){ btn.disabled=true; btn.style.opacity=.4; } btn.onclick=()=>lSelStr(s,btn); wrap.appendChild(btn); } updateLoteInfo(); }
function lSelStr(s,btn){ loteDest.str=s;
  document.querySelectorAll('#lStrButtons button').forEach(b=>{b.style.background='transparent';b.style.color='var(--txt)';b.style.borderColor='var(--linea)';});
  btn.style.background='var(--lima)'; btn.style.color='#0a1f14'; btn.style.borderColor='var(--lima)'; updateLoteInfo(); }
function updateLoteInfo(){ const el=$('lInfo');
  if(loteDest.inv&&loteDest.trk&&loteDest.str){ const [a,b]=rangoString(loteDest.str);
    el.innerHTML='✓ Destino: <b>Inv '+loteDest.inv+' · Trk '+loteDest.trk+' · String '+loteDest.str+'</b> (pos '+a+'–'+b+'). Ahora escanea.'; }
  else el.innerHTML='Selecciona inversor, tracker y string antes de escanear.'; }
function nextPosLote(){ if(!loteDest.str) return null; const [a,b]=rangoString(loteDest.str);
  const occ=ocupadas(loteDest.inv,loteDest.trk); const enCola=new Set(queue.filter(q=>!q.dup&&q.pos).map(q=>q.pos));
  for(let p=a;p<=b;p++) if(!occ.has(p)&&!enCola.has(p)) return p; return null; }

// ============ INGRESO ============
function manualEnter(){ const s=normalizeSerial($('manualSerial').value); if(!s){ toast('Ingresa un serial','warn'); return; } handleSerial(s,'manual'); $('manualSerial').value=''; }
function handleSerial(serial, origen){
  if(mode==='lote') return addToQueue(serial);
  cur={serial:serial, inv:cur.inv, trk:cur.trk, str:cur.str, pos:null, nocat:false};
  $('panelCard').style.display='block'; $('pSerial').textContent=serial;
  const info=DB[serial]; const vd=$('pVerdict'); const pInfo=$('pInfo');
  const dup=yaInstalado(serial);
  if(dup){ vd.className='verdict v-err'; vd.innerHTML='⛔ Ya instalado en Inv '+dup.inv+' · Trk '+dup.trk+' · Str '+dup.str+' · Pos '+dup.pos; pInfo.innerHTML=''; $('ubicCard').style.display='none'; $('btnSave').disabled=true; beep(false); return; }
  if(!info){ vd.className='verdict v-warn'; vd.innerHTML='⚠️ Serial NO está en la base de fábrica'+(origen==='ocr'?' (leído por OCR, revísalo)':'')+'. Instalable, quedará <b>no catalogado</b>.'; pInfo.innerHTML=''; cur.nocat=true; }
  else { if(info.d){ vd.className='verdict v-warn'; vd.innerHTML='⚠️ Serial <b>duplicado en fábrica</b> (2 pallets). Registrable, verifica físicamente.'; } else { vd.className='verdict v-ok'; vd.innerHTML='✓ Panel válido y en base de fábrica'+(origen==='ocr'?' (leído por OCR ✓)':'')+'.'; } pInfo.innerHTML='<b>Pallet:</b> '+info.p+' · <b>Cont:</b> '+info.c+' · <b>Pot:</b> '+(info.w?info.w+' W':'—'); cur.nocat=false; }
  $('ubicCard').style.display='block'; buildInv($('selInv'));
  if(cur.inv){ $('selInv').value=cur.inv; onInv(); if(cur.trk){ $('selTrk').value=cur.trk; onTrk(); } }
  beep(true);
}

// ============ COLA (lote) ============
function addToQueue(serial){
  if(!loteDest.inv||!loteDest.trk||!loteDest.str){ toast('Primero fija el destino del lote','warn'); beep(false); return; }
  const yaInst=yaInstalado(serial); const enCola=queue.find(q=>q.serial===serial);
  let dup=false,motivo=''; if(yaInst){ dup=true; motivo='ya instalado'; } else if(enCola){ dup=true; motivo='repetido en cola'; }
  const info=DB[serial]||{}; let pos=null;
  if(!dup){ pos=nextPosLote(); if(pos===null){ toast('String lleno, no caben más','err'); beep(false); return; } }
  queue.push({serial,pos,dup,motivo,nocat:info.p?0:1,w:info.w||'',pallet:info.p||'',cont:info.c||''});
  renderQueue(); beep(!dup); if(dup) toast('⚠️ '+serial+' — '+motivo,'warn');
}
function renderQueue(){ const list=$('queueList'); const validos=queue.filter(q=>!q.dup).length;
  $('qCount').textContent='('+validos+' válidos'+(queue.length-validos?' · '+(queue.length-validos)+' desc.':'')+')';
  $('scanCount').textContent=validos+' en cola';
  if(!queue.length){ list.innerHTML='<div class="empty">Escanea paneles para agregarlos a la cola</div>'; $('btnSaveLote').disabled=true; return; }
  list.innerHTML=queue.map((q,idx)=>`<div class="queue-item ${q.dup?'dup':''}"><div><div class="q-serial">${q.serial}</div>
    <div class="q-meta">${q.dup?'⛔ '+q.motivo:(q.nocat?'⚠️ no catalogado':'✓ ok')}</div></div>
    <span class="q-pos ${q.dup?'bad':''}">${q.dup?'—':'pos '+q.pos}</span>
    <button class="q-del" onclick="delQueue(${idx})">✕</button></div>`).join('');
  $('btnSaveLote').disabled=validos===0; }
function delQueue(idx){ queue.splice(idx,1); recomputeQueuePos(); renderQueue(); }
function clearQueue(){ queue=[]; renderQueue(); }
function recomputeQueuePos(){ if(!loteDest.str) return; const [a,b]=rangoString(loteDest.str); const occ=ocupadas(loteDest.inv,loteDest.trk); let p=a;
  queue.forEach(q=>{ if(q.dup) return; while(p<=b&&occ.has(p)) p++; q.pos=p<=b?p:null; if(q.pos===null){ q.dup=true; q.motivo='string lleno'; } else p++; }); }
function saveQueue(){ const validos=queue.filter(q=>!q.dup&&q.pos); if(!validos.length){ toast('Nada válido que guardar','warn'); return; }
  const oper=localStorage.getItem(LS.oper)||'';
  validos.forEach(q=>installs.push({serial:q.serial,inv:loteDest.inv,trk:loteDest.trk,str:loteDest.str,pos:q.pos,pallet:q.pallet,cont:q.cont,w:q.w,nocat:q.nocat,oper,ts:new Date().toISOString(),synced:0}));
  save(); toast('✓ '+validos.length+' paneles guardados en Inv '+loteDest.inv+' Trk '+loteDest.trk+' Str '+loteDest.str);
  queue=[]; renderQueue(); lOnTrk(); if(loteDest.str){ const btns=document.querySelectorAll('#lStrButtons button'); if(btns[loteDest.str-1]) lSelStr(loteDest.str,btns[loteDest.str-1]); }
  if(navigator.onLine&&localStorage.getItem(LS.url)) syncNow(true); }

// ============ GUARDAR INDIVIDUAL ============
function saveInstall(){
  if(!cur.serial||!cur.inv||!cur.trk||!cur.str||!cur.pos){ toast('Faltan datos','err'); return; }
  if(yaInstalado(cur.serial)){ toast('Serial ya instalado','err'); return; }
  if(ocupadas(cur.inv,cur.trk).has(cur.pos)){ toast('Posición ocupada','err'); return; }
  const info=DB[cur.serial]||{};
  installs.push({serial:cur.serial,inv:cur.inv,trk:cur.trk,str:cur.str,pos:cur.pos,pallet:info.p||'',cont:info.c||'',w:info.w||'',nocat:cur.nocat?1:0,oper:localStorage.getItem(LS.oper)||'',ts:new Date().toISOString(),synced:0});
  save(); toast('✓ Panel '+cur.pos+' guardado · Inv '+cur.inv+' Trk '+cur.trk+' Str '+cur.str);
  $('panelCard').style.display='none'; $('ubicCard').style.display='none'; $('manualSerial').value='';
  cur={serial:null,inv:cur.inv,trk:cur.trk,str:cur.str,pos:null,nocat:false}; $('btnSave').disabled=true;
  if(navigator.onLine&&localStorage.getItem(LS.url)) syncNow(true);
}

/* ============================================================
   ESCÁNER HÍBRIDO
   1) ZXing lee barras. 2) Tras N seg sin éxito -> OCR (Tesseract)
   sobre el recuadro. 3) Corrector contra base. Botón manual OCR.
   ============================================================ */
let codeReader=null, scanTrack=null, torchOn=false, lastTxt='', lastTime=0;
let ocrTimer=null, ocrRunning=false, ocrWorker=null, scanMode='barras', videoEl=null;
let engine='none', nativeDetector=null;

async function startScan(){
  if(typeof ZXing==='undefined'){ toast('Escáner no cargó, usa modo manual','err'); return; }
  if(mode==='lote'&&(!loteDest.inv||!loteDest.trk||!loteDest.str)){ toast('Fija el destino del lote primero','warn'); return; }
  $('scanArea').style.display='flex'; $('scanCount').style.display=mode==='lote'?'block':'none';
  $('scanLast').style.display='none'; scanMode='barras';
  setScanMode('barras');
  $('scanHint').textContent = mode==='lote'?'Modo lote: escanea uno tras otro':'Apunta al código de barras o a los números';
  try{
    // === abrir cámara (alta resolución, cámara trasera, enfoque continuo) ===
    const constraints={audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},advanced:[{focusMode:'continuous'}]}};
    const stream=await navigator.mediaDevices.getUserMedia(constraints);
    videoEl=$('video'); videoEl.srcObject=stream; await videoEl.play();
    scanTrack=stream.getVideoTracks()[0];
    const caps=scanTrack.getCapabilities?scanTrack.getCapabilities():{};
    $('torchBtn').style.display=caps.torch?'block':'none';

    // === elegir MOTOR de lectura de barras ===
    // 1º: BarcodeDetector NATIVO (Google/Android-Chrome) — el más potente
    // 2º: ZXing como respaldo si el nativo no existe
    engine='none';
    if('BarcodeDetector' in window){
      try{
        const fmts = await window.BarcodeDetector.getSupportedFormats();
        const want = ['code_39','code_128','code_93','itf','codabar','ean_13'].filter(f=>fmts.includes(f));
        if(want.length){ nativeDetector=new window.BarcodeDetector({formats:want}); engine='native'; }
      }catch(e){ nativeDetector=null; }
    }
    if(engine==='native'){
      $('scanHint').textContent='⚡ Lector Google (nativo) activo · apunta al código';
      $('scanMode').textContent='⚡ Lector nativo';
      startNativeLoop();
    } else if(typeof ZXing!=='undefined'){
      engine='zxing';
      const hints=new Map(); const F=ZXing.BarcodeFormat;
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[F.CODE_39,F.CODE_128,F.CODE_93,F.ITF,F.CODABAR]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
      codeReader=new ZXing.BrowserMultiFormatReader(hints,200);
      codeReader.decodeFromStream(stream,videoEl,(result)=>{ if(result){ const txt=result.getText(); const now=Date.now();
        if(txt===lastTxt&&now-lastTime<1200) return; lastTxt=txt; lastTime=now; cancelOcrTimer(); onHit(normalizeSerial(txt),'barras'); } });
    } else {
      $('scanHint').textContent='Sin lector de barras · usando OCR de números';
    }
    // temporizador: si no lee barras en N seg, pasa a OCR automático
    armOcrTimer();
  }catch(e){ $('scanArea').style.display='none'; toast('No se pudo abrir la cámara: '+(e.name||e.message),'err'); }
}

// === bucle de detección con BarcodeDetector nativo ===
let nativeRaf=null;
async function startNativeLoop(){
  if(!nativeDetector||!videoEl) return;
  const tick=async()=>{
    if(!videoEl || $('scanArea').style.display==='none'){ return; }
    if(videoEl.readyState>=2){
      try{
        const codes=await nativeDetector.detect(videoEl);
        if(codes && codes.length){
          const txt=codes[0].rawValue; const now=Date.now();
          if(!(txt===lastTxt && now-lastTime<1200)){
            lastTxt=txt; lastTime=now; cancelOcrTimer();
            onHit(normalizeSerial(txt),'barras'); return; // en individual stopScan corta el loop
          }
        }
      }catch(e){}
    }
    nativeRaf=requestAnimationFrame(tick);
  };
  nativeRaf=requestAnimationFrame(tick);
}
function setScanMode(m){ scanMode=m; const el=$('scanMode');
  if(m==='barras'){ el.textContent='Leyendo barras…'; el.className='scan-mode'; }
  else { el.textContent='🔢 Leyendo números (OCR)…'; el.className='scan-mode ocr'; } }
function armOcrTimer(){ cancelOcrTimer(); ocrTimer=setTimeout(()=>{ if($('scanArea').style.display!=='none') runOcr(true); }, getOcrDelay()); }
function cancelOcrTimer(){ if(ocrTimer){ clearTimeout(ocrTimer); ocrTimer=null; } }
function forceOcr(){ cancelOcrTimer(); runOcr(false); }

// captura frame del recuadro central y corre Tesseract
async function runOcr(fromTimer){
  if(ocrRunning||!videoEl||videoEl.readyState<2){ if(fromTimer) armOcrTimer(); return; }
  ocrRunning=true; setScanMode('ocr'); $('btnForceOcr').classList.add('act');
  try{
    const vw=videoEl.videoWidth, vh=videoEl.videoHeight;
    // recortar banda central horizontal (donde está el recuadro)
    const cropW=Math.round(vw*0.84), cropH=Math.round(vh*0.22);
    const cx=Math.round((vw-cropW)/2), cy=Math.round((vh-cropH)/2);
    const canvas=$('ocrCanvas'); canvas.width=cropW; canvas.height=cropH;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(videoEl,cx,cy,cropW,cropH,0,0,cropW,cropH);
    // preprocesado: escala de grises + umbral para resaltar el texto
    const img=ctx.getImageData(0,0,cropW,cropH); const d=img.data;
    for(let i=0;i<d.length;i+=4){ const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; const v=g>135?255:0; d[i]=d[i+1]=d[i+2]=v; }
    ctx.putImageData(img,0,0);

    if(!ocrWorker){
      ocrWorker=await Tesseract.createWorker('eng',1,{legacyCore:false});
      await ocrWorker.setParameters({ tessedit_char_whitelist:'ETND0123456789', tessedit_pageseg_mode:'7' });
    }
    const { data:{ text } } = await ocrWorker.recognize(canvas);
    const res = resolveOcr(text);
    if(res.exact){ cancelOcrTimer(); onHit(res.serial,'ocr'); }
    else if(res.sugerido){ // mostrar sugerencia para confirmar
      cancelOcrTimer(); showOcrSuggestion(res);
    } else {
      // no logró; si venía del timer, reintenta el ciclo (vuelve a barras+timer)
      $('scanLast').style.display='block'; $('scanLast').textContent='OCR: '+(cleanOcrText(text)||'sin lectura clara')+' — reintentando…';
      setScanMode('barras'); if(fromTimer) armOcrTimer();
    }
  }catch(e){ if(fromTimer) armOcrTimer(); }
  finally{ ocrRunning=false; $('btnForceOcr').classList.remove('act'); }
}
function showOcrSuggestion(res){
  beep(true); flashOk();
  $('scanLast').style.display='block';
  $('scanLast').innerHTML='OCR leyó algo similar. ¿Es <b>'+res.sugerido+'</b>? — tócalo para confirmar';
  $('scanLast').style.pointerEvents='auto'; $('scanLast').style.cursor='pointer';
  $('scanLast').onclick=()=>{ $('scanLast').onclick=null; $('scanLast').style.pointerEvents='none'; onHit(res.sugerido,'ocr'); };
  // auto-continuar barras por si el usuario reencuadra
  setScanMode('barras'); armOcrTimer();
}
function onHit(serial,origen){
  flashOk(); $('scanLast').style.display='block'; $('scanLast').style.pointerEvents='none'; $('scanLast').onclick=null;
  $('scanLast').textContent=(origen==='ocr'?'🔢 ':'▐║ ')+serial;
  // modo dañado: enrutar al formulario de dañados
  if(window._scanTargetDamaged){
    window._scanTargetDamaged=false; stopScan();
    $('dmgSerial').value=serial.replace(getPrefix(),'');
    if(typeof resolveDmg==='function') resolveDmg(serial);
    toast('Leído: '+serial); return;
  }
  if(mode==='lote'){ addToQueue(serial); setScanMode('barras'); armOcrTimer();
    if(engine==='native'){ nativeRaf=requestAnimationFrame(()=>startNativeLoop()); } }
  else { stopScan(); $('manualSerial').value=serial.replace(getPrefix(),''); handleSerial(serial,origen); toast((origen==='ocr'?'OCR: ':'Leído: ')+serial); }
}
// === MODO FOTO: captura un frame fijo y lo analiza (mucho más preciso que video) ===
async function photoShot(){
  if(!videoEl||videoEl.readyState<2){ toast('Cámara no lista','warn'); return; }
  flashOk();
  const vw=videoEl.videoWidth, vh=videoEl.videoHeight;
  const canvas=$('ocrCanvas'); canvas.width=vw; canvas.height=vh;
  const ctx=canvas.getContext('2d'); ctx.drawImage(videoEl,0,0,vw,vh);
  $('scanLast').style.display='block'; $('scanLast').textContent='📸 Analizando foto…';

  // 1) intentar leer BARRAS sobre la imagen fija con el detector nativo
  if('BarcodeDetector' in window){
    try{
      const fmts=await window.BarcodeDetector.getSupportedFormats();
      const want=['code_39','code_128','code_93','itf','codabar'].filter(f=>fmts.includes(f));
      if(want.length){
        const det=new window.BarcodeDetector({formats:want});
        const codes=await det.detect(canvas);
        if(codes&&codes.length){ cancelOcrTimer(); onHit(normalizeSerial(codes[0].rawValue),'barras'); return; }
      }
    }catch(e){}
  }
  // 2) intentar con ZXing sobre la imagen fija
  if(typeof ZXing!=='undefined'){
    try{
      const r=new ZXing.BrowserMultiFormatReader();
      const res=await r.decodeFromImageUrl(canvas.toDataURL('image/png'));
      if(res){ cancelOcrTimer(); onHit(normalizeSerial(res.getText()),'barras'); return; }
    }catch(e){}
  }
  // 3) si no hubo barras, OCR de los números sobre la foto
  runOcr(false);
}
function flashOk(){ const f=$('scanFlash'); f.classList.add('show'); setTimeout(()=>f.classList.remove('show'),140); }
async function toggleTorch(){ if(!scanTrack) return; try{ torchOn=!torchOn; await scanTrack.applyConstraints({advanced:[{torch:torchOn}]}); $('torchBtn').textContent=torchOn?'🔦 Apagar':'🔦 Linterna'; }catch(e){ toast('Linterna no disponible','warn'); } }
function stopScan(){
  cancelOcrTimer();
  if(nativeRaf){ cancelAnimationFrame(nativeRaf); nativeRaf=null; }
  nativeDetector=null; engine='none';
  if(codeReader){ try{codeReader.reset();}catch(e){} codeReader=null; }
  if(scanTrack){ try{scanTrack.stop();}catch(e){} scanTrack=null; }
  const v=$('video'); if(v&&v.srcObject){ v.srcObject.getTracks().forEach(t=>t.stop()); v.srcObject=null; }
  torchOn=false; lastTxt=''; videoEl=null; $('scanArea').style.display='none'; if(mode==='lote') renderQueue();
}

// ============ REGISTRO ============
async function renderLog(){
  const list=$('logList');
  // pendientes locales sin sincronizar (siempre relevantes)
  const pend=installs.filter(i=>!i.synced);
  // si hay sesión y señal, traer la verdad del servidor
  if(navigator.onLine && typeof SESSION!=='undefined' && SESSION && SESSION.token){
    list.innerHTML='<div class="empty">Cargando registros del servidor…</div>';
    try{
      const out=await apiCall('get_installs',{});
      if(out && out.ok){
        const rows=out.rows||[];
        // total real = servidor
        $('stInst').textContent=rows.length;
        $('stPct').textContent=Math.round(rows.length/CFG.META_CSO*100)+'%';
        $('stPend').textContent=pend.length;
        $('cntInst').textContent=rows.length; $('cntPend').textContent=pend.length;
        if(!rows.length && !pend.length){ list.innerHTML='<div class="empty">Aún no hay paneles instalados</div>'; return; }
        const recent=[...rows].reverse().slice(0,60);
        let html='';
        if(pend.length){ html+='<div class="mini" style="color:var(--warn);margin-bottom:8px">⏳ '+pend.length+' sin sincronizar (aún no están en el servidor)</div>'; }
        html+=recent.map(r=>`<div class="log-item"><div><div class="log-serial">${r.Serial}</div>
          <div class="log-loc">Inv ${r.Inversor} · Trk ${r.Tracker} · Str ${r.String} · Pos ${r.Posicion}${r.No_Catalogado==='SI'?' · ⚠️ no cat.':''}${r.EditadoPor?' · ✏️ editado':''}</div></div>
          <span class="badge-sync b-sync">servidor</span></div>`).join('');
        list.innerHTML=html;
        return;
      }
    }catch(e){}
  }
  // fallback offline: mostrar local
  if(!installs.length){ list.innerHTML='<div class="empty">Aún no hay paneles instalados</div>'; $('stInst').textContent=0; $('stPct').textContent='0%'; $('stPend').textContent=0; return; }
  const recent=[...installs].reverse().slice(0,60);
  list.innerHTML='<div class="mini" style="color:var(--muted);margin-bottom:8px">Mostrando datos locales del teléfono (sin conexión al servidor)</div>'+
    recent.map(i=>`<div class="log-item"><div><div class="log-serial">${i.serial}</div>
    <div class="log-loc">Inv ${i.inv} · Trk ${i.trk} · Str ${i.str} · Pos ${i.pos}${i.nocat?' · ⚠️ no cat.':''}</div></div>
    <span class="badge-sync ${i.synced?'b-sync':'b-pend'}">${i.synced?'sync':'pend'}</span></div>`).join('');
  $('stInst').textContent=installs.length; $('stPct').textContent=Math.round(installs.length/CFG.META_CSO*100)+'%'; $('stPend').textContent=installs.filter(i=>!i.synced).length; }

async function refreshCounts(){
  const pend=installs.filter(i=>!i.synced);
  $('cntPend').textContent=pend.length;
  // total real desde servidor si se puede
  if(navigator.onLine && typeof SESSION!=='undefined' && SESSION && SESSION.token){
    try{ const out=await apiCall('get_progress',{}); if(out && out.ok){ $('cntInst').textContent=out.total; return; } }catch(e){}
  }
  $('cntInst').textContent=installs.length;
}

// ============ SYNC / CONFIG ============
function saveSyncUrl(v){ localStorage.setItem(LS.url,v.trim()); }
function saveOperario(v){ localStorage.setItem(LS.oper,v.trim()); }
function savePrefix(v){ const p=v.toUpperCase().trim()||CFG.PREFIX_DEFAULT; localStorage.setItem(LS.pref,p); $('prefixTag').textContent=p; }
function saveOcrDelay(v){ localStorage.setItem(LS.ocrd,v); }
async function syncNow(silent){ const url=localStorage.getItem(LS.url); if(!url){ if(!silent) toast('Configura la URL primero','warn'); return; }
  if(typeof SESSION==='undefined' || !SESSION || !SESSION.token){ if(!silent) toast('Inicia sesión para sincronizar','warn'); return; }
  const pend=installs.filter(i=>!i.synced); if(!pend.length){ if(!silent) toast('Nada pendiente ✓'); return; }
  if(!silent) $('syncMsg').textContent='Enviando '+pend.length+' registros...';
  try{ const res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'sync_installs', token:SESSION.token, registros:pend})});
    const out=await res.json();
    if(out.need_login){ if(!silent){ $('syncMsg').textContent='Sesión expirada, vuelve a entrar'; } if(typeof doLogout==='function') doLogout(true); return; }
    if(out.ok){ const env=new Set(pend.map(p=>p.serial+'|'+p.inv+'|'+p.trk+'|'+p.pos));
      // marcar como sincronizados y luego limpiar de local (ya están seguros en el servidor)
      installs.forEach(i=>{ if(env.has(i.serial+'|'+i.inv+'|'+i.trk+'|'+i.pos)) i.synced=1; });
      clearSyncedLocal();
      renderLog();
      if(!silent){ $('syncMsg').textContent='✓ '+out.insertados+' nuevos sincronizados'; toast('✓ Sincronizado'); } } else throw new Error(out.error||'error servidor');
  }catch(e){ if(!silent){ $('syncMsg').textContent='✗ '+e.message+' (guardado local intacto)'; toast('Sin conexión, guardado local','warn'); } } }

// ============ EXPORTAR ============
function exportCSV(){ if(!installs.length){ toast('Nada para exportar','warn'); return; }
  const head=['Serial','Inversor','Tracker','String','Posicion','Pallet','Contenedor','Potencia_W','No_Catalogado','Operario','FechaHora'];
  const rows=installs.map(i=>[i.serial,i.inv,i.trk,i.str,i.pos,i.pallet,i.cont,i.w,i.nocat?'SI':'',i.oper,i.ts]);
  download('instalados_CSO_'+stamp()+'.csv',[head,...rows].map(r=>r.map(c=>`"${c??''}"`).join(',')).join('\n'),'text/csv'); }
function exportJSON(){ download('respaldo_CSO_'+stamp()+'.json',JSON.stringify(installs,null,2),'application/json'); }
async function download(name,content,type){
  const b=new Blob([content],{type});
  try{
    const file=new File([b],name,{type});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:name});
      return;
    }
  }catch(e){ if(e && e.name==='AbortError') return; }
  const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500);
}
function stamp(){ return new Date().toISOString().slice(0,16).replace(/[:T]/g,'-'); }

// ============ MANTENIMIENTO / RED ============
function marcarSincronizados(){ installs.forEach(i=>i.synced=1); save(); renderLog(); toast('Marcado ✓'); }
function borrarTodo(){ if(confirm('¿Borrar TODO el registro local? No se puede deshacer.')){ installs=[]; save(); renderLog(); toast('Registro borrado'); } }
function updateNet(){ const on=navigator.onLine; $('netDot').className='dot '+(on?'on':'off'); $('netTxt').textContent=on?'Online':'Offline'; }
window.addEventListener('online',()=>{updateNet(); if(localStorage.getItem(LS.url)) syncNow(true);});
window.addEventListener('offline',updateNet);

// ============ INIT ============
(function init(){
  updateNet(); refreshCounts();
  const pref=getPrefix(); $('prefixTag').textContent=pref; $('cfgPrefix').value=pref; { const pd=$('prefixTagD'); if(pd) pd.textContent=pref; }
  $('cfgOcrDelay').value=(parseInt(localStorage.getItem(LS.ocrd))||3);
  $('syncUrl').value=localStorage.getItem(LS.url)||''; $('operario').value=localStorage.getItem(LS.oper)||'';
  buildInv($('selInv'));
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
