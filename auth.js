/* ============================================================
   LECTOR PANELES CSO — módulo AUTH + ROLES + EXPORT
   Login contra backend, sesión firmada (offline tras login),
   gestión de usuarios (admin), avance en vivo, edición y
   exportación xlsx formal con trazabilidad hasta el pallet.
   ============================================================ */

const AUTH = {
  ses:'cso_session',   // {token, user, exp}
};
let SESSION = null;

function api(){ return (localStorage.getItem('cso_syncurl')||'').trim(); }

// ---- POST al backend ----
async function apiCall(action, payload){
  const url=api();
  if(!url) throw new Error('Configura la URL del backend primero');
  const body=Object.assign({action}, payload||{});
  if(SESSION && SESSION.token) body.token=SESSION.token;
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)});
  const out=await res.json();
  if(out && out.need_login){ doLogout(true); throw new Error('Sesión expirada, vuelve a entrar'); }
  return out;
}

// ---- Sesión local (permite escaneo offline tras login online) ----
function loadSession(){
  try{ const s=JSON.parse(localStorage.getItem(AUTH.ses)||'null');
    if(s && s.exp && new Date(s.exp)>new Date()){ SESSION=s; return true; } }catch(e){}
  SESSION=null; return false;
}
function saveSession(token,user){
  const exp=new Date(Date.now()+12*3600*1000).toISOString();
  SESSION={token,user,exp}; localStorage.setItem(AUTH.ses,JSON.stringify(SESSION));
}
function hasPerm(p){ return SESSION && SESSION.user && SESSION.user.permisos && SESSION.user.permisos.indexOf(p)>=0; }

// ============ LOGIN UI ============
function showLogin(msg){
  $('appRoot').style.display='none'; $('loginRoot').style.display='flex';
  $('loginMsg').textContent=msg||'';
}
async function doLogin(){
  const u=$('loginUser').value.trim(), p=$('loginPass').value;
  if(!u||!p){ $('loginMsg').textContent='Ingresa usuario y clave'; return; }
  if(!api()){ $('loginMsg').textContent='Falta configurar la URL del backend (engranaje abajo)'; return; }
  $('loginBtn').disabled=true; $('loginMsg').textContent='Verificando...';
  try{
    const out=await apiCall('login',{usuario:u, clave:p});
    if(out.ok){ saveSession(out.token,out.user); enterApp(); }
    else { $('loginMsg').textContent=loginErr(out.error); }
  }catch(e){ $('loginMsg').textContent='Sin conexión o URL incorrecta'; }
  $('loginBtn').disabled=false;
}
function loginErr(code){
  const m={usuario_o_clave_incorrectos:'Usuario o clave incorrectos', usuario_inactivo:'Usuario desactivado',
    faltan_credenciales:'Faltan datos'}; return m[code]||('Error: '+code);
}
function doLogout(silent){
  if(SESSION && SESSION.token && api()){ apiCall('logout',{}).catch(()=>{}); }
  SESSION=null; localStorage.removeItem(AUTH.ses);
  showLogin(silent?'':'Sesión cerrada');
}

// ============ ENTRAR A LA APP ============
function enterApp(){
  $('loginRoot').style.display='none'; $('appRoot').style.display='flex';
  const u=SESSION.user;
  $('waWho').textContent=u.nombre+' · '+u.rol.toUpperCase();
  // aplicar visibilidad según permisos
  document.querySelectorAll('[data-perm]').forEach(el=>{
    el.style.display = hasPerm(el.getAttribute('data-perm')) ? '' : 'none';
  });
  // tab escanear solo si puede 'scan'
  $('tabScanBtn').style.display = hasPerm('scan')?'':'none';
  $('tabUsersBtn').style.display = hasPerm('manage_users')?'':'none';
  // si no puede escanear, arrancar en avance
  if(!hasPerm('scan')){ showView('v-progress', $('tabProgressBtn')); }
  refreshCounts();
  if(navigator.onLine) loadProgress();
}

// ============ AVANCE / DASHBOARD ============
const LS_META={dia:'cso_meta_dia', fecha:'cso_meta_fecha'};
let chartDiario=null, chartAcum=null;

function saveMeta(){ localStorage.setItem(LS_META.dia,$('metaDia').value); localStorage.setItem(LS_META.fecha,$('metaFecha').value); if(window._dashData) computeForecast(window._dashData); }

async function loadProgress(){ return loadDashboard(); } // compat

async function loadDashboard(){
  $('metaDia').value=localStorage.getItem(LS_META.dia)||'';
  $('metaFecha').value=localStorage.getItem(LS_META.fecha)||'';
  if(!api()||!navigator.onLine){ $('progOffline').style.display='block'; return; }
  $('progOffline').style.display='none';
  try{
    const out=await apiCall('get_dashboard',{});
    if(!out.ok) return;
    window._dashData=out;
    // KPIs de arriba
    $('progTotal').textContent=out.total;
    $('progPct').textContent=Math.round(out.total/out.meta*100)+'%';
    $('progMeta').textContent=out.meta;
    // barras por inversor
    const wrap=$('progByInv'); wrap.innerHTML='';
    for(let inv=1;inv<=10;inv++){ const n=out.porInversor[inv]||0; const pct=Math.round(n/432*100);
      wrap.innerHTML+=`<div class="prog-row"><span class="prog-lbl">Inv ${inv}</span>
        <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
        <span class="prog-num">${n}/432</span></div>`; }
    // serie temporal
    const dias=Object.keys(out.porDia).filter(k=>k!=='sin_fecha').sort();
    const valores=dias.map(d=>out.porDia[d]);
    // KPIs ritmo
    const diasTrab=dias.length;
    const ritmo=diasTrab?Math.round(out.total/diasTrab):0;
    const mejor=valores.length?Math.max(...valores):0;
    $('kpiRitmo').textContent=ritmo; $('kpiDias').textContent=diasTrab; $('kpiMejor').textContent=mejor;
    // gráficos
    drawDiario(dias,valores);
    drawAcum(dias,valores,out.meta);
    // forecast
    computeForecast(out);
  }catch(e){ $('progOffline').style.display='block'; }
}

function fmtDia(iso){ const p=iso.split('-'); return p[2]+'/'+p[1]; } // dd/mm

function drawDiario(dias,valores){
  const ctx=$('chartDiario'); if(!ctx||typeof Chart==='undefined') return;
  if(chartDiario) chartDiario.destroy();
  chartDiario=new Chart(ctx,{type:'bar',
    data:{labels:dias.map(fmtDia),datasets:[{label:'Paneles/día',data:valores,backgroundColor:'#7bc043',borderRadius:4}]},
    options:{responsive:true,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:'#8fa89e',font:{size:9}},grid:{display:false}},
        y:{beginAtZero:true,ticks:{color:'#8fa89e'},grid:{color:'#2a3d35'}}}}});
}
function drawAcum(dias,valores,meta){
  const ctx=$('chartAcum'); if(!ctx||typeof Chart==='undefined') return;
  if(chartAcum) chartAcum.destroy();
  let acc=0; const acumulado=valores.map(v=>acc+=v);
  chartAcum=new Chart(ctx,{type:'line',
    data:{labels:dias.map(fmtDia),datasets:[
      {label:'Instalado acumulado',data:acumulado,borderColor:'#7bc043',backgroundColor:'rgba(123,192,67,.15)',fill:true,tension:.3,pointRadius:2},
      {label:'Meta ('+meta+')',data:dias.map(()=>meta),borderColor:'#e0a53a',borderDash:[6,4],pointRadius:0,fill:false}
    ]},
    options:{responsive:true,plugins:{legend:{labels:{color:'#8fa89e',font:{size:10}}}},
      scales:{x:{ticks:{color:'#8fa89e',font:{size:9}},grid:{display:false}},
        y:{beginAtZero:true,ticks:{color:'#8fa89e'},grid:{color:'#2a3d35'}}}}});
}

function computeForecast(out){
  const box=$('forecastBox');
  const dias=Object.keys(out.porDia).filter(k=>k!=='sin_fecha').sort();
  if(dias.length<1 || out.total===0){ box.innerHTML='Registra paneles para ver la proyección.'; return; }
  // ritmo de los últimos 5 días trabajados (más representativo del ritmo actual)
  const ult=dias.slice(-5); const sumaUlt=ult.reduce((s,d)=>s+out.porDia[d],0);
  const ritmoReciente=sumaUlt/ult.length;
  const restante=out.meta-out.total;
  let html='';
  if(ritmoReciente>0 && restante>0){
    const diasRest=Math.ceil(restante/ritmoReciente);
    const fin=new Date(); fin.setDate(fin.getDate()+diasRest);
    html+=`Al ritmo reciente de <b>${ritmoReciente.toFixed(1)} paneles/día</b>, faltan <b>${restante}</b> paneles (~<b>${diasRest} días</b>).<br>`;
    html+=`Proyección de término: <b>${fin.toLocaleDateString('es-CL')}</b>.`;
    // comparar con meta
    const metaDia=parseFloat(localStorage.getItem(LS_META.dia)||'0');
    const metaFecha=localStorage.getItem(LS_META.fecha);
    if(metaDia>0){
      if(ritmoReciente>=metaDia) html+=`<br><span class="fc-ok">✓ Vas al día o adelantado</span> (meta ${metaDia}/día).`;
      else html+=`<br><span class="fc-bad">▼ Bajo la meta</span> de ${metaDia}/día. Diferencia: ${(metaDia-ritmoReciente).toFixed(1)}/día.`;
    }
    if(metaFecha){
      const fm=new Date(metaFecha+'T00:00:00');
      const diff=Math.round((fin-fm)/(86400000));
      if(diff<=0) html+=`<br><span class="fc-ok">✓ Terminarías ${Math.abs(diff)} días antes</span> de tu fecha objetivo (${fm.toLocaleDateString('es-CL')}).`;
      else html+=`<br><span class="fc-bad">▲ Terminarías ${diff} días después</span> de tu fecha objetivo (${fm.toLocaleDateString('es-CL')}).`;
      // ritmo necesario para cumplir la fecha
      const hoy=new Date(); const diasHastaMeta=Math.max(1,Math.round((fm-hoy)/86400000));
      const ritmoNec=Math.ceil(restante/diasHastaMeta);
      html+=`<br>Para cumplir esa fecha necesitas <b>${ritmoNec} paneles/día</b>.`;
    }
  } else if(restante<=0){ html='<span class="fc-ok">🎉 ¡Meta alcanzada! '+out.total+' paneles instalados.</span>'; }
  box.innerHTML=html;
}

// ============ GESTIÓN DE USUARIOS (admin) ============
// Traducciones fijas en la app (no dependen del backend)
const PERMS_LABELS_FIJO={scan:'Escanear e instalar', view:'Ver avance', edit:'Editar registros', delete:'Borrar registros', export:'Exportar / descargar', manage_users:'Gestionar usuarios'};
const ROLES_LABELS_FIJO={admin:'Administrador', tecnico:'Técnico', ito:'ITO', usuario:'Usuario'};
let USERS_CACHE=[], ROLES_CACHE=[], PERMS_CACHE=[], PERMS_LABELS={}, ROLES_LABELS={}, ROLES_DEFAULTS={};
async function loadUsers(){
  if(!navigator.onLine){ toast('Necesitas señal para gestionar usuarios','warn'); return; }
  try{
    const out=await apiCall('list_users',{});
    if(!out.ok){ toast('Sin permiso o error','err'); return; }
    USERS_CACHE=out.users; ROLES_CACHE=out.roles||['admin','tecnico','ito','usuario'];
    PERMS_CACHE=out.permisos_disponibles||['scan','view','edit','delete','export','manage_users'];
    // usar traducciones fijas de la app; si el backend manda las suyas, se combinan
    PERMS_LABELS=Object.assign({}, PERMS_LABELS_FIJO, out.permisos_labels||{});
    ROLES_LABELS=Object.assign({}, ROLES_LABELS_FIJO, out.roles_labels||{});
    ROLES_DEFAULTS=out.roles_defaults||{admin:['scan','view','edit','delete','export','manage_users'],tecnico:['scan','view','export'],ito:['view','export'],usuario:['view']};
    renderUsers();
  }catch(e){ toast('Error cargando usuarios','err'); }
}
function renderUsers(){
  const list=$('usersList');
  if(!USERS_CACHE.length){ list.innerHTML='<div class="empty">Sin usuarios</div>'; return; }
  list.innerHTML=USERS_CACHE.map(u=>{
    const perms=String(u.permisosExtra||'').split(',').map(x=>x.trim()).filter(Boolean);
    const permsTxt = perms.length ? perms.map(p=>PERMS_LABELS[p]||p).join(', ') : 'permisos del rol';
    return `<div class="user-item">
      <div><div class="user-name">${u.nombre} <span class="user-tag">${ROLES_LABELS[u.rol]||u.rol}</span>${u.activo?'':' <span style="color:var(--err)">(inactivo)</span>'}</div>
        <div class="user-sub">@${u.usuario} · ${permsTxt}</div></div>
      <button class="btn-ghost btn-sm" style="width:auto;padding:6px 10px" onclick="editUserForm('${u.usuario}')">✏️</button>
    </div>`;
  }).join('');
}
function newUserForm(){ openUserForm({usuario:'',nombre:'',rol:'tecnico',permisosExtra:'',activo:true,_new:true}); }
function editUserForm(usuario){ const u=USERS_CACHE.find(x=>x.usuario===usuario); if(u) openUserForm(Object.assign({_new:false},u)); }
function openUserForm(u){
  $('ufTitle').textContent=u._new?'Nuevo usuario':'Editar: '+u.usuario;
  $('ufUser').value=u.usuario; $('ufUser').disabled=!u._new;
  $('ufNombre').value=u.nombre||'';
  $('ufRol').innerHTML=ROLES_CACHE.map(r=>`<option value="${r}" ${r===u.rol?'selected':''}>${ROLES_LABELS[r]||r}</option>`).join('');
  $('ufPass').value=''; $('ufPass').placeholder=u._new?'Clave (obligatoria)':'Dejar vacío = no cambiar';
  $('ufActivo').checked=u.activo!==false;
  // permisos actuales del usuario: si tiene guardados, esos; si no, los del rol
  let permsActuales=String(u.permisosExtra||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!permsActuales.length && !u._new) permsActuales=(ROLES_DEFAULTS[u.rol]||[]).slice();
  if(u._new) permsActuales=(ROLES_DEFAULTS[u.rol]||[]).slice();
  renderPermChecks(permsActuales);
  $('ufDelete').style.display=(u._new||u.usuario==='admin')?'none':'block';
  $('ufDelete').onclick=()=>deleteUser(u.usuario);
  $('userForm').style.display='flex';
}
function renderPermChecks(marcados){
  window._permSel = new Set(marcados);
  $('ufPerms').innerHTML=PERMS_CACHE.map(p=>{
    const on=window._permSel.has(p);
    return `<div class="perm-chk ${on?'on':''}" data-perm="${p}" onclick="togglePerm(this)">
      <span class="perm-box">${on?'✓':''}</span>
      <span>${PERMS_LABELS[p]||p}</span></div>`;
  }).join('');
}
function togglePerm(el){
  const p=el.getAttribute('data-perm');
  if(!window._permSel) window._permSel=new Set();
  if(window._permSel.has(p)){ window._permSel.delete(p); el.classList.remove('on'); el.querySelector('.perm-box').textContent=''; }
  else { window._permSel.add(p); el.classList.add('on'); el.querySelector('.perm-box').textContent='✓'; }
}
// al cambiar el rol, precargar sus permisos típicos (editables después)
function aplicarRolDefault(){
  const rol=$('ufRol').value; const def=(ROLES_DEFAULTS[rol]||[]).slice();
  renderPermChecks(def);
}
function closeUserForm(){ $('userForm').style.display='none'; }
async function saveUserForm(){
  const usuario=$('ufUser').value.trim().toLowerCase();
  const extra=[...(window._permSel||new Set())].join(',');
  const payload={usuario, nombre:$('ufNombre').value.trim(), rol:$('ufRol').value,
    permisosExtra:extra, activo:$('ufActivo').checked};
  const pass=$('ufPass').value; if(pass) payload.clave=pass;
  if(payload._new || !usuario){}
  try{
    const out=await apiCall('save_user',payload);
    if(out.ok){ toast('✓ Usuario guardado'); closeUserForm(); loadUsers(); }
    else toast(userErr(out.error),'err');
  }catch(e){ toast('Error guardando','err'); }
}
async function deleteUser(usuario){
  if(!confirm('¿Eliminar al usuario '+usuario+'?')) return;
  try{ const out=await apiCall('delete_user',{usuario}); if(out.ok){ toast('Usuario eliminado'); closeUserForm(); loadUsers(); } else toast(userErr(out.error),'err'); }catch(e){ toast('Error','err'); }
}
function userErr(c){ const m={clave_requerida_nuevo:'La clave es obligatoria para usuarios nuevos', no_borrar_admin:'No se puede borrar al admin', no_borrarte_a_ti:'No puedes borrarte a ti mismo', rol_invalido:'Rol inválido', sin_permiso:'Sin permiso'}; return m[c]||('Error: '+c); }

// cambiar mi propia clave
async function changeMyPass(){
  const a=$('cpActual').value, n=$('cpNueva').value;
  if(!n||n.length<6){ toast('La nueva clave debe tener 6+ caracteres','warn'); return; }
  try{ const out=await apiCall('change_pass',{claveActual:a, claveNueva:n});
    if(out.ok){ toast('✓ Clave cambiada'); $('cpActual').value=''; $('cpNueva').value=''; } else toast(userErr(out.error)||'Error','err'); }catch(e){ toast('Error','err'); }
}

// ============ EDICIÓN DE REGISTROS ============
async function loadEditList(){
  if(!navigator.onLine){ toast('Necesitas señal para editar','warn'); return; }
  try{ const out=await apiCall('get_installs',{});
    if(!out.ok){ toast('Sin permiso','err'); return; }
    EDIT_CACHE=out.rows; renderEditList(''); }catch(e){ toast('Error','err'); }
}
let EDIT_CACHE=[];
function renderEditList(filter){
  const list=$('editList'); const f=(filter||'').toUpperCase();
  const rows=EDIT_CACHE.filter(r=>!f||String(r.Serial).toUpperCase().includes(f)).slice(0,80);
  if(!rows.length){ list.innerHTML='<div class="empty">Sin registros</div>'; return; }
  list.innerHTML=rows.map(r=>`
    <div class="edit-item">
      <div><div class="log-serial">${r.Serial}</div>
        <div class="log-loc">Inv ${r.Inversor} · Trk ${r.Tracker} · Str ${r.String} · Pos ${r.Posicion}</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn-ghost btn-sm" style="width:auto;padding:6px 10px" onclick="openEditRec('${r.Serial}')">✏️</button>
        ${hasPerm('delete')?`<button class="btn-ghost btn-sm" style="width:auto;padding:6px 10px;color:var(--err);border-color:var(--err)" onclick="delRec('${r.Serial}')">🗑️</button>`:''}
      </div>
    </div>`).join('');
}
function openEditRec(serial){
  const r=EDIT_CACHE.find(x=>x.Serial===serial); if(!r) return;
  $('erSerial').textContent=serial; $('erSerialHidden').value=serial;
  $('erInv').innerHTML=Array.from({length:10},(_,k)=>`<option value="${k+1}" ${r.Inversor==k+1?'selected':''}>Inv ${k+1}</option>`).join('');
  erBuildTrk(r.Tracker); erBuildStr(r.String); erBuildPos(r.Posicion);
  $('editRecForm').style.display='flex';
}
function erBuildTrk(sel){ const inv=+$('erInv').value; const base=(inv-1)*6;
  $('erTrk').innerHTML=Array.from({length:6},(_,k)=>`<option value="${base+k+1}" ${sel==base+k+1?'selected':''}>Trk ${base+k+1}</option>`).join(''); }
function erBuildStr(sel){ $('erStr').innerHTML=[1,2,3].map(s=>`<option value="${s}" ${sel==s?'selected':''}>String ${s}</option>`).join(''); }
function erBuildPos(sel){ const s=+$('erStr').value; const a=(s-1)*24+1,b=a+23;
  let o=''; for(let p=a;p<=b;p++) o+=`<option value="${p}" ${sel==p?'selected':''}>Pos ${p}</option>`; $('erPos').innerHTML=o; }
function closeEditRec(){ $('editRecForm').style.display='none'; }
async function saveEditRec(){
  const payload={serial:$('erSerialHidden').value, inv:+$('erInv').value, trk:+$('erTrk').value, str:+$('erStr').value, pos:+$('erPos').value};
  try{ const out=await apiCall('edit_install',payload);
    if(out.ok){ toast('✓ Registro corregido'); closeEditRec(); loadEditList(); }
    else toast(out.error==='posicion_ocupada'?'Esa posición ya está ocupada':'Error: '+out.error,'err'); }catch(e){ toast('Error','err'); }
}
async function delRec(serial){ if(!confirm('¿Eliminar el registro de '+serial+'?')) return;
  try{ const out=await apiCall('delete_install',{serial}); if(out.ok){ toast('Eliminado'); loadEditList(); } else toast('Error','err'); }catch(e){ toast('Error','err'); } }

// ============ EXPORT XLSX FORMAL (con trazabilidad + fecha descarga) ============
async function exportXLSX(){
  if(typeof XLSX==='undefined'){ toast('Librería Excel no cargó','err'); return; }
  let rows=[];
  // preferir datos del servidor (completos); si no hay señal, usar locales
  if(navigator.onLine && api()){
    try{ const out=await apiCall('get_installs',{}); if(out.ok) rows=out.rows.map(mapServerRow); }catch(e){}
  }
  if(!rows.length){ rows=(JSON.parse(localStorage.getItem('cso_instalados')||'[]')).map(mapLocalRow); }
  if(!rows.length){ toast('No hay datos para exportar','warn'); return; }

  const now=new Date();
  const fstamp=now.toLocaleString('es-CL');
  const quien=(SESSION&&SESSION.user)?(SESSION.user.nombre+' (@'+SESSION.user.usuario+')'):'—';

  const wb=XLSX.utils.book_new();

  // ---- Hoja Portada / control de versión ----
  const portada=[
    ['COMERCIAL CHINALED LTDA.'],
    ['REGISTRO DE INSTALACIÓN DE PANELES FOTOVOLTAICOS'],
    ['Proyecto: PFV Cerro Sombrero (CSO) — Contrato 42PS25'],
    [''],
    ['Fecha y hora de descarga:', fstamp],
    ['Descargado por:', quien],
    ['Total paneles instalados:', rows.length],
    ['Meta CSO:', 4320],
    ['Avance:', Math.round(rows.length/4320*100)+'%'],
    [''],
    ['NOTA: Documento generado automáticamente. La fecha de descarga identifica la versión.'],
  ];
  const wsP=XLSX.utils.aoa_to_sheet(portada);
  wsP['!cols']=[{wch:28},{wch:45}];
  XLSX.utils.book_append_sheet(wb,wsP,'Portada');

  // ---- Hoja Instalados (trazabilidad completa) ----
  const head=['N°','Serial','Inversor','Tracker','String','Posición','Pallet','Contenedor','Potencia (W)','No Catalogado','Operario','Registrado por','Fecha/Hora Registro','Editado por','Fecha Edición'];
  const aoa=[head];
  rows.forEach((r,i)=>aoa.push([i+1,r.serial,r.inv,r.trk,r.str,r.pos,r.pallet,r.cont,r.w,r.nocat?'SI':'',r.oper,r.regBy||'',r.ts||'',r.editBy||'',r.editTs||'']));
  const wsI=XLSX.utils.aoa_to_sheet(aoa);
  wsI['!cols']=[{wch:5},{wch:20},{wch:9},{wch:9},{wch:7},{wch:9},{wch:20},{wch:12},{wch:11},{wch:12},{wch:16},{wch:16},{wch:22},{wch:14},{wch:20}];
  wsI['!freeze']={xSplit:0,ySplit:1};
  XLSX.utils.book_append_sheet(wb,wsI,'Instalados CSO');

  // ---- Hoja Resumen por inversor/tracker ----
  const resumen=[['RESUMEN DE AVANCE'],[''],['Inversor','Tracker','Paneles instalados']];
  const agg={};
  rows.forEach(r=>{ const k=r.inv+'|'+r.trk; agg[k]=(agg[k]||0)+1; });
  Object.keys(agg).sort((a,b)=>{const [ai,at]=a.split('|').map(Number),[bi,bt]=b.split('|').map(Number);return ai-bi||at-bt;})
    .forEach(k=>{ const [inv,trk]=k.split('|'); resumen.push([+inv,+trk,agg[k]]); });
  const wsR=XLSX.utils.aoa_to_sheet(resumen); wsR['!cols']=[{wch:12},{wch:12},{wch:20}];
  XLSX.utils.book_append_sheet(wb,wsR,'Resumen');

  const fname='Instalacion_CSO_'+now.toISOString().slice(0,16).replace(/[:T]/g,'-')+'.xlsx';
  // generar el archivo como blob (funciona igual en PC y celular)
  const wbout=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const blob=new Blob([wbout],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});

  // ¿el dispositivo puede compartir archivos? (celulares) -> menú nativo
  const file=new File([blob],fname,{type:blob.type});
  const puedeCompartir = navigator.canShare && navigator.canShare({files:[file]});
  if(puedeCompartir){
    try{
      await navigator.share({files:[file], title:fname, text:'Registro instalación CSO'});
      toast('✓ Excel listo para compartir/guardar');
      return;
    }catch(e){
      if(e && e.name==='AbortError'){ return; } // el usuario canceló, no es error
      // si falla el compartir, cae a descarga directa
    }
  }
  // computador (o celular sin compartir): descarga directa
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=fname; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500);
  toast('✓ Excel descargado');
}
function mapServerRow(r){ return {serial:r.Serial,inv:r.Inversor,trk:r.Tracker,str:r.String,pos:r.Posicion,pallet:r.Pallet,cont:r.Contenedor,w:r.Potencia_W,nocat:r.No_Catalogado==='SI',oper:r.Operario,regBy:r.RegistradoPor,ts:r.FechaHora_ISO,editBy:r.EditadoPor,editTs:r.FechaEdicion}; }
function mapLocalRow(r){ return {serial:r.serial,inv:r.inv,trk:r.trk,str:r.str,pos:r.pos,pallet:r.pallet,cont:r.cont,w:r.w,nocat:r.nocat,oper:r.oper,regBy:r.oper,ts:r.ts,editBy:'',editTs:''}; }
