-- Cuadre · esquema de base de datos para Supabase (Postgres)
-- Pégalo completo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin romper nada (create if not exists / or replace).

create extension if not exists pgcrypto;

-- ---------- Tablas ----------

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (char_length(nombre) between 1 and 60),
  moneda      text not null default 'S/' check (char_length(moneda) between 1 and 5),
  formato     text not null default 'punto' check (formato in ('punto','coma')),
  dia_cobro   int  not null default 0 check (dia_cobro between 0 and 31),
  plan_hasta  date,                      -- acceso para anotar hasta esta fecha (incluida)
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rol         text not null default 'miembro' check (rol in ('dueno','miembro')),
  created_at  timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index if not exists members_user_idx on public.members(user_id);

create table if not exists public.personas (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  nombre      text not null check (char_length(nombre) between 1 and 30),
  color       text not null default '#2A62D4',
  apodos      text[] not null default '{}',
  es_familia  boolean not null default false,   -- la fila "Familia" (gastos en conjunto)
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists personas_family_idx on public.personas(family_id);

create table if not exists public.movimientos (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  tipo        text not null check (tipo in ('gasto','ingreso','prestamo','cobro')),
  monto       numeric(12,2) not null check (monto > 0),
  persona_id  uuid references public.personas(id) on delete set null,
  categoria   text not null default 'otros',
  nota        text not null default '' check (char_length(nota) <= 140),
  fecha       date not null,
  deudor      text not null default '' check (char_length(deudor) <= 60),
  prestamo_id uuid references public.movimientos(id) on delete set null,
  cerrado     boolean not null default false,
  origen      text,                              -- 'whatsapp' | 'respaldo' | null
  import_key  text,                              -- evita duplicar al importar dos veces
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz
);
create index if not exists movimientos_family_fecha_idx on public.movimientos(family_id, fecha);
create unique index if not exists movimientos_import_key_idx on public.movimientos(family_id, import_key) where import_key is not null;

create table if not exists public.invitaciones (
  code        text primary key,
  family_id   uuid not null references public.families(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references auth.users(id) on delete set null,
  used_at     timestamptz
);

create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.pagos (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  monto       numeric(12,2) not null default 0,
  metodo      text not null default 'yape',
  nota        text not null default '',
  dias        int not null,
  hasta       date not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------- Funciones de apoyo ----------

create or replace function public.is_member(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where family_id = fid and user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Puede anotar: es miembro y la familia tiene el plan vigente
create or replace function public.can_write(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m join public.families f on f.id = m.family_id
    where m.family_id = fid and m.user_id = auth.uid() and f.plan_hasta is not null and f.plan_hasta >= current_date
  );
$$;

-- Los miembros no pueden tocar plan_hasta (solo el admin con admin_activar)
create or replace function public.families_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan_hasta is distinct from old.plan_hasta and not public.is_admin() then
    raise exception 'plan_hasta solo lo cambia el administrador';
  end if;
  return new;
end $$;
drop trigger if exists families_guard_trg on public.families;
create trigger families_guard_trg before update on public.families
  for each row execute function public.families_guard();

create or replace function public.touch_movimiento() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.family_id := old.family_id;       -- nunca se mueve a otra familia
  return new;
end $$;
drop trigger if exists touch_movimiento_trg on public.movimientos;
create trigger touch_movimiento_trg before update on public.movimientos
  for each row execute function public.touch_movimiento();

-- ---------- RPC: crear familia (con 14 días de prueba) ----------

create or replace function public.crear_familia(p_nombre text, p_personas text[], p_moneda text default 'S/', p_dia_cobro int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  fid uuid;
  colores text[] := array['#C2347A','#2A62D4','#A86C06','#6A44B3','#BB3A26','#1A8150','#0E6FA6','#8A5A00'];
  i int := 0;
  n text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  if coalesce(array_length(p_personas, 1), 0) = 0 then raise exception 'Agrega al menos una persona'; end if;
  insert into public.families (nombre, moneda, dia_cobro, plan_hasta, created_by)
    values (trim(p_nombre), coalesce(nullif(trim(p_moneda), ''), 'S/'), coalesce(p_dia_cobro, 0), current_date + 14, auth.uid())
    returning id into fid;
  insert into public.members (family_id, user_id, rol) values (fid, auth.uid(), 'dueno');
  foreach n in array p_personas loop
    if trim(n) <> '' then
      insert into public.personas (family_id, nombre, color, orden) values (fid, left(trim(n), 30), colores[(i % 8) + 1], i);
      i := i + 1;
    end if;
  end loop;
  insert into public.personas (family_id, nombre, color, es_familia, orden) values (fid, 'Familia', '#0E8473', true, 99);
  return fid;
end $$;

-- ---------- RPC: invitaciones ----------

create or replace function public.crear_invitacion(fid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_member(fid) then raise exception 'No eres miembro de esta familia'; end if;
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.invitaciones (code, family_id, created_by) values (code, fid, auth.uid());
  return code;
end $$;

create or replace function public.aceptar_invitacion(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.invitaciones;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  select * into inv from public.invitaciones where code = upper(trim(p_code));
  if inv.code is null then raise exception 'El código no existe'; end if;
  if inv.used_at is not null then raise exception 'Ese código ya se usó'; end if;
  if inv.expires_at < now() then raise exception 'El código venció. Pide uno nuevo'; end if;
  insert into public.members (family_id, user_id) values (inv.family_id, auth.uid()) on conflict do nothing;
  update public.invitaciones set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.family_id;
end $$;

-- ---------- RPC: lo que ve cada miembro de su familia ----------

create or replace function public.miembros_de(fid uuid)
returns table (user_id uuid, rol text, nombre text, email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.rol,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)) as nombre,
         u.email, m.created_at
  from public.members m join auth.users u on u.id = m.user_id
  where m.family_id = fid and public.is_member(fid)
  order by m.created_at;
$$;

-- ---------- RPC: administración (solo admins) ----------

create or replace function public.admin_familias()
returns table (id uuid, nombre text, plan_hasta date, created_at timestamptz, miembros bigint, movimientos bigint, ultimo timestamptz, correos text)
language sql stable security definer set search_path = public as $$
  select f.id, f.nombre, f.plan_hasta, f.created_at,
         (select count(*) from public.members m where m.family_id = f.id),
         (select count(*) from public.movimientos x where x.family_id = f.id),
         (select max(x.created_at) from public.movimientos x where x.family_id = f.id),
         (select string_agg(u.email, ', ') from public.members m join auth.users u on u.id = m.user_id where m.family_id = f.id)
  from public.families f
  where public.is_admin()
  order by f.created_at desc;
$$;

create or replace function public.admin_activar(fid uuid, p_dias int, p_monto numeric default 0, p_metodo text default 'yape', p_nota text default '')
returns date language plpgsql security definer set search_path = public as $$
declare base date; hasta date;
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  select greatest(coalesce(plan_hasta, current_date), current_date) into base from public.families where id = fid;
  hasta := base + p_dias;
  update public.families set plan_hasta = hasta where id = fid;
  insert into public.pagos (family_id, monto, metodo, nota, dias, hasta, created_by) values (fid, p_monto, p_metodo, p_nota, p_dias, hasta, auth.uid());
  return hasta;
end $$;

-- ---------- Seguridad por filas (RLS) ----------

alter table public.families     enable row level security;
alter table public.members      enable row level security;
alter table public.personas     enable row level security;
alter table public.movimientos  enable row level security;
alter table public.invitaciones enable row level security;
alter table public.admins       enable row level security;
alter table public.pagos        enable row level security;

drop policy if exists families_select on public.families;
create policy families_select on public.families for select using (public.is_member(id) or public.is_admin());
drop policy if exists families_update on public.families;
create policy families_update on public.families for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_select on public.members;
create policy members_select on public.members for select using (public.is_member(family_id));
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete using (user_id = auth.uid());

drop policy if exists personas_all on public.personas;
create policy personas_all on public.personas for all using (public.is_member(family_id)) with check (public.is_member(family_id));

drop policy if exists mov_select on public.movimientos;
create policy mov_select on public.movimientos for select using (public.is_member(family_id));
drop policy if exists mov_insert on public.movimientos;
create policy mov_insert on public.movimientos for insert with check (public.can_write(family_id));
drop policy if exists mov_update on public.movimientos;
create policy mov_update on public.movimientos for update using (public.can_write(family_id)) with check (public.can_write(family_id));
drop policy if exists mov_delete on public.movimientos;
create policy mov_delete on public.movimientos for delete using (public.can_write(family_id));

drop policy if exists inv_select on public.invitaciones;
create policy inv_select on public.invitaciones for select using (public.is_member(family_id));

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select using (user_id = auth.uid());

drop policy if exists pagos_admin on public.pagos;
create policy pagos_admin on public.pagos for select using (public.is_admin() or public.is_member(family_id));

-- ---------- Tiempo real ----------
-- Para que lo que anota uno aparezca al instante en el celular del otro.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'movimientos') then
    alter publication supabase_realtime add table public.movimientos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'personas') then
    alter publication supabase_realtime add table public.personas;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'families') then
    alter publication supabase_realtime add table public.families;
  end if;
end $$;
alter table public.movimientos replica identity full;

-- ---------- Hacerte administrador ----------
-- Entra una vez a la app con tu Google y luego ejecuta (cambia el correo):
-- insert into public.admins (user_id) select id from auth.users where email = 'tu-correo@gmail.com' on conflict do nothing;
