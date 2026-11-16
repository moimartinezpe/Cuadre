-- Cuadre · actualización 003: refuerzo de seguridad.
-- Ejecútalo después de 002: Supabase → SQL Editor → New query → pega todo → Run.

-- quitar_miembro: exige sesión iniciada. Antes, sin sesión, auth.uid() es null,
-- la comparación "uid <> auth.uid()" daba null y se saltaba el control de dueño.
create or replace function public.quitar_miembro(fid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare era_dueno boolean;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  if uid is distinct from auth.uid() and not public.is_owner(fid) then
    raise exception 'Solo quien creó la familia puede quitar a alguien';
  end if;
  select rol = 'dueno' into era_dueno from public.members where family_id = fid and user_id = uid;
  delete from public.members where family_id = fid and user_id = uid;
  if era_dueno and not exists (select 1 from public.members where family_id = fid and rol = 'dueno') then
    update public.members set rol = 'dueno'
     where family_id = fid and user_id = (select user_id from public.members where family_id = fid order by created_at limit 1);
  end if;
end $$;

-- Nadie sin sesión puede llamar funciones que cambian datos.
-- (ver_invitacion sí queda abierta: muestra a qué familia te invitan antes de entrar.)
revoke execute on function public.crear_familia(text, text[], text, int)        from anon, public;
revoke execute on function public.crear_invitacion(uuid)                         from anon, public;
revoke execute on function public.nueva_invitacion(uuid)                         from anon, public;
revoke execute on function public.aceptar_invitacion(text, uuid)                 from anon, public;
revoke execute on function public.soy(uuid, uuid)                                from anon, public;
revoke execute on function public.quitar_miembro(uuid, uuid)                     from anon, public;
revoke execute on function public.miembros_de(uuid)                              from anon, public;
revoke execute on function public.admin_familias()                               from anon, public;
revoke execute on function public.admin_activar(uuid, int, numeric, text, text)  from anon, public;

grant execute on function public.crear_familia(text, text[], text, int)        to authenticated;
grant execute on function public.crear_invitacion(uuid)                         to authenticated;
grant execute on function public.nueva_invitacion(uuid)                         to authenticated;
grant execute on function public.aceptar_invitacion(text, uuid)                 to authenticated;
grant execute on function public.soy(uuid, uuid)                                to authenticated;
grant execute on function public.quitar_miembro(uuid, uuid)                     to authenticated;
grant execute on function public.miembros_de(uuid)                              to authenticated;
grant execute on function public.admin_familias()                               to authenticated;
grant execute on function public.admin_activar(uuid, int, numeric, text, text)  to authenticated;
grant execute on function public.ver_invitacion(text)                           to anon, authenticated;
