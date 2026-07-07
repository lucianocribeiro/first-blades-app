-- 0010_notification_type_franco.sql
-- FB-F3-13: agrega los valores de alerta de franco al enum notification_type.
--
-- Migración separada (no fusionada con 0011) a propósito: Postgres prohíbe
-- usar un valor de enum recién agregado (ALTER TYPE ... ADD VALUE) en la
-- MISMA transacción/migración que lo agrega ("unsafe use of new value of
-- enum type"). 0011 referencia 'sin_franco'/'franco_excedido' en un CHECK,
-- así que el ADD VALUE tiene que quedar commiteado en un paso previo.
ALTER TYPE public.notification_type ADD VALUE 'sin_franco';
ALTER TYPE public.notification_type ADD VALUE 'franco_excedido';
