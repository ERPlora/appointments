// pm#93 (hallazgo lateral) — el día de la agenda es el día LOCAL, no el día UTC.
//
// Lo que había: `todayISO()` hacía `new Date().toISOString().slice(0, 10)` y la ventana se construía
// como `${day}T00:00:00.000Z` + 24 h. `appointments` trabajaba en **días UTC** de punta a punta: la
// etiqueta, los límites y el rango SQL.
//
// El caso que lo rompe: a las **00:30 en Madrid** (CEST = UTC+2) todavía son las 22:30 del día
// ANTERIOR en UTC. La recepcionista abre la agenda y ve **el día de ayer**.
//
// Mismo criterio que `sales` en su histórico y `cash_register` al pintar una fecha: para un negocio,
// «hoy» es el día de su reloj de pared.
import { describe, expect, it } from 'vitest';
import { todayISO, dayBounds } from './day-bounds';

describe('el día de la agenda es el LOCAL', () => {
  it('`todayISO` devuelve el día del reloj de pared, no el de UTC', () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(todayISO()).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  });

  it('los límites son medianoche local a medianoche local', () => {
    // Se comparan como INSTANTES: el SQL filtra `start_datetime`, que es ISO/UTC. Lo local es dónde
    // EMPIEZA y acaba el día, no el formato en que viaja.
    const { day_start, day_end } = dayBounds('2026-08-22');
    expect(new Date(day_start).getTime()).toBe(new Date(2026, 7, 22, 0, 0, 0, 0).getTime());
    expect(new Date(day_end).getTime()).toBe(new Date(2026, 7, 23, 0, 0, 0, 0).getTime());
  });

  it('una cita de las 00:30 locales cae DENTRO de su propio día', () => {
    // El caso que rompía: 00:30 del 22 en Madrid es 22:30 del 21 en UTC, así que con días UTC la
    // cita aparecía en la agenda del 21.
    const cita = new Date(2026, 7, 22, 0, 30, 0, 0);
    const { day_start, day_end } = dayBounds('2026-08-22');
    expect(cita.getTime()).toBeGreaterThanOrEqual(new Date(day_start).getTime());
    expect(cita.getTime()).toBeLessThan(new Date(day_end).getTime());
  });

  it('el cambio de hora no descuadra el día', () => {
    // 25/10/2026: en Europa el reloj retrasa una hora y el día local dura 25 h. Un `+24h` dejaría
    // fuera la última hora — citas que desaparecen de la agenda una vez al año, en silencio.
    const { day_start, day_end } = dayBounds('2026-10-25');
    const medido = new Date(day_end).getTime() - new Date(day_start).getTime();
    const esperado = new Date(2026, 9, 26).getTime() - new Date(2026, 9, 25).getTime();
    expect(medido).toBe(esperado);
  });

  it('el último día del mes salta bien de mes', () => {
    const { day_end } = dayBounds('2026-08-31');
    expect(new Date(day_end).getTime()).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
  });
});
