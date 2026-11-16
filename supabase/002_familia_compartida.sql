-- Cuadre · actualización 002: enlace de invitación para toda la familia, "quién soy",
-- quitar o salir de una familia, y miembros en tiempo real.
-- Ejecútalo DESPUÉS de schema.sql: Supabase → SQL Editor → New query → pega todo → Run.
-- Se puede volver a ejecutar sin romper nada.

-- ---------- Columnas nuevas ----------
alter table public.invitaciones add column if not exists max_usos int not null default 10;
alter table public.invitaciones add column if not exists usos     int not null default 0;
alter table public.invitaciones add column if not exists revocada boolean not null default false;
alter table public.members      add column if not exists persona_id uuid references public.personas(id) on delete set null;

-- ---------- Apoyo ----------
create or replace function public.is_owner(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where family_id = fid and user_id = auth.uid() and rol = 'dueno');
$$;

-- ---------- Invitaciones ----------
-- Devuelve el enlace vigente de la familia (lo crea si no hay): sirve para varias personas.
create or replace function public.crear_invitacion(fid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_member(fid) then raise exception 'No eres miembro de esta familia'; end if;
  select code into c from public.invitaciones
   where family_id = fid and not revocada and expires_at > now() and usos < max_usos
   order by created_at desc limit 1;
  if c is not null then return c; end if;
  c := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  insert into public.invitaciones (code, family_id, created_by, expires_at, max_usos)
    values (c, fid, auth.uid(), now() + interval '14 days', 10);
  return c;
end $$;

-- Anula los enlaces anteriores y crea uno nuevo
create or replace function public.nueva_invitacion(fid uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(fid) then raise exception 'No eres miembro de esta familia'; end if;
  update public.invitaciones set revocada = true where family_id = fid and not revocada;
  return public.crear_invitacion(fid);
end $$;

drop function if exists public.ver_invitacion(text);
-- Lo que ve alguien que abre un enlace, antes de unirse: nombre de la familia y sus personas
create or replace function public.ver_invitacion(p_code text)
returns table (familia_id uuid, familia text, personas jsonb, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare inv public.invitaciones;
begin
  select * into inv from public.invitaciones where code = upper(trim(p_code));
  if inv.code is null then return query select null::uuid, null::text, null::jsonb, 'El código no existe. Revisa que esté bien escrito.'; return; end if;
  if inv.revocada then return query select null::uuid, null::text, null::jsonb, 'Este enlace ya no sirve. Pide uno nuevo.'; return; end if;
  if inv.expires_at < now() then return query select null::uuid, null::text, null::jsonb, 'Este enlace venció. Pide uno nuevo.'; return; end if;
  if inv.usos >= inv.max_usos then return query select null::uuid, null::text, null::jsonb, 'Este enlace ya se usó demasiadas veces. Pide uno nuevo.'; return; end if;
  return query
    select f.id, f.nombre,
           coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'color', p.color) order by p.orden)
                       from public.personas p where p.family_id = f.id and not p.es_familia), '[]'::jsonb),
           null::text
    from public.families f where f.id = inv.family_id;
end $$;

drop function if exists public.aceptar_invitacion(text);
create or replace function public.aceptar_invitacion(p_code text, p_persona uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.invitaciones;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  select * into inv from public.invitaciones where code = upper(trim(p_code)) for update;
  if inv.code is null then raise exception 'El código no existe'; end if;
  if exists (select 1 from public.members where family_id = inv.family_id and user_id = auth.uid()) then
    return inv.family_id;                      -- ya era miembro: no gasta un uso
  end if;
  if inv.revocada then raise exception 'Este enlace ya no sirve. Pide uno nuevo'; end if;
  if inv.expires_at < now() then raise exception 'Este enlace venció. Pide uno nuevo'; end if;
  if inv.usos >= inv.max_usos then raise exception 'Este enlace ya se usó demasiadas veces. Pide uno nuevo'; end if;
  if p_persona is not null and not exists (select 1 from public.personas where id = p_persona and family_id = inv.family_id) then
    p_persona := null;
  end if;
  insert into public.members (family_id, user_id, persona_id) values (inv.family_id, auth.uid(), p_persona);
  update public.invitaciones set usos = usos + 1, used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.family_id;
end $$;

-- ---------- Miembros ----------
-- "Yo soy esta persona" (para saber quién anotó cada cosa)
create or replace function public.soy(fid uuid, p_persona uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_persona is not null and not exists (select 1 from public.personas where id = p_persona and family_id = fid and not es_familia) then
    raise exception 'Esa persona no es de esta familia';
  end if;
  update public.members set persona_id = p_persona where family_id = fid and user_id = auth.uid();
end $$;

-- Quitar a alguien (solo quien creó la familia) o salirse uno mismo
create or replace function public.quitar_miembro(fid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare era_dueno boolean;
begin
  if uid <> auth.uid() and not public.is_owner(fid) then raise exception 'Solo quien creó la familia puede quitar a alguien'; end if;
  select rol = 'dueno' into era_dueno from public.members where family_id = fid and user_id = uid;
  delete from public.members where family_id = fid and user_id = uid;
  -- Si se fue quien creó la familia, el miembro más antiguo pasa a ser el responsable
  if era_dueno and not exists (select 1 from public.members where family_id = fid and rol = 'dueno') then
    update public.members set rol = 'dueno'
     where family_id = fid and user_id = (select user_id from public.members where family_id = fid order by created_at limit 1);
  end if;
end $$;

drop policy if exists members_delete on public.members;   -- ahora solo por quitar_miembro

drop function if exists public.miembros_de(uuid);
create or replace function public.miembros_de(fid uuid)
returns table (user_id uuid, rol text, nombre text, email text, persona_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.rol,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
         u.email, m.persona_id, m.created_at
  from public.members m join auth.users u on u.id = m.user_id
  where m.family_id = fid and public.is_member(fid)
  order by m.created_at;
$$;

-- ---------- Administración: más detalle de cada familia (sin ver sus movimientos) ----------
drop function if exists public.admin_familias();
create or replace function public.admin_familias()
returns table (id uuid, nombre text, plan_hasta date, created_at timestamptz, miembros bigint, movimientos bigint,
               ultimo timestamptz, correos text, nombres text, pagado numeric, ultimo_pago date)
language sql stable security definer set search_path = public as $$
  select f.id, f.nombre, f.plan_hasta, f.created_at,
         (select count(*) from public.members m where m.family_id = f.id),
         (select count(*) from public.movimientos x where x.family_id = f.id),
         (select max(greatest(x.created_at, coalesce(x.updated_at, x.created_at))) from public.movimientos x where x.family_id = f.id),
         (select string_agg(u.email, ', ' order by m.created_at) from public.members m join auth.users u on u.id = m.user_id where m.family_id = f.id),
         (select string_agg(p.nombre, ', ' order by p.orden) from public.personas p where p.family_id = f.id and not p.es_familia),
         (select coalesce(sum(pg.monto), 0) from public.pagos pg where pg.family_id = f.id),
         (select max(pg.created_at)::date from public.pagos pg where pg.family_id = f.id)
  from public.families f
  where public.is_admin()
  order by f.created_at desc;
$$;

-- ---------- Tiempo real también para los miembros ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'members') then
    alter publication supabase_realtime add table public.members;
  end if;
end $$;
