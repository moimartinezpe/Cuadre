// El analizador de mensajes de Cuadre: convierte "mercado 120 familia" en un movimiento.
// Las personas vienen de la familia (nombre + apodos); las categorías son fijas.

const w = s => s.split(" ");

export const CATS_GASTO = [
  { id: "comida", nombre: "Comida", keys: w("mercado super supermercado comida almuerzo desayuno cena lonche lonchera pan fruta verdura carne pollo pescado restaurante restaurant menu delivery rappi pedidosya cafe snack bodega abarrote leche huevo pizza chifa hamburguesa galleta arroz azucar aceite feria polleria minimarket market") },
  { id: "transporte", nombre: "Transporte", keys: w("taxi uber didi cabify indrive indriver bus pasaje combi colectivo micro metro tren gasolina gasol combustible grifo peaje estacionamiento parqueo cochera mecanico llanta soat moto") },
  { id: "casa", nombre: "Casa", keys: w("alquiler renta arriendo condominio mantenimiento limpieza ferreteria mueble hipoteca administracion detergente lejia reparacion gasfitero plomero foco") },
  { id: "servicios", nombre: "Servicios", keys: w("luz agua gas internet cable celular telefono recarga netflix spotify disney hbo youtube icloud streaming movistar claro entel bitel tigo wifi") },
  { id: "salud", nombre: "Salud", keys: w("farmacia medicina medicamento doctor medico clinica hospital consulta dentista odontologo analisis laboratorio seguro vitamina pastilla pediatra terapia vacuna") },
  { id: "educacion", nombre: "Educación", keys: w("colegio pension matricula util libro curso universidad nido clase escuela cuaderno taller academia uniforme") },
  { id: "ropa", nombre: "Ropa", keys: w("ropa zapato zapatilla polo camisa vestido pantalon casaca chompa media calzado buzo") },
  { id: "cuidado", nombre: "Cuidado personal", keys: w("peluqueria corte barberia manicure pedicure maquillaje shampoo crema perfume gym gimnasio spa cosmetico") },
  { id: "salidas", nombre: "Salidas", keys: w("cine salida fiesta juguete regalo paseo viaje helado cumpleanos juego bar cerveza chela trago concierto entrada hotel playa") },
  { id: "deudas", nombre: "Deudas", keys: w("tarjeta prestamo cuota deuda banco credito interes") },
  { id: "otros", nombre: "Otros", keys: [] },
];
export const CATS_INGRESO = [
  { id: "sueldo", nombre: "Sueldo", keys: w("sueldo salario quincena pagaron deposito depositaron gratificacion cts utilidades aguinaldo") },
  { id: "extra", nombre: "Extra", keys: w("venta vendi vendimos bono freelance cachuelo extra negocio") },
  { id: "otro_ingreso", nombre: "Otro ingreso", keys: [] },
];
export const CATS_PRESTAMO = [{ id: "prestamo", nombre: "Préstamo", keys: [] }];
export const CATS_COBRO = [{ id: "cobro", nombre: "Devolución", keys: [] }];
export const CATS_AHORRO = [{ id: "ahorro", nombre: "Ahorro", keys: [] }];
export const CATS_RETIRO = [{ id: "retiro", nombre: "Uso de ahorros", keys: [] }];
export const CATS_PAGOTC = [{ id: "pagotarjeta", nombre: "Pago de tarjeta", keys: [] }];
export const CATS_AJMAS = [{ id: "ajuste_mas", nombre: "Ajuste de saldo", keys: [] }];
export const CATS_AJMENOS = [{ id: "ajuste_menos", nombre: "Ajuste de saldo", keys: [] }];
export const CAT = Object.fromEntries([...CATS_GASTO, ...CATS_INGRESO, ...CATS_PRESTAMO, ...CATS_COBRO, ...CATS_AHORRO, ...CATS_RETIRO, ...CATS_PAGOTC, ...CATS_AJMAS, ...CATS_AJMENOS].map(c => [c.id, c]));
export const TIPOS = ["gasto", "ingreso", "prestamo", "cobro", "ahorro", "retiro", "pagotarjeta", "ajuste_mas", "ajuste_menos"];
export const catsFor = tipo => ({ ingreso: CATS_INGRESO, prestamo: CATS_PRESTAMO, cobro: CATS_COBRO, ahorro: CATS_AHORRO, retiro: CATS_RETIRO, pagotarjeta: CATS_PAGOTC, ajuste_mas: CATS_AJMAS, ajuste_menos: CATS_AJMENOS }[tipo] || CATS_GASTO);
// Lo que suma a «Les queda»
export const entra = tipo => tipo === "ingreso" || tipo === "cobro" || tipo === "retiro" || tipo === "ajuste_mas";
// Movimientos que no son ni gasto ni ingreso (no cuentan en las estadísticas de consumo)
export const especial = tipo => ["ahorro", "retiro", "pagotarjeta", "ajuste_mas", "ajuste_menos"].includes(tipo);
export const esAhorro = tipo => tipo === "ahorro" || tipo === "retiro";
// Compra con tarjeta de crédito: es gasto, pero el efectivo baja recién al pagar la tarjeta
export const conTarjeta = d => d.tipo === "gasto" && d.medio === "tarjeta";
export const isLoan = tipo => tipo === "prestamo" || tipo === "cobro";

const INGRESO_KEYS = w("sueldo salario quincena ingreso cobre cobramos pagaron deposito depositaron venta vendi vendimos bono gratificacion cts utilidades aguinaldo freelance cachuelo reembolso devolucion devolvio devolvieron abonaron prestaron");
const LOAN_VERBS = new Set(w("preste prestamos presto prestar prestado prestada prestarle prestaste prestamosle"));
const REPAY_WORDS = new Set(w("devolvio devolvieron devuelve devolucion abono abonaron pago pagaron cancelo cancelaron"));
const GENERIC_NAMES = new Set(w("tia tio senora senor sra don dona primo prima amigo amiga vecino vecina hermano hermana cunado cunada suegra suegro compadre comadre"));
const FILLER = new Set(w("le les se lo me nos"));
const LEAD_TO = new Set(w("a al para pa de la el mi su"));
const NAME_CUT = new Set(w("para pa por porque que pq hasta y"));
const LEAD_VERBS = new Set(w("gaste gastamos gasto compre compramos pague pagamos"));
const TRAIL_WORDS = new Set(w("de del es en por para a al la el y fue son con"));
const CUR_WORDS = new Set(["s/", "s/.", "$", "€", "soles", "sol", "pesos", "dolares", "dolar", "lucas", "euros", "bs", "mangos", "varos", "usd", "pen"]);
const SAVE_VERBS = new Set(w("ahorre ahorramos ahorrar ahorro guarde guardamos guardar separe separamos"));
const WITHDRAW_VERBS = new Set(w("saque sacamos sacar retire retiramos retirar retiro use usamos usar"));
const SAVE_WORDS = new Set(w("ahorro ahorros alcancia chanchito"));
const TC_WORDS = new Set(w("tarjeta tc visa amex mastercard credito"));
const PAY_VERBS = new Set(w("pague pagamos pago pagar cancele cancelamos"));
const LEAD_WORDS = new Set(["para", "pa", "de", "del", "a", "al", "por", "la", "el", "los", "las", "mi", "nuestra", "nuestro"]);
export const FAMILIA_KEYS = w("familia familiar conjunto todos casa hogar nosotros juntos compartido");

export const pad = n => String(n).padStart(2, "0");
export const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoOf(new Date());
export const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const matchKey = (word, keys) => !!word && keys.some(k => word === k || word === k + "s" || word === k + "es");
const titleCase = s => s.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());

export function parseNum(s) {
  s = String(s).replace(/[^\d.,]/g, "");
  if (!s) return NaN;
  const dot = s.lastIndexOf("."), com = s.lastIndexOf(",");
  if (dot > -1 && com > -1) {
    const dec = dot > com ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else if (dot > -1 || com > -1) {
    const parts = s.split(dot > -1 ? "." : ",");
    const last = parts[parts.length - 1];
    s = (parts.length > 2 || last.length === 3) ? parts.join("") : parts.join(".");
  }
  return parseFloat(s);
}

// "21/10/26" → "2026-10-21"; sin año asume el actual (o el anterior si quedaría en el futuro)
export function waDate(d, m, y) {
  let day = +d, mon = +m;
  if (mon > 12 && day <= 12) [day, mon] = [mon, day];
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  const year = y ? (y.length <= 2 ? 2000 + +y : +y) : new Date().getFullYear();
  const iso = `${year}-${pad(mon)}-${pad(day)}`;
  return !y && iso > today() ? `${year - 1}-${pad(mon)}-${pad(day)}` : iso;
}

// Palabras con las que se reconoce a una persona en un mensaje: su nombre, su primer nombre y sus apodos
export function keysOf(p) {
  const ks = new Set();
  const full = norm(p.nombre).replace(/[^a-z0-9 ]/g, "").trim();
  if (full) { ks.add(full.replace(/ /g, "")); full.split(" ").filter(x => x.length >= 3).forEach(x => ks.add(x)); }
  (p.apodos || []).forEach(a => { const n = norm(a).replace(/[^a-z0-9]/g, ""); if (n) ks.add(n); });
  if (p.es_familia) FAMILIA_KEYS.forEach(k => ks.add(k));
  return [...ks];
}

// Encuentra el préstamo abierto del que habla un pago ("rosa devolvió 50"); null si no hay o es ambiguo
function matchLoan(words, used, loans) {
  let best = null, tie = false;
  const byDate = loans.slice().sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
  for (const l of byDate) {
    const toks = norm(l.deudor || "").split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !GENERIC_NAMES.has(t));
    const idx = [];
    words.forEach((x, i) => { if (!used[i] && toks.includes(x)) idx.push(i); });
    if (!idx.length) continue;
    if (!best || idx.length > best.idx.length) { best = { loan: l, idx }; tie = false; }
    else if (idx.length === best.idx.length && norm(l.deudor) !== norm(best.loan.deudor)) tie = true;
  }
  return best && !tie ? best : null;
}

/**
 * parse(texto, { tipo?, personas, loans })
 * personas: [{ id, nombre, keys }]; loans: préstamos abiertos [{ id, deudor, persona_id, fecha }]
 */
export function parse(text, opts = {}) {
  const personas = opts.personas || [], loans = opts.loans || [], tipoOverride = opts.tipo;
  const raw = String(text).trim().split(/\s+/).filter(Boolean);
  const used = raw.map(() => false);
  const words = raw.map(t => norm(t).replace(/[^a-z0-9]/g, ""));
  let monto = null, sign = "", fecha = null;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].replace(/[;:!?)\]]+$/, "").replace(/[.,]+$/, "");
    const m = t.match(/^([+\-−])?(?:s\/\.?|\$|€|bs\.?|q)?([+\-−])?(\d[\d.,]*)(k|mil)?$/i);
    if (!m) continue;
    let v = parseNum(m[3]);
    if (!(v > 0)) continue;
    if (m[4]) v *= 1000;
    else if (words[i + 1] === "mil" || words[i + 1] === "k") { v *= 1000; used[i + 1] = true; }
    if (v > 1e8) continue;
    monto = Math.round(v * 100) / 100;
    used[i] = true;
    sign = m[1] || m[2] || "";
    break;
  }
  for (let i = 0; i < raw.length && !fecha; i++) {
    if (used[i]) continue;
    const m = raw[i].replace(/[.,;:]+$/, "").match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
    const f = m && waDate(m[1], m[2], m[3]);
    if (!f) continue;
    fecha = f; used[i] = true;
    for (let j = i - 1; j >= Math.max(0, i - 3) && !used[j] && ["del", "el", "al", "dia", "de", "hasta"].includes(words[j]); j--) used[j] = true;
  }
  raw.forEach((t, i) => {
    if (used[i]) return;
    if (t === "+") { sign = "+"; used[i] = true; }
    else if (t === "-" || t === "−") { used[i] = true; if (!sign) sign = "-"; }
    else if (CUR_WORDS.has(t.toLowerCase()) || CUR_WORDS.has(words[i])) used[i] = true;
  });
  let persona = null;
  for (let i = 0; i < raw.length && !persona; i++) {
    if (used[i]) continue;
    const p = personas.find(p => p.keys.includes(words[i]));
    if (!p) continue;
    persona = p.id; used[i] = true;
    for (let j = i - 1; j >= Math.max(0, i - 2) && !used[j] && LEAD_WORDS.has(words[j]); j--) used[j] = true;
  }
  let tipo = tipoOverride || null, deudor = "", prestamoId = null, medio = null;
  // «pagué la tarjeta 3074» = pago de la tarjeta; «luz 304 tarjeta» = compra con tarjeta
  const tcIdx = words.findIndex((x, i) => !used[i] && TC_WORDS.has(x));
  if (tcIdx > -1) {
    const payIdx = words.findIndex((x, i) => !used[i] && PAY_VERBS.has(x));
    const marcaTc = () => words.forEach((x, i) => { if (!used[i] && (TC_WORDS.has(x) || ["con", "la", "de", "mi", "en", "por"].includes(x))) used[i] = true; });
    // solo «pagué (la/de/mi) tarjeta»; «pagué la luz con tarjeta» es una compra con tarjeta
    const pegado = payIdx > -1 && tcIdx > payIdx && tcIdx - payIdx <= 3 && words.slice(payIdx + 1, tcIdx).every(x => ["la", "de", "mi", "el", "del"].includes(x));
    if (!tipo && pegado && sign !== "+") { tipo = "pagotarjeta"; used[payIdx] = true; marcaTc(); }
    else if (!tipo || tipo === "gasto") { medio = "tarjeta"; marcaTc(); }
  }
  const verbIdx = words.findIndex((x, i) => !used[i] && LOAN_VERBS.has(x));
  if (!tipo) {
    // «ahorré 200», «guardé 100 en el chanchito» / «saqué 350 de ahorros»
    const hasSave = words.some((x, i) => !used[i] && SAVE_WORDS.has(x));
    const wIdx = words.findIndex((x, i) => !used[i] && WITHDRAW_VERBS.has(x) && x !== "ahorro");
    const sIdx = words.findIndex((x, i) => !used[i] && SAVE_VERBS.has(x) && !(x === "ahorro" && i > 0));
    const marcar = () => words.forEach((x, i) => { if (!used[i] && (SAVE_VERBS.has(x) || WITHDRAW_VERBS.has(x) || SAVE_WORDS.has(x) || ["de", "del", "en", "el", "la", "los", "mis", "mi", "nuestros", "al", "a"].includes(x))) used[i] = true; });
    if (wIdx > -1 && hasSave) { tipo = "retiro"; marcar(); }
    else if (sIdx > -1 && sign !== "+" && verbIdx === -1) { tipo = "ahorro"; marcar(); }
    else if (verbIdx > -1 && sign !== "+") tipo = "prestamo";
    else if (sign === "+") tipo = "ingreso";
    else if (sign) tipo = "gasto";
    else if (loans.length && words.some((x, i) => !used[i] && REPAY_WORDS.has(x))) {
      const hit = matchLoan(words, used, loans);
      if (hit) {
        tipo = "cobro"; prestamoId = hit.loan.id; deudor = hit.loan.deudor;
        if (!persona) persona = hit.loan.persona_id;
        hit.idx.forEach(i => { used[i] = true; });
        words.forEach((x, i) => { if (!used[i] && (REPAY_WORDS.has(x) || FILLER.has(x))) used[i] = true; });
      }
    }
    if (!tipo) tipo = words.some((x, i) => !used[i] && matchKey(x, INGRESO_KEYS)) ? "ingreso" : "gasto";
  }
  if (tipo === "prestamo") {
    if (verbIdx > -1) used[verbIdx] = true;
    words.forEach((x, i) => { if (!used[i] && FILLER.has(x)) used[i] = true; });
    const idx = raw.map((_, i) => i).filter(i => !used[i]);
    let k = 0;
    while (k < idx.length && LEAD_TO.has(words[idx[k]])) { used[idx[k]] = true; k++; }
    const name = [];
    while (k < idx.length && name.length < 4 && !NAME_CUT.has(words[idx[k]])) { name.push(idx[k]); k++; }
    name.forEach(i => { used[i] = true; });
    deudor = titleCase(name.map(i => raw[i].replace(/[^\p{L}\p{N}.'-]/gu, "")).filter(Boolean).join(" ")).slice(0, 60);
  }
  const cats = catsFor(tipo);
  let categoria = null;
  for (let i = 0; i < words.length && !categoria; i++) {
    if (used[i]) continue;
    const c = cats.find(c => matchKey(words[i], c.keys));
    if (c) categoria = c.id;
  }
  const catFound = !!categoria || cats.length === 1;
  if (!categoria) categoria = cats[cats.length - 1].id;
  const rest = raw.filter((_, i) => !used[i]);
  const rw = rest.map(t => norm(t).replace(/[^a-z0-9]/g, ""));
  let s = 0, e = rest.length;
  if (!isLoan(tipo)) while (s < e && LEAD_VERBS.has(rw[s])) { s++; if (s < e && (rw[s] === "en" || rw[s] === "de")) s++; }
  while (e > s && TRAIL_WORDS.has(rw[e - 1])) e--;
  let nota = rest.slice(s, e).join(" ").replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, "");
  if (nota) nota = nota.charAt(0).toUpperCase() + nota.slice(1);
  if (tipo !== "gasto") medio = null;
  return { monto, tipo, persona, categoria, catFound, nota, deudor, prestamoId, fecha, medio };
}

// ---------- Chat exportado de WhatsApp ----------
const WA = /^\[?(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?,?\s+(\d{1,2}:\d{2})(?::\d{2})?\s*([ap]\.?\s?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}?):\s(.*)$/i;
const DATE_START = /^\[?\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/;

export function hash(s) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822507) >>> 0; b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

function personaDeNombre(nombre, personas) {
  const ws = norm(nombre).split(/[^a-z0-9]+/);
  const p = personas.find(p => !p.es_familia && p.keys.some(k => ws.includes(k)));
  return p ? p.id : null;
}

/** parseChat(texto, { modo: "familia"|"autor", personas, loans, familiaId }) → { rows, sinMonto } */
export function parseChat(text, opts) {
  const { modo, personas, familiaId } = opts;
  text = text.replace(/[‎‏‪-‮﻿]/g, "").replace(/[  ]/g, " ");
  let fecha = today(), autor = "";
  const rows = [], seen = new Map();
  const loanCtx = (opts.loans || []).slice();
  let sinMonto = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let msg = line, stamp = "";
    const m = line.trim().match(WA);
    if (m) {
      const f = waDate(m[1], m[2], m[3]);
      if (!f) continue;
      fecha = f; stamp = m[4] + (m[5] || ""); autor = m[6].trim(); msg = m[7];
    } else if (DATE_START.test(line.trim())) continue;
    if (/omitid|omitted|adjunt|eliminado|eliminaste|\.(jpg|jpeg|png|opus|pdf|webp|mp4)\b/i.test(msg)) { sinMonto++; continue; }
    const p = parse(msg, { personas, loans: loanCtx });
    if (!p.monto) { sinMonto++; continue; }
    const persona_id = p.persona || (modo === "autor" && personaDeNombre(autor, personas)) || familiaId;
    const base = [fecha, stamp, autor, msg.trim()].join("|");
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const row = { import_key: "wa-" + hash(base + "#" + n), tipo: p.tipo, monto: p.monto, persona_id, categoria: p.categoria, nota: isLoan(p.tipo) ? p.nota : (p.nota || CAT[p.categoria].nombre), fecha: p.fecha || fecha, deudor: isLoan(p.tipo) ? p.deudor : "", prestamo_key: p.tipo === "cobro" ? p.prestamoId : null };
    if (p.medio) row.medio = p.medio;
    if (p.tipo === "prestamo" && p.deudor) loanCtx.push({ id: row.import_key, deudor: p.deudor, persona_id, fecha: row.fecha });
    rows.push(row);
  }
  return { rows, sinMonto };
}
