// Parsea precios en cualquiera de estos formatos: "S/. 159,00", "S/159", "159"
function parsePrice(raw) {
    if (!raw) return 0;
    const s = raw.trim();
    // Si termina en coma + exactamente 2 dígitos (ej: "159,00"), tiene decimales
    if (/,\d{2}$/.test(s)) {
        return parseInt(s.replace(/[^\d]/g, '')) / 100 || 0;
    }
    // Si no tiene decimales, el número completo es el precio en soles
    return parseInt(s.replace(/[^\d]/g, '')) || 0;
}
 
// ─── CONFIG ─────────────────────────────────────────────────────────────
// ⚠️  Reemplaza con el número de WhatsApp de Lazyitis (formato: 51XXXXXXXXX)
const WA_NUMBER  = '51969009619';
const FB_PAGE    = 'lazyitisdiscos'; // ⚠️ Reemplaza con el usuario de la página de Facebook
 
// URL pública del Google Sheet publicado como CSV
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCte-LDumP7yTYAlTr1uw6s01GfSx_l-_f0s0vr4QuvX_o0hgOXB3oErX6k3MqJbXbHewjs38CZb2i/pub?gid=1534600788&single=true&output=csv';
// ────────────────────────────────────────────────────────────────────────
 
// ─── COLUMNAS POR NOMBRE (no por posición) ───────────────────────────────
// El sitio ya NO depende del orden de las columnas en la hoja: cada columna se
// resuelve emparejando el NOMBRE de su encabezado (fila 2 de la hoja). Así el
// cliente puede mover/reordenar columnas libremente sin romper nada ni tocar
// este archivo. Lo único que debe mantenerse es el TEXTO de los encabezados.

// Nombres de encabezado tal como están en la hoja (fila 2). Si renombras un
// encabezado en la hoja, actualiza el texto aquí también.
const COL_NAMES = {
    id:        'ID',
    artist:    'Artista / Banda',
    album:     'Nombre del Vinilo',
    version:   'Versión',
    image:     'URL Portada (Drive)',
    price:     'Precio (S/)',
    edition:   'Tipo de Edición',
    novedad:   'Novedades',
    pronto:    'Pronto en Stock',
    available: 'Disponible (uso interno)',
};

// Etiquetas de género en el ORDEN en que se muestran los botones de filtro.
// Cada una se empareja con el encabezado del mismo nombre en la hoja.
const GENRE_LABELS = [
    'Pop', 'Indie Alternativo', 'Jazz', 'Pop Rock', 'Rock Clásico / Progresivo',
    'Soundtracks', 'Rock / Pop Latino', 'New Wave', 'R&B / Soul / Blues',
    'Salsa / Cumbia', 'Punk / Hardcore', 'Electronic / Dance', 'Hip Hop / Rap',
    'Hard Rock / Metal', 'Folk / Country / Reggae', 'Artículos / Merch',
];

// Normaliza un encabezado/etiqueta para emparejar por NOMBRE de forma tolerante:
// sin acentos, en minúsculas y con saltos de línea/espacios múltiples colapsados.
// (P. ej. el encabezado "Disponible\n(uso interno)" o "Electronic /  Dance".)
function normHeader(s) {
    return (s == null ? '' : String(s))
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
        .toLowerCase()
        .replace(/\s+/g, ' ')                              // colapsa \n y espacios
        .trim();
}
 
// ─── CSV PARSER ──────────────────────────────────────────────────────────
function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i], nx = text[i + 1];
        if (inQ) {
            if (ch === '"' && nx === '"') { field += '"'; i++; }
            else if (ch === '"') { inQ = false; }
            else { field += ch; }
        } else {
            if (ch === '"') { inQ = true; }
            else if (ch === ',') { row.push(field); field = ''; }
            else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else if (ch !== '\r') { field += ch; }
        }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}
 
// ─── DRIVE URL CONVERTER ─────────────────────────────────────────────────
// Convierte cualquier URL de Google Drive al formato de imagen directa.
// Acepta: /file/d/ID/view, /open?id=ID, /uc?id=ID, thumbnails, etc.
function driveUrl(url) {
    if (!url) return '';
    if (!url.includes('drive.google.com')) return url;
    const m = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);   // extrae ID de /file/d/ID/
    const id = m ? m[1] : (url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || [])[1];
    if (!id) return url;
    // `=w600` pide a Google una versión REDIMENSIONADA (no la original de varios MB).
    // Las portadas se muestran a ~200-270px; w600 cubre pantallas retina y pesa
    // 10-20x menos, acelerando mucho la carga de la grilla.
    return `https://lh3.googleusercontent.com/d/${id}=w600`;
}
 
// ─── CATALOG LOADER ──────────────────────────────────────────────────────
async function loadCatalog() {
    const res  = await fetch(CSV_URL);
    const text = await res.text();
    const rows = parseCSV(text);
    // Fila 0: cabeceras de sección (ignorar)
    // Fila 1: nombres de columnas → de aquí resolvemos las columnas POR NOMBRE
    // Fila 2+: datos
    if (rows.length < 2) return [];

    // Índice de encabezados normalizados → posición de columna.
    const headerRow = rows[1].map(normHeader);
    const colOf = (name) => headerRow.indexOf(normHeader(name));

    // Resuelve una sola vez la posición de cada columna con nombre.
    const C = {};
    for (const key in COL_NAMES) C[key] = colOf(COL_NAMES[key]);

    // Resuelve las columnas de género (las que no aparezcan en la hoja se ignoran).
    const genreCols = GENRE_LABELS
        .map(label => ({ label, idx: colOf(label) }))
        .filter(g => g.idx !== -1);

    // Lee una celda por nombre de columna de forma segura.
    const cell = (r, key) => (C[key] !== -1 ? (r[C[key]] || '') : '');

    const catalog = [];
    for (let i = 2; i < rows.length; i++) {
        const r = rows[i];
        const id = String(cell(r, 'id')).trim();
        if (!id) continue;                                  // fila sin ID = vacía
        const available = cell(r, 'available') === 'SÍ';
        const pronto    = cell(r, 'pronto')    === 'SÍ';
        if (!available && !pronto) continue;
        const genres = genreCols.filter(g => r[g.idx] === 'SÍ').map(g => g.label);
        catalog.push({
            id:      parseInt(id) || 0,
            artist:  String(cell(r, 'artist')).trim(),
            album:   String(cell(r, 'album')).trim(),
            version: String(cell(r, 'version')).trim(),
            image:   driveUrl(String(cell(r, 'image')).trim()),
            price:   parsePrice(cell(r, 'price')),
            edition: String(cell(r, 'edition')).trim(),
            pronto,
            novedad: cell(r, 'novedad') === 'SÍ',
            genres,
        });
    }
    return catalog;
}
 
let CATALOG = [];
 
// ─── PALETTE for placeholders ──────────────────────────────────────────
const PALETTES = [
    ['#1a1a2e', '#e94560'],
    ['#2c003e', '#e040fb'],
    ['#0d3b66', '#faa300'],
    ['#1b4332', '#95d5b2'],
    ['#3d0000', '#ff6b6b'],
    ['#0a3d62', '#f8c291'],
    ['#2d1b69', '#a29bfe'],
    ['#1e3a5f', '#74b9ff'],
    ['#4a1942', '#fd79a8'],
    ['#003049', '#fcbf49'],
    ['#1a1a1a', '#FF4500'],
    ['#2c2c54', '#ff793f'],
    ['#1e272e', '#d2dae2'],
    ['#2f3640', '#e84393'],
    ['#192a56', '#00a8ff'],
];
 
function palette(str) {
    let h = 0;
    for (let c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return PALETTES[Math.abs(h) % PALETTES.length];
}
 
function initials(str) {
    return str.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}
 
// ─── GENRES ────────────────────────────────────────────────────────────
// Botones de filtro: "Novedades" + los géneros (misma lista/orden que arriba)
// + "Catálogo Completo". Un solo lugar donde mantener los géneros: GENRE_LABELS.
const GENRES = ['Novedades', ...GENRE_LABELS, 'Catálogo Completo'];
let activeGenre = 'Novedades';
let genreBeforeSearch = 'Novedades'; // restores on clear
let searchQuery = '';
 
// Build genre buttons
const genreList        = document.getElementById('genreList');
const genresToggle     = document.getElementById('genresToggle');
const genresToggleLabel = document.getElementById('genresToggleLabel');
 
GENRES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'genre-btn' + (g === activeGenre ? ' active' : '');
    btn.textContent = g;
    btn.dataset.genre = g;
    btn.addEventListener('click', () => {
        activeGenre = g;
        genreBeforeSearch = g;
        searchInput.value = '';
        searchQuery = '';
        setActiveGenreUI(g);
        render();
    });
    genreList.appendChild(btn);
});
 
genresToggle.addEventListener('click', () => {
    genreList.classList.toggle('open');
    genresToggle.classList.toggle('open');
});
 
function setActiveGenreUI(g) {
    document.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === g));
    genresToggleLabel.textContent = g;
    genreList.classList.remove('open');
    genresToggle.classList.remove('open');
}
 
// ─── SEARCH ────────────────────────────────────────────────────────────
const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    if (searchQuery) {
        // Override genre: show everything, activate Catálogo Completo
        activeGenre = 'Catálogo Completo';
        setActiveGenreUI('Catálogo Completo');
    } else {
        // Restore the genre that was active before searching
        activeGenre = genreBeforeSearch;
        setActiveGenreUI(genreBeforeSearch);
    }
    render();
});
 
// ─── COVER PLACEHOLDER ─────────────────────────────────────────────────
function buildCoverPlaceholder(vinyl, forModal = false) {
    const [bg, fg] = palette(vinyl.artist + vinyl.album);
    const div = document.createElement('div');
        div.className = 'cover-placeholder';
        div.style.background = `linear-gradient(135deg, ${bg} 0%, ${fg}33 100%), ${bg}`;
        const ini = document.createElement('span');
        ini.className = 'initials';
        ini.style.color = fg;
        ini.textContent = initials(vinyl.artist);
        const alb = document.createElement('span');
        alb.className = 'album-short';
        alb.textContent = vinyl.album;
        div.appendChild(ini);
        div.appendChild(alb);
    return div;
}
 
// ─── CONTACT LINKS ─────────────────────────────────────────────────────
function waLink(vinyl) {
    const coverLine = vinyl.image ? ` \n Portada: ${vinyl.image}` : '';
    const msg = `Hola! Me interesa el vinilo:\n*${vinyl.artist}* — ${vinyl.album} (${vinyl.version})${vinyl.edition ? `\n_${vinyl.edition}_` : ''}${coverLine}\n¿Está disponible?`;
    return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
}
function messengerLink(vinyl) {
    const msg = `Hola! Me interesa el vinilo: ${vinyl.artist} — ${vinyl.album} (${vinyl.version})${vinyl.edition ? ` / ${vinyl.edition}` : ''}. ¿Está disponible?`;
    return `https://m.me/${FB_PAGE}?text=${encodeURIComponent(msg)}`;
}
 
// ─── RENDER ────────────────────────────────────────────────────────────
const PAGE_SIZE = 75;
let visibleCount = 0;
 
const catalogEl = document.getElementById('catalog');
const countEl    = document.getElementById('countNum');
const countLabel = document.getElementById('countLabel');
const sentinel  = document.getElementById('sentinel');
 
function filtered() {
    return CATALOG.filter(v => {
        let matchGenre;
        if (activeGenre === 'Catálogo Completo') {
            matchGenre = true;
        } else if (activeGenre === 'Novedades') {
            matchGenre = v.novedad === true;
        } else {
            matchGenre = v.genres.includes(activeGenre);
        }
        const q = searchQuery;
        const matchSearch = !q || v.artist.toLowerCase().includes(q) || v.album.toLowerCase().includes(q) || v.edition.toLowerCase().includes(q);
        return matchGenre && matchSearch;
    });
}
 
function buildCard(vinyl, index = 99) {
    const card = document.createElement('div');
    card.className = vinyl.pronto ? 'card card--pronto' : 'card';
    if (!vinyl.pronto) card.addEventListener('click', () => openModal(vinyl));
 
    const artist = document.createElement('p');
    artist.className = 'card-artist';
    artist.textContent = vinyl.artist;
 
    const coverWrap = document.createElement('div');
    coverWrap.className = 'card-cover';
    if (vinyl.image) {
        const img = document.createElement('img');
        img.src = vinyl.image;
        img.alt = `${vinyl.artist} – ${vinyl.album}`;
        // Las primeras portadas (visibles al entrar) cargan de inmediato;
        // el resto en diferido para no saturar la red al inicio.
        img.loading = index < 14 ? 'eager' : 'lazy';
        img.decoding = 'async';
        coverWrap.appendChild(img);
    } else {
        coverWrap.appendChild(buildCoverPlaceholder(vinyl));
    }
 
    const album = document.createElement('p');
    album.className = 'card-album';
    album.innerHTML = `${vinyl.album} <span class="version">(${vinyl.version})</span>`;
 
    const footer = document.createElement('div');
    footer.className = 'card-footer';
 
    const priceRow = document.createElement('div');
    priceRow.className = 'card-price-row';
    const priceBadge = document.createElement('span');
    priceBadge.className = 'price-badge';
    priceBadge.textContent = vinyl.price ? `S/ ${vinyl.price}` : 'Consultar';
    priceRow.appendChild(priceBadge);
    if (vinyl.edition) {
        const ed = document.createElement('span');
        ed.className = 'edition-text';
        ed.textContent = vinyl.edition;
        priceRow.appendChild(ed);
    }
    footer.appendChild(priceRow);
 
    const cardInner = document.createElement('div');
    cardInner.className = 'card-inner';
    cardInner.appendChild(album);
    cardInner.appendChild(coverWrap);
    cardInner.appendChild(footer);
 
    if (vinyl.pronto) {
        const bar = document.createElement('div');
        bar.className = 'pronto-bar';
        bar.textContent = 'Pronto en Stock';
        cardInner.appendChild(bar);
    }
 
    card.appendChild(artist);
    card.appendChild(cardInner);
    return card;
}
 
function appendBatch(items) {
    const end = Math.min(visibleCount + PAGE_SIZE, items.length);
    const frag = document.createDocumentFragment();
    items.slice(visibleCount, end).forEach((v, i) => frag.appendChild(buildCard(v, visibleCount + i)));
    catalogEl.appendChild(frag);
    visibleCount = end;
    sentinel.style.display = visibleCount < items.length ? 'block' : 'none';
}
 
function render() {
    const items = filtered();
    countEl.textContent = items.length;
    countLabel.textContent = items.length === 1 ? 'vinilo' : 'vinilos';
    catalogEl.innerHTML = '';
    visibleCount = 0;
    sentinel.style.display = 'none';
 
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        const msg = (activeGenre === 'Novedades' && !searchQuery) ?
            'Pronto habrá novedades disponibles. Mientras tanto, explora el catálogo completo.' :
            'No encontramos vinilos con esa búsqueda.';
        empty.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>${msg}</p>`;
        catalogEl.appendChild(empty);
        return;
    }
 
    appendBatch(items);
}
 
// ─── INFINITE SCROLL ───────────────────────────────────────────────────
const scrollObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) appendBatch(filtered());
}, { rootMargin: '300px' });
scrollObserver.observe(sentinel);
 
// ─── MODAL ─────────────────────────────────────────────────────────────
const backdrop = document.getElementById('modalBackdrop');
const mClose = document.getElementById('modalClose');
const mCover = document.getElementById('modalCover');
const mArtist = document.getElementById('modalArtist');
const mAlbum = document.getElementById('modalAlbum');
const mVersion = document.getElementById('modalVersion');
const mPrice = document.getElementById('modalPrice');
const mEdition = document.getElementById('modalEdition');
const mGenres = document.getElementById('modalGenres');
const mActions = document.getElementById('modalActions');
 
function openModal(vinyl) {
    mCover.innerHTML = '';
    if (vinyl.image) {
        const img = document.createElement('img');
        img.src = vinyl.image;
        img.alt = `${vinyl.artist} – ${vinyl.album}`;
        mCover.appendChild(img);
    } else {
        mCover.appendChild(buildCoverPlaceholder(vinyl, true));
    }
    mArtist.textContent = vinyl.artist;
    mAlbum.textContent = vinyl.album;
    mVersion.textContent = vinyl.version;
    mPrice.textContent = vinyl.price ? `S/ ${vinyl.price}` : 'Consultar precio';
    mEdition.textContent = vinyl.edition || '';
    mEdition.style.display = vinyl.edition ? '' : 'none';
    mGenres.innerHTML = '';
    vinyl.genres.forEach(g => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = g;
        mGenres.appendChild(tag);
    });
 
    // Build action buttons
    mActions.innerHTML = '';
    const mActionsLabel = document.createElement('p');
    mActionsLabel.className = 'modal-actions-label';
    mActionsLabel.textContent = 'Pide tu vinilo a través de:';
    mActions.appendChild(mActionsLabel);
    const btnsRow = document.createElement('div');
    btnsRow.className = 'modal-actions-btns';
 
    const wa = document.createElement('a');
    wa.className = 'modal-btn modal-btn--wa';
    wa.href = waLink(vinyl);
    wa.target = '_blank';
    wa.rel = 'noopener';
    wa.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.527 5.847L.057 23.885c-.073.271.175.52.446.447l6.04-1.47A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.897 0-3.67-.518-5.193-1.421l-.372-.22-3.862.94.96-3.862-.242-.385A9.953 9.953 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>WhatsApp`;
    btnsRow.appendChild(wa);
 
    const ms = document.createElement('a');
    ms.className = 'modal-btn modal-btn--ms';
    ms.href = messengerLink(vinyl);
    ms.target = '_blank';
    ms.rel = 'noopener';
    ms.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.186 0 11.581c0 3.644 1.826 6.884 4.688 9.014V24l4.274-2.342c1.141.315 2.351.486 3.607.486 6.627 0 12-5.186 12-11.581S18.627 0 12 0zm1.19 15.593l-3.057-3.26-5.964 3.26 6.559-6.97 3.132 3.26 5.889-3.26-6.559 6.97z"/></svg>Messenger`;
    btnsRow.appendChild(ms);
 
    mActions.appendChild(btnsRow);
 
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
}
 
function closeModal() {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
}
 
mClose.addEventListener('click', closeModal);
backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeModal();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
});
 
catalogEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Cargando catálogo…</p></div>';
 
loadCatalog()
    .then(data => {
        CATALOG = data;
        render();
    })
    .catch(() => {
        catalogEl.innerHTML = '<div class="empty-state"><p>No se pudo cargar el catálogo. Recarga la página.</p></div>';
    });