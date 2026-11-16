// Panel del dueño del servicio: ver familias y activar días pagados.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoy = new Date().toISOString().slice(0, 10);
const fecha = d => d ? new Date(d + "T00:00:00").toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" }) : "—";

async function load() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("who").innerHTML = 'Entra primero en <a href="./">la app</a> con tu cuenta de administrador.'; return; }
  const { data, error } = await sb.rpc("admin_familias");
  if (error || !data) { $("who").textContent = "No tienes acceso de administrador (" + (error ? error.message : "sin datos") + ")."; return; }
  $("who").textContent = `${session.user.email} · ${data.length} familias · ${data.filter(f => f.plan_hasta >= hoy).length} activas`;
  $("list").innerHTML = data.map(f => {
    const activa = f.plan_hasta && f.plan_hasta >= hoy;
    return `<div class="card"><div class="fam"><div><b>${esc(f.nombre)}</b> <span class="st ${activa ? "ok" : "bad"}">${activa ? "activa hasta " + fecha(f.plan_hasta) : "vencida " + fecha(f.plan_hasta)}</span><small>${esc(f.correos || "")}</small><small>${f.miembros} ${f.miembros == 1 ? "persona" : "personas"} · ${f.movimientos} movimientos · último ${f.ultimo ? new Date(f.ultimo).toLocaleDateString("es-PE") : "nunca"} · creada ${new Date(f.created_at).toLocaleDateString("es-PE")}</small></div></div>
      <form class="row" data-fid="${f.id}"><select name="dias"><option value="30">+30 días (mes)</option><option value="365">+365 días (año)</option><option value="14">+14 días (prueba)</option><option value="7">+7 días</option></select><input class="n" name="monto" inputmode="decimal" placeholder="Monto" value=""><select name="metodo"><option value="yape">Yape</option><option value="plin">Plin</option><option value="transferencia">Transferencia</option><option value="cortesia">Cortesía</option></select><input name="nota" placeholder="Nota (opcional)"><button class="btn p" type="submit">Activar</button></form></div>`;
  }).join("") || "<p class='muted'>Todavía no hay familias.</p>";
  document.querySelectorAll("form[data-fid]").forEach(form => form.addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(form), btn = form.querySelector("button"); btn.disabled = true;
    const { data, error } = await sb.rpc("admin_activar", { fid: form.dataset.fid, p_dias: parseInt(fd.get("dias"), 10), p_monto: parseFloat(String(fd.get("monto")).replace(",", ".")) || 0, p_metodo: fd.get("metodo"), p_nota: fd.get("nota") || "" });
    btn.disabled = false;
    if (error) return alert("No se pudo activar: " + error.message);
    alert("Activada hasta el " + fecha(data)); load();
  }));
}
load();
