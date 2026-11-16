// Configuración de Cuadre. Estos valores son públicos (van en el navegador): la seguridad
// la ponen las reglas RLS de la base de datos, no estas claves.
export const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
export const SUPABASE_ANON_KEY = "TU_ANON_KEY";

// Lo que ve una familia cuando se le vence el plan.
export const PLAN = {
  precioMes: "S/ 9.90",
  precioAnio: "S/ 79",
  // Cómo pagan. Se muestra tal cual. Ejemplo: "Yape o Plin al 999 999 999 (Moisés M.)"
  instrucciones: "Yape o Plin al 999 999 999 a nombre de Moisés. Luego escríbenos por WhatsApp con tu correo.",
  whatsapp: "51999999999", // número para el botón "Avisar que pagué", con código de país y sin +
};
