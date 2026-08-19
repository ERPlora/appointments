-- appointments#69: vence las retenciones a las que se les acabó el tiempo.
--
-- ⚠️ **Esta barrida NO es la que libera el hueco.** Quien decide es la lectura: tanto
-- `slot_holds.live` como `slot_holds.upcoming` exigen `expires_at > :now`, así que una retención
-- caducada deja de contar en el instante exacto en que caduca, sin esperar a nadie. Esto es a
-- propósito y es la lección más cara del mercado: WooCommerce libera el stock retenido desde un
-- cron programado al MISMO intervalo que la retención, así que la liberación real cae en algún
-- punto entre T+x y T+2x — y cuando el cron no corre (loopback/REST bloqueados, un clásico), el
-- stock se queda bloqueado PARA SIEMPRE. La implementación de referencia de Redis eligió justo lo
-- contrario, reconciliar al leer y no tener worker, por este motivo.
--
-- Lo que sí hace esta tarea es dejar la TABLA limpia y contable: pasar la fila a `expired` para
-- que no crezca un montón de filas `held` muertas y para poder distinguir «lo soltaron» (una
-- decisión) de «se acabó el tiempo» (nadie decidió). Que se retrase una pasada no le cuesta un
-- hueco a nadie.
--
-- No filtra por `source`: cualquier retención vencida se barre, venga del panel de la bandeja, de
-- la API o de donde sea. WooCommerce solo barre los pedidos `created_via checkout`/`store-api` y
-- los creados por cualquier otra puerta retienen stock indefinidamente; una puerta lateral tiene
-- que tener el mismo barrendero que la principal.
UPDATE appointments_slot_hold SET
    status     = 'expired',
    updated_by = :current_user_id,
    updated_at = :now
WHERE hub_id = :hub_id AND status = 'held' AND is_deleted = 0
  AND erp_dt(expires_at) <= erp_dt(:now);
