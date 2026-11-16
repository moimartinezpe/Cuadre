// Panel del dueño del servicio: prueba gratis, activar o cortar acceso, y seguimiento de ventas.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, PLAN } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = iso(new Date());
const fecha = d => d ? new Date(d + "T00:00:00").toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" }) : "—";
const diasHasta = d => d ? Math.round((new Date(d + "T00:00:00") - new Date(hoy + "T00:00:00")) / 864e5) : null;
const soles = n => "S/ " + Number(n || 0).toFixed(2).replace(/\.00$/, "");
const precioMes = parseFloat(String(PLAN.precioMes).replace(/[^\d.,]/g, "").replace(",", ".")) || 9.9;

let familias = [], filtro = "todas", q = "";

function estadoDe(f) {
  const d = diasHasta(f.plan_hasta), paga = Number(f.pagos_reales) > 0;
  if (!f.plan_hasta) return { k: "pendientes", label: "sin activar", cls: "warn" };
  if (d < 0) return { k: "vencidas", label: `vencida hace ${-d} ${d === -1 ? "día" : "días"}`, cls: "bad" };
  if (!paga) return { k: "prueba", label: d <= 5 ? `prueba: quedan ${d} ${d === 1 ? "día" : "días"}` : `en prueba hasta ${fecha(f.plan_hasta)}`, cls: "trial", vence: d <= 5 };
  return { k: "pagando", label: d <= 5 ? `vence en ${d} ${d === 1 ? "día" : "días"}` : `pagando hasta ${fecha(f.plan_hasta)}`, cls: d <= 5 ? "warn" : "ok", vence: d <= 5 };
}
const pasa = f => {
  const e = estadoDe(f);
  if (filtro === "vence" && !e.vence) return false;
  if (!["todas", "vence"].includes(filtro) && e.k !== filtro) return false;
  if (q && !`${f.nombre} ${f.nombres} ${f.correos}`.toLowerCase().includes(q)) return false;
  return true;
};

function renderKpis() {
  const est = familias.map(estadoDe);
  const prueba = est.filter(e => e.k === "prueba").length, pagando = est.filter(e => e.k === "pagando").length;
  const conPago = familias.filter(f => Number(f.pagos_reales) > 0).length;
  const conv = familias.length ? Math.round(conPago / familias.length * 100) : 0;
  const cobrado = familias.reduce((t, f) => t + Number(f.pagado || 0), 0);
  const activas7 = familias.filter(f => Number(f.movs_7d) > 0).length;
  $("kpis").innerHTML = [
    ["Familias", familias.length], ["En prueba", prueba], ["Pagando", pagando],
    ["Pasaron a pago", conv + "%"], ["Usan la app (7 días)", activas7],
    ["Ingreso mensual aprox.", soles(pagando * precioMes)], ["Cobrado en total", soles(cobrado)],
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join("");
  $("kpis").hidden = false;
}

function renderList() {
  const list = familias.filter(pasa);
  $("list").innerHTML = list.map(f => {
    const e = estadoDe(f);
    return `<div class="card" data-fid="${f.id}">
      <div class="fam"><div><b>${esc(f.nombre)}</b> <span class="st ${e.cls}">${esc(e.label)}</span></div>
        <small>Personas: ${esc(f.nombres || "—")}</small>
        <small>Cuentas: ${esc(f.correos || "—")}</small>
        <small>${Number(f.pagos_reales) > 0 ? `Pagado: ${soles(f.pagado)} en ${f.pagos_reales} ${f.pagos_reales == 1 ? "pago" : "pagos"}${f.ultimo_pago ? " · último " + fecha(f.ultimo_pago) : ""}` : "Aún no paga"}</small>
        <small>${f.miembros} ${f.miembros == 1 ? "cuenta" : "cuentas"} · ${f.movimientos} movimientos (${f.movs_7d} esta semana) · último ${f.ultimo ? new Date(f.ultimo).toLocaleDateString("es-PE") : "nunca"} · creada ${new Date(f.created_at).toLocaleDateString("es-PE")}</small>
      </div>
      <form class="row act">
        <select name="dias" aria-label="Cuánto activar">
          <option value="30">+30 días · mes</option><option value="365">+365 días · año</option>
          <option value="7">+7 días</option><option value="14">+14 días</option><option value="custom">Otra cantidad…</option>
        </select>
        <input class="n" name="custom" type="number" min="1" max="3660" placeholder="Días" hidden>
        <select name="metodo" aria-label="Cómo pagó"><option value="yape">Yape</option><option value="plin">Plin</option><option value="transferencia">Transferencia</option><option value="cortesia">Prueba / cortesía (gratis)</option></select>
        <input class="n" name="monto" inputmode="decimal" placeholder="Monto S/">
        <input name="nota" placeholder="Nota (opcional)">
        <button class="btn p" type="submit">Activar</button>
      </form>
      <div class="row">
        <label class="muted" style="font-size:13px">Fecha exacta: <input type="date" name="hasta" value="${f.plan_hasta || ""}"></label>
        <button type="button" class="btn" data-a="fijar">Fijar fecha</button>
        <button type="button" class="btn d" data-a="cortar">Cortar acceso</button>
        <button type="button" class="btn" data-a="correos">Copiar correos</button>
      </div>
      <details data-hist><summary>Historial de pagos y activaciones</summary><ul class="hist"><li>Cargando…</li></ul></details>
      <p class="msg" data-msg></p>
    </div>`;
  }).join("") || "<p class='muted'>No hay familias en esta lista.</p>";
}

async function load() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("who").innerHTML = 'Entra primero en <a href="./">la app</a> con tu cuenta de administrador.'; return; }
  const { data, error } = await sb.rpc("admin_familias");
  if (error || !data) { $("who").textContent = "No tienes acceso de administrador (" + (error ? error.message : "sin datos") + ")."; return; }
  familias = data;
  $("who").textContent = `Administrador: ${session.user.email}`;
  const { data: aj } = await sb.rpc("admin_ajustes");
  if (aj && aj[0]) {
    const sel = $("cfg-dias"), v = String(aj[0].prueba_dias);
    if (![...sel.options].some(o => o.value === v)) sel.add(new Option(`${v} días`, v));
    sel.value = v;
  }
  $("cfg").hidden = false; $("tools").hidden = false;
  renderKpis(); renderList();
}

function msg(card, text, ok) { const m = card.querySelector("[data-msg]"); m.textContent = text; m.className = "msg " + (ok ? "ok" : "err"); }
async function copiar(texto, card) {
  try { await navigator.clipboard.writeText(texto); if (card) msg(card, "Correos copiados.", true); else alert("Correos copiados:\n" + texto); }
  catch { prompt("Copia estos correos:", texto); }
}

$("cfg-form").addEventListener("submit", async e => {
  e.preventDefault();
  const dias = parseInt($("cfg-dias").value, 10);
  const { error } = await sb.rpc("admin_set_prueba", { p_dias: dias });
  $("cfg-msg").textContent = error ? "No se pudo guardar: " + error.message : dias ? `Listo: las familias nuevas tendrán ${dias} días gratis.` : "Listo: las familias nuevas esperarán a que las actives.";
  $("cfg-msg").className = "msg " + (error ? "err" : "ok");
});

$("filtros").addEventListener("click", e => {
  const b = e.target.closest("[data-f]"); if (!b) return;
  filtro = b.dataset.f;
  $("filtros").querySelectorAll("[data-f]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderList();
});
$("buscar").addEventListener("input", e => { q = e.target.value.trim().toLowerCase(); renderList(); });
$("copiar-correos").addEventListener("click", () => {
  const correos = [...new Set(familias.filter(pasa).flatMap(f => (f.correos || "").split(", ")).filter(Boolean))];
  if (!correos.length) return alert("No hay correos en esta lista.");
  copiar(correos.join(", "));
});

$("list").addEventListener("change", e => {
  if (e.target.name === "dias") e.target.form.custom.hidden = e.target.value !== "custom";
  if (e.target.name === "metodo" && e.target.value === "cortesia") e.target.form.monto.value = "";
});
$("list").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target, card = form.closest("[data-fid]"), fd = new FormData(form);
  const dias = fd.get("dias") === "custom" ? parseInt(fd.get("custom"), 10) : parseInt(fd.get("dias"), 10);
  if (!(dias >= 1)) return msg(card, "Escribe cuántos días.", false);
  const metodo = fd.get("metodo"), monto = metodo === "cortesia" ? 0 : (parseFloat(String(fd.get("monto")).replace(",", ".")) || 0);
  if (metodo !== "cortesia" && !monto) return msg(card, "Escribe el monto que pagó, o elige «Prueba / cortesía».", false);
  const btn = form.querySelector("button"); btn.disabled = true;
  const { data, error } = await sb.rpc("admin_activar", { fid: card.dataset.fid, p_dias: dias, p_monto: monto, p_metodo: metodo, p_nota: fd.get("nota") || "" });
  btn.disabled = false;
  if (error) return msg(card, "No se pudo activar: " + error.message, false);
  await load();
  const c2 = document.querySelector(`[data-fid="${card.dataset.fid}"]`);
  if (c2) msg(c2, `Activada hasta el ${fecha(data)}${monto ? ` · pago de ${soles(monto)} registrado` : " · cortesía"}.`, true);
});
$("list").addEventListener("click", async e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const card = b.closest("[data-fid]"), f = familias.find(x => x.id === card.dataset.fid);
  if (b.dataset.a === "correos") return copiar(f.correos || "", card);
  let hasta;
  if (b.dataset.a === "fijar") { hasta = card.querySelector('input[name="hasta"]').value; if (!hasta) return msg(card, "Elige una fecha.", false); }
  else {
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "¿Seguro? Toca otra vez"; return; }
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1); hasta = iso(ayer);
  }
  const { error } = await sb.rpc("admin_plan_hasta", { fid: f.id, p_hasta: hasta, p_nota: b.dataset.a === "cortar" ? "Acceso cortado por el administrador" : "" });
  if (error) return msg(card, "No se pudo: " + error.message, false);
  await load();
  const c2 = document.querySelector(`[data-fid="${f.id}"]`);
  if (c2) msg(c2, b.dataset.a === "cortar" ? "Acceso cortado: pueden ver sus datos, pero no anotar." : `Acceso hasta el ${fecha(hasta)}.`, true);
});
$("list").addEventListener("toggle", async e => {
  const d = e.target; if (!d.matches || !d.matches("[data-hist]") || !d.open) return;
  const fid = d.closest("[data-fid]").dataset.fid;
  const { data, error } = await sb.from("pagos").select("created_at, monto, metodo, dias, hasta, nota, tipo").eq("family_id", fid).order("created_at", { ascending: false });
  d.querySelector("ul").innerHTML = error ? `<li>No se pudo cargar: ${esc(error.message)}</li>`
    : (data || []).map(p => `<li>${new Date(p.created_at).toLocaleDateString("es-PE")} · ${p.tipo === "pago" ? soles(p.monto) + " por " + esc(p.metodo) : p.tipo === "cortesia" ? "cortesía" : "ajuste"} · ${p.dias > 0 ? "+" + p.dias + " días" : "fecha fijada"} → hasta ${fecha(p.hasta)}${p.nota ? " · " + esc(p.nota) : ""}</li>`).join("") || "<li>Sin movimientos todavía.</li>";
}, true);

load();
