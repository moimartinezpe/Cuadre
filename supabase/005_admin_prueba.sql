-- Cuadre · actualización 005: el administrador decide la prueba gratis y el acceso de cada familia.
-- Ejecútalo: Supabase → SQL Editor → New query → pega todo → Run.

-- ---------- Ajustes del servicio (una sola fila) ----------
create table if not exists public.app_ajustes (
  id          int primary key default 1 check (id = 1),
  prueba_dias int not null default 14 check (prueba_dias between 0 and 365),
  updated_at  timestamptz not null default now()
);
insert into public.app_ajustes (id) values (1) on conflict do nothing;
alter table public.app_ajustes enable row level security;
drop policy if exists app_ajustes_admin on public.app_ajustes;
create policy app_ajustes_admin on public.app_ajustes for select using (public.is_admin());

-- Pagos: distinguir cortesías y ajustes de los cobros reales
alter table public.pagos add column if not exists tipo text not null default 'pago' check (tipo in ('pago','cortesia','ajuste'));

-- ---------- Crear familia: usa la prueba configurada (0 = sin acceso hasta que el admin active) ----------
create or replace function public.crear_familia(p_nombre text, p_personas text[], p_moneda text default 'S/', p_dia_cobro int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  fid uuid;
  colores text[] := array['#C2347A','#2A62D4','#A86C06','#6A44B3','#BB3A26','#1A8150','#0E6FA6','#8A5A00'];
  i int := 0;
  n text;
  dias int := coalesce((select prueba_dias from public.app_ajustes where id = 1), 14);
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  if coalesce(array_length(p_personas, 1), 0) = 0 then raise exception 'Agrega al menos una persona'; end if;
  insert into public.families (nombre, moneda, dia_cobro, plan_hasta, created_by)
    values (trim(p_nombre), coalesce(nullif(trim(p_moneda), ''), 'S/'), coalesce(p_dia_cobro, 0),
            case when dias > 0 then current_date + dias else null end, auth.uid())
    returning id into fid;
  insert into public.members (family_id, user_id, rol) values (fid, auth.uid(), 'dueno');
  foreach n in array p_personas loop
    if trim(n) <> '' then
      insert into public.personas (family_id, nombre, color, orden) values (fid, left(trim(n), 30), colores[(i % 8) + 1], i);
      i := i + 1;
    end if;
  end loop;
  insert into public.personas (family_id, nombre, color, es_familia, orden) values (fid, 'Familia', '#0E8473', true, 99);
  if dias > 0 then
    insert into public.pagos (family_id, monto, metodo, nota, dias, hasta, tipo, created_by)
      values (fid, 0, 'prueba', 'Prueba gratis automática', dias, current_date + dias, 'cortesia', auth.uid());
  end if;
  return fid;
end $$;

-- ---------- RPC del administrador ----------
create or replace function public.admin_ajustes() returns table (prueba_dias int)
language sql stable security definer set search_path = public as $$
  select a.prueba_dias from public.app_ajustes a where a.id = 1 and public.is_admin();
$$;

create or replace function public.admin_set_prueba(p_dias int) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  if p_dias < 0 or p_dias > 365 then raise exception 'Entre 0 y 365 días'; end if;
  update public.app_ajustes set prueba_dias = p_dias, updated_at = now() where id = 1;
  return p_dias;
end $$;

-- Suma días (pago, cortesía) desde hoy o desde que vence, lo que sea más tarde
drop function if exists public.admin_activar(uuid, int, numeric, text, text);
create or replace function public.admin_activar(fid uuid, p_dias int, p_monto numeric default 0, p_metodo text default 'yape', p_nota text default '')
returns date language plpgsql security definer set search_path = public as $$
declare base date; hasta date; t text;
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  if p_dias < 1 or p_dias > 3660 then raise exception 'Días inválidos'; end if;
  select greatest(coalesce(plan_hasta, current_date), current_date) into base from public.families where id = fid;
  if base is null then raise exception 'La familia no existe'; end if;
  hasta := base + p_dias;
  t := case when p_metodo in ('cortesia','prueba') or coalesce(p_monto, 0) = 0 then 'cortesia' else 'pago' end;
  update public.families set plan_hasta = hasta where id = fid;
  insert into public.pagos (family_id, monto, metodo, nota, dias, hasta, tipo, created_by)
    values (fid, coalesce(p_monto, 0), p_metodo, coalesce(p_nota, ''), p_dias, hasta, t, auth.uid());
  return hasta;
end $$;

-- Fija una fecha exacta. Una fecha pasada corta el acceso (pueden ver, no anotar).
create or replace function public.admin_plan_hasta(fid uuid, p_hasta date, p_nota text default '')
returns date language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  update public.families set plan_hasta = p_hasta where id = fid;
  if not found then raise exception 'La familia no existe'; end if;
  insert into public.pagos (family_id, monto, metodo, nota, dias, hasta, tipo, created_by)
    values (fid, 0, 'ajuste', coalesce(nullif(p_nota, ''), case when p_hasta < current_date then 'Acceso cortado' else 'Fecha fijada a mano' end),
            p_hasta - current_date, p_hasta, 'ajuste', auth.uid());
  return p_hasta;
end $$;

-- Lista de familias con lo necesario para vender (sin ver sus movimientos)
drop function if exists public.admin_familias();
create or replace function public.admin_familias()
returns table (id uuid, nombre text, plan_hasta date, created_at timestamptz, miembros bigint, movimientos bigint,
               ultimo timestamptz, correos text, nombres text, pagado numeric, ultimo_pago date, pagos_reales bigint,
               movs_7d bigint)
language sql stable security definer set search_path = public as $$
  select f.id, f.nombre, f.plan_hasta, f.created_at,
         (select count(*) from public.members m where m.family_id = f.id),
         (select count(*) from public.movimientos x where x.family_id = f.id),
         (select max(greatest(x.created_at, coalesce(x.updated_at, x.created_at))) from public.movimientos x where x.family_id = f.id),
         (select string_agg(u.email, ', ' order by m.created_at) from public.members m join auth.users u on u.id = m.user_id where m.family_id = f.id),
         (select string_agg(p.nombre, ', ' order by p.orden) from public.personas p where p.family_id = f.id and not p.es_familia),
         (select coalesce(sum(pg.monto), 0) from public.pagos pg where pg.family_id = f.id and pg.tipo = 'pago'),
         (select max(pg.created_at)::date from public.pagos pg where pg.family_id = f.id and pg.tipo = 'pago'),
         (select count(*) from public.pagos pg where pg.family_id = f.id and pg.tipo = 'pago'),
         (select count(*) from public.movimientos x where x.family_id = f.id and x.created_at > now() - interval '7 days')
  from public.families f
  where public.is_admin()
  order by f.created_at desc;
$$;

revoke execute on function public.admin_ajustes()                                 from anon, public;
revoke execute on function public.admin_set_prueba(int)                           from anon, public;
revoke execute on function public.admin_activar(uuid, int, numeric, text, text)   from anon, public;
revoke execute on function public.admin_plan_hasta(uuid, date, text)              from anon, public;
revoke execute on function public.admin_familias()                                from anon, public;
revoke execute on function public.crear_familia(text, text[], text, int)          from anon, public;
grant  execute on function public.admin_ajustes()                                 to authenticated;
grant  execute on function public.admin_set_prueba(int)                           to authenticated;
grant  execute on function public.admin_activar(uuid, int, numeric, text, text)   to authenticated;
grant  execute on function public.admin_plan_hasta(uuid, date, text)              to authenticated;
grant  execute on function public.admin_familias()                                to authenticated;
grant  execute on function public.crear_familia(text, text[], text, int)          to authenticated;
