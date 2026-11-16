// Cuadre · app principal. Datos en Supabase (Postgres + RLS), sesión con Google.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, PLAN } from "./config.js";
import { CAT, catsFor, entra, isLoan, keysOf, parse, parseChat, parseNum, isoOf, today, pad, norm, hash } from "./parser.js";

const D = document, $ = id => D.getElementById(id);
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const COLORES = ["#C2347A", "#2A62D4", "#A86C06", "#6A44B3", "#BB3A26", "#1A8150", "#0E6FA6", "#8A5A00", "#0E8473"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MES_C = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/* ---------- helpers ---------- */
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d); };
const dateOf = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const mesNombre = mes => MESES[Number(mes.slice(5, 7)) - 1];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shiftMonth = (mes, k) => { const [y, m] = mes.split("-").map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const round2 = n => Math.round(n * 100) / 100;

function fmt(n, sign) {
  const neg = n < 0, a = round2(Math.abs(n));
  const cents = Math.round(a * 100) % 100 !== 0;
  let [i, d] = a.toFixed(cents ? 2 : 0).split(".");
  const coma = fam.formato === "coma";
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, coma ? "." : ",");
  const body = `${fam.moneda} ${i}${d ? (coma ? "," : ".") + d : ""}`;
  if (neg) return "−" + body;
  if (a && sign === "+") return "+" + body;
  if (a && sign === "-") return "−" + body;
  return body;
}
const signed = d => fmt(d.monto, entra(d.tipo) ? "+" : "-");
function titleOf(d) {
  if (d.tipo === "prestamo") return `Préstamo a ${d.deudor || "alguien"}${d.nota ? " · " + d.nota : ""}`;
  if (d.tipo === "cobro") return `Devolución de ${d.deudor || "alguien"}${d.nota ? " · " + d.nota : ""}`;
  return d.nota || CAT[d.categoria].nombre;
}
function dayLabel(iso) {
  if (iso === today()) return "Hoy";
  if (iso === yesterday()) return "Ayer";
  const d = dateOf(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MES_C[d.getMonth()]}`;
}
function shortDate(iso) {
  if (iso === today()) return "Hoy";
  if (iso === yesterday()) return "Ayer";
  const d = dateOf(iso);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MES_C[d.getMonth()]}${y}`;
}
const cuando = iso => iso === today() ? "hoy" : iso === yesterday() ? "ayer" : "el " + shortDate(iso);
const fechaLarga = iso => { const d = dateOf(iso); return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };

/* ---------- estado ---------- */
let user = null;               // usuario de Supabase
let fam = null;                // familia activa: { id, nombre, moneda, formato, dia_cobro, plan_hasta }
let personas = [];             // [{ id, nombre, color, apodos, es_familia, keys }]
let P = {};                    // personas por id
let familiaId = null;          // id de la persona "Familia"
let all = [];                  // todos los movimientos de la familia, normalizados
let miembros = [];             // [{ user_id, rol, nombre, email, persona_id }]
let online = new Set();        // user_id de quienes tienen la app abierta ahora
let channel = null, isAdmin = false;
const state = { mes: today().slice(0, 7), filter: null, search: "", fecha: today(), fechaManual: false, loading: true };
let docs = [], loanDocs = [], loans = [], openLoans = [], carry = 0;
let ov = {}, trayKind = null;
const inText = $("in-text"), inDate = $("in-date"), tray = $("tray");

const activo = () => !!fam && !!fam.plan_hasta && fam.plan_hasta >= today();
const writable = () => !!fam && activo();
const prefKey = () => `cuadre.sinNombre.${fam ? fam.id : ""}.${user ? user.id : ""}`;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const miPersona = () => { const m = miembros.find(x => x.user_id === (user && user.id)); return m && m.persona_id && P[m.persona_id] ? m.persona_id : null; };
const sinNombreMio = () => lsGet(prefKey()) === "mio" && !!miPersona();
const personaDefault = () => (sinNombreMio() ? miPersona() : null) || familiaId || (personas[0] && personas[0].id);

function normRow(r) {
  const tipo = ["ingreso", "prestamo", "cobro"].includes(r.tipo) ? r.tipo : "gasto";
  const cats = catsFor(tipo);
  return {
    id: r.id, tipo, monto: Math.max(0, Number(r.monto) || 0),
    persona: P[r.persona_id] ? r.persona_id : personaDefault(),
    categoria: cats.some(c => c.id === r.categoria) ? r.categoria : cats[cats.length - 1].id,
    nota: r.nota || "", fecha: r.fecha, mes: String(r.fecha).slice(0, 7),
    deudor: r.deudor || "", prestamoId: r.prestamo_id || null, cerrado: !!r.cerrado, origen: r.origen || null,
    creado: r.created_at ? new Date(r.created_at).getTime() : 0, por: r.created_by || null,
    editadoPor: r.updated_by || null, editado: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  };
}
function derive() {
  const mes = state.mes;
  docs = all.filter(d => d.mes === mes);
  carry = round2(all.reduce((t, d) => d.mes < mes ? t + (entra(d.tipo) ? d.monto : -d.monto) : t, 0));
  loanDocs = all.filter(d => isLoan(d.tipo));
  const paid = {};
  for (const d of loanDocs) if (d.tipo === "cobro" && d.prestamoId) paid[d.prestamoId] = (paid[d.prestamoId] || 0) + d.monto;
  loans = loanDocs.filter(d => d.tipo === "prestamo").map(l => {
    const pagado = round2(paid[l.id] || 0), pendiente = Math.max(0, round2(l.monto - pagado));
    return { ...l, pagado, pendiente, abierto: !l.cerrado && pendiente > 0 };
  }).sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.creado - b.creado);
  openLoans = loans.filter(l => l.abierto).map(l => ({ id: l.id, deudor: l.deudor, persona_id: l.persona, fecha: l.fecha }));
}
function upsertLocal(row) { const d = normRow(row); const i = all.findIndex(x => x.id === d.id); if (i > -1) all[i] = d; else all.push(d); }
function removeLocal(id) { all = all.filter(x => x.id !== id); }

/* ---------- pantallas ---------- */
function show(id) {
  for (const s of ["scr-loading", "scr-login", "scr-onboard", "scr-join", "scr-app"]) $(s).hidden = s !== id;
  $("composer").hidden = id !== "scr-app";
}

/* ---------- quién es quién ---------- */
const yo = () => miembros.find(m => m.user_id === (user && user.id));
function nombreDe(uid) {
  if (!uid) return "";
  const m = miembros.find(x => x.user_id === uid);
  if (!m) return "alguien que ya no está";
  if (m.persona_id && P[m.persona_id]) return P[m.persona_id].nombre;
  return (m.nombre || m.email || "alguien").split(" ")[0];
}
const varios = () => miembros.length > 1;

/* ---------- render ---------- */
function totals() {
  const t = { inn: 0, out: 0, prest: 0, cob: 0, hoy: 0, byP: {}, byPIn: {}, byC: {} };
  const hoy = today();
  for (const d of docs) {
    if (d.tipo === "ingreso") { t.inn += d.monto; t.byPIn[d.persona] = (t.byPIn[d.persona] || 0) + d.monto; }
    else if (d.tipo === "prestamo") t.prest += d.monto;
    else if (d.tipo === "cobro") t.cob += d.monto;
    else { t.out += d.monto; t.byP[d.persona] = (t.byP[d.persona] || 0) + d.monto; t.byC[d.categoria] = (t.byC[d.categoria] || 0) + d.monto; if (d.fecha === hoy) t.hoy += d.monto; }
  }
  return t;
}
function renderAll() {
  if (!fam) return;
  derive();
  const t = totals();
  renderHeader(); renderMonth(); renderBalance(t); renderLoans(); renderPeople(t); renderCats(t); renderList(); renderBanner();
}
function avatarDe(m) {
  const per = m.persona_id && P[m.persona_id];
  const nombre = per ? per.nombre : (m.nombre || m.email || "?");
  const color = per ? per.color : "#8A968F";
  return { nombre, color, ini: (nombre.trim()[0] || "?").toUpperCase(), on: m.user_id !== user.id && online.has(m.user_id) };
}
const avHTML = (a, i) => `<span class="av${a.on ? " on" : ""}" style="background:${esc(a.color)}${i != null ? `;z-index:${9 - i}` : ""}" title="${esc(a.nombre)}${a.on ? " · en línea" : ""}">${esc(a.ini)}</span>`;
const soloEnCasa = () => miembros.length <= 1;
function renderHeader() {
  $("family-line").textContent = fam.nombre;
  const ms = miembros.length ? miembros : (user ? [{ user_id: user.id, nombre: (user.user_metadata && user.user_metadata.full_name) || user.email }] : []);
  // los que están en línea primero, luego tú, máximo 4 círculos
  const orden = ms.slice().sort((a, b) => (online.has(b.user_id) && b.user_id !== user.id) - (online.has(a.user_id) && a.user_id !== user.id));
  const vis = orden.slice(0, orden.length > 4 ? 3 : 4);
  $("avatars").innerHTML = vis.map((m, i) => avHTML(avatarDe(m), i)).join("") + (orden.length > vis.length ? `<span class="av more">+${orden.length - vis.length}</span>` : "");
  const enLinea = ms.filter(m => m.user_id !== user.id && online.has(m.user_id)).map(m => avatarDe(m).nombre);
  $("btn-members").setAttribute("aria-label", `${ms.length} ${ms.length === 1 ? "persona anota" : "personas anotan"}${enLinea.length ? `; en línea: ${enLinea.join(", ")}` : ""}`);
  $("btn-invite").classList.toggle("strong", soloEnCasa());
  $("solo").hidden = !miembros.length || !soloEnCasa() || lsGet("cuadre.solo." + fam.id) === "no";
  renderInstall();
}
function renderBanner() {
  const b = $("banner");
  if (activo()) {
    const left = Math.round((dateOf(fam.plan_hasta) - dateOf(today())) / 864e5);
    if (left <= 5) { $("banner-text").textContent = `Tu plan vence ${left === 0 ? "hoy" : `en ${left} ${left === 1 ? "día" : "días"}`}. Renueva para seguir anotando.`; b.hidden = false; }
    else b.hidden = true;
  } else {
    $("banner-text").textContent = fam.plan_hasta ? `Tu plan venció el ${fechaLarga(fam.plan_hasta)}. Pueden ver todo, pero no anotar.` : `Tu familia ya está creada. Para empezar a anotar, activa tu plan: ${PLAN.precioMes} al mes o ${PLAN.precioAnio} al año.`;
    $("banner-btn").textContent = fam.plan_hasta ? "Ver cómo renovar" : "Ver cómo activar";
    b.hidden = false;
  }
}
function renderMonth() {
  const [y] = state.mes.split("-");
  $("month-label").textContent = `${mesNombre(state.mes)} ${y}`;
  $("to-today").hidden = state.mes === today().slice(0, 7);
  $("set-export").textContent = `Descargar ${mesNombre(state.mes)} en CSV`;
}
function renderBalance(t) {
  const actual = today().slice(0, 7);
  const cur = state.mes === actual, futuro = state.mes > actual, nombre = mesNombre(state.mes);
  $("eyebrow").textContent = cur ? "Les queda este mes" : futuro ? `Queda para ${nombre}` : `Quedó en ${nombre}`;
  const queda = carry + t.inn + t.cob - t.out - t.prest;
  $("queda").textContent = fmt(queda); $("queda").classList.toggle("neg", queda < 0);
  const entro = t.inn + t.cob, salio = t.out + t.prest, disponible = entro + Math.max(0, carry);
  const pct = disponible > 0 ? salio / disponible : (salio > 0 ? 1 : 0);
  $("meter").classList.toggle("hot", pct >= 0.9);
  $("meter-fill").style.width = Math.min(100, pct * 100).toFixed(1) + "%";
  $("meter-note").textContent = disponible > 0 ? `Ya salió el ${Math.round(pct * 100)}% de lo ${carry > 0 ? "disponible" : "que entró"}.` : salio > 0 ? `Todavía no hay ingresos anotados en ${nombre}.` : "Anoten lo que entra y lo que sale para ver cuánto queda.";
  $("st-in").textContent = fmt(t.inn); $("st-out").textContent = fmt(t.out);
  const partes = [], anterior = mesNombre(shiftMonth(state.mes, -1));
  if (carry > 0) partes.push(`suma ${fmt(carry)} que sobraron hasta ${anterior}`);
  if (carry < 0) partes.push(`descuenta ${fmt(-carry)} que faltaron hasta ${anterior}`);
  if (t.prest) partes.push(`descuenta ${fmt(t.prest)} prestados`);
  if (t.cob) partes.push(`suma ${fmt(t.cob)} que les devolvieron`);
  $("loanline").textContent = partes.length ? `Lo que queda ${partes.join(" y ")}.` : ""; $("loanline").hidden = !partes.length;
  if (cur) { $("st-3-label").textContent = "Hoy"; $("st-3").textContent = fmt(t.hoy); }
  else { const [y, m] = state.mes.split("-").map(Number); $("st-3-label").textContent = "Por día"; $("st-3").textContent = fmt(t.out / new Date(y, m, 0).getDate()); }
  const pd = $("perday");
  if (cur && queda > 0 && disponible > 0) {
    const now = new Date(), hoyD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let left, meta = "fin de mes";
    if (fam.dia_cobro) {
      let pago = new Date(now.getFullYear(), now.getMonth(), fam.dia_cobro);
      if (pago <= hoyD) pago = new Date(now.getFullYear(), now.getMonth() + 1, fam.dia_cobro);
      left = Math.round((pago - hoyD) / 864e5); meta = `su cobro del ${pago.getDate()}`;
    } else left = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
    pd.innerHTML = `Hasta ${esc(meta)} pueden gastar <strong>${esc(fmt(Math.floor(queda / left * 100) / 100))}</strong> por día (${left} ${left === 1 ? "día" : "días"}).`; pd.hidden = false;
  } else if (queda < 0) { pd.textContent = `Salió ${fmt(-queda)} más de lo que tenían.`; pd.hidden = false; }
  else pd.hidden = true;
}
function renderPeople(t) {
  $("people").innerHTML = personas.map(p => {
    const g = t.byP[p.id] || 0, i = t.byPIn[p.id] || 0, share = t.out > 0 ? g / t.out : 0;
    const sub = [g > 0 ? `${Math.round(share * 100)}% del gasto` : "Sin gastos", i > 0 ? `entró ${fmt(i)}` : ""].filter(Boolean).join(" · ");
    const on = !!state.filter && state.filter.k === "persona" && state.filter.id === p.id;
    return `<li><button type="button" class="row-btn" data-k="persona" data-id="${p.id}" aria-pressed="${on}"><i class="dot" style="background:${p.color}"></i><span class="row-name">${esc(p.nombre)}${p.es_familia ? ' <span class="tag">en conjunto</span>' : ""}<span class="row-sub">${esc(sub)}</span></span><span class="row-amt">${esc(fmt(g))}</span><span class="bar"><i style="width:${(share * 100).toFixed(1)}%;background:${p.color}"></i></span></button></li>`;
  }).join("");
}
function renderCats(t) {
  const list = Object.entries(t.byC).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!list.length) { $("cats").innerHTML = `<li class="muted-empty">Aún no hay gastos en ${esc(mesNombre(state.mes))}.</li>`; return; }
  $("cats").innerHTML = list.map(([id, v]) => {
    const share = t.out > 0 ? v / t.out : 0, on = !!state.filter && state.filter.k === "cat" && state.filter.id === id;
    return `<li><button type="button" class="row-btn no-dot" data-k="cat" data-id="${esc(id)}" aria-pressed="${on}"><span class="row-name">${esc(CAT[id].nombre)} <span class="tag">${Math.round(share * 100)}%</span></span><span class="row-amt">${esc(fmt(v))}</span><span class="bar"><i style="width:${(share * 100).toFixed(1)}%"></i></span></button></li>`;
  }).join("");
}
function renderLoans() {
  $("loans-block").hidden = !loans.length;
  if (!loans.length) return;
  const open = loans.filter(l => l.abierto), can = writable();
  $("loans-total").textContent = open.length ? fmt(open.reduce((s, l) => s + l.pendiente, 0)) : "";
  $("loans").innerHTML = open.length ? open.map(l => {
    const sub = `desde ${cuando(l.fecha)} · ` + (l.pagado > 0 ? `devolvió ${fmt(l.pagado)} de ${fmt(l.monto)}` : `plata de ${P[l.persona] ? P[l.persona].nombre : "la familia"}`);
    return `<li class="loan-row"><button type="button" class="row-btn no-dot" data-loan="${l.id}"><span class="row-name">${esc(l.deudor || "Sin nombre")}<span class="row-sub">${esc(sub)}</span></span><span class="row-amt loan-amt">${esc(fmt(l.pendiente))}</span></button>${can ? `<button type="button" class="btn ghost small" data-pay="${l.id}">Registrar pago</button>` : ""}</li>`;
  }).join("") : `<li class="muted-empty">Nadie les debe nada ahora.</li>`;
}
const filterName = f => f.k === "persona" ? (P[f.id] ? P[f.id].nombre : "") : CAT[f.id].nombre;
function renderList() {
  const box = $("list"), f = state.filter;
  $("filter-chip").hidden = !f;
  if (f) $("filter-label").textContent = "Solo " + filterName(f);
  let list = docs.slice();
  if (f) list = list.filter(d => f.k === "persona" ? d.persona === f.id : (d.tipo === "gasto" && d.categoria === f.id));
  if (state.search) { const q = norm(state.search); list = list.filter(d => norm(titleOf(d) + " " + CAT[d.categoria].nombre + " " + (P[d.persona] ? P[d.persona].nombre : "")).includes(q)); }
  list.sort((a, b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.creado - a.creado);
  if (!list.length) { box.innerHTML = emptyHTML(); return; }
  const groups = new Map();
  for (const d of list) { if (!groups.has(d.fecha)) groups.set(d.fecha, []); groups.get(d.fecha).push(d); }
  let html = "";
  for (const [fecha, items] of groups) {
    const out = items.reduce((s, d) => s + (entra(d.tipo) ? 0 : d.monto), 0), inn = items.reduce((s, d) => s + (entra(d.tipo) ? d.monto : 0), 0);
    const tot = [inn ? fmt(inn, "+") : "", out ? fmt(out, "-") : ""].filter(Boolean).join("  ·  ");
    html += `<div class="day"><div class="day-head"><span class="day-name">${esc(dayLabel(fecha))}</span><span class="day-tot">${esc(tot)}</span></div><div class="day-list">${items.map(movHTML).join("")}</div></div>`;
  }
  box.innerHTML = html;
}
function movHTML(d) {
  const p = P[d.persona] || { color: "var(--muted)", nombre: "—" }, c = CAT[d.categoria];
  let estado = "";
  if (d.tipo === "prestamo") { const l = loans.find(x => x.id === d.id); if (l) estado = l.pendiente <= 0 ? `<span class="pill ok">pagado</span>` : l.cerrado ? `<span class="pill">cerrado</span>` : `<span>debe ${esc(fmt(l.pendiente))}</span>`; }
  const cls = entra(d.tipo) ? " in" : d.tipo === "prestamo" ? " loan" : "";
  return `<button type="button" class="mov" data-id="${d.id}"><i class="dot" style="background:${p.color}"></i><span class="mov-main"><span class="mov-title">${esc(titleOf(d))}</span><span class="mov-meta"><span>${esc(c.nombre)}</span><span aria-hidden="true">·</span><span>${esc(p.nombre)}</span>${estado ? `<span aria-hidden="true">·</span>${estado}` : ""}${varios() && d.por ? `<span aria-hidden="true">·</span><span class="who">por ${esc(nombreDe(d.por))}</span>` : ""}</span></span><span class="mov-amt${cls}">${esc(signed(d))}</span></button>`;
}
function emptyHTML() {
  const nombre = mesNombre(state.mes);
  if (state.loading) return `<div class="empty"><p class="empty-title">Cargando ${esc(nombre)}…</p></div>`;
  if (state.search) return `<div class="empty"><p>Nada coincide con «${esc(state.search)}» en ${esc(nombre)}.</p></div>`;
  if (state.filter) return `<div class="empty"><p>No hay movimientos de ${esc(filterName(state.filter))} en ${esc(nombre)}.</p></div>`;
  const ej = personas.filter(p => !p.es_familia).map(p => norm(p.nombre).split(" ")[0]);
  return `<div class="empty"><p class="empty-title">${esc(nombre.charAt(0).toUpperCase() + nombre.slice(1))} está en blanco</p>
    <p>Anoten en la barra de abajo, igual que en el chat: qué fue, cuánto y para quién. Con un + delante es un ingreso. Toca un ejemplo:</p>
    <div class="bubbles">${[`+3500 sueldo ${ej[0] || ""}`, "mercado 120 familia", `taxi 15 ${ej[1] || ej[0] || ""}`, "presté 200 a Rosa"].map(s => `<button type="button" class="bubble" data-ex="${esc(s.trim())}">${esc(s.trim())}</button>`).join("")}</div>
    <p>¿Ya tienen gastos anotados en WhatsApp? <button type="button" class="link-btn" data-import>Importa el chat</button></p></div>`;
}

/* ---------- composer ---------- */
function build(text, conCat) {
  const p = parse(text, { tipo: ov.tipo, personas, loans: openLoans });
  const categoria = conCat && ov.categoria && catsFor(p.tipo).some(c => c.id === ov.categoria) ? ov.categoria : p.categoria;
  return { ...p, categoria, fecha: p.fecha || state.fecha, persona: p.persona || ov.persona || personaDefault(), personaSoft: !ov.persona && !p.persona, catSoft: !(conCat && ov.categoria) && !p.catFound };
}
function current() {
  const c = build(inText.value, true);
  if (ov.persona) { c.persona = ov.persona; c.personaSoft = false; }
  return c;
}
// Varios en un mensaje: «taxi 10, almuerzo 18, pan 5» (coma con espacio, punto y coma o salto de línea).
// La coma pegada a números (1,250.50 o 12,50) no separa.
function multi() {
  const partes = inText.value.split(/\s*(?:;|\n|,(?=\s))\s*/).map(t => t.trim()).filter(Boolean);
  if (partes.length < 2) return null;
  const items = partes.map(t => build(t, false));
  return items.every(c => c.monto) ? items : null;
}
const rowOf = c => ({ family_id: fam.id, tipo: c.tipo, monto: c.monto, persona_id: c.persona, categoria: c.categoria, nota: isLoan(c.tipo) ? c.nota : (c.nota || CAT[c.categoria].nombre), fecha: c.fecha, deudor: isLoan(c.tipo) ? c.deudor : "", prestamo_id: c.tipo === "cobro" ? c.prestamoId : null, created_by: user.id });
// Lo que más anotan (últimos 60 días); si aún no hay nada, unos ejemplos comunes
function frecuentes() {
  const desde = isoOf(new Date(Date.now() - 60 * 864e5)), cuenta = new Map();
  for (const d of all) {
    if (d.tipo !== "gasto" || d.fecha < desde) continue;
    const n = norm(d.nota || "").replace(/[^a-zñ ]/g, "").trim();
    if (!n || n.length > 18 || n === "otros") continue;
    cuenta.set(n, (cuenta.get(n) || 0) + 1);
  }
  const top = [...cuenta].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 6);
  for (const n of ["mercado", "almuerzo", "pasaje", "taxi", "luz", "internet"]) { if (top.length >= 6) break; if (!top.includes(n)) top.push(n); }
  return top;
}
function renderSugs() {
  const box = $("sugs"), on = writable() && !inText.value.trim() && !trayKind;
  box.hidden = !on;
  if (on) box.innerHTML = frecuentes().map(n => `<button type="button" class="sug" data-sug="${esc(n)}">${esc(n)}</button>`).join("");
}
$("sugs").addEventListener("click", e => { const b = e.target.closest("[data-sug]"); if (!b) return; inText.value = b.dataset.sug + " "; updateComposer(); inText.focus(); try { inText.setSelectionRange(inText.value.length, inText.value.length); } catch { /* */ } });
const TIPO_LABEL = { gasto: "Gasto", ingreso: "Ingreso", prestamo: "Préstamo", cobro: "Devolución" };
const listo = c => !!c.monto && (c.tipo !== "prestamo" || !!c.deudor);
function updateComposer() {
  if (!fam) return;
  renderSugs();
  const ms = multi(), mbox = $("multi");
  $("composer").querySelector(".chips").classList.toggle("multi-mode", !!ms);
  mbox.hidden = !ms;
  if (ms) {
    if (trayKind === "categoria") closeTray();
    const neto = ms.reduce((t, c) => t + (entra(c.tipo) ? c.monto : -c.monto), 0);
    mbox.innerHTML = `<div class="mhead">${ms.length} movimientos</div>` + ms.map(c => {
      const per = P[c.persona] || { nombre: "—" }, bad = !listo(c);
      const sub = c.tipo === "prestamo" ? (c.deudor ? `préstamo a ${c.deudor}` : "¿a quién?") : c.tipo === "cobro" ? `devolución de ${c.deudor}` : CAT[c.categoria].nombre;
      return `<div class="mrow${bad ? " bad" : ""}"><span class="t">${esc(c.nota || sub)}</span><span class="s">${esc(sub)} · ${esc(per.nombre)}</span><span class="a${entra(c.tipo) ? " in" : ""}">${esc(fmt(c.monto, entra(c.tipo) ? "+" : "-"))}</span></div>`;
    }).join("");
    const per0 = P[ov.persona || personaDefault()] || { color: "var(--muted)", nombre: "—" };
    $("chip-persona-dot").style.background = per0.color; $("chip-persona-name").textContent = per0.nombre; $("chip-persona").classList.toggle("soft", !ov.persona);
    $("date-label").textContent = shortDate(state.fecha); if (inDate.value !== state.fecha) inDate.value = state.fecha;
    $("chip-date").classList.toggle("away", state.fecha !== today());
    $("send-amt").textContent = fmt(Math.abs(neto), neto >= 0 ? "+" : "-");
    $("send").classList.add("has-amt");
    $("send").disabled = !(writable() && ms.every(listo));
    $("send").setAttribute("aria-label", `Anotar ${ms.length} movimientos`);
    if (trayKind) fillTray();
    return;
  }
  $("send").setAttribute("aria-label", "Anotar");
  const c = current(), per = P[c.persona] || { color: "var(--muted)", nombre: "—" };
  const tipoChip = $("chip-tipo");
  tipoChip.textContent = TIPO_LABEL[c.tipo]; tipoChip.classList.toggle("in", entra(c.tipo)); tipoChip.classList.toggle("loan", c.tipo === "prestamo");
  $("chip-persona-dot").style.background = per.color; $("chip-persona-name").textContent = per.nombre; $("chip-persona").classList.toggle("soft", c.personaSoft);
  const loanish = isLoan(c.tipo);
  $("chip-cat-name").textContent = c.tipo === "prestamo" ? (c.deudor ? `a ${c.deudor}` : "¿a quién?") : c.tipo === "cobro" ? `de ${c.deudor}` : CAT[c.categoria].nombre;
  $("chip-cat").classList.toggle("soft", loanish ? !c.deudor : c.catSoft);
  $("chip-cat").querySelector(".caret").hidden = loanish;
  if (loanish && trayKind === "categoria") closeTray();
  $("date-label").textContent = shortDate(c.fecha);
  if (inDate.value !== c.fecha) inDate.value = c.fecha;
  $("chip-date").classList.toggle("away", c.fecha !== today());
  $("send-amt").textContent = c.monto ? fmt(c.monto, entra(c.tipo) ? "+" : "-") : "";
  $("send").classList.toggle("has-amt", !!c.monto);
  $("send").disabled = !(writable() && listo(c));
  inText.disabled = !writable();
  inText.placeholder = writable() ? "Ej: mercado 120 familia" : fam.plan_hasta ? "Renueva el plan para seguir anotando" : "Activa tu plan para empezar a anotar";
  if (trayKind) fillTray();
}
function hint(msg, isErr) { const h = $("hint"); h.textContent = msg; h.classList.toggle("err", !!isErr); h.hidden = !msg; }
function fillTray() {
  const c = current();
  const opts = trayKind === "persona" ? personas.map(p => ({ id: p.id, label: p.nombre, color: p.color, on: c.persona === p.id })) : catsFor(c.tipo).map(x => ({ id: x.id, label: x.nombre, on: c.categoria === x.id }));
  tray.innerHTML = opts.map(o => `<button type="button" class="chip" data-id="${o.id}" aria-pressed="${o.on}">${o.color ? `<i class="dot" style="background:${o.color}"></i>` : ""}${esc(o.label)}</button>`).join("");
}
function openTray(kind) { if (trayKind === kind) return closeTray(); trayKind = kind; fillTray(); tray.hidden = false; $("chip-persona").setAttribute("aria-expanded", String(kind === "persona")); $("chip-cat").setAttribute("aria-expanded", String(kind === "categoria")); }
function closeTray() { trayKind = null; tray.hidden = true; tray.innerHTML = ""; $("chip-persona").setAttribute("aria-expanded", "false"); $("chip-cat").setAttribute("aria-expanded", "false"); }
$("composer").addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); });
$("chip-tipo").addEventListener("click", () => { const tipo = { gasto: "ingreso", ingreso: "prestamo", prestamo: "gasto", cobro: "ingreso" }[current().tipo]; ov.tipo = tipo; if (ov.categoria && !catsFor(tipo).some(c => c.id === ov.categoria)) delete ov.categoria; closeTray(); updateComposer(); });
$("chip-persona").addEventListener("click", () => openTray("persona"));
$("chip-cat").addEventListener("click", () => { const c = current(); if (c.tipo === "prestamo") { closeTray(); hint("Escribe el nombre en el mensaje, por ejemplo: presté 200 a Rosa"); return; } if (c.tipo === "cobro") { closeTray(); hint(`Se resta de lo que debe ${c.deudor}.`); return; } openTray("categoria"); });
tray.addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (!b || !trayKind) return; ov[trayKind] = b.dataset.id; closeTray(); updateComposer(); });
inDate.addEventListener("change", () => { state.fecha = inDate.value || today(); state.fechaManual = state.fecha !== today(); updateComposer(); });
inText.addEventListener("input", () => { if (!inText.value.trim()) ov = {}; if (!$("hint").classList.contains("err") || inText.value) hint(""); updateComposer(); });
inText.addEventListener("keydown", e => {
  if (e.key === "Escape") closeTray();
  if (e.key === "Enter" && $("send").disabled && inText.value.trim()) {
    e.preventDefault(); const ms = multi();
    if (ms) { hint(writable() ? "En un préstamo falta a quién. Por ejemplo: presté 200 a Rosa" : "Renueva el plan para seguir anotando.", true); return; }
    const c = current();
    if (!writable()) hint("Renueva el plan para seguir anotando.", true);
    else if (!c.monto) hint("Falta el monto. Por ejemplo: taxi 15", true);
    else if (c.tipo === "prestamo" && !c.deudor) hint("¿A quién le prestaron? Por ejemplo: presté 200 a Rosa", true);
  }
});
async function anotarVarios(ms) {
  if (!writable() || !ms.every(listo)) return;
  // la persona elegida en el chip aplica a los que no dicen para quién
  const rows = ms.map(rowOf);
  const prevText = inText.value, prevOv = ov;
  inText.value = ""; ov = {}; hint(""); updateComposer();
  const { data, error } = await sb.from("movimientos").insert(rows).select();
  if (error) { inText.value = prevText; ov = prevOv; updateComposer(); return writeError(error); }
  (data || []).forEach(upsertLocal); renderAll();
  const ids = (data || []).map(d => d.id), neto = ms.reduce((t, c) => t + (entra(c.tipo) ? c.monto : -c.monto), 0);
  toast(`Anotados ${ids.length} movimientos (${fmt(Math.abs(neto), neto >= 0 ? "+" : "-")})`, { label: "Deshacer", run: async () => { const { error } = await sb.from("movimientos").delete().in("id", ids); if (error) return writeError(error); ids.forEach(removeLocal); renderAll(); toast(`Se borraron ${ids.length} movimientos.`); } });
}
$("composer").addEventListener("submit", async e => {
  e.preventDefault(); closeTray();
  const ms = multi(); if (ms) return anotarVarios(ms);
  const c = current();
  if (!c.monto) { if (inText.value.trim()) hint("Falta el monto. Por ejemplo: taxi 15", true); return; }
  if (c.tipo === "prestamo" && !c.deudor) { hint("¿A quién le prestaron? Por ejemplo: presté 200 a Rosa", true); return; }
  if (!writable()) return;
  const row = rowOf(c);
  const prevText = inText.value, prevOv = ov;
  inText.value = ""; ov = {}; hint(""); updateComposer();
  const { data, error } = await sb.from("movimientos").insert(row).select().single();
  if (error) { inText.value = prevText; ov = prevOv; updateComposer(); return writeError(error); }
  upsertLocal(data); renderAll();
  const d = normRow(data), otroMes = d.mes !== state.mes ? ` en ${mesNombre(d.mes)}` : "";
  toast(`Anotado${otroMes}: ${titleOf(d)} ${signed(d)}`, { label: "Deshacer", run: async () => { const { error } = await sb.from("movimientos").delete().eq("id", d.id); if (error) return writeError(error); removeLocal(d.id); renderAll(); toast("Movimiento borrado."); } });
});

/* ---------- feedback ---------- */
let toastT = 0;
function toast(msg, action) {
  const t = $("toast"); t.replaceChildren();
  const span = D.createElement("span"); span.textContent = msg; t.append(span);
  if (action) { const b = D.createElement("button"); b.type = "button"; b.textContent = action.label; b.addEventListener("click", () => { t.hidden = true; action.run(); }); t.append(b); }
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 6000 : 4000);
}
function writeError(err) {
  const msg = (err && err.message) || "";
  if (/row-level security|violates/.test(msg)) { refreshFamily(); toast(activo() ? "No tienes permiso para hacer eso." : "El plan está vencido: pueden ver, pero no anotar."); }
  else if (/Failed to fetch|NetworkError/.test(msg)) toast("Sin conexión. Revisa tu internet y vuelve a intentar.");
  else toast("No se pudo guardar: " + (msg || "error desconocido"));
}

/* ---------- filtros + lista ---------- */
function toggleFilter(k, id) { const f = state.filter; state.filter = f && f.k === k && f.id === id ? null : { k, id }; renderAll(); if (state.filter && window.matchMedia("(max-width: 879px)").matches) $("list").scrollIntoView({ behavior: "smooth", block: "start" }); }
$("people").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) toggleFilter("persona", b.dataset.id); });
$("cats").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) toggleFilter("cat", b.dataset.id); });
$("filter-chip").addEventListener("click", () => { state.filter = null; renderAll(); });
$("search").addEventListener("input", e => { state.search = e.target.value.trim(); renderList(); });
$("list").addEventListener("click", e => {
  if (e.target.closest("[data-import]")) { renderImport(); openSheet("imp-wrap"); return; }
  const ex = e.target.closest("[data-ex]"); if (ex) { inText.value = ex.dataset.ex; ov = {}; updateComposer(); inText.focus(); return; }
  const m = e.target.closest(".mov[data-id]"); if (m) openEdit(m.dataset.id);
});
function goMonth(mes) { state.mes = mes; state.filter = null; state.search = ""; $("search").value = ""; renderAll(); }
$("prev").addEventListener("click", () => goMonth(shiftMonth(state.mes, -1)));
$("next").addEventListener("click", () => goMonth(shiftMonth(state.mes, 1)));
$("to-today").addEventListener("click", () => goMonth(today().slice(0, 7)));
$("banner-btn").addEventListener("click", () => { syncSettingsForm(); openSheet("set-wrap"); });

/* ---------- hojas ---------- */
let lastFocus = null;
function openSheet(id) { lastFocus = D.activeElement; closeTray(); $(id).hidden = false; $(id).querySelector("h2").focus({ preventScroll: true }); }
function closeSheet(id) { $(id).hidden = true; if (lastFocus && lastFocus.focus && lastFocus !== inText) lastFocus.focus({ preventScroll: true }); }
D.querySelectorAll(".sheet-wrap").forEach(wrap => wrap.addEventListener("click", e => { if (e.target === wrap || e.target.closest("[data-close]")) closeSheet(wrap.id); }));
D.addEventListener("keydown", e => { if (e.key !== "Escape") return; const open = [...D.querySelectorAll(".sheet-wrap")].find(s => !s.hidden); if (open) closeSheet(open.id); else closeTray(); });
const segSet = (el, v) => el.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
const segGet = el => { const b = el.querySelector('button[aria-pressed="true"]'); return b ? b.dataset.v : null; };

/* editar */
let editing = null, delArmed = false;
function fillCatSelect(tipo, sel) { const cats = catsFor(tipo); $("ed-cat").innerHTML = cats.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join(""); $("ed-cat").value = cats.some(c => c.id === sel) ? sel : cats[cats.length - 1].id; }
function applyEdTipo(tipo, cat) {
  const loanish = isLoan(tipo);
  $("ed-tipo").hidden = tipo === "cobro"; segSet($("ed-tipo"), tipo);
  $("ed-deudor-wrap").hidden = tipo !== "prestamo"; $("ed-cat-wrap").hidden = loanish;
  $("ed-cerrado-wrap").hidden = tipo !== "prestamo" || !editing || editing.tipo !== "prestamo";
  $("ed-nota-label").textContent = loanish ? "Nota (opcional)" : "Descripción";
  $("ed-persona-label").textContent = { gasto: "Para quién", ingreso: "De quién", prestamo: "De quién era la plata", cobro: "Para quién" }[tipo];
  fillCatSelect(tipo, cat);
}
function openEdit(id) {
  const d = all.find(x => x.id === id); if (!d) return;
  editing = d; delArmed = false;
  $("ed-persona").innerHTML = personas.map(p => `<button type="button" data-v="${p.id}"><i class="dot" style="background:${p.color}"></i>${esc(p.nombre)}</button>`).join("");
  $("edit-title").textContent = d.tipo === "cobro" ? `Devolución de ${d.deudor || "alguien"}` : d.tipo === "prestamo" ? "Editar préstamo" : "Editar movimiento";
  applyEdTipo(d.tipo, d.categoria);
  $("ed-monto").value = fam.formato === "coma" ? String(d.monto).replace(".", ",") : String(d.monto);
  $("ed-nota").value = d.nota || ""; $("ed-deudor").value = d.deudor || ""; $("ed-cerrado").checked = !!d.cerrado;
  segSet($("ed-persona"), d.persona); $("ed-fecha").value = d.fecha; $("ed-err").hidden = true;
  const del = $("ed-del"); del.textContent = "Eliminar"; del.classList.remove("armed");
  del.disabled = !writable(); $("ed-save").disabled = !writable();
  const l = d.tipo === "prestamo" && loans.find(x => x.id === d.id);
  $("ed-meta").textContent = (d.creado ? `Anotado ${cuando(isoOf(new Date(d.creado)))}` : "Anotado") + (d.por ? ` por ${nombreDe(d.por)}` : "") + (d.editado && d.editadoPor ? ` · editado por ${nombreDe(d.editadoPor)} ${cuando(isoOf(new Date(d.editado)))}` : "") + (d.origen === "whatsapp" ? " · importado del chat" : d.origen === "respaldo" ? " · restaurado" : "") + (l && l.pagado > 0 ? ` · ya devolvió ${fmt(l.pagado)}, debe ${fmt(l.pendiente)}` : "");
  openSheet("edit-wrap");
}
$("ed-tipo").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (b) applyEdTipo(b.dataset.v, $("ed-cat").value); });
$("ed-persona").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (b) segSet($("ed-persona"), b.dataset.v); });
$("ed-save").addEventListener("click", async () => {
  if (!editing || !writable()) return;
  const monto = parseNum($("ed-monto").value), err = $("ed-err");
  if (!(monto > 0)) { err.textContent = "Escribe un monto mayor que cero."; err.hidden = false; return; }
  const tipo = editing.tipo === "cobro" ? "cobro" : (segGet($("ed-tipo")) || editing.tipo);
  const deudor = $("ed-deudor").value.trim().slice(0, 60);
  if (tipo === "prestamo" && !deudor) { err.textContent = "Escribe a quién le prestaron."; err.hidden = false; return; }
  const categoria = $("ed-cat").value, fecha = /^\d{4}-\d{2}-\d{2}$/.test($("ed-fecha").value) ? $("ed-fecha").value : editing.fecha, notaIn = $("ed-nota").value.trim();
  const patch = { tipo, monto: round2(monto), persona_id: segGet($("ed-persona")) || editing.persona, categoria, nota: isLoan(tipo) ? notaIn : (notaIn || CAT[categoria].nombre), fecha, deudor: tipo === "prestamo" ? deudor : tipo === "cobro" ? editing.deudor : "", cerrado: tipo === "prestamo" && editing.tipo === "prestamo" ? $("ed-cerrado").checked : false, prestamo_id: tipo === "cobro" ? editing.prestamoId : null };
  $("ed-save").disabled = true;
  const { data, error } = await sb.from("movimientos").update(patch).eq("id", editing.id).select().single();
  $("ed-save").disabled = !writable();
  if (error) return writeError(error);
  upsertLocal(data); renderAll(); closeSheet("edit-wrap");
  toast(data.fecha.slice(0, 7) !== state.mes ? `Guardado y movido a ${mesNombre(data.fecha.slice(0, 7))}.` : "Cambios guardados.");
});
$("ed-del").addEventListener("click", async () => {
  if (!editing || !writable()) return;
  const del = $("ed-del");
  if (!delArmed) { delArmed = true; del.textContent = "Toca otra vez para eliminar"; del.classList.add("armed"); return; }
  del.disabled = true;
  const { error } = await sb.from("movimientos").delete().eq("id", editing.id);
  del.disabled = !writable();
  if (error) return writeError(error);
  removeLocal(editing.id); renderAll(); closeSheet("edit-wrap"); toast("Movimiento eliminado.");
});

/* préstamos: registrar pago */
let paying = null;
function openPay(id) {
  const l = loans.find(x => x.id === id); if (!l) return;
  paying = l;
  $("pay-title").textContent = `Pago de ${l.deudor || "alguien"}`;
  $("pay-meta").textContent = `Debe ${fmt(l.pendiente)} de ${fmt(l.monto)} que le prestaron ${cuando(l.fecha)}.`;
  $("pay-monto").value = fam.formato === "coma" ? String(l.pendiente).replace(".", ",") : String(l.pendiente);
  $("pay-fecha").value = today(); $("pay-err").hidden = true; $("pay-save").disabled = !writable();
  openSheet("pay-wrap");
}
$("loans").addEventListener("click", e => { const pay = e.target.closest("[data-pay]"); if (pay) return openPay(pay.dataset.pay); const l = e.target.closest("[data-loan]"); if (l) openEdit(l.dataset.loan); });
$("pay-save").addEventListener("click", async () => {
  if (!paying || !writable()) return;
  const monto = round2(parseNum($("pay-monto").value)), err = $("pay-err");
  if (!(monto > 0)) { err.textContent = "Escribe un monto mayor que cero."; err.hidden = false; return; }
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test($("pay-fecha").value) ? $("pay-fecha").value : today();
  $("pay-save").disabled = true;
  const { data, error } = await sb.from("movimientos").insert({ family_id: fam.id, tipo: "cobro", monto, persona_id: paying.persona, categoria: "cobro", nota: "", deudor: paying.deudor || "", prestamo_id: paying.id, fecha, created_by: user.id }).select().single();
  $("pay-save").disabled = !writable();
  if (error) return writeError(error);
  upsertLocal(data); renderAll(); closeSheet("pay-wrap");
  const resta = round2(paying.pendiente - monto);
  toast(resta > 0 ? `Pago guardado. ${paying.deudor} todavía debe ${fmt(resta)}.` : `Pago guardado. ${paying.deudor} ya no debe nada.`);
});

/* ---------- ajustes ---------- */
function syncSettingsForm() {
  if (!fam) return;
  const m = $("set-moneda"); if (D.activeElement !== m) m.value = fam.moneda;
  segSet($("set-formato"), fam.formato);
  const dc = $("set-cobro"); if (D.activeElement !== dc) dc.value = fam.dia_cobro ? String(fam.dia_cobro) : "";
  $("set-personas").innerHTML = personas.map(p => `<li><i class="dot" style="background:${p.color};width:12px;height:12px"></i><span class="nm">${esc(p.nombre)}<span class="sub">${p.es_familia ? "Gastos en conjunto" : (p.apodos && p.apodos.length ? "También: " + esc(p.apodos.join(", ")) : "Sin apodos")}</span></span><button type="button" class="btn ghost small" data-per="${p.id}">Editar</button></li>`).join("");
  renderMiembros();
  renderSoy($("set-soy"));
  segSet($("set-sinnombre"), sinNombreMio() ? "mio" : "familia");
  $("set-sinnombre").querySelector('[data-v="mio"]').disabled = !miPersona();
  $("sinnombre-note").textContent = miPersona() ? "Solo cambia en este celular. Igual puedes escribir el nombre: «taxi 15 bri»." : "Para elegir «Mío», primero dinos quién eres aquí arriba.";
  $("set-cuenta").textContent = `Entraste como ${user.email}. Familia: ${fam.nombre}.`;
  $("set-admin").hidden = !isAdmin;
  const pn = $("plan-note");
  if (activo()) { $("plan-title").textContent = "Plan activo"; $("plan-text").textContent = `Pueden anotar hasta el ${fechaLarga(fam.plan_hasta)}. Después, ${PLAN.precioMes} al mes o ${PLAN.precioAnio} al año.`; }
  else if (!fam.plan_hasta) { $("plan-title").textContent = "Plan por activar"; $("plan-text").textContent = `Para empezar a anotar, activa tu plan: ${PLAN.precioMes} al mes o ${PLAN.precioAnio} al año.`; }
  else { $("plan-title").textContent = "Plan vencido"; $("plan-text").textContent = `Venció el ${fechaLarga(fam.plan_hasta)}. Pueden ver todo, pero no anotar hasta renovar: ${PLAN.precioMes} al mes o ${PLAN.precioAnio} al año.`; }
  $("plan-pay").hidden = false; $("plan-instr").textContent = PLAN.instrucciones;
  $("plan-wa").href = `https://wa.me/${PLAN.whatsapp}?text=${encodeURIComponent(`Hola, pagué Cuadre para la familia "${fam.nombre}". Mi correo es ${user.email}.`)}`;
  pn.hidden = false;
}
let cfgT = 0;
function saveCfg(delay) {
  renderAll(); updateComposer(); clearTimeout(cfgT);
  cfgT = setTimeout(async () => { const { error } = await sb.from("families").update({ moneda: fam.moneda, formato: fam.formato, dia_cobro: fam.dia_cobro }).eq("id", fam.id); if (error) writeError(error); }, delay || 0);
}
$("btn-settings").addEventListener("click", () => { syncSettingsForm(); openSheet("set-wrap"); });
$("set-cobro").addEventListener("change", e => { const n = parseInt(e.target.value, 10); fam.dia_cobro = n >= 1 && n <= 31 ? n : 0; saveCfg(); });
$("set-moneda").addEventListener("input", e => { const v = e.target.value.trim(); if (v) { fam.moneda = v.slice(0, 5); saveCfg(700); } });
$("set-wrap").addEventListener("click", e => {
  const q = e.target.closest("[data-m]"); if (q) { fam.moneda = q.dataset.m; $("set-moneda").value = fam.moneda; saveCfg(); }
  const f = e.target.closest("#set-formato button[data-v]"); if (f) { fam.formato = f.dataset.v; segSet($("set-formato"), fam.formato); saveCfg(); }
  const per = e.target.closest("[data-per]"); if (per) openPersona(per.dataset.per);
});
$("set-logout").addEventListener("click", async () => { await sb.auth.signOut(); location.href = location.pathname; });
$("ob-logout").addEventListener("click", async () => { await sb.auth.signOut(); location.href = location.pathname; });

/* personas */
let perEditing = null, perColor = COLORES[0];
function openPersona(id) {
  perEditing = id ? personas.find(p => p.id === id) : null;
  perColor = perEditing ? perEditing.color : COLORES[personas.length % COLORES.length];
  $("per-title").textContent = perEditing ? "Editar persona" : "Nueva persona";
  $("per-nombre").value = perEditing ? perEditing.nombre : ""; $("per-apodos").value = perEditing ? (perEditing.apodos || []).join(", ") : "";
  $("per-nombre").disabled = !!(perEditing && perEditing.es_familia);
  $("per-del").hidden = !perEditing || perEditing.es_familia; $("per-err").hidden = true;
  $("per-colores").innerHTML = COLORES.map(c => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-pressed="${c === perColor}" aria-label="Color"></button>`).join("");
  openSheet("per-wrap");
}
$("set-add-persona").addEventListener("click", () => openPersona(null));
$("per-colores").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; perColor = b.dataset.c; $("per-colores").querySelectorAll(".swatch").forEach(s => s.setAttribute("aria-pressed", String(s.dataset.c === perColor))); });
$("per-save").addEventListener("click", async () => {
  const nombre = $("per-nombre").value.trim().slice(0, 30), apodos = $("per-apodos").value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 8);
  if (!nombre) { $("per-err").textContent = "Escribe un nombre."; $("per-err").hidden = false; return; }
  const row = { family_id: fam.id, nombre, apodos, color: perColor };
  const q = perEditing ? sb.from("personas").update(row).eq("id", perEditing.id) : sb.from("personas").insert({ ...row, orden: personas.length });
  const { error } = await q;
  if (error) return writeError(error);
  await loadPersonas(); renderAll(); updateComposer(); syncSettingsForm(); closeSheet("per-wrap"); toast(perEditing ? "Persona guardada." : `${nombre} ya puede aparecer en los mensajes.`);
});
$("per-del").addEventListener("click", async () => {
  if (!perEditing || perEditing.es_familia) return;
  const n = all.filter(d => d.persona === perEditing.id).length;
  if (n && !D.getElementById("per-del").dataset.armed) { $("per-del").dataset.armed = "1"; $("per-del").textContent = `Tiene ${n} movimientos. ¿Quitar igual? Pasarán a Familia`; return; }
  if (n && familiaId) await sb.from("movimientos").update({ persona_id: familiaId }).eq("persona_id", perEditing.id);
  const { error } = await sb.from("personas").delete().eq("id", perEditing.id);
  delete $("per-del").dataset.armed; $("per-del").textContent = "Quitar";
  if (error) return writeError(error);
  await loadPersonas(); await loadMovs(); renderAll(); updateComposer(); syncSettingsForm(); closeSheet("per-wrap"); toast("Persona quitada.");
});

/* miembros */
function renderMiembros() {
  const soyDueno = yo() && yo().rol === "dueno";
  $("set-miembros").innerHTML = miembros.map(m => {
    const per = m.persona_id && P[m.persona_id];
    const yoMismo = m.user_id === user.id;
    const accion = yoMismo ? (miembros.length > 1 ? `<button type="button" class="btn ghost small" data-salir>Salir</button>` : "")
      : soyDueno ? `<button type="button" class="btn ghost small" data-quitar="${m.user_id}">Quitar</button>` : "";
    return `<li>${per ? `<i class="dot" style="background:${per.color};width:12px;height:12px"></i>` : ""}<span class="nm">${esc(per ? per.nombre : (m.nombre || m.email))}${yoMismo ? " (tú)" : ""}<span class="sub">${esc(m.email || "")}${online.has(m.user_id) && !yoMismo ? " · en línea ahora" : ""}</span></span>${m.rol === "dueno" ? '<span class="tagrol">Creó la familia</span>' : ""}${accion}</li>`;
  }).join("");
}
function renderSoy(box) {
  const mine = yo() ? yo().persona_id : null;
  const tomadas = new Set(miembros.filter(m => m.user_id !== user.id && m.persona_id).map(m => m.persona_id));
  box.innerHTML = personas.filter(p => !p.es_familia).map(p => `<button type="button" data-soy="${p.id}" aria-pressed="${p.id === mine}"${tomadas.has(p.id) ? ' title="Ya la eligió otra cuenta"' : ""}><i class="dot" style="background:${p.color}"></i>${esc(p.nombre)}</button>`).join("");
}
async function elegirSoy(pid) {
  const { error } = await sb.rpc("soy", { fid: fam.id, p_persona: pid });
  if (error) return writeError(error);
  await loadMiembros(); renderAll(); syncSettingsForm();
  toast(`Listo, eres ${P[pid].nombre}.`);
}
$("set-sinnombre").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]"); if (!b || b.disabled) return;
  lsSet(prefKey(), b.dataset.v === "mio" ? "mio" : null); segSet($("set-sinnombre"), b.dataset.v); updateComposer();
  toast(b.dataset.v === "mio" ? `Lo que anotes sin nombre irá para ${P[miPersona()].nombre}.` : "Lo que anotes sin nombre irá para la familia.");
});
$("set-soy").addEventListener("click", e => { const b = e.target.closest("[data-soy]"); if (b) elegirSoy(b.dataset.soy); });
$("soy-opts").addEventListener("click", async e => { const b = e.target.closest("[data-soy]"); if (!b) return; await elegirSoy(b.dataset.soy); closeSheet("soy-wrap"); });
$("set-miembros").addEventListener("click", async e => {
  const q = e.target.closest("[data-quitar]"), s2 = e.target.closest("[data-salir]");
  const btn = q || s2; if (!btn) return;
  if (!btn.dataset.armed) { btn.dataset.armed = "1"; btn.textContent = q ? "¿Seguro? Toca otra vez" : "¿Salir? Toca otra vez"; btn.classList.add("danger"); return; }
  const uid = q ? q.dataset.quitar : user.id;
  const { error } = await sb.rpc("quitar_miembro", { fid: fam.id, uid });
  if (error) return writeError(error);
  if (s2) { localStorage.removeItem("cuadre.fam"); location.href = location.pathname; return; }
  await loadMiembros(); syncSettingsForm(); toast("Ya no es parte de la familia. Sus movimientos se quedan.");
});

/* acceso directo: agregar a la pantalla de inicio */
let installEvt = null;
const UA = navigator.userAgent;
const esStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const esIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const esAndroid = /Android/.test(UA);
const enAppAjena = /FBAN|FBAV|Instagram|Line\/|WhatsApp|TikTok|musical_ly|; wv\)/.test(UA);
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; renderInstall(); });
addEventListener("appinstalled", () => { installEvt = null; lsSet("cuadre.inst", "ok"); renderInstall(); toast("¡Listo! Cuadre ya está en tu pantalla de inicio."); });
function renderInstall() {
  const puede = !esStandalone() && lsGet("cuadre.inst") !== "ok";
  $("set-install").hidden = !puede;
  // una tarjeta a la vez: primero «Anoten juntos», luego esta
  $("inst").hidden = !puede || !fam || lsGet("cuadre.inst") === "no" || !$("solo").hidden;
}
function pasosInstalar() {
  const k = t => `<span class="k">${t}</span>`;
  if (enAppAjena) return { sub: "Estás dentro de otra app (WhatsApp, Facebook…). Primero ábrela en tu navegador:", pasos: [`Toca ${k("⋮")} o ${k("···")} arriba`, `Elige ${k(esIOS ? "Abrir en Safari" : "Abrir en Chrome")}`, `Vuelve a tocar ${k("📲 Agregar")} en Cuadre`] };
  if (esIOS) return { sub: "En iPhone se hace desde el botón Compartir:", pasos: [`Toca ${k("Compartir ⬆")} (abajo en Safari, arriba en Chrome)`, `Baja y toca ${k("Agregar a inicio")}`, `Toca ${k("Agregar")} arriba a la derecha`] };
  if (esAndroid) return { sub: "Desde el menú del navegador:", pasos: [`Toca ${k("⋮")} arriba a la derecha`, `Toca ${k("Agregar a pantalla de inicio")} o ${k("Instalar app")}`, `Confirma con ${k("Agregar")}`] };
  return { sub: "En la computadora, desde Chrome o Edge:", pasos: [`En la barra de direcciones toca el ícono ${k("⊕ Instalar")}`, `O abre el menú ${k("⋮")} → ${k("Instalar Cuadre")}`, "Cuadre se abrirá en su propia ventana"] };
}
async function instalar() {
  if (installEvt) {
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice.catch(() => ({}));
    installEvt = null;
    if (outcome === "accepted") lsSet("cuadre.inst", "ok");
    renderInstall(); return;
  }
  const { sub, pasos } = pasosInstalar();
  $("ins-sub").textContent = sub;
  $("ins-steps").innerHTML = pasos.map(p => `<li><span>${p}</span></li>`).join("");
  if (!$("set-wrap").hidden) $("set-wrap").hidden = true;
  openSheet("ins-wrap");
}
$("inst-go").addEventListener("click", instalar);
$("set-install").addEventListener("click", instalar);
$("inst-close").addEventListener("click", () => { lsSet("cuadre.inst", "no"); renderInstall(); toast("Cuando quieras, está en Ajustes: «Agregar a pantalla de inicio»."); });

/* invitar */
function renderInvPeople() {
  const ms = miembros.length ? miembros : [{ user_id: user.id }];
  $("inv-people").innerHTML = ms.map(m => {
    const a = avatarDe(m), yoMismo = m.user_id === user.id;
    return `<li>${avHTML(a)}<span>${esc(a.nombre)}${yoMismo ? " (tú)" : ""}<span class="sub">${yoMismo ? "Ya anota" : a.on ? "En línea ahora" : "Ya anota"}</span></span></li>`;
  }).join("") + (ms.length <= 1 ? `<li><span class="ghost-av" aria-hidden="true">+</span><span>Tu pareja, tus hijos…<span class="sub">Les llega un enlace y entran con su Google</span></span></li>` : "");
}
function openInvite(nuevo) {
  $("inv-title").textContent = nuevo ? "¿Quién más anota en casa?" : "Invita a tu familia";
  $("inv-sub").textContent = nuevo ? "Mándales el enlace por WhatsApp. Cada uno anota desde su celular y todos ven lo mismo al instante." : "Cada uno entra con su cuenta de Google y anota desde su celular. Todo se ve al instante.";
  $("inv-later").hidden = !nuevo;
  $("inv-share").hidden = !navigator.share;
  renderInvPeople();
  if (!$("set-wrap").hidden) $("set-wrap").hidden = true;
  openSheet("inv-wrap");
  cargarInvitacion();
}
$("btn-invite").addEventListener("click", () => openInvite(false));
$("btn-members").addEventListener("click", () => openInvite(false));
$("solo-invite").addEventListener("click", () => openInvite(false));
$("set-invite").addEventListener("click", () => openInvite(false));
$("solo-close").addEventListener("click", () => { lsSet("cuadre.solo." + fam.id, "no"); renderHeader(); toast("Listo. Puedes invitar cuando quieras con el botón Invitar, arriba."); });
$("inv-later").addEventListener("click", () => closeSheet("inv-wrap"));
$("inv-share").addEventListener("click", async () => { const link = $("inv-box").dataset.link; if (!link) return; try { await navigator.share({ title: "Cuadre", text: `Te invito a llevar las cuentas de la casa conmigo en Cuadre (${fam.nombre}).`, url: link }); } catch { /* canceló */ } });
async function cargarInvitacion(nueva) {
  const { data, error } = await sb.rpc(nueva ? "nueva_invitacion" : "crear_invitacion", { fid: fam.id });
  if (error) {
    delete $("inv-box").dataset.link; $("inv-code").textContent = "—"; $("inv-meta").textContent = "No se pudo crear el enlace";
    $("inv-wa").removeAttribute("href");
    return toast("No se pudo crear el enlace de invitación: " + error.message);
  }
  const link = `${location.origin}${location.pathname}?inv=${data}`;
  $("inv-code").textContent = data; $("inv-box").dataset.link = link;
  $("inv-meta").textContent = "· hasta 10 personas, 14 días";
  $("inv-wa").href = `https://wa.me/?text=${encodeURIComponent(`Te invito a llevar las cuentas de la casa conmigo en Cuadre (${fam.nombre}). Entra con tu Google aquí: ${link}`)}`;
  if (nueva) toast("Listo: el enlace anterior ya no sirve.");
}
$("inv-new").addEventListener("click", () => cargarInvitacion(true));
$("inv-copy").addEventListener("click", async () => { const link = $("inv-box").dataset.link; if (!link) return toast("El enlace todavía no está listo. Intenta otra vez en un segundo."); try { await navigator.clipboard.writeText(link); toast("Enlace copiado."); } catch { prompt("Copia este enlace:", link); } });

/* respaldo: CSV y restaurar JSON */
function toCSV() {
  const coma = fam.formato === "coma", sep = coma ? ";" : ",";
  const cell = v => { const s = String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [["fecha", "tipo", "para", "categoria", "descripcion", "a_quien", "monto"]];
  docs.slice().sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.creado - b.creado).forEach(d => { const n = (entra(d.tipo) ? d.monto : -d.monto).toFixed(2); rows.push([d.fecha, d.tipo, P[d.persona] ? P[d.persona].nombre : "", CAT[d.categoria].nombre, d.nota, d.deudor || "", coma ? n.replace(".", ",") : n]); });
  return "﻿" + rows.map(r => r.map(cell).join(sep)).join("\r\n");
}
$("set-export").addEventListener("click", () => {
  const blob = new Blob([toCSV()], { type: "text/csv;charset=utf-8" }), a = D.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `cuadre-${state.mes}.csv`; D.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("set-restore").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f || !writable()) return;
  const msg = $("restore-msg"); msg.hidden = false; msg.textContent = "Leyendo respaldo…";
  try {
    const j = JSON.parse(await f.text());
    const movs = Array.isArray(j.movimientos) ? j.movimientos : [];
    // Crea las personas del respaldo que no existan aún
    const nombres = [...new Set(movs.map(m => m.persona).filter(Boolean))];
    for (const n of nombres) {
      if (n === "Familia" || personas.some(p => norm(p.nombre) === norm(n))) continue;
      await sb.from("personas").insert({ family_id: fam.id, nombre: n.slice(0, 30), color: COLORES[personas.length % COLORES.length], orden: personas.length });
      await loadPersonas();
    }
    const byName = Object.fromEntries(personas.map(p => [norm(p.nombre), p.id]));
    const idMap = {}; let nuevos = 0, repetidos = 0;
    const ordered = movs.slice().sort((a, b) => (a.tipo === "cobro") - (b.tipo === "cobro")); // préstamos antes que sus pagos
    for (const m of ordered) {
      if (!(m.monto > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(m.fecha || "")) continue;
      const key = "bk-" + (m.id || hash(JSON.stringify(m)));
      const row = { family_id: fam.id, tipo: m.tipo, monto: round2(m.monto), persona_id: byName[norm(m.persona || "")] || familiaId, categoria: m.categoria || "otros", nota: (m.nota || "").slice(0, 140), fecha: m.fecha, deudor: (m.deudor || "").slice(0, 60), cerrado: !!m.cerrado, prestamo_id: m.prestamoId ? (idMap[m.prestamoId] || null) : null, origen: "respaldo", import_key: key, created_by: user.id };
      const { data, error } = await sb.from("movimientos").upsert(row, { onConflict: "family_id,import_key", ignoreDuplicates: true }).select();
      if (error) throw error;
      if (data && data.length) { nuevos++; idMap[m.id] = data[0].id; } else { repetidos++; const { data: ex } = await sb.from("movimientos").select("id").eq("family_id", fam.id).eq("import_key", key).single(); if (ex) idMap[m.id] = ex.id; }
      msg.textContent = `Restaurando… ${nuevos + repetidos} de ${ordered.length}`;
    }
    await loadMovs(); renderAll(); updateComposer();
    msg.textContent = `Listo: ${nuevos} movimientos restaurados${repetidos ? `, ${repetidos} ya estaban` : ""}.`;
  } catch (err) { msg.textContent = "No se pudo restaurar: " + (err.message || "archivo inválido"); }
});

/* ---------- importar chat de WhatsApp ---------- */
let impRows = [], impBusy = false, impT = 0;
function renderImport() {
  const modo = (D.querySelector('input[name="imp-modo"]:checked') || {}).value, text = $("imp-text").value;
  const { rows, sinMonto } = parseChat(text, { modo, personas, loans: openLoans, familiaId: personaDefault() });
  impRows = rows;
  const out = rows.reduce((s, r) => s + (r.tipo === "gasto" ? r.monto : 0), 0), inn = rows.reduce((s, r) => s + (r.tipo === "ingreso" ? r.monto : 0), 0);
  $("imp-sum").textContent = rows.length ? `${rows.length} ${rows.length === 1 ? "movimiento" : "movimientos"} · salen ${fmt(out)} · entran ${fmt(inn)}${sinMonto ? ` · ${sinMonto} ${sinMonto === 1 ? "mensaje sin monto se ignora" : "mensajes sin monto se ignoran"}` : ""}` : text.trim() ? "No encontré montos en ese texto. Cada mensaje necesita un número, como «taxi 15»." : "";
  const MAX = 60;
  $("imp-list").innerHTML = rows.slice(0, MAX).map(r => `<li><span class="d">${esc(shortDate(r.fecha))}</span><span><b>${esc(titleOf({ ...r, prestamoId: r.prestamo_key }))}</b><small>${esc(CAT[r.categoria].nombre)} · ${esc(P[r.persona_id] ? P[r.persona_id].nombre : "")}</small></span><span class="a${r.tipo === "ingreso" ? " in" : ""}">${esc(signed(r))}</span></li>`).join("") + (rows.length > MAX ? `<li><span class="more" style="grid-column:1/-1">y ${rows.length - MAX} más</span></li>` : "");
  $("imp-list").hidden = !rows.length;
  const go = $("imp-go"); if (!impBusy) go.textContent = rows.length ? `Importar ${rows.length}` : "Importar"; go.disabled = impBusy || !rows.length || !writable();
}
$("btn-import").addEventListener("click", () => { renderImport(); openSheet("imp-wrap"); });
$("imp-text").addEventListener("input", () => { clearTimeout(impT); impT = setTimeout(renderImport, 200); });
D.querySelectorAll('input[name="imp-modo"]').forEach(r => r.addEventListener("change", renderImport));
$("imp-file").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $("imp-text").value = String(r.result || ""); renderImport(); }; r.readAsText(f); e.target.value = ""; });
$("imp-go").addEventListener("click", async () => {
  if (!impRows.length || !writable() || impBusy) return;
  impBusy = true; const go = $("imp-go"); go.disabled = true;
  const rows = impRows.slice(); let nuevos = 0, repetidos = 0; const keyToId = {};
  try {
    for (let i = 0; i < rows.length; i++) {
      go.textContent = `Importando ${i + 1} de ${rows.length}…`;
      const r = rows[i];
      const prestamo_id = r.prestamo_key ? (keyToId[r.prestamo_key] || (openLoans.some(l => l.id === r.prestamo_key) ? r.prestamo_key : null)) : null;
      const { data, error } = await sb.from("movimientos").upsert({ family_id: fam.id, tipo: r.tipo, monto: r.monto, persona_id: r.persona_id, categoria: r.categoria, nota: r.nota, fecha: r.fecha, deudor: r.deudor, prestamo_id, origen: "whatsapp", import_key: r.import_key, created_by: user.id }, { onConflict: "family_id,import_key", ignoreDuplicates: true }).select();
      if (error) throw error;
      if (data && data.length) { nuevos++; keyToId[r.import_key] = data[0].id; } else { repetidos++; const { data: ex } = await sb.from("movimientos").select("id").eq("family_id", fam.id).eq("import_key", r.import_key).single(); if (ex) keyToId[r.import_key] = ex.id; }
    }
    await loadMovs(); renderAll(); updateComposer();
    $("imp-text").value = ""; closeSheet("imp-wrap");
    toast(`Importados ${nuevos}${repetidos ? ` (${repetidos} ya estaban)` : ""}.`);
  } catch (e) { writeError(e); toast(`Se importaron ${nuevos} antes de un error. Toca Importar otra vez: lo ya guardado no se repite.`); }
  finally { impBusy = false; renderImport(); }
});

/* ---------- datos ---------- */
async function loadPersonas() {
  const { data, error } = await sb.from("personas").select("*").eq("family_id", fam.id).order("orden").order("created_at");
  if (error) throw error;
  personas = data.map(p => ({ ...p, keys: keysOf(p) }));
  P = Object.fromEntries(personas.map(p => [p.id, p]));
  const famP = personas.find(p => p.es_familia); familiaId = famP ? famP.id : null;
}
async function loadMovs() {
  const { data, error } = await sb.from("movimientos").select("*").eq("family_id", fam.id).order("fecha").limit(20000);
  if (error) throw error;
  all = data.map(normRow); state.loading = false;
}
async function loadMiembros() { const { data } = await sb.rpc("miembros_de", { fid: fam.id }); miembros = data || []; }
async function refreshFamily() {
  const { data } = await sb.from("families").select("*").eq("id", fam.id).single();
  if (data) { fam = data; renderAll(); updateComposer(); }
}
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("fam-" + fam.id, { config: { presence: { key: user.id } } })
    .on("postgres_changes", { event: "*", schema: "public", table: "movimientos", filter: `family_id=eq.${fam.id}` }, payload => {
      let aviso = "";
      if (payload.eventType === "DELETE") {
        const antes = all.find(x => x.id === payload.old.id);
        if (antes) aviso = `Se borró: ${titleOf(antes)} ${signed(antes)}`;   // si aún estaba aquí, lo borró otra persona
        removeLocal(payload.old.id);
      } else {
        upsertLocal(payload.new);
        const d = normRow(payload.new), quien = payload.eventType === "INSERT" ? payload.new.created_by : payload.new.updated_by;
        if (quien && quien !== user.id) aviso = `${nombreDe(quien)} ${payload.eventType === "INSERT" ? "anotó" : "cambió"}: ${titleOf(d)} ${signed(d)}`;
      }
      renderAll(); updateComposer();
      if (aviso) toast(aviso);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `family_id=eq.${fam.id}` }, async payload => {
      const antes = new Set(miembros.map(m => m.user_id));
      await loadMiembros(); renderAll();
      if (!$("set-wrap").hidden) syncSettingsForm();
      if (!$("inv-wrap").hidden) renderInvPeople();
      const nuevo = miembros.find(m => !antes.has(m.user_id));
      if (payload.eventType === "INSERT" && nuevo && nuevo.user_id !== user.id) toast(`${nombreDe(nuevo.user_id)} se unió a ${fam.nombre}.`);
      if (!miembros.some(m => m.user_id === user.id)) { toast("Ya no eres parte de esta familia."); setTimeout(() => location.reload(), 1500); }
    })
    .on("presence", { event: "sync" }, () => {
      online = new Set(Object.values(channel.presenceState()).flat().map(p => p.uid));
      renderHeader(); if (!$("set-wrap").hidden) renderMiembros(); if (!$("inv-wrap").hidden) renderInvPeople();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "personas", filter: `family_id=eq.${fam.id}` }, async () => { await loadPersonas(); renderAll(); updateComposer(); })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "families", filter: `id=eq.${fam.id}` }, payload => { fam = { ...fam, ...payload.new }; renderAll(); updateComposer(); })
    .subscribe(status => { if (status === "SUBSCRIBED") channel.track({ uid: user.id }); });
}
D.addEventListener("visibilitychange", async () => {
  if (D.hidden || !fam) return;
  if (!state.fechaManual) state.fecha = today();
  try { await loadMovs(); await refreshFamily(); } catch { /* sin conexión: se queda lo que hay */ }
  renderAll(); updateComposer();
});

async function openFamily(f) {
  fam = f; localStorage.setItem("cuadre.fam", f.id);
  state.loading = true; all = [];
  await loadPersonas();
  show("scr-app"); renderAll(); updateComposer();
  await Promise.all([loadMovs(), loadMiembros()]);
  renderAll(); updateComposer(); subscribe();
  const sinNombre = yo() && !yo().persona_id && personas.some(p => !p.es_familia);
  if (sinNombre && !localStorage.getItem("cuadre.soy." + fam.id)) { localStorage.setItem("cuadre.soy." + fam.id, "1"); renderSoy($("soy-opts")); openSheet("soy-wrap"); }
  const { data: adm } = await sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  isAdmin = !!adm;
}

/* ---------- onboarding ---------- */
function personaInput(v) { const d = D.createElement("div"); d.className = "person-input"; d.innerHTML = `<input maxlength="30" placeholder="Nombre" value="${esc(v || "")}"><button type="button" class="icon-btn" aria-label="Quitar">✕</button>`; d.querySelector("button").addEventListener("click", () => { if ($("cf-personas").children.length > 1) d.remove(); }); return d; }
function initOnboard() {
  if (!$("cf-personas").children.length) { $("cf-personas").append(personaInput(""), personaInput("")); const first = $("cf-personas").querySelector("input"); const n = user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name); if (n) first.value = n.split(" ")[0]; }
  $("cf-add").onclick = () => $("cf-personas").append(personaInput(""));
}
$("form-crear").addEventListener("submit", async e => {
  e.preventDefault();
  const nombre = $("cf-nombre").value.trim(), pers = [...$("cf-personas").querySelectorAll("input")].map(i => i.value.trim()).filter(Boolean);
  const err = $("cf-err"); err.hidden = true;
  if (!pers.length) { err.textContent = "Escribe al menos una persona."; err.hidden = false; return; }
  $("cf-go").disabled = true;
  const { data, error } = await sb.rpc("crear_familia", { p_nombre: nombre || "Mi familia", p_personas: pers, p_moneda: $("cf-moneda").value, p_dia_cobro: parseInt($("cf-cobro").value, 10) || 0 });
  $("cf-go").disabled = false;
  if (error) { err.textContent = error.message; err.hidden = false; return; }
  // Quien crea la familia es la primera persona de la lista (viene con su nombre de Google)
  const { data: primera } = await sb.from("personas").select("id").eq("family_id", data).eq("es_familia", false).order("orden").limit(1).maybeSingle();
  if (primera) await sb.rpc("soy", { fid: data, p_persona: primera.id });
  localStorage.setItem("cuadre.soy." + data, "1");
  const { data: f } = await sb.from("families").select("*").eq("id", data).single();
  await openFamily(f); openInvite(true);
});
$("form-unirse").addEventListener("submit", async e => { e.preventDefault(); await showJoin($("un-code").value, $("un-err")); });

let joinCode = null, joinPick = null;
async function showJoin(code, errEl, misFams) {
  code = String(code || "").trim().toUpperCase();
  const { data, error } = await sb.rpc("ver_invitacion", { p_code: code });
  const row = data && data[0];
  const motivo = error ? error.message : row && row.motivo;
  if (motivo || !row) {
    history.replaceState(null, "", location.pathname);
    if (errEl) { errEl.textContent = motivo || "No se pudo leer la invitación."; errEl.hidden = false; return false; }
    toast(motivo || "No se pudo leer la invitación."); return false;
  }
  const ya = (misFams || []).find(f => f.id === row.familia_id);
  if (ya) { history.replaceState(null, "", location.pathname); await openFamily(ya); toast(`Ya eres parte de ${ya.nombre}.`); return true; }
  joinCode = code; joinPick = null;
  $("jn-title").textContent = `Te invitaron a ${row.familia}`;
  const ps = row.personas || [];
  $("jn-personas").innerHTML = ps.map(p => `<button type="button" class="chip" data-pick="${p.id}" aria-pressed="false"><i class="dot" style="background:${esc(p.color)}"></i>Soy ${esc(p.nombre)}</button>`).join("") + `<button type="button" class="chip" data-pick="otro" aria-pressed="false">Soy otra persona</button>`;
  $("jn-otro-wrap").hidden = true; $("jn-err").hidden = true; $("jn-go").disabled = true;
  show("scr-join"); return true;
}
$("jn-personas").addEventListener("click", e => {
  const b = e.target.closest("[data-pick]"); if (!b) return;
  joinPick = b.dataset.pick;
  $("jn-personas").querySelectorAll("[data-pick]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  $("jn-otro-wrap").hidden = joinPick !== "otro";
  if (joinPick === "otro") { const n = user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name); if (n && !$("jn-otro").value) $("jn-otro").value = n.split(" ")[0]; $("jn-otro").focus(); }
  $("jn-go").disabled = false;
});
$("jn-go").addEventListener("click", async () => {
  const err = $("jn-err"); err.hidden = true;
  const otro = joinPick === "otro" ? $("jn-otro").value.trim().slice(0, 30) : "";
  if (joinPick === "otro" && !otro) { err.textContent = "Escribe tu nombre."; err.hidden = false; return; }
  $("jn-go").disabled = true;
  const { data: fid, error } = await sb.rpc("aceptar_invitacion", { p_code: joinCode, p_persona: joinPick && joinPick !== "otro" ? joinPick : null });
  if (error) { $("jn-go").disabled = false; err.textContent = error.message; err.hidden = false; return; }
  if (otro) {
    const { count } = await sb.from("personas").select("id", { count: "exact", head: true }).eq("family_id", fid);
    const { data: np } = await sb.from("personas").insert({ family_id: fid, nombre: otro, color: COLORES[(count || 0) % COLORES.length], orden: count || 0 }).select().single();
    if (np) await sb.rpc("soy", { fid, p_persona: np.id });
  }
  localStorage.setItem("cuadre.soy." + fid, "1");
  history.replaceState(null, "", location.pathname);
  const { data: f } = await sb.from("families").select("*").eq("id", fid).single();
  await openFamily(f); toast(`¡Bienvenido a ${f.nombre}! Lo que anoten aparece al instante para todos.`);
});
$("jn-cancel").addEventListener("click", () => { history.replaceState(null, "", location.pathname); joinCode = null; route(); });

/* ---------- arranque ---------- */
async function route() {
  const { data: { session } } = await sb.auth.getSession();
  user = session ? session.user : null;
  if (!user) { show("scr-login"); return; }
  const inv = new URLSearchParams(location.search).get("inv") || localStorage.getItem("cuadre.inv");
  localStorage.removeItem("cuadre.inv");
  const { data: ms, error } = await sb.from("members").select("family_id, rol, families(*)").eq("user_id", user.id);
  if (error) { $("login-err").textContent = "No se pudo cargar: " + error.message; $("login-err").hidden = false; show("scr-login"); return; }
  const fams = (ms || []).map(m => m.families).filter(Boolean);
  // Abrió un enlace de invitación: si ya es de esa familia entra directo; si no, ve a quién se une
  if (inv && await showJoin(inv, null, fams)) return;
  if (!fams.length) { initOnboard(); show("scr-onboard"); return; }
  const saved = localStorage.getItem("cuadre.fam");
  await openFamily(fams.find(f => f.id === saved) || fams[0]);
}
$("btn-google").addEventListener("click", async () => {
  const inv = new URLSearchParams(location.search).get("inv"); if (inv) localStorage.setItem("cuadre.inv", inv);
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  if (error) { $("login-err").textContent = error.message; $("login-err").hidden = false; }
});
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { fam = null; show("scr-login"); } });
if (window.ResizeObserver) new ResizeObserver(() => D.documentElement.style.setProperty("--composer-h", $("composer").offsetHeight + "px")).observe($("composer"));
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
route().catch(err => { console.error(err); $("login-err").textContent = "Algo falló al cargar: " + (err.message || err); $("login-err").hidden = false; show("scr-login"); });
