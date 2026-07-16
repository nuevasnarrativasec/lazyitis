/**
 * ============================================================================
 *  PORTADAS AUTO  ·  catalogo_vinilos_lazyitis
 * ============================================================================
 *  Rellena automáticamente la columna "URL Portada (Drive)" para las filas
 *  que la tengan vacía:
 *    1. Busca la carátula oficial por artista + álbum (iTunes → Deezer).
 *    2. Descarga la imagen.
 *    3. La sube a tu carpeta de Drive "portadas-vinilos".
 *    4. La comparte como "cualquiera con el enlace → Lector".
 *    5. Escribe el enlace de Drive en la celda.
 *
 *  Corre en los servidores de Google. No gasta tokens de Claude.
 *  Es RESUMIBLE: solo toca celdas vacías, así que puedes ejecutarlo las
 *  veces que haga falta hasta terminar todo el catálogo.
 *
 *  --------------------------------------------------------------------------
 *  CÓMO USARLO (una sola vez)
 *  --------------------------------------------------------------------------
 *  1. Abre la hoja catalogo_vinilos_lazyitis.
 *  2. Menú  Extensiones ▸ Apps Script.
 *  3. Borra lo que haya y pega TODO este archivo. Guarda (💾).
 *  4. En la lista de funciones elige  rellenarPortadas  y pulsa ▶ Ejecutar.
 *  5. La primera vez Google pedirá autorización → acéptala (es tu propia cuenta).
 *  6. Repite ▶ hasta que el registro diga "0 filas pendientes".
 *
 *  Consejo: empieza con PRUEBA = true (procesa solo MAX_POR_CORRIDA filas)
 *  para revisar resultados; cuando estés conforme, ponlo en false.
 * ============================================================================
 */

const CONFIG = {
  FOLDER_ID: '1Cs8s3Lrr-_NbAjcpbEM5G76rlnxOrDPg', // carpeta "portadas-vinilos"
  SHEET_NAME: '',            // '' = primera hoja; o pon el nombre exacto de la pestaña
  COL_ARTISTA_HEADER: 'Artista / Banda',
  COL_ALBUM_HEADER:   'Nombre del Vinilo',
  COL_URL_HEADER:     'URL Portada (Drive)',
  IMG_SIZE: 1000,            // px del lado de la carátula (iTunes). 600–1200 ok.
  MAX_POR_CORRIDA: 40,       // filas por ejecución (límite de 6 min de Apps Script)
  SEGUNDOS_LIMITE: 300,      // corta a los 5 min para no exceder el máximo
  PRUEBA: true,              // true = solo procesa MAX_POR_CORRIDA y marca notas
  PONER_NOTA_REVISION: true, // deja una nota en la celda con lo que encontró
  OMITIR_SIN_COINCIDENCIA: true // true = no reintenta las ya marcadas "SIN COINCIDENCIA";
                                //        prioriza las que todavía no se han buscado
};

/** Función principal — ejecútala desde el editor de Apps Script. */
function rellenarPortadas() {
  const inicio = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = CONFIG.SHEET_NAME ? ss.getSheetByName(CONFIG.SHEET_NAME) : ss.getSheets()[0];
  if (!sheet) throw new Error('No encontré la hoja. Revisa CONFIG.SHEET_NAME.');

  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);

  const values = sheet.getDataRange().getValues();
  const { headerRow, cArt, cAlb, cUrl } = ubicarColumnas_(values);

  // Notas de la columna de URL (para saber cuáles ya se marcaron SIN COINCIDENCIA)
  const notas = sheet.getRange(1, cUrl + 1, values.length, 1).getNotes();

  let procesadas = 0, exito = 0, sinCoincidencia = 0, pendientesRestantes = 0, omitidas = 0;

  for (let r = headerRow + 1; r < values.length; r++) {
    const artista = String(values[r][cArt] || '').trim();
    const album   = String(values[r][cAlb] || '').trim();
    const urlYa   = String(values[r][cUrl] || '').trim();
    const nota    = String((notas[r] && notas[r][0]) || '');

    if (!artista && !album) continue;      // fila vacía
    if (urlYa) continue;                    // ya tiene portada

    // Omitir las ya buscadas sin resultado, para priorizar lo que falta
    if (CONFIG.OMITIR_SIN_COINCIDENCIA && nota.indexOf('SIN COINCIDENCIA') !== -1) {
      omitidas++;
      continue;
    }
    pendientesRestantes++;

    // Respeta el tope por corrida
    if (procesadas >= CONFIG.MAX_POR_CORRIDA) continue;
    if ((Date.now() - inicio) / 1000 > CONFIG.SEGUNDOS_LIMITE) continue;

    procesadas++;
    const filaHoja = r + 1;              // 1-based para la API de Sheets
    const idFila = String(values[r][0] || filaHoja).trim();

    try {
      const match = buscarCaratula_(artista, album);
      if (!match) {
        sinCoincidencia++;
        if (CONFIG.PONER_NOTA_REVISION) {
          sheet.getRange(filaHoja, cUrl + 1).setNote('⚠ SIN COINCIDENCIA automática · ' + artista + ' – ' + album);
        }
        Logger.log('· fila %s  SIN COINCIDENCIA  %s – %s', idFila, artista, album);
        continue;
      }

      // Descarga la imagen
      const resp = UrlFetchApp.fetch(match.img, { muteHttpExceptions: true, followRedirects: true });
      if (resp.getResponseCode() !== 200) throw new Error('HTTP ' + resp.getResponseCode() + ' al bajar imagen');
      let blob = resp.getBlob();
      const nombre = pad3_(idFila) + ' - ' + limpiarNombre_(artista) + ' - ' + limpiarNombre_(album) + '.jpg';
      blob.setName(nombre);

      // Sube a Drive y comparte
      const file = folder.createFile(blob);
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

      const link = 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=drive_link';
      sheet.getRange(filaHoja, cUrl + 1).setValue(link);

      if (CONFIG.PONER_NOTA_REVISION) {
        const aviso = match.score < 0.6 ? '⚠ REVISAR · ' : 'Auto · ';
        sheet.getRange(filaHoja, cUrl + 1).setNote(aviso + match.artist + ' – ' + match.album + '  [' + match.source + ']');
      }

      exito++;
      Logger.log('✓ fila %s  %s – %s  [%s, score %s]', idFila, artista, album, match.source, match.score.toFixed(2));
      Utilities.sleep(250); // cortesía con las APIs
    } catch (err) {
      sheet.getRange(filaHoja, cUrl + 1).setNote('✗ Error: ' + err.message);
      Logger.log('✗ fila %s  ERROR  %s', idFila, err.message);
    }
  }

  const restanTrasCorrida = Math.max(0, pendientesRestantes - procesadas);
  Logger.log('———');
  Logger.log('Procesadas: %s   ✓ subidas: %s   ⚠ sin match: %s', procesadas, exito, sinCoincidencia);
  if (CONFIG.OMITIR_SIN_COINCIDENCIA && omitidas > 0)
    Logger.log('Omitidas (ya marcadas SIN COINCIDENCIA): %s', omitidas);
  Logger.log('Filas aún pendientes tras esta corrida: %s%s', restanTrasCorrida,
             CONFIG.PRUEBA ? '  (MODO PRUEBA — pon CONFIG.PRUEBA=false para correr todo)' : '');
  if (restanTrasCorrida > 0) Logger.log('▶ Vuelve a ejecutar rellenarPortadas para continuar.');
  else Logger.log('🎉 0 filas pendientes. ¡Catálogo completo!');
}

/* ------------------------------- Búsqueda -------------------------------- */

/** Devuelve {img, artist, album, source, score} o null. iTunes primero, Deezer de respaldo. */
function buscarCaratula_(artista, album) {
  const albumSimple = simplificar_(album);
  const intentos = [artista + ' ' + album];
  if (albumSimple !== album) intentos.push(artista + ' ' + albumSimple);

  for (const q of intentos) {
    const it = buscarItunes_(q, artista, album);
    if (it) return it;
  }
  for (const q of intentos) {
    const dz = buscarDeezer_(q, artista, album);
    if (dz) return dz;
  }
  return null;
}

function buscarItunes_(term, artista, album) {
  const url = 'https://itunes.apple.com/search?entity=album&limit=8&term=' + encodeURIComponent(term);
  const data = jsonSeguro_(url);
  if (!data || !data.results || !data.results.length) return null;
  let best = null, bestScore = -1;
  for (const r of data.results) {
    const s = similitud_(album, r.collectionName) * 0.7 + similitud_(artista, r.artistName) * 0.3;
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (!best || bestScore < 0.34) return null;
  const img = String(best.artworkUrl100 || '').replace(/\/\d+x\d+bb\.jpg$/, '/' + CONFIG.IMG_SIZE + 'x' + CONFIG.IMG_SIZE + 'bb.jpg');
  if (!img) return null;
  return { img: img, artist: best.artistName, album: best.collectionName, source: 'iTunes', score: bestScore };
}

function buscarDeezer_(term, artista, album) {
  const url = 'https://api.deezer.com/search/album?q=' + encodeURIComponent(term);
  const data = jsonSeguro_(url);
  if (!data || !data.data || !data.data.length) return null;
  let best = null, bestScore = -1;
  for (const a of data.data) {
    const s = similitud_(album, a.title) * 0.7 + similitud_(artista, a.artist && a.artist.name) * 0.3;
    if (s > bestScore) { bestScore = s; best = a; }
  }
  if (!best || bestScore < 0.34) return null;
  const img = best.cover_xl || best.cover_big || best.cover_medium;
  if (!img) return null;
  return { img: img, artist: best.artist && best.artist.name, album: best.title, source: 'Deezer', score: bestScore };
}

/* ------------------------------- Utilidades ------------------------------ */

function jsonSeguro_(url) {
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    return JSON.parse(resp.getContentText());
  } catch (e) { return null; }
}

/** Localiza la fila de encabezados y las columnas por su título. */
function ubicarColumnas_(values) {
  for (let i = 0; i < Math.min(values.length, 8); i++) {
    const fila = values[i].map(v => String(v || '').trim());
    const cUrl = fila.indexOf(CONFIG.COL_URL_HEADER);
    if (cUrl !== -1) {
      const cArt = fila.indexOf(CONFIG.COL_ARTISTA_HEADER);
      const cAlb = fila.indexOf(CONFIG.COL_ALBUM_HEADER);
      if (cArt === -1 || cAlb === -1) throw new Error('Encontré la columna de URL pero no las de Artista/Álbum. Revisa los encabezados en CONFIG.');
      return { headerRow: i, cArt: cArt, cAlb: cAlb, cUrl: cUrl };
    }
  }
  throw new Error('No encontré el encabezado "' + CONFIG.COL_URL_HEADER + '". Revisa CONFIG.SHEET_NAME / encabezados.');
}

/** Similitud 0..1 por solapamiento de palabras normalizadas. */
function similitud_(a, b) {
  const ta = tokens_(a), tb = tokens_(b);
  if (!ta.length || !tb.length) return 0;
  const setB = {}; tb.forEach(t => setB[t] = true);
  let comunes = 0; ta.forEach(t => { if (setB[t]) comunes++; });
  return comunes / Math.max(ta.length, tb.length);
}

function tokens_(s) {
  return normalizar_(s).split(' ').filter(Boolean);
}

function normalizar_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita paréntesis/corchetes y sufijos de edición para reforzar la búsqueda. */
function simplificar_(album) {
  return String(album || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function limpiarNombre_(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pad3_(id) {
  const n = String(id).replace(/[^0-9]/g, '');
  return n ? ('000' + n).slice(-3) : String(id);
}
