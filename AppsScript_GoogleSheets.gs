/************************************************************************
 *  LECTOR PANELES CSO — Backend v2 (Google Apps Script)
 *  Sistema multiusuario con roles, permisos y auditoría.
 *  ---------------------------------------------------------------------
 *  SEGURIDAD:
 *   - Contraseñas con hash SHA-256 + salt único por usuario (nunca texto plano).
 *   - TODOS los permisos se validan aquí, en el servidor. Aunque alguien
 *     manipule la app en su teléfono, el servidor rechaza lo no autorizado.
 *   - Sesiones por token con expiración.
 *
 *  INSTALACIÓN (una sola vez):
 *   1. Abre tu Google Sheet.
 *   2. Extensiones -> Apps Script. Borra todo y pega este archivo.
 *   3. Ejecuta la función  setup()  una vez (menú Ejecutar). Autoriza permisos.
 *      -> Crea las hojas y el usuario admin inicial.
 *   4. Implementar -> Nueva implementación -> Aplicación web:
 *        Ejecutar como: Yo    |    Acceso: Cualquier persona
 *   5. Copia la URL /exec y pégala en la app (pantalla de login/config).
 *
 *  USUARIO ADMIN INICIAL:  usuario "admin"  /  clave "cambiar123"
 *  >>> CAMBIA ESA CLAVE apenas entres. <<<
 ************************************************************************/

var SH_USERS = 'Usuarios';
var SH_INST  = 'Instalados_CSO';
var SH_AUDIT = 'Auditoria';
var SH_SESS  = 'Sesiones';
var SH_DMG   = 'Paneles_Danados';
var SH_INV   = 'Inversores';
var SH_PROY  = 'Proyectos';
var FOLDER_DMG_ID = '162736m4knTmHZkxRVqlmP8V8UTizCPaa'; // carpeta de Drive para fotos de dañados

// Permisos por rol (server-side, no manipulable desde la app)
var ROLE_PERMS = {
  admin:   ['scan','view','edit','delete','export','manage_users'],
  tecnico: ['scan','view','export'],
  ito:     ['view','export'],
  usuario: ['view']
};
var SESSION_HOURS = 12;

// ============ SETUP ============
function setup(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SH_USERS, ['Usuario','Nombre','Rol','Salt','Hash','PermisosExtra','Activo','FechaCreacion','CreadoPor']);
  ensureSheet_(ss, SH_INST,  ['Serial','Inversor','Tracker','String','Posicion','Pallet','Contenedor','Potencia_W','No_Catalogado','Operario','FechaHora_ISO','RegistradoPor','FechaServidor','EditadoPor','FechaEdicion','Proyecto']);
  ensureSheet_(ss, SH_DMG,   ['Serial','Motivo','Nota','Pallet','Contenedor','Potencia_W','Fotos','ReportadoPor','FechaServidor','Proyecto']);
  ensureSheet_(ss, SH_INV,   ['Numero','CodigoBarras','Ubicacion','Nota','Foto','RegistradoPor','FechaServidor','Proyecto']);
  ensureSheet_(ss, SH_PROY,  ['Nombre','Config','Activo','CreadoPor','FechaServidor']);
  ensureSheet_(ss, SH_AUDIT, ['FechaHora','Usuario','Accion','Detalle','IP']);
  ensureSheet_(ss, SH_SESS,  ['Token','Usuario','Rol','Expira']);
  var users = getSheet_(SH_USERS);
  if(users.getLastRow() < 2){
    var salt = randomSalt_();
    users.appendRow(['admin','Administrador','admin',salt,sha256_('cambiar123'+salt),'',true,new Date(),'sistema']);
  }
  // migración: asegurar columna Proyecto al final de cada hoja
  asegurarColumna_(SH_INST, 'Proyecto');
  asegurarColumna_(SH_DMG, 'Proyecto');
  asegurarColumna_(SH_INV, 'Proyecto');
  // precargar proyecto Cerro Sombrero (CSO) si no existe
  var shP=getSheet_(SH_PROY);
  var existeCSO=false;
  if(shP.getLastRow()>1){ shP.getRange(2,1,shP.getLastRow()-1,1).getValues().forEach(function(r){ if(String(r[0])==='Cerro Sombrero (CSO)') existeCSO=true; }); }
  if(!existeCSO){
    var cfgCSO={
      inversores:10,
      trackers:[{tipo:'A', paneles:72, strings:3, porString:24, cantidad:60}],
      inventario:{ totalPaneles:5940, totalInversores:10 }
    };
    shP.appendRow(['Cerro Sombrero (CSO)', JSON.stringify(cfgCSO), true, 'sistema', new Date()]);
  }
  return 'Setup OK. admin / cambiar123 (cámbiala al entrar).';
}
// agrega una columna al final si no existe (no toca datos)
function asegurarColumna_(nombreHoja, nombreCol){
  var sh=getSheet_(nombreHoja); if(!sh) return;
  var lastCol=sh.getLastColumn();
  var head=sh.getRange(1,1,1,lastCol).getValues()[0];
  if(head.indexOf(nombreCol)===-1){
    sh.getRange(1,lastCol+1).setValue(nombreCol).setFontWeight('bold');
  }
}

// ============ ROUTER ============
function doPost(e){
  try{
    var req = JSON.parse(e.postData.contents);
    var action = req.action;
    if(action === 'login') return json_(login_(req));
    if(action === 'ping')  return json_({ok:true, mensaje:'backend v2 activo'});

    var sess = validateSession_(req.token);
    if(!sess.ok) return json_({ok:false, error:'sesion_invalida', need_login:true});
    var me = sess.user;

    switch(action){
      case 'sync_installs':  return json_(syncInstalls_(req, me));
      case 'get_progress':   return json_(getProgress_(req, me));
      case 'get_dashboard':  return json_(getDashboard_(req, me));
      case 'export_xlsx':    return exportXlsxServer_(req, me);
      case 'get_installs':   return json_(getInstalls_(req, me));
      case 'edit_install':   return json_(editInstall_(req, me));
      case 'delete_install': return json_(deleteInstall_(req, me));
      case 'report_damaged': return json_(reportDamaged_(req, me));
      case 'get_damaged':    return json_(getDamaged_(req, me));
      case 'get_damaged_serials': return json_(getDamagedSerials_(req, me));
      case 'delete_damaged': return json_(deleteDamaged_(req, me));
      case 'add_damage_photo': return json_(addDamagePhoto_(req, me));
      case 'delete_damage_photo': return json_(deleteDamagePhoto_(req, me));
      case 'save_inverter':  return json_(saveInverter_(req, me));
      case 'get_inverters':  return json_(getInverters_(req, me));
      case 'delete_inverter': return json_(deleteInverter_(req, me));
      case 'save_project':   return json_(saveProject_(req, me));
      case 'get_projects':   return json_(getProjects_(req, me));
      case 'delete_project': return json_(deleteProject_(req, me));
      case 'list_users':     return json_(listUsers_(req, me));
      case 'save_user':      return json_(saveUser_(req, me));
      case 'delete_user':    return json_(deleteUser_(req, me));
      case 'change_pass':    return json_(changePass_(req, me));
      case 'logout':         return json_(logout_(req));
      default: return json_({ok:false, error:'accion_desconocida'});
    }
  }catch(err){ return json_({ok:false, error:String(err)}); }
}
function doGet(){ return json_({ok:true, mensaje:'Backend CSO v2 activo. Usa POST.'}); }

// ============ AUTH ============
function login_(req){
  var u=(req.usuario||'').toLowerCase().trim(), p=req.clave||'';
  if(!u||!p) return {ok:false, error:'faltan_credenciales'};
  var row=findUserRow_(u);
  if(!row) return {ok:false, error:'usuario_o_clave_incorrectos'};
  if(!row.data.Activo) return {ok:false, error:'usuario_inactivo'};
  if(sha256_(p+row.data.Salt)!==row.data.Hash) return {ok:false, error:'usuario_o_clave_incorrectos'};
  var token=newSession_(row.data.Usuario,row.data.Rol);
  audit_(row.data.Usuario,'login','inicio de sesión');
  return {ok:true, token:token, user:{usuario:row.data.Usuario, nombre:row.data.Nombre, rol:row.data.Rol, permisos:effectivePerms_(row.data)}};
}
function logout_(req){ var s=getSheet_(SH_SESS); var v=s.getDataRange().getValues();
  for(var i=1;i<v.length;i++){ if(v[i][0]===req.token){ s.deleteRow(i+1); break; } } return {ok:true}; }
function newSession_(usuario,rol){
  var token=Utilities.getUuid()+Utilities.getUuid().replace(/-/g,'');
  getSheet_(SH_SESS).appendRow([token,usuario,rol,new Date(Date.now()+SESSION_HOURS*3600*1000)]);
  return token;
}
function validateSession_(token){
  if(!token) return {ok:false};
  var s=getSheet_(SH_SESS); var v=s.getDataRange().getValues();
  for(var i=1;i<v.length;i++){
    if(v[i][0]===token){
      if(new Date(v[i][3])<new Date()){ s.deleteRow(i+1); return {ok:false}; }
      var row=findUserRow_(String(v[i][1]).toLowerCase());
      if(!row||!row.data.Activo) return {ok:false};
      return {ok:true, user:row.data};
    }
  }
  return {ok:false};
}
function effectivePerms_(d){
  // Si el usuario tiene permisos explícitos guardados, esos mandan.
  var explicit=String(d.PermisosExtra||'').split(',').map(function(x){return x.trim();}).filter(Boolean);
  if(explicit.length) return explicit;
  // Si no (usuarios antiguos), caer al set base del rol.
  return (ROLE_PERMS[d.Rol]||[]).slice();
}
function can_(d,perm){ return effectivePerms_(d).indexOf(perm)>=0; }

// ============ INSTALADOS ============
function syncInstalls_(req, me){
  if(!can_(me,'scan')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_INST); var ex=installKeys_(sh); var nuevos=[]; var rechazados=[];
  var colProy=colIndex_(sh,'Proyecto');
  // set de seriales dañados para bloqueo cruzado
  var danados={}; var shD=getSheet_(SH_DMG);
  if(shD){ var vd=shD.getDataRange().getValues(); for(var k=1;k<vd.length;k++) danados[vd[k][0]]=true; }
  var proy=req.proyecto||'';
  (req.registros||[]).forEach(function(r){
    if(danados[r.serial]){ rechazados.push(r.serial); return; } // no instalar dañados
    var k=[r.serial,r.inv,r.trk,r.pos].join('|');
    if(ex.indexOf(k)===-1){
      var fila=[r.serial,r.inv,r.trk,r.str,r.pos,r.pallet||'',r.cont||'',r.w||'',r.nocat?'SI':'',r.oper||'',r.ts||'',me.Usuario,new Date(),'',''];
      while(fila.length < colProy-1) fila.push('');
      fila[colProy-1]=r.proyecto||proy;
      nuevos.push(fila); ex.push(k);
    }
  });
  if(nuevos.length){ sh.getRange(sh.getLastRow()+1,1,nuevos.length,nuevos[0].length).setValues(nuevos); audit_(me.Usuario,'sync',nuevos.length+' paneles ('+proy+')'); }
  return {ok:true, insertados:nuevos.length, recibidos:(req.registros||[]).length, rechazados_danados:rechazados};
}
function colIndex_(sh, nombre){
  var lastCol=sh.getLastColumn();
  var head=sh.getRange(1,1,1,lastCol).getValues()[0];
  var idx=head.indexOf(nombre);
  return idx>=0 ? idx+1 : lastCol+1;
}
function getProgress_(req, me){
  if(!can_(me,'view')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_INST); var last=sh.getLastRow(); var porInv={}, porTrk={};
  if(last>1){ getSheet_(SH_INST).getRange(2,2,last-1,3).getValues().forEach(function(r){ porInv[r[0]]=(porInv[r[0]]||0)+1; porTrk[r[0]+'-'+r[1]]=(porTrk[r[0]+'-'+r[1]]||0)+1; }); }
  return {ok:true, total:Math.max(0,last-1), meta:4320, porInversor:porInv, porTracker:porTrk};
}
// Dashboard: avance agrupado por día (para gráficos diario, acumulado, forecast, ritmo)
function getDashboard_(req, me){
  if(!can_(me,'view')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_INST); var last=sh.getLastRow();
  var proy=req.proyecto||''; var colProy=colIndex_(sh,'Proyecto');
  var porDia={}; var porInv={}; var total=0;
  if(last>1){
    var datos=sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
    for(var i=0;i<datos.length;i++){
      var rowProy=datos[i][colProy-1]||'';
      if(proy && String(rowProy)!==String(proy)) continue;
      total++;
      var d=datos[i][12]; var key;
      if(d instanceof Date && !isNaN(d)){ key=Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
      else { key='sin_fecha'; }
      porDia[key]=(porDia[key]||0)+1;
      porInv[datos[i][1]]=(porInv[datos[i][1]]||0)+1;
    }
  }
  var shD=getSheet_(SH_DMG); var danados=0; var porMotivo={};
  if(shD && shD.getLastRow()>1){
    var colProyD=colIndex_(shD,'Proyecto');
    var vm=shD.getRange(2,1,shD.getLastRow()-1,shD.getLastColumn()).getValues();
    vm.forEach(function(r){
      var rp=r[colProyD-1]||'';
      if(proy && String(rp)!==String(proy)) return;
      danados++;
      var m=r[1]||'Sin motivo'; porMotivo[m]=(porMotivo[m]||0)+1;
    });
  }
  return {ok:true, total:total, meta:(req.meta||4320), porDia:porDia, porInversor:porInv, danados:danados, danadosPorMotivo:porMotivo};
}
// ===== PANELES DAÑADOS =====
function reportDamaged_(req, me){
  if(!can_(me,'scan')) return {ok:false, error:'sin_permiso'};
  var serial=req.serial;
  if(!serial) return {ok:false, error:'serial_requerido'};
  var shI=getSheet_(SH_INST); var vi=shI.getDataRange().getValues();
  for(var i=1;i<vi.length;i++){ if(vi[i][0]===serial) return {ok:false, error:'ya_instalado'}; }
  var shD=getSheet_(SH_DMG); var vd=shD.getDataRange().getValues();
  for(var j=1;j<vd.length;j++){ if(vd[j][0]===serial) return {ok:false, error:'ya_danado'}; }
  var fotos=[];
  var arr=req.fotos||(req.fotoB64?[{b64:req.fotoB64,tipo:req.fotoTipo}]:[]);
  for(var f=0; f<arr.length && f<3; f++){
    var url=guardarFoto_(arr[f].b64, arr[f].tipo, serial+'_'+(f+1));
    if(url) fotos.push(url);
  }
  var filaD=[serial, req.motivo||'', req.nota||'', req.pallet||'', req.cont||'', req.w||'', fotos.join('|'), me.Usuario, new Date()];
  var colPd=colIndex_(shD,'Proyecto');
  while(filaD.length < colPd-1) filaD.push('');
  filaD[colPd-1]=req.proyecto||'';
  shD.appendRow(filaD);
  audit_(me.Usuario,'damaged',serial+' ('+(req.motivo||'')+')');
  return {ok:true, fotos:fotos};
}
function getDamaged_(req, me){
  if(!can_(me,'view')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_DMG); var last=sh.getLastRow(); if(last<2) return {ok:true, rows:[], total:0};
  var v=sh.getRange(1,1,last,9).getValues(); var head=v[0]; var rows=[];
  for(var i=1;i<v.length;i++){
    var o={}; for(var c=0;c<head.length;c++) o[head[c]]=v[i][c];
    // normalizar: la columna 7 (índice 6) siempre es las fotos, se llame Fotos o FotoURL
    o.Fotos = v[i][6];
    rows.push(o);
  }
  return {ok:true, rows:rows, total:rows.length};
}
function getDamagedSerials_(req, me){
  if(!can_(me,'view')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_DMG); var last=sh.getLastRow(); var serials=[];
  if(last>1){ sh.getRange(2,1,last-1,1).getValues().forEach(function(r){ if(r[0]) serials.push(r[0]); }); }
  return {ok:true, serials:serials};
}
function deleteDamaged_(req, me){
  if(!can_(me,'delete') && !can_(me,'edit')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_DMG); var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){ if(v[i][0]===req.serial){ sh.deleteRow(i+1); audit_(me.Usuario,'revert_damaged',req.serial); return {ok:true}; } }
  return {ok:false, error:'no_encontrado'};
}
function addDamagePhoto_(req, me){
  if(!can_(me,'scan') && !can_(me,'edit')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_DMG); var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){
    if(v[i][0]===req.serial){
      var fotos=String(v[i][6]||'').split('|').filter(Boolean);
      if(fotos.length>=3) return {ok:false, error:'max_fotos'};
      var url=guardarFoto_(req.fotoB64, req.fotoTipo, req.serial+'_'+(fotos.length+1));
      if(!url) return {ok:false, error:'error_foto'};
      fotos.push(url); sh.getRange(i+1,7).setValue(fotos.join('|'));
      return {ok:true, fotos:fotos};
    }
  }
  return {ok:false, error:'no_encontrado'};
}
function deleteDamagePhoto_(req, me){
  if(!can_(me,'edit') && !can_(me,'delete') && !can_(me,'scan')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_DMG); var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){
    if(v[i][0]===req.serial){
      var fotos=String(v[i][6]||'').split('|').filter(Boolean);
      var idx=req.fotoIndex;
      if(idx<0||idx>=fotos.length) return {ok:false, error:'indice_invalido'};
      try{ var fid=extraerIdDrive_(fotos[idx]); if(fid) DriveApp.getFileById(fid).setTrashed(true); }catch(e){}
      fotos.splice(idx,1); sh.getRange(i+1,7).setValue(fotos.join('|'));
      return {ok:true, fotos:fotos};
    }
  }
  return {ok:false, error:'no_encontrado'};
}

// ===== INVERSORES =====
function saveInverter_(req, me){
  if(!can_(me,'scan')) return {ok:false, error:'sin_permiso'};
  var num=req.numero;
  if(!num) return {ok:false, error:'numero_requerido'};
  var sh=getSheet_(SH_INV); var v=sh.getDataRange().getValues();
  var fila=-1;
  for(var i=1;i<v.length;i++){ if(String(v[i][0])===String(num)){ fila=i+1; break; } }
  var fotoUrl=req.fotoActual||'';
  if(req.fotoB64){ var u=guardarFoto_(req.fotoB64, req.fotoTipo, 'Inversor_'+num); if(u) fotoUrl=u; }
  if(fila>0){
    sh.getRange(fila,2,1,5).setValues([[req.codigo||v[fila-1][1], req.ubicacion||'', req.nota||'', fotoUrl, me.Usuario]]);
    sh.getRange(fila,7).setValue(new Date());
    audit_(me.Usuario,'inverter_edit','Inv '+num);
    return {ok:true, updated:true};
  } else {
    var filaI=[num, req.codigo||'', req.ubicacion||'', req.nota||'', fotoUrl, me.Usuario, new Date()];
    var colPi=colIndex_(sh,'Proyecto');
    while(filaI.length < colPi-1) filaI.push('');
    filaI[colPi-1]=req.proyecto||'';
    sh.appendRow(filaI);
    audit_(me.Usuario,'inverter_add','Inv '+num);
    return {ok:true, created:true};
  }
}
function getInverters_(req, me){
  if(!can_(me,'view')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_INV); var last=sh.getLastRow(); if(last<2) return {ok:true, rows:[]};
  var v=sh.getRange(1,1,last,7).getValues(); var head=v[0]; var rows=[];
  for(var i=1;i<v.length;i++){ var o={}; for(var c=0;c<head.length;c++) o[head[c]]=v[i][c]; rows.push(o); }
  return {ok:true, rows:rows};
}
function deleteInverter_(req, me){
  if(!can_(me,'delete') && !can_(me,'edit')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_INV); var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){ if(String(v[i][0])===String(req.numero)){ sh.deleteRow(i+1); audit_(me.Usuario,'inverter_del','Inv '+req.numero); return {ok:true}; } }
  return {ok:false, error:'no_encontrado'};
}

// ===== HELPERS DE FOTOS =====
// Ejecuta esta función UNA vez para autorizar el acceso a Drive (soluciona 'Acceso denegado')
function autorizarDrive(){
  var carpeta;
  try{ carpeta=DriveApp.getFolderById(FOLDER_DMG_ID); carpeta.getName(); }
  catch(e){
    // crear carpeta propia si la configurada no es accesible
    var it=DriveApp.getFoldersByName('CSO_Fotos_Danados');
    carpeta = it.hasNext()? it.next() : DriveApp.createFolder('CSO_Fotos_Danados');
  }
  // crear un archivo de prueba y borrarlo, para confirmar permiso de escritura
  var test=carpeta.createFile(Utilities.newBlob('test','text/plain','test_permiso.txt'));
  test.setTrashed(true);
  return 'Drive autorizado OK. Carpeta usada: '+carpeta.getName()+' (ID: '+carpeta.getId()+')';
}

function guardarFoto_(b64, tipo, nombre){
  if(!b64) return '';
  try{
    var folder=getDamageFolder_();
    if(!folder) return 'ERROR:sin_carpeta_accesible';
    var bytes=Utilities.base64Decode(b64);
    var blob=Utilities.newBlob(bytes, tipo||'image/jpeg', nombre+'_'+Date.now()+'.jpg');
    var file=folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/file/d/'+file.getId()+'/view';
  }catch(e){ return 'ERROR:'+String(e); }
}
function extraerIdDrive_(url){
  var m=String(url).match(/[-\w]{25,}/);
  return m?m[0]:null;
}
function getDamageFolder_(){
  // 1) intentar la carpeta configurada por ID
  try{
    var f=DriveApp.getFolderById(FOLDER_DMG_ID);
    // probar acceso real de escritura leyendo el nombre (dispara el error si no hay permiso)
    f.getName();
    return f;
  }catch(e){}
  // 2) respaldo: carpeta propia del script (siempre accesible)
  try{
    var it=DriveApp.getFoldersByName('CSO_Fotos_Danados');
    if(it.hasNext()) return it.next();
    return DriveApp.createFolder('CSO_Fotos_Danados');
  }catch(e2){ return null; }
}

function getInstalls_(req, me){
  if(!can_(me,'view')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_INST); var last=sh.getLastRow(); if(last<2) return {ok:true, rows:[]};
  var v=sh.getRange(1,1,last,15).getValues(); var head=v[0]; var rows=[];
  for(var i=1;i<v.length;i++){ var o={}; for(var c=0;c<head.length;c++) o[head[c]]=v[i][c]; rows.push(o); }
  return {ok:true, rows:rows};
}
function editInstall_(req, me){
  if(!can_(me,'edit')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_INST); var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){
    if(v[i][0]===req.serial){
      for(var j=1;j<v.length;j++){ if(j!==i && v[j][1]==req.inv && v[j][2]==req.trk && v[j][4]==req.pos) return {ok:false, error:'posicion_ocupada'}; }
      sh.getRange(i+1,2,1,4).setValues([[req.inv,req.trk,req.str,req.pos]]);
      sh.getRange(i+1,14,1,2).setValues([[me.Usuario,new Date()]]);
      audit_(me.Usuario,'edit',req.serial+' -> Inv'+req.inv+' Trk'+req.trk+' Str'+req.str+' Pos'+req.pos);
      return {ok:true};
    }
  }
  return {ok:false, error:'no_encontrado'};
}
function deleteInstall_(req, me){
  if(!can_(me,'delete')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_INST); var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){ if(v[i][0]===req.serial){ sh.deleteRow(i+1); audit_(me.Usuario,'delete',req.serial); return {ok:true}; } }
  return {ok:false, error:'no_encontrado'};
}

// ============ EXPORT XLSX FORMAL (generado en servidor con formato) ============
function exportXlsxServer_(req, me){
  if(!can_(me,'export')) return json_({ok:false, error:'sin_permiso'});
  var shInst=getSheet_(SH_INST);
  var last=shInst.getLastRow();
  var data = last>1 ? shInst.getRange(2,1,last-1,15).getValues() : [];

  // crear un Spreadsheet temporal con formato, exportarlo como xlsx, borrarlo
  var tmp = SpreadsheetApp.create('tmp_export_CSO_'+Date.now());
  var ss = tmp;
  var tz = Session.getScriptTimeZone();
  var ahora = Utilities.formatDate(new Date(), tz, 'dd-MM-yyyy HH:mm');

  // ---- Hoja Portada ----
  var pt = ss.getActiveSheet(); pt.setName('Portada');
  pt.getRange('A1').setValue('COMERCIAL CHINALED LTDA.').setFontSize(16).setFontWeight('bold').setFontColor('#0d3b2e');
  pt.getRange('A2').setValue('REGISTRO DE INSTALACIÓN DE PANELES FOTOVOLTAICOS').setFontSize(12).setFontWeight('bold');
  pt.getRange('A3').setValue('Proyecto: PFV Cerro Sombrero (CSO) — Contrato 42PS25').setFontStyle('italic').setFontColor('#666666');
  var info=[
    ['Fecha y hora de descarga:', ahora],
    ['Descargado por:', me.Nombre+' (@'+me.Usuario+')'],
    ['Total paneles instalados:', data.length],
    ['Meta CSO:', 4320],
    ['Avance:', Math.round(data.length/4320*100)+'%']
  ];
  pt.getRange(5,1,info.length,2).setValues(info);
  pt.getRange(5,1,info.length,1).setFontWeight('bold');
  pt.getRange('A5:A9').setBackground('#e8f0ec');
  pt.setColumnWidth(1,240); pt.setColumnWidth(2,320);
  pt.getRange('A11').setValue('Documento generado automáticamente. La fecha de descarga identifica la versión.').setFontSize(9).setFontStyle('italic').setFontColor('#999999');

  // ---- Hoja Instalados ----
  var ins = ss.insertSheet('Instalados CSO');
  var head=['N°','Serial','Inversor','Tracker','String','Posición','Pallet','Contenedor','Potencia (W)','No Catalogado','Operario','Registrado por','Fecha/Hora Registro','Editado por','Fecha Edición'];
  ins.getRange(1,1,1,head.length).setValues([head])
     .setFontWeight('bold').setFontColor('#ffffff').setBackground('#14705a')
     .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  ins.setFrozenRows(1);
  if(data.length){
    var rows=data.map(function(r,i){
      var fecha = r[12] instanceof Date ? Utilities.formatDate(r[12],tz,'dd-MM-yyyy HH:mm') : r[10];
      var fedit = r[14] instanceof Date ? Utilities.formatDate(r[14],tz,'dd-MM-yyyy HH:mm') : '';
      return [i+1, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[11], fecha, r[13], fedit];
    });
    ins.getRange(2,1,rows.length,head.length).setValues(rows);
    // bordes y zebra
    var rng=ins.getRange(1,1,rows.length+1,head.length);
    rng.setBorder(true,true,true,true,true,true,'#d0d8d4',SpreadsheetApp.BorderStyle.SOLID);
    for(var i=2;i<=rows.length+1;i++){ if(i%2===0) ins.getRange(i,1,1,head.length).setBackground('#f4f8f6'); }
  }
  var widths=[40,150,70,70,55,70,150,90,85,90,120,120,150,110,150];
  for(var c=0;c<widths.length;c++) ins.setColumnWidth(c+1,widths[c]);

  // ---- Hoja Resumen ----
  var res = ss.insertSheet('Resumen');
  res.getRange('A1').setValue('RESUMEN DE AVANCE POR INVERSOR / TRACKER').setFontWeight('bold').setFontSize(12).setFontColor('#0d3b2e');
  res.getRange(3,1,1,3).setValues([['Inversor','Tracker','Paneles instalados']])
     .setFontWeight('bold').setFontColor('#ffffff').setBackground('#14705a').setHorizontalAlignment('center');
  var agg={};
  data.forEach(function(r){ var k=r[1]+'|'+r[2]; agg[k]=(agg[k]||0)+1; });
  var keys=Object.keys(agg).sort(function(a,b){ var A=a.split('|').map(Number),B=b.split('|').map(Number); return A[0]-B[0]||A[1]-B[1]; });
  if(keys.length){
    var rr=keys.map(function(k){ var p=k.split('|'); return [Number(p[0]),Number(p[1]),agg[k]]; });
    res.getRange(4,1,rr.length,3).setValues(rr);
    res.getRange(3,1,rr.length+1,3).setBorder(true,true,true,true,true,true,'#d0d8d4',SpreadsheetApp.BorderStyle.SOLID);
  }
  res.setColumnWidth(1,100); res.setColumnWidth(2,100); res.setColumnWidth(3,150);

  // ---- Hoja Paneles Dañados ----
  var shD=getSheet_(SH_DMG);
  var dmg = shD && shD.getLastRow()>1 ? shD.getRange(2,1,shD.getLastRow()-1,9).getValues() : [];
  var wsD = ss.insertSheet('Paneles Dañados');
  var hD=['N°','Serial','Motivo','Nota','Pallet','Contenedor','Potencia (W)','Reportado por','Fecha'];
  wsD.getRange(1,1,1,hD.length).setValues([hD]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#e05a4a').setHorizontalAlignment('center').setWrap(true);
  wsD.setFrozenRows(1);
  if(dmg.length){
    var rowsD=dmg.map(function(r,i){
      var f = r[8] instanceof Date ? Utilities.formatDate(r[8],tz,'dd-MM-yyyy HH:mm') : r[8];
      return [i+1, r[0], r[1], r[2], r[3], r[4], r[5], r[7], f];
    });
    wsD.getRange(2,1,rowsD.length,hD.length).setValues(rowsD);
    wsD.getRange(1,1,rowsD.length+1,hD.length).setBorder(true,true,true,true,true,true,'#d0d8d4',SpreadsheetApp.BorderStyle.SOLID);
    for(var di=2;di<=rowsD.length+1;di++){ if(di%2===0) wsD.getRange(di,1,1,hD.length).setBackground('#fdf0ee'); }
  }
  var wD=[40,150,120,220,150,90,85,120,150];
  for(var wc=0;wc<wD.length;wc++) wsD.setColumnWidth(wc+1,wD[wc]);
  // añadir cuadre de inventario en la portada
  pt.getRange(10,1,1,2).setValues([['Paneles dañados/rechazados:', dmg.length]]);
  pt.getRange(10,1).setFontWeight('bold');

  SpreadsheetApp.flush();

  // exportar como xlsx
  var url='https://docs.google.com/spreadsheets/d/'+ss.getId()+'/export?format=xlsx';
  var blob=UrlFetchApp.fetch(url,{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()}}).getBlob();
  var b64=Utilities.base64Encode(blob.getBytes());
  // borrar el temporal
  DriveApp.getFileById(ss.getId()).setTrashed(true);

  var fname='Instalacion_CSO_'+Utilities.formatDate(new Date(),tz,'yyyy-MM-dd_HHmm')+'.xlsx';
  return json_({ok:true, filename:fname, b64:b64});
}
// ===== PROYECTOS =====
// Config JSON: { inversores:N, trackers:[{tipo,paneles,strings,porString,cantidad}], asignacion:{'1':['A','A','B']} }
function saveProject_(req, me){
  if(me.Rol!=='admin') return {ok:false, error:'solo_admin'};
  var nombre=(req.nombre||'').trim();
  if(!nombre) return {ok:false, error:'nombre_requerido'};
  var sh=getSheet_(SH_PROY); var v=sh.getDataRange().getValues();
  var cfg = typeof req.config==='string' ? req.config : JSON.stringify(req.config||{});
  var fila=-1;
  for(var i=1;i<v.length;i++){ if(String(v[i][0])===nombre){ fila=i+1; break; } }
  if(fila>0){
    sh.getRange(fila,2).setValue(cfg); sh.getRange(fila,3).setValue(req.activo!==false);
    audit_(me.Usuario,'proy_edit',nombre); return {ok:true, updated:true};
  } else {
    sh.appendRow([nombre, cfg, req.activo!==false, me.Usuario, new Date()]);
    audit_(me.Usuario,'proy_add',nombre); return {ok:true, created:true};
  }
}
function getProjects_(req, me){
  if(!can_(me,'view')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_PROY); var last=sh.getLastRow(); if(last<2) return {ok:true, rows:[]};
  var v=sh.getRange(2,1,last-1,5).getValues(); var rows=[];
  for(var i=0;i<v.length;i++){
    var cfg={}; try{ cfg=JSON.parse(v[i][1]||'{}'); }catch(e){}
    rows.push({nombre:v[i][0], config:cfg, activo:v[i][2], creadoPor:v[i][3]});
  }
  return {ok:true, rows:rows};
}
function deleteProject_(req, me){
  if(me.Rol!=='admin') return {ok:false, error:'solo_admin'};
  var sh=getSheet_(SH_PROY); var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){ if(String(v[i][0])===String(req.nombre)){ sh.deleteRow(i+1); audit_(me.Usuario,'proy_del',req.nombre); return {ok:true}; } }
  return {ok:false, error:'no_encontrado'};
}

function listUsers_(req, me){
  if(!can_(me,'manage_users')) return {ok:false, error:'sin_permiso'};
  var sh=getSheet_(SH_USERS); var v=sh.getDataRange().getValues(); var rows=[];
  for(var i=1;i<v.length;i++) rows.push({usuario:v[i][0],nombre:v[i][1],rol:v[i][2],permisosExtra:v[i][5],activo:v[i][6],creado:v[i][7],creadoPor:v[i][8]});
  return {ok:true, users:rows, roles:Object.keys(ROLE_PERMS),
    permisos_disponibles:['scan','view','edit','delete','export','manage_users'],
    permisos_labels:{scan:'Escanear e instalar', view:'Ver avance', edit:'Editar registros', delete:'Borrar registros', export:'Exportar / descargar', manage_users:'Gestionar usuarios'},
    roles_labels:{admin:'Administrador', tecnico:'Técnico', ito:'ITO', usuario:'Usuario'},
    roles_defaults:ROLE_PERMS};
}
function saveUser_(req, me){
  if(!can_(me,'manage_users')) return {ok:false, error:'sin_permiso'};
  var u=(req.usuario||'').toLowerCase().trim();
  if(!u) return {ok:false, error:'usuario_requerido'};
  if(!ROLE_PERMS[req.rol]) return {ok:false, error:'rol_invalido'};
  var sh=getSheet_(SH_USERS); var ex=findUserRow_(u); var pe=(req.permisosExtra||'').trim();
  if(ex){
    var r=ex.rowIndex;
    sh.getRange(r,2).setValue(req.nombre||ex.data.Nombre);
    sh.getRange(r,3).setValue(req.rol);
    sh.getRange(r,6).setValue(pe);
    sh.getRange(r,7).setValue(req.activo!==false);
    if(req.clave){ var s=randomSalt_(); sh.getRange(r,4).setValue(s); sh.getRange(r,5).setValue(sha256_(req.clave+s)); }
    audit_(me.Usuario,'user_edit',u); return {ok:true, updated:true};
  } else {
    if(!req.clave) return {ok:false, error:'clave_requerida_nuevo'};
    var s2=randomSalt_(); sh.appendRow([u,req.nombre||u,req.rol,s2,sha256_(req.clave+s2),pe,req.activo!==false,new Date(),me.Usuario]);
    audit_(me.Usuario,'user_create',u); return {ok:true, created:true};
  }
}
function deleteUser_(req, me){
  if(!can_(me,'manage_users')) return {ok:false, error:'sin_permiso'};
  var u=(req.usuario||'').toLowerCase().trim();
  if(u==='admin') return {ok:false, error:'no_borrar_admin'};
  if(u===me.Usuario.toLowerCase()) return {ok:false, error:'no_borrarte_a_ti'};
  var sh=getSheet_(SH_USERS); var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){ if(String(v[i][0]).toLowerCase()===u){ sh.deleteRow(i+1); audit_(me.Usuario,'user_delete',u); return {ok:true}; } }
  return {ok:false, error:'no_encontrado'};
}
function changePass_(req, me){
  var sh=getSheet_(SH_USERS); var row=findUserRow_(me.Usuario.toLowerCase());
  if(!row) return {ok:false, error:'no_encontrado'};
  if(sha256_((req.claveActual||'')+row.data.Salt)!==row.data.Hash) return {ok:false, error:'clave_actual_incorrecta'};
  if(!req.claveNueva||req.claveNueva.length<6) return {ok:false, error:'clave_muy_corta'};
  var s=randomSalt_(); sh.getRange(row.rowIndex,4).setValue(s); sh.getRange(row.rowIndex,5).setValue(sha256_(req.claveNueva+s));
  audit_(me.Usuario,'change_pass','cambió su clave'); return {ok:true};
}

// ============ HELPERS ============
function ensureSheet_(ss,name,headers){ var sh=ss.getSheetByName(name);
  if(!sh){ sh=ss.insertSheet(name); sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold'); sh.setFrozenRows(1); } return sh; }
function getSheet_(name){ return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function findUserRow_(ul){ var sh=getSheet_(SH_USERS); var v=sh.getDataRange().getValues(); var head=v[0];
  for(var i=1;i<v.length;i++){ if(String(v[i][0]).toLowerCase()===ul){ var o={}; for(var c=0;c<head.length;c++) o[head[c]]=v[i][c]; return {rowIndex:i+1, data:o}; } } return null; }
function installKeys_(sh){ var last=sh.getLastRow(); if(last<2) return []; return sh.getRange(2,1,last-1,5).getValues().map(function(r){ return [r[0],r[1],r[2],r[4]].join('|'); }); }
function audit_(usuario,accion,detalle){ try{ getSheet_(SH_AUDIT).appendRow([new Date(),usuario,accion,detalle,'']); }catch(e){} }
function randomSalt_(){ return Utilities.getUuid().replace(/-/g,''); }
function sha256_(t){ return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,t,Utilities.Charset.UTF_8).map(function(b){ return ((b&0xff)+0x100).toString(16).slice(1); }).join(''); }
function json_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
