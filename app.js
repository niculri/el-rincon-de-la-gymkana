/* El Rincón de la Gymkana · app de una sola página.
   Vistas: inicio (lista de gymkanas) → portada de una gymkana (#<id>) → modo Anki | modo CA → resultado.
   Todo el avance queda en el navegador (localStorage, claves «rincon.<id>.*») y se puede bajar y cargar como archivo. */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => n.toLocaleString('es-CL');
const MIN = 60e3, HORA = 36e5, DIA = 864e5;

const ICON = {
  pin: '<svg viewBox="0 0 32 32" aria-hidden="true"><line x1="12" y1="12" x2="27" y2="29" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".55"/><circle cx="11" cy="11" r="8" fill="var(--pin)"/><circle cx="8.5" cy="8.5" r="2.4" fill="#fff" opacity=".55"/></svg>',
  casa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  deshacer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>',
  mazo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 012 2v12"/></svg>',
  lapiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
};

/* ---------------------------------------------------------------- almacenamiento */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } },
};
const clave = k => `rincon.${G.id}.${k}`;

/* ---------------------------------------------------------------- estado */
let INDICE = [];
const G = { id: null, meta: null, cartas: [], por: {}, regSem: {} };
let srs = {};          // código → estado de repetición espaciada
let vista = null;      // función que dibuja la vista actual (para redibujar)
let teclas = null;     // atajos de la vista actual

function imgURL(h) { return `gymkanas/${G.id}/img/${h}.webp`; }

/* ---------------------------------------------------------------- imágenes: base + recortes */
function figura(c, lado, extra = '') {
  const [base, parches] = c[lado];
  const pct = (v, t) => (v / t * 100).toFixed(4) + '%';
  const ps = parches.map(([h, x, y, w, hh]) =>
    `<img src="${imgURL(h)}" alt="" draggable="false" style="left:${pct(x, c.w)};top:${pct(y, c.h)};width:${pct(w, c.w)};height:${pct(hh, c.h)}">`).join('');
  return `<div class="fig esperando ${extra}" data-c="${esc(c.c)}" data-l="${lado}" style="--w:${c.w};--h:${c.h};--ar:${(c.w / c.h).toFixed(4)}" role="img" aria-label="${lado === 'q' ? 'Foto de la estación' : 'Foto con la respuesta'}"><img class="base" src="${imgURL(base)}" alt="" draggable="false">${ps}</div>`;
}
function activarFiguras(raiz = document) {
  raiz.querySelectorAll('.fig.esperando').forEach(f => {
    const imgs = [...f.querySelectorAll('img')];
    let n = imgs.length;
    const listo = () => { if (--n <= 0) f.classList.remove('esperando'); };
    imgs.forEach(i => (i.complete ? listo() : (i.addEventListener('load', listo), i.addEventListener('error', listo))));
  });
}
const precargadas = new Set();
function precargar(cs) {
  for (const c of cs) for (const lado of ['q', 'a']) {
    for (const h of [c[lado][0], ...c[lado][1].map(p => p[0])]) {
      if (precargadas.has(h)) continue;
      precargadas.add(h);
      const i = new Image(); i.src = imgURL(h);
    }
  }
}
document.addEventListener('click', e => {
  const f = e.target.closest('.fig');
  if (f && !f.closest('.zoom')) {
    const c = G.por[f.dataset.c];
    if (!c) return;
    const z = document.createElement('div');
    z.className = 'zoom';
    z.innerHTML = figura(c, f.dataset.l);
    z.addEventListener('click', () => z.remove());
    document.body.appendChild(z);
    activarFiguras(z);
  }
});

function fechaCL(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  return `${d}-${m}-${a}`;
}
function pieCarta(c) {
  return `<div class="pie-carta">Creado por Nico Ulriksen el ${fechaCL(c.cr)}${c.ac ? ' · actualizado el ' + fechaCL(c.ac) : ''} · T-${esc(c.c)}.${c.v}</div>`;
}
/* cara de una tarjeta como la plantilla de Anki: encabezado, imagen y, en el reverso, nombre, extra y fuente */
function cartaHTML(c, reverso) {
  let h = `<div class="carta"><div class="encabezado">${esc(c.e)}</div>${figura(c, reverso ? 'a' : 'q')}`;
  if (reverso) {
    h += `<hr><div class="respuesta"><b>${esc(c.n)}</b></div>`;
    if (c.x) h += `<div class="extra">${esc(c.x)}</div>`;
    if (c.f) h += `<div class="fuente">${esc(c.f)}</div>`;
  }
  return h + '</div>';
}

/* ---------------------------------------------------------------- barra superior */
function barra({ titulo = '', centro = '', acciones = '', progreso = null, reloj = false } = {}) {
  $('#barra').innerHTML =
    `<button class="logo" id="b-logo" title="El Rincón de la Gymkana">${ICON.pin}<b>El Rincón de la Gymkana</b></button>` +
    `<span class="hname">${titulo}</span><span class="hgrow"></span>${centro}${acciones}`;
  $('#b-logo').onclick = () => irA('');
  const pb = $('#pb');
  pb.hidden = progreso == null;
  pb.classList.toggle('reloj', reloj);
  if (progreso != null) pb.firstElementChild.style.width = (progreso * 100).toFixed(2) + '%';
}

/* diálogo de confirmación dentro de la página (no hay confirm() en todos los visores) */
function confirmar(titulo, texto, si = 'Sí', no = 'Cancelar') {
  return new Promise(res => {
    const v = document.createElement('div');
    v.className = 'velo';
    v.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><h2>${titulo}</h2><p>${texto}</p><div class="acciones"><button class="btn" id="d-si">${si}</button><button class="btn2" id="d-no">${no}</button></div></div>`;
    document.body.appendChild(v);
    const fin = r => { v.remove(); res(r); };
    $('#d-si', v).onclick = () => fin(true);
    $('#d-no', v).onclick = () => fin(false);
    v.addEventListener('click', e => { if (e.target === v) fin(false); });
    $('#d-si', v).focus();
  });
}

/* ---------------------------------------------------------------- navegación */
function irA(id) {
  if (location.hash.slice(1) !== id) location.hash = id;
  else enrutar();
}
window.addEventListener('hashchange', enrutar);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { const z = $('.zoom'); if (z) { z.remove(); return; } }
  if (teclas) teclas(e);
});

async function enrutar() {
  teclas = null;
  $('#abajo').innerHTML = '';
  const id = decodeURIComponent(location.hash.slice(1));
  if (!INDICE.length) {
    try { INDICE = await (await fetch('gymkanas/indice.json', { cache: 'no-cache' })).json(); }
    catch (e) { $('#app').innerHTML = `<div class="wrap error">No se pudo leer la lista de gymkanas. Revisa la conexión y recarga la página.</div>`; return; }
  }
  const g = INDICE.find(x => x.id === id);
  if (!g) return inicio();
  if (G.id !== id) {
    barra({ titulo: esc(g.ramo) });
    $('#app').innerHTML = `<div class="wrap cargando">Cargando las ${fmtN(g.tarjetas)} estaciones…</div>`;
    try {
      const d = await (await fetch(`gymkanas/${id}/datos.json?v=${g.actualizada}`)).json();
      G.id = id; G.meta = d; G.cartas = d.tarjetas; G.por = {}; G.regSem = {};
      for (const c of G.cartas) { G.por[c.c] = c; if (c.reg && !G.regSem[c.reg]) G.regSem[c.reg] = c.sem; }
      srs = LS.get(clave('srs'), {});
    } catch (e) {
      $('#app').innerHTML = `<div class="wrap error">No se pudo cargar esta gymkana. Revisa la conexión y recarga la página.</div>`;
      return;
    }
  }
  portada();
}

/* ---------------------------------------------------------------- inicio */
function inicio() {
  barra();
  vista = inicio;
  teclas = null;
  pararReloj();
  $('#abajo').innerHTML = '';
  $('#app').innerHTML = `<div class="wrap portada">
    <p class="kicker">Anatomía · Medicina U. de Chile</p>
    <h1>El Rincón de la Gymkana</h1>
    <p class="lead">Las fotos de preparados de cada gymkana, con sus alfileres. Estúdialas como en Anki o pruébate como en la gymkana, escribiendo el nombre de cada estación. Tu avance queda guardado en este navegador.</p>
    <div class="lista">${INDICE.map(g => `<button class="gk" data-id="${esc(g.id)}">
      <span class="gi"><span class="gr">${esc(g.ramo)}</span><span class="gt" style="display:block">${esc(g.titulo)}</span>
      <span class="gs" style="display:block">${fmtN(g.tarjetas)} estaciones · ${fmtN(g.tarjetas - g.extras)} esenciales y ${fmtN(g.extras)} extras · ${esc(g.periodo)}</span></span>
      <span class="gf" aria-hidden="true">→</span></button>`).join('')}</div>
    <p class="pie-sitio">Hecho por Nico Ulriksen. Fotos de morfogym.cl, Yokochi (<i>Atlas fotográfico de anatomía</i>, 8.ª ed.) y ComprehensiveCadaver, con los nombres en castellano.</p>
  </div>`;
  document.querySelectorAll('.gk').forEach(b => (b.onclick = () => irA(b.dataset.id)));
}

/* ---------------------------------------------------------------- filtros */
const SEMS = () => Object.keys(G.meta.semanas || {}).filter(s => G.cartas.some(c => c.sem === s));
const REGS_DE = s => Object.keys(G.meta.regiones || {}).filter(r => G.regSem[r] === s);
const FUENTES = () => [...new Set(G.cartas.map(c => c.src))];
function filtros() {
  const f = LS.get(clave('filtros'), null);
  if (f) return f;
  return { reg: Object.keys(G.regSem), src: FUENTES(), nivel: ['esencial'] };
}
function guardarFiltros(f) { LS.set(clave('filtros'), f); }
function pasa(c, f) {
  return (c.reg ? f.reg.includes(c.reg) : true) && f.src.includes(c.src) && f.nivel.includes(c.xt ? 'extra' : 'esencial');
}
const seleccion = (f = filtros()) => G.cartas.filter(c => pasa(c, f));
function resumenFiltros(f) {
  const sems = SEMS().filter(s => REGS_DE(s).some(r => f.reg.includes(r)));
  const n = f.nivel.length === 2 ? 'esenciales y extras' : f.nivel[0] === 'extra' ? 'solo extras' : 'esenciales';
  return `${sems.join(', ') || 'nada'} · ${n}`;
}

/* ---------------------------------------------------------------- repetición espaciada (como Anki, SM-2) */
const PASOS = [1, 10], REAPRENDER = [10], GRADUAR = 1, FACIL = 4, ADELANTAR = 20 * MIN;
function inicioDelDia(t = Date.now()) {       // el día de Anki empieza a las 4:00
  const d = new Date(t); d.setHours(4, 0, 0, 0);
  if (t < +d) d.setDate(d.getDate() - 1);
  return d;
}
const hoy = () => { const d = inicioDelDia(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function enDias(n) { const d = inicioDelDia(); d.setDate(d.getDate() + n); return +d; }
function calificar(st0, b, now = Date.now()) {
  const st = st0 ? { ...st0 } : { t: 0, s: 0, e: 2500, i: 0, r: 0, l: 0, d: 0 };
  st.r++;
  const grad = n => { st.t = 2; st.i = n; st.s = 0; st.d = enDias(n); };
  if (st.t === 0 || st.t === 1) {                     // nueva o aprendiendo
    st.t = 1;
    if (b === 1) { st.s = 0; st.d = now + PASOS[0] * MIN; }
    else if (b === 2) { st.d = now + (st.s === 0 ? (PASOS[0] + PASOS[1]) / 2 : PASOS[st.s]) * MIN; }
    else if (b === 3) { if (st.s + 1 < PASOS.length) { st.s++; st.d = now + PASOS[st.s] * MIN; } else grad(GRADUAR); }
    else grad(FACIL);
  } else if (st.t === 2) {                            // repaso
    const atraso = Math.max(0, (now - st.d) / DIA);
    if (b === 1) { st.l++; st.e = Math.max(1300, st.e - 200); st.t = 3; st.s = 0; st.i = 1; st.d = now + REAPRENDER[0] * MIN; }
    else {
      let ni;
      if (b === 2) { ni = Math.max(st.i + 1, st.i * 1.2); st.e = Math.max(1300, st.e - 150); }
      else if (b === 3) ni = Math.max(st.i * 1.2 + 1, (st.i + atraso / 2) * st.e / 1000);
      else { ni = Math.max(st.i * 1.2 + 2, (st.i + atraso) * st.e / 1000 * 1.3); st.e += 150; }
      st.i = Math.round(Math.min(ni, 36500)); st.d = enDias(st.i);
    }
  } else {                                            // reaprendiendo
    if (b === 1) st.d = now + REAPRENDER[0] * MIN;
    else if (b === 2) st.d = now + REAPRENDER[0] * 1.5 * MIN;
    else { st.t = 2; st.i = Math.max(1, st.i) + (b === 4 ? 1 : 0); st.d = enDias(st.i); }
  }
  return st;
}
function cuanto(ms) {
  if (ms < MIN) return '<1 min';
  if (ms < HORA) return Math.round(ms / MIN) + ' min';
  if (ms < DIA) return Math.round(ms / HORA) + ' h';
  const d = Math.round(ms / DIA);
  if (d < 30) return d + ' d';
  if (d < 365) return (d / 30).toFixed(1).replace('.', ',').replace(',0', '') + ' meses';
  return (d / 365).toFixed(1).replace('.', ',').replace(',0', '') + ' años';
}
function ajustesAnki() { return { nuevas: 20, repasos: 200, ...LS.get(clave('ajustes'), {}) }; }
function diaAnki() {
  const d = LS.get(clave('dia'), null);
  return d && d.dia === hoy() ? d : { dia: hoy(), nuevas: 0, repasos: 0, extra: 0, otra: 0, ms: 0 };
}
function colaAnki(f = filtros()) {
  const now = Date.now(), aj = ajustesAnki(), dia = diaAnki();
  const aprend = [], repaso = [], nuevas = [], espera = [];
  for (const c of seleccion(f)) {
    const st = srs[c.c];
    if (!st || st.t === 0) nuevas.push(c);
    else if (st.t === 2) { if (st.d <= now) repaso.push(c); }
    else if (st.d <= now) aprend.push(c);
    else if (st.d <= now + ADELANTAR) espera.push(c);
  }
  aprend.sort((a, b) => srs[a.c].d - srs[b.c].d);
  espera.sort((a, b) => srs[a.c].d - srs[b.c].d);
  repaso.sort((a, b) => srs[a.c].d - srs[b.c].d);
  const quedanN = Math.max(0, aj.nuevas + dia.extra - dia.nuevas);
  const quedanR = Math.max(0, aj.repasos - dia.repasos);
  return { aprend, espera, repaso: repaso.slice(0, quedanR), nuevas, quedanN: Math.min(quedanN, nuevas.length) };
}
function contarEstados(cs) {
  let n = 0, a = 0, r = 0, mad = 0;
  for (const c of cs) {
    const st = srs[c.c];
    if (!st || st.t === 0) n++;
    else if (st.t === 2) { r++; if (st.i >= 21) mad++; }
    else a++;
  }
  return { n, a, r, mad };
}

/* ---------------------------------------------------------------- historial */
function historial() { return LS.get(clave('hist'), []); }
function anotar(e) {
  const h = historial();
  if (e.modo === 'anki') {
    const i = h.findIndex(x => x.modo === 'anki' && x.dia === e.dia);
    if (i >= 0) h.splice(i, 1);
  } else {
    const i = h.findIndex(x => x.id && x.id === e.id);
    if (i >= 0) h.splice(i, 1);
  }
  h.unshift(e);
  LS.set(clave('hist'), h.slice(0, 300));
}
function fechaHora(t) {
  const d = new Date(t);
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function duracion(ms) {
  const m = Math.round(ms / MIN);
  return m < 1 ? '<1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/* ---------------------------------------------------------------- portada de una gymkana */
function portada() {
  vista = portada;
  teclas = null;
  pararReloj();
  $('#abajo').innerHTML = '';   // la barra de abajo de Anki o del modo CA no sigue en la portada
  window.scrollTo(0, 0);
  barra({ titulo: esc(G.meta.ramo) });
  const f = filtros(), sel = seleccion(f);
  const q = colaAnki(f), est = contarEstados(sel);
  const cnt = (pred) => G.cartas.filter(pred).length;
  const ronda = LS.get(clave('ronda'), null);
  const ajA = ajustesAnki(), ajC = { n: 20, seg: 0, corregir: 'al_instante', falladas: false, ...LS.get(clave('ajustesCA'), {}) };
  const hist = historial();
  const stats = LS.get(clave('ca'), {});
  const falladas = Object.entries(stats).filter(([k, v]) => G.por[k] && v[0] - v[1] > 0)
    .sort((a, b) => (b[1][0] - b[1][1]) - (a[1][0] - a[1][1]) || a[1][1] / a[1][0] - b[1][1] / b[1][0]).slice(0, 12);

  const semanasHTML = SEMS().map(s => {
    const rs = REGS_DE(s), on = rs.filter(r => f.reg.includes(r)).length;
    return `<div class="semana"><label class="sem-cab"><input type="checkbox" data-sem="${s}" ${on === rs.length ? 'checked' : ''} ${on && on < rs.length ? 'data-mixto="1"' : ''}>
      <span class="st">${s} · ${esc(G.meta.semanas[s])}<small>${fmtN(cnt(c => c.sem === s))} estaciones</small></span></label>
      <div class="regs">${rs.map(r => `<label class="pill" data-on="${f.reg.includes(r) ? 1 : 0}"><input type="checkbox" data-reg="${r}" ${f.reg.includes(r) ? 'checked' : ''}>${esc(G.meta.regiones[r])}<small>${fmtN(cnt(c => c.reg === r))}</small></label>`).join('')}</div></div>`;
  }).join('');
  const pill = (attr, val, txt, n, on) => `<label class="pill" data-on="${on ? 1 : 0}"><input type="checkbox" data-${attr}="${val}" ${on ? 'checked' : ''}>${txt}<small>${fmtN(n)}</small></label>`;

  $('#app').innerHTML = `<div class="wrap portada">
    <p class="kicker">${esc(G.meta.ramo)} · ${esc(G.meta.periodo || '')}</p>
    <h1>${esc(G.meta.titulo)}</h1>
    <p class="lead">${fmtN(G.cartas.length)} estaciones con fotos de preparados. Elige qué estudiar y en qué modo.</p>
    ${ronda && !ronda.fin ? `<div class="seguir"><div class="sg-t"><b>Tienes una ronda del modo CA a medias</b><span>Estación ${ronda.i + 1} de ${ronda.cods.length} · ${ronda.res.filter(r => r && r.ok).length} buenas</span></div>
      <div class="acciones"><button class="btn" id="b-seguir">Continuar</button><button class="btn2" id="b-descartar">Descartar</button></div></div>` : ''}

    <fieldset class="sec"><legend>Semanas y regiones</legend><div class="semanas">${semanasHTML}</div></fieldset>
    <fieldset class="sec"><legend>Fuente de las fotos</legend><div class="pills">${FUENTES().map(s => pill('src', s, esc(s), cnt(c => c.src === s), f.src.includes(s))).join('')}</div></fieldset>
    <fieldset class="sec"><legend>Nivel</legend><div class="pills">
      ${pill('nivel', 'esencial', 'Esenciales', cnt(c => !c.xt), f.nivel.includes('esencial'))}
      ${pill('nivel', 'extra', 'Extras', cnt(c => c.xt), f.nivel.includes('extra'))}</div>
      <p class="nota" style="margin:8px 0 0">Extras: cada estructura ya tiene hasta tres vistas en las esenciales; estas son las demás, como el submazo «Extras» de Anki.</p></fieldset>
    <div class="resumen"><b>${fmtN(sel.length)}</b><span>estaciones seleccionadas</span>
      <button class="txtbtn" id="b-todo">Seleccionar todo</button><button class="txtbtn" id="b-nada">Quitar todo</button></div>

    <div class="sec modos">
      <section class="modo"><h2><span class="ic">${ICON.mazo}</span>Modo Anki</h2>
        <p>Repetición espaciada como en Anki: ves la foto, muestras la respuesta y te calificas. Cada estación vuelve cuando toca.</p>
        <div class="est"><span class="cn">${fmtN(q.quedanN)} nuevas</span><span class="ca">${fmtN(q.aprend.length + q.espera.length)} aprendiendo</span><span class="cr">${fmtN(q.repaso.length)} para repasar</span></div>
        <div class="ajustes"><label for="a-nuevas">Nuevas por día</label><select id="a-nuevas">${[10, 20, 30, 50, 100, 200, 9999].map(v => `<option value="${v}" ${ajA.nuevas === v ? 'selected' : ''}>${v === 9999 ? 'Sin límite' : v}</option>`).join('')}</select>
          <label for="a-repasos">Repasos por día</label><select id="a-repasos">${[100, 200, 500, 9999].map(v => `<option value="${v}" ${ajA.repasos === v ? 'selected' : ''}>${v === 9999 ? 'Sin límite' : v}</option>`).join('')}</select></div>
        <button class="btn" id="b-anki" ${sel.length ? '' : 'disabled'}>Estudiar</button></section>
      <section class="modo"><h2><span class="ic">${ICON.lapiz}</span>Modo CA</h2>
        <p>Como en la gymkana: cada estación muestra la foto con el alfiler y tú escribes el nombre. Se corrige solo y puedes cambiar la corrección.</p>
        <div class="ajustes"><label for="c-n">Estaciones</label><select id="c-n">${[10, 20, 30, 50, 100, 0].map(v => `<option value="${v}" ${ajC.n === v ? 'selected' : ''}>${v || 'Todas las seleccionadas'}</option>`).join('')}</select>
          <label for="c-seg">Tiempo</label><select id="c-seg">${[0, 30, 45, 60, 90].map(v => `<option value="${v}" ${ajC.seg === v ? 'selected' : ''}>${v ? v + ' s por estación' : 'Sin límite'}</option>`).join('')}</select>
          <label for="c-cor">Corrección</label><select id="c-cor"><option value="al_instante" ${ajC.corregir === 'al_instante' ? 'selected' : ''}>En cada estación</option><option value="al_final" ${ajC.corregir === 'al_final' ? 'selected' : ''}>Al final, como en la prueba</option></select></div>
        <label class="sw"><input type="checkbox" id="c-fall" ${ajC.falladas ? 'checked' : ''}><span>Solo las que he fallado antes en el modo CA</span></label>
        <button class="btn" id="b-ca" ${sel.length ? '' : 'disabled'}>Empezar ronda</button></section>
    </div>

    <section class="sec"><h2 class="subt">Tu avance en lo seleccionado</h2>
      <div class="avance"><div class="av cn"><div class="n">${fmtN(est.n)}</div><div class="l">nuevas</div></div>
        <div class="av ca"><div class="n">${fmtN(est.a)}</div><div class="l">aprendiendo</div></div>
        <div class="av cr"><div class="n">${fmtN(est.r)}</div><div class="l">en repaso</div></div>
        <div class="av"><div class="n">${fmtN(est.mad)}</div><div class="l">maduras (≥ 21 días)</div></div></div></section>

    ${falladas.length ? `<section class="sec"><h2 class="subt">Las que más fallas en el modo CA</h2><ul class="falladas">${falladas.map(([k, v]) => `<li>${esc(G.por[k].n)}<small>${v[1]}/${v[0]}</small></li>`).join('')}</ul></section>` : ''}

    <section class="sec"><h2 class="subt">Historial</h2>
      <ul class="hist">${hist.length ? hist.slice(0, 30).map(h => h.modo === 'anki'
        ? `<li><span class="hf">${fechaHora(h.t)}</span><span class="hm">Modo Anki</span><span class="hd">${fmtN(h.n)} respuestas · ${h.n ? Math.round(100 * (h.n - h.otra) / h.n) : 0} % sin «Otra vez» · ${fmtN(h.nuevas)} nuevas · ${duracion(h.ms)}</span></li>`
        : `<li><span class="hf">${fechaHora(h.t)}</span><span class="hm">Modo CA</span><span class="hd">${h.buenas}/${h.total} buenas (${Math.round(100 * h.buenas / h.total)} %)${h.fin ? '' : ' · a medias'} · ${esc(h.filtros)}</span></li>`).join('')
        : '<li class="vacio">Todavía no has estudiado. Aquí van a quedar tus sesiones del modo Anki (una por día) y tus rondas del modo CA.</li>'}</ul></section>

    <section class="sec"><h2 class="subt">Copia de tu avance</h2>
      <p class="nota" style="margin:0 0 10px">El avance vive en este navegador. Para pasarlo a otro dispositivo, baja la copia y cárgala allá.</p>
      <div class="acciones"><button class="btn2" id="b-bajar">Bajar copia</button><button class="btn2" id="b-cargar">Cargar copia</button><input type="file" id="f-cargar" accept="application/json,.json" hidden>
        <button class="txtbtn" id="b-borrar" style="margin-left:auto">Borrar todo mi avance</button></div></section>
    <p class="pie-sitio">Hecho por Nico Ulriksen · ${esc(G.meta.ramo)}, ${esc((G.meta.periodo || '').toLowerCase())}. Cada estación lleva su código abajo a la derecha (T-…) para reportar errores.</p>
  </div>`;

  // indeterminado en las semanas con algunas regiones
  document.querySelectorAll('[data-mixto]').forEach(i => (i.indeterminate = true));
  const app = $('#app');
  app.querySelectorAll('input[data-sem]').forEach(i => i.onchange = () => {
    const rs = REGS_DE(i.dataset.sem);
    f.reg = i.checked ? [...new Set([...f.reg, ...rs])] : f.reg.filter(r => !rs.includes(r));
    guardarFiltros(f); portada(); restaurarScroll();
  });
  const alternar = (lista, v, on) => on ? [...new Set([...lista, v])] : lista.filter(x => x !== v);
  app.querySelectorAll('input[data-reg]').forEach(i => i.onchange = () => { f.reg = alternar(f.reg, i.dataset.reg, i.checked); guardarFiltros(f); portada(); restaurarScroll(); });
  app.querySelectorAll('input[data-src]').forEach(i => i.onchange = () => { f.src = alternar(f.src, i.dataset.src, i.checked); guardarFiltros(f); portada(); restaurarScroll(); });
  app.querySelectorAll('input[data-nivel]').forEach(i => i.onchange = () => { f.nivel = alternar(f.nivel, i.dataset.nivel, i.checked); guardarFiltros(f); portada(); restaurarScroll(); });
  $('#b-todo').onclick = () => { guardarFiltros({ reg: Object.keys(G.regSem), src: FUENTES(), nivel: ['esencial', 'extra'] }); portada(); restaurarScroll(); };
  $('#b-nada').onclick = () => { guardarFiltros({ reg: [], src: f.src, nivel: f.nivel }); portada(); restaurarScroll(); };
  $('#a-nuevas').onchange = e => { LS.set(clave('ajustes'), { ...ajustesAnki(), nuevas: +e.target.value }); portada(); restaurarScroll(); };
  $('#a-repasos').onchange = e => { LS.set(clave('ajustes'), { ...ajustesAnki(), repasos: +e.target.value }); portada(); restaurarScroll(); };
  const guardarCA = () => LS.set(clave('ajustesCA'), { n: +$('#c-n').value, seg: +$('#c-seg').value, corregir: $('#c-cor').value, falladas: $('#c-fall').checked });
  ['#c-n', '#c-seg', '#c-cor', '#c-fall'].forEach(s => ($(s).onchange = guardarCA));
  $('#b-anki').onclick = () => { ultimoScroll = 0; anki(); };
  $('#b-ca').onclick = async () => {
    guardarCA();
    if (ronda && !ronda.fin && !(await confirmar('¿Empezar una ronda nueva?', 'Tienes una ronda a medias. Si empiezas otra, esa queda en el historial como está.', 'Empezar otra'))) return;
    nuevaRonda();
  };
  if ($('#b-seguir')) {
    $('#b-seguir').onclick = () => ca();
    $('#b-descartar').onclick = async () => {
      if (await confirmar('¿Descartar la ronda?', 'Queda en el historial con lo que alcanzaste a responder.', 'Descartar')) { LS.del(clave('ronda')); portada(); }
    };
  }
  $('#b-bajar').onclick = bajarCopia;
  $('#b-cargar').onclick = () => $('#f-cargar').click();
  $('#f-cargar').onchange = e => cargarCopia(e.target.files[0]);
  $('#b-borrar').onclick = async () => {
    if (!(await confirmar('¿Borrar todo tu avance?', 'Se borran la repetición espaciada, el historial y las estadísticas de esta gymkana en este navegador. No se puede deshacer; si quieres, baja antes una copia.', 'Borrar todo'))) return;
    for (const k of ['srs', 'hist', 'ronda', 'dia', 'ca']) LS.del(clave(k));
    srs = {}; portada();
  };
}
let ultimoScroll = 0;
window.addEventListener('scroll', () => { if (vista === portada) ultimoScroll = window.scrollY; }, { passive: true });
function restaurarScroll() { window.scrollTo(0, ultimoScroll); }

function bajarCopia() {
  const datos = { gymkana: G.id, fecha: new Date().toISOString() };
  for (const k of ['srs', 'hist', 'ronda', 'dia', 'ca', 'filtros', 'ajustes', 'ajustesCA']) datos[k] = LS.get(clave(k), null);
  const blob = new Blob([JSON.stringify(datos)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Rincón de la Gymkana - ${G.id} - ${hoy()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function cargarCopia(file) {
  if (!file) return;
  let d;
  try { d = JSON.parse(await file.text()); } catch (e) { await confirmar('No se pudo leer el archivo', 'No es una copia del avance de El Rincón de la Gymkana.', 'Entendido', 'Cerrar'); return; }
  if (d.gymkana !== G.id) { await confirmar('Esa copia es de otra gymkana', `El archivo es de «${esc(d.gymkana)}». Ábrelo desde esa gymkana.`, 'Entendido', 'Cerrar'); return; }
  if (!(await confirmar('¿Cargar esta copia?', `Reemplaza tu avance de este navegador por el de la copia del ${fechaHora(d.fecha)}.`, 'Cargar'))) return;
  for (const k of ['srs', 'hist', 'ronda', 'dia', 'ca', 'filtros', 'ajustes', 'ajustesCA']) {
    if (d[k] == null) LS.del(clave(k)); else LS.set(clave(k), d[k]);
  }
  srs = LS.get(clave('srs'), {});
  portada();
}

/* ---------------------------------------------------------------- modo Anki */
let A = null;   // sesión: { c, rev, deshacer: [], t0 }
function anki() {
  vista = anki;
  window.scrollTo(0, 0);
  if (!A) A = { c: null, rev: false, deshacer: [], t0: Date.now(), tCarta: Date.now() };
  siguienteAnki();
}
function elegirAnki() {
  const q = colaAnki();
  if (q.aprend.length) return { c: q.aprend[0], q };
  const nR = q.repaso.length, nN = q.quedanN;
  if (nR || nN) {
    // nuevas al azar, mezcladas con los repasos (como el preset «Gymkana»)
    const tocaNueva = nN && (!nR || Math.random() < nN / (nN + nR));
    if (tocaNueva) return { c: q.nuevas[Math.floor(Math.random() * q.nuevas.length)], q };
    return { c: q.repaso[0], q };
  }
  if (q.espera.length) return { c: q.espera[0], q };
  return { c: null, q };
}
function cuentasHTML(q, c) {
  const st = c && srs[c.c];
  const tipo = !c ? '' : !st || st.t === 0 ? 'n' : st.t === 2 ? 'r' : 'a';
  return `<span class="cuentas" title="Nuevas · Aprendiendo · Para repasar"><span class="cn ${tipo === 'n' ? 'act' : ''}">${q.quedanN}</span><span class="ca ${tipo === 'a' ? 'act' : ''}">${q.aprend.length + q.espera.length}</span><span class="cr ${tipo === 'r' ? 'act' : ''}">${q.repaso.length}</span></span>`;
}
function barraAnki(q) {
  barra({
    titulo: esc(G.meta.ramo) + ' · Modo Anki',
    centro: cuentasHTML(q, A.c),
    acciones: `<button class="hbtn" id="b-desh" ${A.deshacer.length ? '' : 'disabled'} title="Deshacer (Z)">${ICON.deshacer}<span>Deshacer</span></button><button class="hbtn" id="b-ini">${ICON.casa}<span>Inicio</span></button>`,
  });
  $('#b-ini').onclick = salirAnki;
  $('#b-desh').onclick = deshacerAnki;
}
function salirAnki() { A = null; portada(); }
function siguienteAnki() {
  const { c, q } = elegirAnki();
  A.c = c; A.rev = false; A.tCarta = Date.now();
  barraAnki(q);
  if (!c) {
    const sel = seleccion();
    const nuevasSin = q.nuevas.length;
    $('#app').innerHTML = `<div class="wrap listo"><h1>¡Listo por hoy!</h1>
      <p>${sel.length ? `Terminaste lo que tocaba en lo seleccionado.${nuevasSin ? ` Quedan ${fmtN(nuevasSin)} nuevas sin ver.` : ''}` : 'No hay estaciones seleccionadas.'}</p>
      <div class="acciones">${nuevasSin ? '<button class="btn" id="b-mas">Estudiar 10 nuevas más hoy</button>' : ''}<button class="btn2" id="b-volver">Volver al inicio</button></div></div>`;
    $('#abajo').innerHTML = '';
    if ($('#b-mas')) $('#b-mas').onclick = () => { const d = diaAnki(); d.extra += 10; LS.set(clave('dia'), d); siguienteAnki(); };
    $('#b-volver').onclick = salirAnki;
    teclas = e => { if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey) deshacerAnki(); };
    return;
  }
  dibujarAnki();
  // precarga las que probablemente vienen
  precargar([...q.aprend.slice(0, 2), ...q.repaso.slice(0, 3)]);
  if (q.nuevas.length) precargar([q.nuevas[Math.floor(Math.random() * q.nuevas.length)]]);
}
function dibujarAnki() {
  const c = A.c;
  $('#app').innerHTML = `<div class="wrap estudio">${cartaHTML(c, A.rev)}${pieCarta(c)}</div>`;
  activarFiguras($('#app'));
  precargar([c]);
  if (!A.rev) {
    $('#abajo').innerHTML = `<div class="barra-abajo"><div class="in"><button class="mostrar" id="b-mostrar">Mostrar respuesta</button></div><div class="atajos"><kbd>Espacio</kbd> mostrar · <kbd>Z</kbd> deshacer</div></div>`;
    $('#b-mostrar').onclick = mostrarAnki;
  } else {
    const now = Date.now(), st = srs[c.c];
    const nombres = ['Otra vez', 'Difícil', 'Bien', 'Fácil'];
    $('#abajo').innerHTML = `<div class="barra-abajo"><div class="in">${nombres.map((n, i) => {
      const nx = calificar(st, i + 1, now);
      // en días, el intervalo (no lo que falta para las 4:00 de ese día), como lo muestra Anki
      const ms = nx.t === 2 ? nx.i * DIA : Math.max(0, nx.d - now);
      return `<button class="calif c${i + 1}" data-b="${i + 1}"><small>${cuanto(ms)}</small>${n}</button>`;
    }).join('')}</div><div class="atajos"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> calificar · <kbd>Espacio</kbd> bien · <kbd>Z</kbd> deshacer</div></div>`;
    document.querySelectorAll('.calif').forEach(b => (b.onclick = () => responderAnki(+b.dataset.b)));
  }
  teclas = e => {
    if (e.metaKey || e.ctrlKey || e.altKey || $('.velo')) return;
    if (e.key.toLowerCase() === 'z') { deshacerAnki(); return; }
    if (!A.rev) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); mostrarAnki(); } return; }
    if (['1', '2', '3', '4'].includes(e.key)) responderAnki(+e.key);
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); responderAnki(3); }
  };
}
function mostrarAnki() { A.rev = true; dibujarAnki(); window.scrollTo(0, 0); }
function responderAnki(b) {
  const c = A.c, now = Date.now();
  const antes = srs[c.c], dia = diaAnki();
  A.deshacer.push({ c: c.c, antes, dia: { ...dia } });
  if (A.deshacer.length > 30) A.deshacer.shift();
  if (!antes || antes.t === 0) dia.nuevas++;
  else if (antes.t === 2) dia.repasos++;
  dia.otra = (dia.otra || 0) + (b === 1 ? 1 : 0);
  dia.n = (dia.n || 0) + 1;
  dia.ms = (dia.ms || 0) + Math.min(now - A.tCarta, 2 * MIN);
  srs[c.c] = calificar(antes, b, now);
  LS.set(clave('srs'), srs);
  LS.set(clave('dia'), dia);
  anotar({ modo: 'anki', dia: dia.dia, t: now, n: dia.n, otra: dia.otra, nuevas: dia.nuevas, ms: dia.ms });
  siguienteAnki();
}
function deshacerAnki() {
  const u = A && A.deshacer.pop();
  if (!u) return;
  if (u.antes) srs[u.c] = u.antes; else delete srs[u.c];
  LS.set(clave('srs'), srs);
  LS.set(clave('dia'), u.dia);
  const d = u.dia;
  if (d.n) anotar({ modo: 'anki', dia: d.dia, t: Date.now(), n: d.n, otra: d.otra || 0, nuevas: d.nuevas, ms: d.ms || 0 });
  else LS.set(clave('hist'), historial().filter(h => !(h.modo === 'anki' && h.dia === d.dia)));
  const q = colaAnki();
  A.c = G.por[u.c]; A.rev = true; A.tCarta = Date.now();
  barraAnki(q);
  dibujarAnki();
}

/* ---------------------------------------------------------------- modo CA: corrección del texto */
const ABREV = { 'm': 'musculo', 'mm': 'musculos', 'a': 'arteria', 'aa': 'arterias', 'n': 'nervio', 'nn': 'nervios', 'v': 'vena', 'vv': 'venas', 'lig': 'ligamento', 'gl': 'glandula', 'art': 'articulacion', 'r': 'ramo' };
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'al', 'a', 'su', 'sus']);
const GENERICAS = new Set(['musculo', 'musculos', 'arteria', 'arterias', 'nervio', 'nervios', 'vena', 'venas', 'ligamento', 'ligamentos', 'glandula', 'hueso', 'ramo', 'ramos', 'rama', 'tendon', 'fascia', 'conducto', 'seno', 'nucleo']);
// palabras que distinguen una estructura de su vecina: tienen que estar tal cual (sin contar el género)
const CLAVES = new Set(['intern', 'extern', 'superior', 'inferior', 'anterior', 'posterior', 'medial', 'lateral', 'mayor',
  'menor', 'superficial', 'profund', 'derech', 'izquierd', 'ascendent', 'descendent', 'transvers', 'oblicu', 'rect',
  'proximal', 'distal', 'comun', 'medi', 'central', 'principal', 'accesori', 'primer', 'segund', 'tercer', 'cuart',
  'median', 'propi', 'larg', 'cort', 'grand', 'pequen', 'alt', 'baj', 'vertical', 'horizontal', 'supraorbitari',
  'infraorbitari', 'supratroclear', 'infratroclear']);
const raiz = w => w.replace(/(os|as|o|a|es|e)$/, '');
function normalizar(s) {
  const t = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(mm|aa|nn|vv|lig|gl|art|m|a|n|v|r)\.\s*/g, (_, x) => ABREV[x] + ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  // «m recto lateral», «n facial»: abreviatura sin punto al comienzo
  if (t.length > 1 && ABREV[t[0]]) t[0] = ABREV[t[0]];
  return t.filter(w => !VACIAS.has(w));
}
const esClave = w => CLAVES.has(w) || CLAVES.has(raiz(w));
function palabraOK(x, y) {
  if (x === y) return 2;
  const rx = raiz(x), ry = raiz(y);
  if (rx === ry) return 2;
  if (esClave(x) && esClave(y)) return 0;      // «interna» por «externa», «medial» por «lateral»
  const tol = y.length <= 4 ? 0 : y.length <= 7 ? 1 : 2;
  return lev(x, y) <= tol ? 1 : 0;
}
// 1 = igual (sin tildes ni mayúsculas, en cualquier orden), 0,95 = alguna falta chica de ortografía, 0 = otra cosa
function compararPalabras(r, a) {
  if (r.length !== a.length) return 0;
  const libres = a.slice();
  let p = 1;
  for (const w of r) {
    let mejor = -1, k = 0;
    for (let j = 0; j < libres.length; j++) {
      const v = palabraOK(w, libres[j]);
      if (v > k) { k = v; mejor = j; if (v === 2) break; }
    }
    if (mejor < 0) return 0;
    if (k === 1) p = 0.95;
    libres.splice(mejor, 1);
  }
  return p;
}
function alternativas(nombre) {
  const alts = [];
  const sinPar = nombre.replace(/\([^)]*\)/g, ' ');
  alts.push(...sinPar.split(/\s\/\s|;/));
  for (const m of nombre.matchAll(/\(([^)]*)\)/g)) alts.push(...m[1].split(/,|\so\s/));
  return alts.map(normalizar).filter(a => a.length);
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
/* acepta sin «músculo», «arteria»…, con abreviaturas («m.», «a.», «n.»), sin tildes, con sinónimos entre paréntesis
   y con faltas chicas de ortografía; nunca con una palabra que cambia la estructura (interna por externa) */
function corregir(txt, nombre) {
  const r = normalizar(txt);
  if (!r.length) return 0;
  let mejor = 0;
  for (const alt of alternativas(nombre)) {
    mejor = Math.max(mejor, compararPalabras(r, alt));
    // «recto lateral» por «Músculo recto lateral»; pero si escribió «arteria», tiene que ser arteria
    const aS = alt.filter(w => !GENERICAS.has(w));
    if (!r.some(w => GENERICAS.has(w)) && aS.length) mejor = Math.max(mejor, compararPalabras(r, aS));
  }
  return mejor;
}
const UMBRAL_BIEN = 0.9;

/* ---------------------------------------------------------------- modo CA: ronda */
let R = null, reloj = null;
function barajar(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function nuevaRonda(cods) {
  const aj = { n: 20, seg: 0, corregir: 'al_instante', falladas: false, ...LS.get(clave('ajustesCA'), {}) };
  let pool;
  if (cods) pool = cods.slice();
  else {
    let sel = seleccion();
    if (aj.falladas) {
      const st = LS.get(clave('ca'), {});
      sel = sel.filter(c => st[c.c] && st[c.c][0] > st[c.c][1]);
    }
    pool = barajar(sel.map(c => c.c));
    if (aj.n) pool = pool.slice(0, aj.n);
  }
  if (!pool.length) { confirmar('No hay estaciones', aj.falladas ? 'No has fallado ninguna estación de lo seleccionado en el modo CA.' : 'Selecciona al menos una semana o región.', 'Entendido', 'Cerrar'); return; }
  R = { id: 'r' + Date.now(), t: Date.now(), cods: barajar(pool), i: 0, res: [], seg: aj.seg, corregir: aj.corregir, filtros: cods ? 'repetir las malas' : resumenFiltros(filtros()), fin: false, vista: false };
  guardarRonda();
  ca();
}
function guardarRonda() {
  LS.set(clave('ronda'), R);
  const resp = R.res.filter(Boolean);
  if (resp.length) anotar({ modo: 'ca', id: R.id, t: R.t, buenas: resp.filter(r => r.ok).length, total: R.fin ? R.cods.length : resp.length, filtros: R.filtros, fin: R.fin });
}
function ca() {
  vista = ca;
  if (!R) R = LS.get(clave('ronda'), null);
  if (!R) return portada();
  R.cods = R.cods.filter(k => G.por[k]);
  if (R.fin || R.i >= R.cods.length) return resultadoCA();
  estacion();
}
function marcadorCA() {
  const r = R.res.filter(Boolean), b = r.filter(x => x.ok).length;
  return R.corregir === 'al_final' ? '' : `<span class="marca"><span class="vb">✓ ${b}</span><span class="vm">✗ ${r.length - b}</span></span>`;
}
function barraCA(prog) {
  barra({
    titulo: `${esc(G.meta.ramo)} · Estación ${R.i + 1} de ${R.cods.length}`,
    centro: marcadorCA(),
    acciones: `<button class="hbtn" id="b-ini">${ICON.casa}<span>Inicio</span></button>`,
    progreso: prog, reloj: prog != null && R.seg > 0,
  });
  $('#b-ini').onclick = () => { pararReloj(); guardarRonda(); R = null; portada(); };
}
function pararReloj() { if (reloj) { clearInterval(reloj); reloj = null; } }
function estacion() {
  pararReloj();
  window.scrollTo(0, 0);
  const c = G.por[R.cods[R.i]], r = R.res[R.i];
  precargar(R.cods.slice(R.i, R.i + 4).map(k => G.por[k]));
  const respondida = !!r;
  const mostrarSol = respondida && R.corregir === 'al_instante';
  barraCA(R.seg > 0 && !respondida ? 1 : (R.i + (respondida ? 1 : 0)) / R.cods.length);
  let h = `<div class="wrap estudio"><div class="carta"><div class="encabezado">${esc(c.e)}</div>${figura(c, mostrarSol ? 'a' : 'q')}`;
  if (!respondida) {
    h += `<form class="escribir" id="f-resp" autocomplete="off"><input id="i-resp" type="text" placeholder="Nombre de la estructura" aria-label="Tu respuesta" autocapitalize="sentences" spellcheck="false"><button class="btn" type="submit">Responder</button></form>`;
  } else if (mostrarSol) {
    h += veredictoHTML(r, c);
  }
  h += `</div>${pieCarta(c)}</div>`;
  $('#app').innerHTML = h;
  activarFiguras($('#app'));
  if (!respondida) {
    const inp = $('#i-resp');
    if (R.borrador && R.borrador.i === R.i) inp.value = R.borrador.txt;
    inp.addEventListener('input', () => { R.borrador = { i: R.i, txt: inp.value }; LS.set(clave('ronda'), R); });
    setTimeout(() => inp.focus({ preventScroll: true }), 30);
    $('#f-resp').onsubmit = e => { e.preventDefault(); responderCA(inp.value); };
    $('#abajo').innerHTML = '';
    if (R.seg > 0) {
      const fin = Date.now() + (R.restante ?? R.seg * 1000);
      const tic = () => {
        const q = fin - Date.now();
        R.restante = Math.max(0, q);
        const pb = $('#pb');
        pb.firstElementChild.style.width = (100 * Math.max(0, q) / (R.seg * 1000)).toFixed(1) + '%';
        pb.classList.toggle('poco', q < 10000);
        if (q <= 0) { pararReloj(); responderCA(inp.value, true); }
      };
      tic(); reloj = setInterval(tic, 250);
    }
    teclas = null;
  } else {
    const ult = R.i === R.cods.length - 1;
    $('#abajo').innerHTML = `<div class="barra-abajo"><div class="in"><button class="mostrar" id="b-sig">${ult ? 'Ver resultado' : 'Siguiente estación'}</button></div><div class="atajos"><kbd>Enter</kbd> seguir</div></div>`;
    $('#b-sig').onclick = siguienteCA;
    if ($('#b-cambiar')) $('#b-cambiar').onclick = () => { cambiarCorreccion(R.i); estacion(); };
    teclas = e => { if (e.key === 'Enter' && !$('.velo')) { e.preventDefault(); siguienteCA(); } };
  }
}
function veredictoHTML(r, c) {
  const bien = r.ok;
  const txt = r.txt.trim() ? esc(r.txt) : '<i>sin respuesta</i>';
  return `<div class="veredicto ${bien ? 'bien' : 'mal'}"><span class="vi">${bien ? '✓' : '✗'}</span>${bien ? (r.manual ? 'Buena (la marcaste tú)' : r.p < 1 ? 'Buena, revisa la ortografía' : 'Buena') : r.manual ? 'Mala (la marcaste tú)' : r.agotado ? 'Se acabó el tiempo' : 'Mala'}</div>
    <div class="tuya">Escribiste: ${bien ? txt : `<s>${txt}</s>`}</div>
    <div class="cambiar"><button class="chico" id="b-cambiar">${bien ? 'Contarla como mala' : 'Contarla como buena'}</button></div>
    <hr><div class="respuesta"><b>${esc(c.n)}</b></div>${c.x ? `<div class="extra">${esc(c.x)}</div>` : ''}${c.f ? `<div class="fuente">${esc(c.f)}</div>` : ''}`;
}
function statsCA(cod, delta) {
  const st = LS.get(clave('ca'), {});
  const v = st[cod] || [0, 0];
  v[0] += delta[0]; v[1] += delta[1];
  if (v[0] <= 0) delete st[cod]; else st[cod] = v;
  LS.set(clave('ca'), st);
}
function responderCA(txt, agotado = false) {
  if (R.res[R.i]) return;
  pararReloj();
  const c = G.por[R.cods[R.i]];
  const p = corregir(txt, c.n);
  R.res[R.i] = { txt, p, ok: p >= UMBRAL_BIEN, agotado, manual: false };
  R.restante = null; R.borrador = null;
  statsCA(c.c, [1, R.res[R.i].ok ? 1 : 0]);
  guardarRonda();
  if (R.corregir === 'al_final') siguienteCA();
  else estacion();
}
function cambiarCorreccion(i) {
  const r = R.res[i];
  r.ok = !r.ok; r.manual = true;
  statsCA(R.cods[i], [0, r.ok ? 1 : -1]);
  guardarRonda();
}
function siguienteCA() {
  R.i++;
  if (R.i >= R.cods.length) { R.fin = true; guardarRonda(); return resultadoCA(); }
  guardarRonda();
  estacion();
}
function resultadoCA() {
  pararReloj();
  vista = resultadoCA;
  teclas = null;
  window.scrollTo(0, 0);
  $('#abajo').innerHTML = '';
  const res = R.cods.map((k, i) => ({ c: G.por[k], r: R.res[i] || { txt: '', ok: false, p: 0 } , i }));
  const b = res.filter(x => x.r.ok).length, n = res.length, pc = n ? Math.round(100 * b / n) : 0;
  barra({ titulo: `${esc(G.meta.ramo)} · Resultado`, acciones: `<button class="hbtn" id="b-ini">${ICON.casa}<span>Inicio</span></button>`, progreso: 1 });
  $('#b-ini').onclick = () => { R = null; portada(); };
  const malas = res.filter(x => !x.r.ok);
  const fila = x => `<div class="rv ${x.r.ok ? 'ok' : ''}" data-i="${x.i}">${figura(x.c, 'a')}<div><div class="rn">${esc(x.c.n)}</div>
    <div class="rt">${x.r.txt.trim() ? 'Escribiste: ' + (x.r.ok ? esc(x.r.txt) : `<s>${esc(x.r.txt)}</s>`) : 'Sin respuesta'}${x.r.manual ? ' · corrección tuya' : ''}</div>
    <div class="rc">Estación ${x.i + 1} · T-${esc(x.c.c)}.${x.c.v}</div>
    <div class="rb"><button class="chico" data-cambiar="${x.i}">${x.r.ok ? 'Contarla como mala' : 'Contarla como buena'}</button></div></div></div>`;
  $('#app').innerHTML = `<div class="wrap res"><p class="kicker">Modo CA · ${esc(R.filtros)}</p><h1>${b} de ${n} buenas</h1>
    <div class="marcador"><div class="mcell g"><div class="n">${b}</div><div class="l">buenas</div></div><div class="mcell r"><div class="n">${n - b}</div><div class="l">malas</div></div><div class="mcell p"><div class="n">${pc} %</div><div class="l">de la ronda</div></div></div>
    <div class="barra" aria-hidden="true"><i style="width:${pc}%"></i></div>
    <div class="acciones" style="margin-top:22px">${malas.length ? `<button class="btn" id="b-malas">Repetir las ${malas.length} malas</button>` : ''}<button class="btn2" id="b-otra">Nueva ronda</button><button class="btn2" id="b-volver">Volver al inicio</button></div>
    ${R.corregir === 'al_final' ? '<p class="nota" style="margin-top:14px">La corrección es automática: acepta faltas de ortografía chicas, tildes y «m.», «a.», «n.». Si una quedó mal corregida, cámbiala.</p>' : ''}
    <div class="revision">${(R.corregir === 'al_final' ? res : malas.concat(res.filter(x => x.r.ok))).map(fila).join('')}</div></div>`;
  activarFiguras($('#app'));
  if ($('#b-malas')) $('#b-malas').onclick = () => nuevaRonda(malas.map(x => x.c.c));
  $('#b-otra').onclick = () => nuevaRonda();
  $('#b-volver').onclick = () => { R = null; portada(); };
  document.querySelectorAll('[data-cambiar]').forEach(bt => (bt.onclick = () => { cambiarCorreccion(+bt.dataset.cambiar); const y = window.scrollY; resultadoCA(); window.scrollTo(0, y); }));
}

enrutar();
