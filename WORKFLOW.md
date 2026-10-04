# WORKFLOW — Citas

Prefijo: APPOINTMENTS
Alcance MVP: peluqueria

## Para qué sirve y para quién
La agenda de un negocio que trabaja con cita previa (peluquería, estética, clínica). Cada cita une
una clienta de **Clientes**, un servicio de **Servicios** y un profesional de **Personal** a una
hora, sin pisar el horario del negocio (**Horarios**), el turno del profesional ni otra cita suya, y
guarda todo lo que le pasa desde que se reserva hasta que se atiende o se anula. La usan el
**empleado** (ve la agenda y reserva), el **responsable** (además confirma, inicia, completa,
cancela, mueve y bloquea) y el **administrador** (además borra y cambia los ajustes). La clienta
también reserva, mueve y cancela sola por WhatsApp a través de una automatización.

## Referencia adoptada
- **Fresha** (fresha.com), **Vagaro** (vagaro.com), **Mangomint** (mangomint.com) y **Square
  Appointments** (squareup.com/appointments): agenda del día por profesional, arrastrar la cita a
  otra hora o a otra columna, reserva online que se confirma sola salvo que el negocio quiera
  revisarla, política de cancelación que ata a la clienta y no al negocio, «no presentado» como
  acción aparte, solape que se confirma antes de reservar encima.
- **Google Calendar / RFC 5545**: editar una serie como «solo esta» o «esta y las siguientes»
  (nunca «todas»), y la serie conserva su hora de pared al cambiar de hora oficial.
- **Mindbody/Booker**: el mostrador puede apuntar una cita que ya ha empezado.
- Decisiones registradas que mandan aquí: horario del negocio solo en Horarios (ADR-0392),
  cita→venta la inicia el TPV (ADR-0077), reloj del negocio (ADR-0384), series con corte (ADR-0385).

## Antes de empezar
1. Instala **Clientes**, **Servicios**, **Personal** y **Horarios** (Citas los exige y se instalan con ella).
2. En **Servicios**, da de alta los servicios reservables con su precio y su duración.
3. En **Personal**, da de alta a los profesionales, márcalos como reservables, asígnales los
   servicios que hacen (si un servicio no tiene a nadie asignado, lo hace todo el equipo) y, si
   quieres que la agenda respete su turno, su horario y sus ausencias.
4. En **Horarios**, pon el horario semanal, los festivos y las excepciones. Sin ninguna regla la
   agenda deja reservar a cualquier hora.
5. Comprueba en los ajustes del hub que la zona horaria del negocio es la correcta: la agenda
   siempre pinta el reloj del negocio, nunca el del dispositivo.
6. Revisa los **Ajustes de Citas** (antelaciones, solape, confirmación automática, cancelación).
7. Para la cita por WhatsApp: conecta el número y activa la tarjeta «Reservar citas» en **Bandeja de WhatsApp → Ajustes** (WHATSAPP_INBOX-F01, WHATSAPP_INBOX-F14). El camino entero, de punta a punta, está en el recorrido `REC_WA_CITA` (`architecture/workflows/whatsapp-cita.md`).

## Pantallas

### Agenda
Menú → **Citas**. Una barra con el día (‹ fecha › con botón «Abrir calendario»), «Filtrar por
estado» y el conmutador **Lista · Por profesional · Periódicas** (en móvil solo iconos).
- **Lista**: columnas Hora, Nº, Cliente, Servicio, Personal, Estado; buscador «Buscar nº, cliente o
  servicio…»; por fila **Cobrar, Editar, Confirmar, Iniciar, Completar, No-show, Cancelar,
  Historial, Borrar** (la que no aplica al estado sale en gris, no se esconde; **Cobrar** en gris si
  la cita ya está cobrada).
- **Por profesional**: una fila por profesional reservable y un carril «Sin asignar». Tocar un
  hueco abre el alta con ese profesional y esa hora; el bloque se arrastra a otra hora o a otra fila.
- **Periódicas**: ver la pantalla [Periódicas](#periódicas).
- Botón **Añadir cita** → panel de alta: Cliente, Servicio, Profesional, Día, Hora (con «Horas
  libres» como botones), Min.; avisos «Esta cita empieza en el pasado…», profesional que no hace
  el servicio, duración propia no leída.
- **Editar** → panel «Editar la cita»: Día, Hora, Min., Servicio, Profesional, «Guardar cambios» y,
  debajo, el historial. **Historial** → panel «Historial de la cita».
- Diálogos: «Cita solapada» (**Reservar igual** / **Elegir otra hora**) y «Editar cita periódica»
  (**Solo esta cita** / **Esta y todas las siguientes**).
- Vacía: «Sin citas para este día.» · Cargando: «Cargando…» · Error: «Error cargando citas» o el
  motivo concreto · sin profesionales: «Aún no hay profesionales reservables.» · dispositivo en otra
  zona: aviso con el reloj del negocio.
- La campana del hub muestra **Citas por confirmar** (reservas de la clienta pendientes) y lleva aquí.

### Periódicas
Tercer segmento de la Agenda. Tabla: Cliente, Servicio, Profesional, Repetición («Cada semana ·
Lunes · 11:00»), Empieza, Termina («Sin fin», «Tras N citas» o fecha), Estado (interruptor
**Activa**). Por fila: **Editar serie**, **Reservar citas**, **Borrar** (pide confirmación). El
botón de añadir de la tabla abre «Nueva cita periódica» (Cliente, Servicio, Profesional,
Repetición, Día de la semana, Día, Hora, Min., «Termina el (opcional)», «Número de citas
(opcional)») con **Crear cita periódica**; editar abre «Editar cita periódica» con **Guardar de esta
cita en adelante**. Tras reservar o guardar, un aviso «N reservadas · M no se han podido reservar» con
cada fecha y su motivo. Vacía: «Todavía no hay citas periódicas.» · Error: «No se han podido cargar
las citas periódicas.»; un rechazo al guardar sale dentro del panel, encima del botón.

### Ajustes de Citas
Formulario que pinta el hub en **Hub: Ajustes** desde los ajustes declarados del módulo (solo
administrador). Cómo se llega desde el menú: sin confirmar. Campos: Duración por defecto, Antelación mínima para reservar,
Reservar como máximo con esta antelación, Permitir citas solapadas, Enviar recordatorios (no envía
nada todavía), Permitir que el cliente cancele su cita, Antelación mínima para cancelar, El calendario
empieza/termina a las, Intervalo entre huecos, Confirmar automáticamente las citas que reserva el cliente.

### Historial de visitas
Bloque dentro de la ficha de una clienta en **Clientes** (lo aporta Citas). Sus 10 últimas citas,
la más reciente primero, con servicio, profesional, estado y las notas (la interna primero). Vacía:
«Este cliente aún no tiene citas.» · Error: «No se pudo cargar el historial de visitas.»

## Flujos

El detalle de cada flujo (pasos, datos, fallos, implicados y QA) está en `workflow/`, con la
misma gramática y el mismo prefijo. Antes de tocar código, lee el fichero del flujo que cambias.

| ID | Flujo | Estado | Detalle |
|---|---|---|---|
| APPOINTMENTS-F01 | Reservar una cita desde la agenda | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F02 | Ver qué horas quedan libres | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F03 | Confirmar una cita pendiente | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F04 | Mover una cita o cambiarle el profesional o el servicio | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F05 | Cancelar una cita desde la agenda | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F06 | La clienta cancela o mueve su propia cita | hecho | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F07 | Marcar la llegada y empezar el servicio | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F08 | Completar la cita | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F09 | Marcar que la clienta no se presentó | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F10 | Ver el historial de una cita | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F11 | Borrar una cita | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F12 | Crear una cita periódica | hecho | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F13 | Reservar las citas de una serie | parcial | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F14 | Editar una serie de esta cita en adelante | hecho | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F15 | Pausar, reactivar o borrar una serie | hecho | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F16 | Bloquear tiempo en la agenda | parcial | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F17 | Cobrar la cita en el TPV | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F18 | Cita que llega por WhatsApp | hecho | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F19 | Ajustar las reglas de reserva | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F20 | Ver las citas de una clienta en su ficha | hecho | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F21 | Reservar varias citas de golpe (bono o curso) | parcial | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F22 | Cambiar las notas o el contacto de una cita | parcial | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F23 | Unir las citas al fusionar dos fichas de clienta | hecho | [`workflow/canales.md`](workflow/canales.md) |

## Cobertura contra la referencia
| Elemento (Fresha, Vagaro, Mangomint, Square Appointments) | Estado | Flujo |
|---|---|---|
| Agenda del día por profesional, arrastrar a otra hora o a otra columna | hecho | APPOINTMENTS-F04 |
| Reserva ligada a clienta, servicio y profesional con horas libres reales | hecho | APPOINTMENTS-F01, APPOINTMENTS-F02 |
| Profesionales filtrados por servicio y duración propia del profesional | hecho | APPOINTMENTS-F01 |
| Aviso antes de reservar encima (solape permitido) | hecho | APPOINTMENTS-F01, APPOINTMENTS-F04 |
| Estados reservada → confirmada → en curso → completada / cancelada / no presentada | hecho | APPOINTMENTS-F03, APPOINTMENTS-F07, APPOINTMENTS-F08, APPOINTMENTS-F09 |
| Historial de cada cita con quién y qué cambió | hecho | APPOINTMENTS-F10 |
| Reserva de la clienta que se confirma sola salvo revisión | hecho | APPOINTMENTS-F18, APPOINTMENTS-F19 |
| Política de cancelación de la clienta | hecho | APPOINTMENTS-F06 |
| Citas periódicas, editar «esta y siguientes», saltos con motivo | hecho | APPOINTMENTS-F12, APPOINTMENTS-F13, APPOINTMENTS-F14, APPOINTMENTS-F15 |
| Cita → cobro en el TPV sin re-teclear | parcial — no completa la cita | APPOINTMENTS-F17 |
| Motivo al cancelar y confirmación al borrar | parcial | APPOINTMENTS-F05, APPOINTMENTS-F11 |
| Bloqueos de agenda (festivo, vacaciones de un profesional) con pantalla | parcial — solo asistente o API | APPOINTMENTS-F16 |
| Bono o paquete de sesiones | parcial — solo asistente o API | APPOINTMENTS-F21 |
| Notas de la visita (fórmula) desde la agenda | parcial — solo asistente o API | APPOINTMENTS-F22 |
| Alta rápida de la clienta sin ficha (walk-in) desde el formulario | no hecho — hay que crearla en Clientes | — |
| Varios servicios encadenados en una cita (corte + color) | no hecho — una cita = un servicio; B-04 lo pide | — |
| Ocupación del día por profesional en la agenda | no hecho — B-01 lo pide | — |
| Recordatorios automáticos | no hecho — ajuste visible pero inerte; fuera del MVP según appointments#6 | — |
| Llegada separada de «empezar» | fuera del MVP — Iniciar hace de llegada | — |
| Vista de semana o mes | fuera del MVP | — |
| Reserva online pública, depósito o cargo por no presentarse, lista de espera, salas o equipos, reservas de grupo, calendario externo | fuera del MVP | — |

## Datos: de quién es cada dato
| Dato | Dueño | Cómo lo obtiene Citas |
|---|---|---|
| Cita, su número, estado, notas, motivo de cancelación, canal | Citas | propio |
| Historial de cada cita | Citas | propio |
| Serie periódica y su pauta | Citas | propio |
| Bloqueos de agenda | Citas | propio |
| Ajustes de reserva | Citas | propio |
| Ficha de la clienta | Clientes | lectura pública de su ficha al reservar; copia nombre, teléfono y email en la cita |
| Servicio, precio y duración | Servicios | lectura pública al reservar; se congela en la cita |
| Profesional, competencia, duración y precio propios, turno y ausencias | Personal | lecturas públicas al reservar y al mover |
| Horario del negocio, festivos y excepciones | Horarios | lecturas públicas; Citas no lo guarda |
| Zona horaria del negocio | Hub | la entrega el hub; Citas no guarda copia |
| Venta de la cita | TPV (sales) | solo se anota el número de la venta cobrada |

**Datos personales (inventario RGPD):** la cita guarda nombre, teléfono y email de la clienta y dos
notas libres (la interna puede llevar datos sensibles como alergias); la serie guarda el nombre; el
historial guarda el nombre en la línea «Reservada» y el motivo que dé la clienta. Citas escucha la
fusión de fichas pero **no** la anonimización ni el borrado de una ficha: esas copias se quedan
(hueco de la familia RGPD). Las lecturas que ven el asistente o un canal externo no devuelven las
notas ni el contacto de la agenda del día.

## Reglas que no se rompen
- **Vínculos reales:** toda cita lleva clienta, servicio y profesional de sus fichas; nombre, precio
  y duración salen del catálogo, nunca de quien llama.
- **Sin solape por profesional:** dos profesionales distintos sí; el mismo, no, salvo el ajuste. La
  última palabra la tiene el servidor, aunque la pantalla avise antes.
- **El reloj es el del negocio**, nunca el del dispositivo; una serie conserva su hora al cambiar la hora oficial.
- **Transición fuera de orden = rechazo con motivo** y sin rastro: ni historial ni aviso duplicado.
- **Lo cobrado no se toca:** una edición de serie no mueve una cita cobrada y Cobrar no se ofrece dos veces.
- **La clienta solo toca lo suyo:** su identidad se comprueba antes que cualquier otra cosa.
- **Pasado y antelación mínima** solo los salta una persona del equipo en el mostrador; nunca una
  automatización ni la reserva de la clienta.
- **Lectura que falta = rechazo**, nunca reserva a ciegas.
- **Aislamiento por hub** en toda lectura y escritura; la fusión de fichas solo dentro de su negocio.
- **Permisos:** empleado ve y reserva; responsable cambia estados, mueve y bloquea; administrador
  además borra y ajusta.

## Lo que NO hace, a propósito
- No guarda el horario del negocio (es de Horarios) ni el turno del profesional (es de Personal).
- No cobra ni arma ventas: Cobrar abre el TPV; Citas solo anota que se cobró.
- No envía mensajes ni recordatorios: eso es de WhatsApp y de las automatizaciones.
- No ofrece «cambiar todas las citas de la serie»: solo «esta» o «esta y las siguientes».
- No retiene un hueco mientras alguien decide (retirado en appointments#184).
- No sincroniza con calendarios externos (módulo aparte previsto, sin construir).

## Dudas abiertas
- ¿Una cita del mostrador debería nacer **Confirmada**? Hoy nace Pendiente y hay que pulsar
  Confirmar antes de Iniciar, también con la clienta ya sentada (walk-in).
- ¿Cobrar debería dejar la cita **Completada**, como hace el cobro en Fresha y Square?
- ¿Se debe poder cobrar una cita cancelada o no presentada? Hoy el botón está activo.
- ¿«No-show» debe exigir que la hora de la cita haya pasado?
- ¿Se oculta «Enviar recordatorios» mientras no envíe nada, o se deja con aviso?

## Fuentes contrastadas
Contra el código de `origin/main` (v1.1.140), una línea por discrepancia:
- `docs/screens.md` y el mensaje del manifest dicen que Completar exige haber iniciado; el código también completa desde Confirmada (APPOINTMENTS-F08).
- `docs/screens.md` dice que No-show es para una cita cuya hora ya pasó; el código no lo comprueba (APPOINTMENTS-F09).
- `docs/limits.md` dice que una cita no presentada no se puede cancelar; el código la cancela, y también una en curso (APPOINTMENTS-F05).
- `docs/screens.md` describe pasos de pantalla para crear bloqueos; no hay pantalla, solo asistente o API (APPOINTMENTS-F16).
- `docs/screens.md` y `architecture/modules/appointments.md` dicen que Borrar pide confirmación; la agenda borra sin preguntar (APPOINTMENTS-F11).
- `architecture/modules/appointments.md` y `docs/screens.md` dicen que se cancela con motivo; la agenda manda el motivo vacío (APPOINTMENTS-F05).
- `architecture/modules/appointments.md` cita la lectura `appointments.schedules.active_timeslots` y el respaldo con el horario propio; ya no están en el manifest (migración 009).
- `architecture/modules/appointments.md` dice que la pantalla pregunta la apertura del día para avisar de «cerrado hoy» y que hay vista de detalle; la interfaz no hace ninguna de las dos cosas.
- `locales/es.json` (`ui.pastStartNotice`) dice «Se guardará como ya iniciada»; la cita se guarda Pendiente (APPOINTMENTS-F01).
- `hand-book/modulos/appointments.md` llama «Repetitivas» y «No presentado» a lo que la pantalla llama «Periódicas» y «No-show».
- `hand-book/modulos/appointments.md` pide indicar el motivo al cancelar; la agenda no lo pide (APPOINTMENTS-F05).
- `hand-book/modulos/appointments.md` dice que a los bloqueos se llega desde la agenda y su paso 6 del vídeo crea uno; no se puede (APPOINTMENTS-F16).
- `hand-book/modulos/appointments.md` dice que las acciones no permitidas «no aparecen»; aparecen y las rechaza el servidor.
- W-03 (`qa-hub-beauty.md`) espera «Rechazar → nada en la agenda»; Citas no tiene rechazar, y cancelar deja la cita en la agenda como Cancelada (APPOINTMENTS-F03, APPOINTMENTS-F18).
- B-04 (`qa-hub.md` §6) espera servicios encadenados (corte + color) en una cita; una cita lleva un solo servicio (APPOINTMENTS-F08).
- B-01 (`qa-hub.md` §6) espera la ocupación del día por profesional en la agenda; no se muestra.
- `handler/src/lib.rs` nombra todavía «an approval from the inbox» entre las puertas de reserva; la bandeja de aprobación de WhatsApp está retirada y Citas no tiene ninguna orden de aprobar una petición (APPOINTMENTS-F18).
