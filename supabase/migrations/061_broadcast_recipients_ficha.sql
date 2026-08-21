-- Ficha (pac_codigo) asociada al envio especifico de este destinatario
-- de campaña. Necesario para "lock-in" de ficha al confirmar "SI": un
-- mismo telefono puede recibir campañas para distintas fichas (ej.
-- familiares compartiendo numero), asi que hace falta saber con QUE
-- ficha se envio ESTA campaña puntual, no solo la ficha actual del
-- contacto (que puede quedar desactualizada o pertenecer a otro
-- familiar).
ALTER TABLE public.broadcast_recipients
  ADD COLUMN ficha text;
