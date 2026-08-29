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
      case 'export_xlsx':    return exportXlsxServer_(req, me);
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
