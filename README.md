# Cuadre

Las cuentas de la casa, cuadradas. App web (instalable en el celular) para que una familia anote ingresos, gastos y préstamos escribiendo como en el chat.

- **Frontend:** HTML + JS sin frameworks (`index.html`, `js/`). Se publica como sitio estático.
- **Backend:** [Supabase](https://supabase.com) (Postgres + login con Google + tiempo real). Esquema en `supabase/schema.sql`.
- **Hosting:** Cloudflare Pages (gratis) o cualquier hosting estático.
- **Cobros:** manual al inicio (Yape/Plin). El admin activa días desde `admin.html`.

## Puesta en marcha (una sola vez, ~30 min)

### 1. Supabase
1. Crea una cuenta en supabase.com y un proyecto nuevo (región *South America (São Paulo)*). Guarda la contraseña de la base de datos.
2. En **SQL Editor → New query**, pega todo `supabase/schema.sql` y ejecuta (*Run*). Luego, en otra query, `supabase/002_familia_compartida.sql`, y después `supabase/003_seguridad.sql`, ejecutando cada uno.
3. En **Project Settings → API** copia la **Project URL** y la **anon public key** y pégalas en `js/config.js`.
4. Edita también en `js/config.js` el precio, las instrucciones de pago y tu número de WhatsApp.

### 2. Login con Google
1. En [console.cloud.google.com](https://console.cloud.google.com) crea un proyecto → **APIs y servicios → Pantalla de consentimiento OAuth** (tipo Externo, nombre "Cuadre", tu correo). Publica la app.
2. **Credenciales → Crear credencial → ID de cliente OAuth → Aplicación web**.
   - Orígenes autorizados: `https://cuadre.pe` (tu dominio) y `https://TU-PROYECTO.supabase.co`.
   - URI de redirección: `https://TU-PROYECTO.supabase.co/auth/v1/callback`.
3. Copia el **Client ID** y el **Client Secret**.
4. En Supabase: **Authentication → Providers → Google**: activa, pega ID y Secret, guarda.
5. En Supabase: **Authentication → URL Configuration**: *Site URL* = `https://cuadre.pe`; en *Redirect URLs* agrega `https://cuadre.pe/**` (y `http://localhost:8080/**` si pruebas en tu PC).

### 3. Publicar en Cloudflare Pages
1. Sube esta carpeta a un repositorio de GitHub.
2. En [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git** → elige el repo.
   - Framework preset: *None*. Build command: vacío. Build output directory: `/`.
3. Cuando termine, abre la URL `*.pages.dev` y prueba entrar con Google.
4. **Custom domains → Set up a custom domain** → `cuadre.pe` (sigue las instrucciones de DNS de tu registrador).

### 4. Hacerte administrador
Entra una vez a la app con tu Google. Luego en Supabase **SQL Editor** ejecuta:

```sql
insert into public.admins (user_id) select id from auth.users where email = 'TU-CORREO@gmail.com' on conflict do nothing;
```

Ya puedes abrir `https://cuadre.pe/admin.html` para ver familias y activar días pagados.

### 5. Migrar tus datos actuales
En la app: **Ajustes → Restaurar respaldo JSON** → elige `migracion/respaldo-moises.json`. Crea las personas que falten y carga los 113 movimientos sin duplicar.

## Familias compartidas
- **Invitar:** Ajustes → *Invitar a la familia*. Un mismo enlace sirve para hasta 10 personas durante 14 días; *Anular este enlace y crear otro* deja sin efecto el anterior.
- **Unirse:** quien abre el enlace entra con su Google, ve el nombre de la familia y elige quién es ("Soy Briggit" o "Soy otra persona"). Si ya era miembro, entra directo.
- **Tiempo real:** todos ven y editan lo mismo al instante; aparece "Briggit anotó: Taxi −S/ 15", cada movimiento dice *por quién* y arriba se ve quién está en línea.
- **Miembros:** quien creó la familia puede quitar a alguien; los demás pueden salirse. Los movimientos se quedan.

## Cómo funciona el cobro
- Cada familia nueva tiene **14 días gratis** (`plan_hasta` = hoy + 14).
- Vencido el plan, la familia **ve todo pero no puede anotar**: lo bloquea la base de datos (RLS), no solo la pantalla.
- El cliente paga por Yape/Plin y te avisa por WhatsApp (botón en Ajustes). Tú entras a `admin.html` y activas +30 o +365 días.

## Seguridad
- Cada fila lleva `family_id`; las políticas RLS en `schema.sql` solo dejan leer y escribir a los miembros de esa familia. Ni el admin ve los movimientos de nadie (solo nombre de familia, correos, conteos y fecha de plan).
- La *anon key* es pública por diseño; no pongas la *service_role key* en ningún archivo del sitio.
- Antes de cobrar en serio: publica `privacidad.html` y `terminos.html` con tus datos, y revisa la Ley 29733 (registro del banco de datos ante la ANPD).

## Probar en tu PC
```
python3 -m http.server 8080
```
y abre http://localhost:8080 (agrega esa URL en Supabase → Redirect URLs).

## Estructura
```
index.html           la app
admin.html           panel del dueño (solo admins)
js/app.js            lógica de la app
js/parser.js         analizador de mensajes ("taxi 15 ana") e importador de WhatsApp
js/admin.js          lógica del panel
js/config.js         URL y clave pública de Supabase, precios, WhatsApp
supabase/schema.sql  tablas, funciones, seguridad (RLS) y tiempo real
sw.js, manifest.webmanifest, icons/   instalable como app (PWA)
privacidad.html, terminos.html        textos legales (completar)
migracion/           respaldo de los datos de la versión anterior
```
