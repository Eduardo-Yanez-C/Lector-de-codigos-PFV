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
  ensureSheet_(ss, SH_INST,  ['Serial','Inversor','Tracker','String','Posicion','Pallet','Contenedor','Potencia_W','No_Catalogado','Operario','FechaHora_ISO','RegistradoPor','FechaServidor','EditadoPor','FechaEdicion']);
  ensureSheet_(ss, SH_AUDIT, ['FechaHora','Usuario','Accion','Detalle','IP']);
  ensureSheet_(ss, SH_SESS,  ['Token','Usuario','Rol','Expira']);
  var users = getSheet_(SH_USERS);
  if(users.getLastRow() < 2){
    var salt = randomSalt_();
    users.appendRow(['admin','Administrador','admin',salt,sha256_('cambiar123'+salt),'',true,new Date(),'sistema']);
  }
  return 'Setup OK. admin / cambiar123 (cámbiala al entrar).';
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
      case 'get_installs':   return json_(getInstalls_(req, me));
      case 'edit_install':   return json_(editInstall_(req, me));
      case 'delete_install': return json_(deleteInstall_(req, me));
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
  var sh=getSheet_(SH_INST); var ex=installKeys_(sh); var nuevos=[];
  (req.registros||[]).forEach(function(r){
    var k=[r.serial,r.inv,r.trk,r.pos].join('|');
    if(ex.indexOf(k)===-1){ nuevos.push([r.serial,r.inv,r.trk,r.str,r.pos,r.pallet||'',r.cont||'',r.w||'',r.nocat?'SI':'',r.oper||'',r.ts||'',me.Usuario,new Date(),'','']); ex.push(k); }
  });
  if(nuevos.length){ sh.getRange(sh.getLastRow()+1,1,nuevos.length,15).setValues(nuevos); audit_(me.Usuario,'sync',nuevos.length+' paneles'); }
  return {ok:true, insertados:nuevos.length, recibidos:(req.registros||[]).length};
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
  var porDia={}; var porInv={};
  if(last>1){
    // col 2 = Inversor, col 13 = FechaServidor (fecha real de registro en servidor)
    var inv=sh.getRange(2,2,last-1,1).getValues();
    var fechas=sh.getRange(2,13,last-1,1).getValues();
    for(var i=0;i<fechas.length;i++){
      var d=fechas[i][0]; var key;
      if(d instanceof Date && !isNaN(d)){ key=Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
      else { key='sin_fecha'; }
      porDia[key]=(porDia[key]||0)+1;
      porInv[inv[i][0]]=(porInv[inv[i][0]]||0)+1;
    }
  }
  return {ok:true, total:Math.max(0,last-1), meta:4320, porDia:porDia, porInversor:porInv};
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

// ============ USUARIOS ============
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
