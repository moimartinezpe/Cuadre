-- Cuadre · actualización 004: arregla la creación del código de invitación.
-- En Supabase, gen_random_bytes vive en el esquema "extensions" y la función no lo encontraba.
-- Ejecútalo: Supabase → SQL Editor → New query → pega todo → Run.

create or replace function public.crear_invitacion(fid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_member(fid) then raise exception 'No eres miembro de esta familia'; end if;
  select code into c from public.invitaciones
   where family_id = fid and not revocada and expires_at > now() and usos < max_usos
   order by created_at desc limit 1;
  if c is not null then return c; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.invitaciones (code, family_id, created_by, expires_at, max_usos)
    values (c, fid, auth.uid(), now() + interval '14 days', 10);
  return c;
end $$;

revoke execute on function public.crear_invitacion(uuid) from anon, public;
grant  execute on function public.crear_invitacion(uuid) to authenticated;
