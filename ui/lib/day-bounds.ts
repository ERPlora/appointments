/** El día de la agenda, en la zona del NEGOCIO (pm#93, hallazgo lateral).
 *
 * Antes esto vivía suelto en dos componentes como `new Date().toISOString().slice(0, 10)` más una
 * ventana `${day}T00:00:00.000Z` + 24 h — es decir, `appointments` trabajaba en **días UTC** de
 * punta a punta.
 *
 * 🔴 Por qué está mal, con el caso concreto: a las **00:30 en Madrid** (CEST = UTC+2) todavía son
 * las 22:30 del día ANTERIOR en UTC. La recepcionista abre la agenda y ve **el día de ayer**; y una
 * cita de las 00:30 cae en el día UTC anterior, así que sale en la agenda equivocada.
 *
 * Para un negocio, «hoy» es el día de su reloj de pared. Es el mismo criterio que `sales` aplica en
 * su histórico y `cash_register` al pintar una fecha.
 *
 * ⚠️ Los límites NO se calculan con un `+24h`: en los días de cambio de hora el día local dura 23 o
 * 25 horas, y sumar 24 dejaría fuera (o repetiría) una hora de citas, una vez al año, en silencio.
 * El constructor local con `d + 1` resuelve el salto, y de paso el fin de mes y el de año.
 *
 * Los límites se devuelven en ISO/UTC a propósito: la ventana es el día LOCAL, pero el SQL compara
 * `start_datetime`, que son instantes. Lo local es dónde empieza y acaba el día, no el formato.
 */
export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ventana `[day_start, day_end)` del día LOCAL `day` (`YYYY-MM-DD`), en instantes ISO. */
export function dayBounds(day: string): { day_start: string; day_end: string } {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { day_start: start.toISOString(), day_end: end.toISOString() };
}
