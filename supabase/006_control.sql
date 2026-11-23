-- 006 · Control: tarjeta de crédito, ahorros, ajustes de saldo, pagos fijos y presupuestos.
-- Ejecútalo una vez en Supabase → SQL Editor → New query → Run. Se puede volver a ejecutar sin problema.

-- Nuevos tipos de movimiento:
--   ahorro       guardan plata (sale de «Les queda», suma a ahorros)
--   retiro       usan sus ahorros (entra a «Les queda», baja ahorros)
--   pagotarjeta  pagan la tarjeta de crédito (baja el efectivo y la deuda; no es un gasto nuevo)
--   ajuste_mas / ajuste_menos  cuadran el efectivo con lo que tienen de verdad
alter table public.movimientos drop constraint if exists movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo in ('gasto','ingreso','prestamo','cobro','ahorro','retiro','pagotarjeta','ajuste_mas','ajuste_menos'));

-- Cómo se pagó: null = efectivo/cuenta, 'tarjeta' = tarjeta de crédito (se descuenta del efectivo al pagarla)
alter table public.movimientos add column if not exists medio text;
alter table public.movimientos drop constraint if exists movimientos_medio_check;
alter table public.movimientos add constraint movimientos_medio_check check (medio is null or medio in ('tarjeta'));

-- Pago fijo al que corresponde el movimiento (si se anotó desde «Pagos fijos»)
alter table public.movimientos add column if not exists fijo_id text;

-- Configuración de control por familia
alter table public.families add column if not exists presupuestos   jsonb   not null default '{}'::jsonb;
alter table public.families add column if not exists fijos          jsonb   not null default '[]'::jsonb;
alter table public.families add column if not exists ahorro_inicial numeric not null default 0;
alter table public.families add column if not exists tc_inicial     numeric not null default 0;
alter table public.families add column if not exists tc_dia         int     not null default 20;

alter table public.families drop constraint if exists families_tc_dia_check;
alter table public.families add constraint families_tc_dia_check check (tc_dia between 1 and 31);
alter table public.families drop constraint if exists families_presupuestos_check;
alter table public.families add constraint families_presupuestos_check check (jsonb_typeof(presupuestos) = 'object' and pg_column_size(presupuestos) < 8000);
alter table public.families drop constraint if exists families_fijos_check;
alter table public.families add constraint families_fijos_check check (jsonb_typeof(fijos) = 'array' and jsonb_array_length(fijos) <= 30 and pg_column_size(fijos) < 16000);

create index if not exists movimientos_medio_idx on public.movimientos (family_id) where medio = 'tarjeta';
