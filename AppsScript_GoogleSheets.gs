/************************************************************************
 *  LECTOR PANELES CSO — Backend Google Sheets (Apps Script)
 *  ---------------------------------------------------------------------
 *  QUÉ HACE: recibe las lecturas de la app del celular y las escribe
 *  en una hoja "Instalados_CSO" de tu Google Sheet, en vivo.
 *
 *  CÓMO INSTALARLO (una sola vez, ~3 minutos):
 *  1. Abre (o crea) tu Google Sheet de instalación.
 *  2. Menú:  Extensiones → Apps Script.
 *  3. Borra el código de ejemplo y pega TODO este archivo.
 *  4. Arriba, presiona  Implementar → Nueva implementación.
 *  5. Tipo: "Aplicación web".
 *       - Ejecutar como:  Yo (tu correo)
 *       - Quién tiene acceso:  Cualquier persona
 *  6. Presiona Implementar, autoriza los permisos.
 *  7. Copia la URL que termina en /exec.
 *  8. Pégala en la app del celular → pestaña "Datos" → URL Web App.
 *
 *  Listo. Cada vez que guardes un panel con señal, aparece en la hoja.
 ************************************************************************/

var SHEET_NAME = 'Instalados_CSO';

var HEADERS = ['Serial','Inversor','Tracker','String','Posicion',
               'Pallet','Contenedor','Potencia_W','No_Catalogado',
               'Operario','FechaHora_ISO','Fecha_Registro_Servidor'];

function doPost(e){
  var lock = LockService.getScriptLock();
  try{
    lock.waitLock(20000);
    var data = JSON.parse(e.postData.contents);
    var regs = data.registros || [];
    var sh = getSheet_();

    // set de claves ya existentes para evitar duplicados serial+ubicación
    var existentes = clavesExistentes_(sh);
    var nuevos = [];
    regs.forEach(function(r){
      var clave = [r.serial, r.inv, r.trk, r.pos].join('|');
      if(existentes.indexOf(clave) === -1){
        nuevos.push([
          r.serial, r.inv, r.trk, r.str, r.pos,
          r.pallet||'', r.cont||'', r.w||'',
          r.nocat? 'SI':'', r.oper||'', r.ts||'',
          new Date()
        ]);
        existentes.push(clave);
      }
    });
    if(nuevos.length){
      sh.getRange(sh.getLastRow()+1, 1, nuevos.length, HEADERS.length).setValues(nuevos);
    }
    return json_({ok:true, recibidos:regs.length, insertados:nuevos.length});
  }catch(err){
    return json_({ok:false, error:String(err)});
  }finally{
    try{lock.releaseLock();}catch(e2){}
  }
}

// permite probar en el navegador que la URL responde
function doGet(){
  var sh = getSheet_();
  return json_({ok:true, mensaje:'Backend CSO activo', total_instalados: Math.max(0, sh.getLastRow()-1)});
}

function getSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if(!sh){
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function clavesExistentes_(sh){
  var last = sh.getLastRow();
  if(last < 2) return [];
  var vals = sh.getRange(2,1,last-1,5).getValues(); // Serial,Inv,Trk,Str,Pos
  return vals.map(function(v){ return [v[0], v[1], v[2], v[4]].join('|'); });
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
