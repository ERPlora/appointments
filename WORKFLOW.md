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
  revisarla, política de cancelación que ata a la clienta y no al negocio, no presentado como
  acción aparte, solape que se confirma antes de reservar encima.
- **Google Calendar / RFC 5545**: editar una serie solo en esta cita o en esta y las siguientes
  (nunca en todas), y la serie conserva su hora de pared al cambiar de hora oficial.
- **Mindbody/Booker**: el mostrador puede apuntar una cita que ya ha empezado.
- Decisiones registradas que mandan aquí: horario del negocio solo en Horarios (ADR-0392),
  cita→venta la inicia el TPV (ADR-0077), reloj del negocio (ADR-0384), series con corte (ADR-0385).

## Antes de empezar
1. Instala **Clientes**, **Servicios**, **Personal** y **Horarios** (Citas los exige y se instalan con ella).
2. En **Servicios**, da de alta los servicios reservables con su precio y su duración.
3. En **Personal**, da de alta a los profesionales, márcalos como reservables, asígnales los
   servicios que hacen (si un servicio no tiene a nadie asignado, o quien lo tiene no está Activo y
   Reservable, Citas deja reservarlo con todo el equipo reservable: la regla es de Citas, no de Personal
   ni de Servicios; STAFF-F12, APPOINTMENTS-F01) y, si
   quieres que la agenda respete su turno, su horario y sus ausencias.
4. En **Horarios**, confirma o cambia el horario semanal (al instalarse ya trae uno, SCHEDULES-F12) y
   pon los festivos y las excepciones. Sin ningún tramo semanal, y sin festivo ni excepción ese día, la
   agenda deja reservar a cualquier hora (APPOINTMENTS-F02).
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
- **Por profesional**: una fila por profesional reservable y un carril «Sin asignar». Una
  profesional que ya no es reservable (o está de baja) conserva su fila los días en que aún tiene
  citas, marcada «Ana · no reservable» o «Ana · de baja», para que esas citas se vean y se puedan
  pasar a otra (appointments#334). Tocar un hueco abre el alta con ese profesional y esa hora (en
  una fila marcada, solo con la hora); el bloque se arrastra a otra hora o a otra fila.
  Mientras Personal contesta, «Cargando profesionales…»; si la lista no se puede leer, «No se han
  podido cargar los profesionales.» con **Reintentar**, en lugar de la rejilla (sin el equipo no se
  sabe en qué fila va cada cita, y no se toca ni se arrastra a ciegas); sin ninguno reservable, «Aún
  no hay profesionales reservables.» encima de la rejilla, que conserva el carril «Sin asignar»
  (appointments#323).
- **Periódicas**: ver la pantalla [Periódicas](#periódicas).
- Botón **Añadir cita** → panel de alta: Cliente (buscador «Busca por nombre o teléfono»; también encuentra por email), Servicio, Profesional, Día, Hora (con «Horas
  libres» como botones), Min.; avisos «Esta cita empieza en el pasado…», profesional que no hace
  el servicio, duración propia no leída. Bajo Servicio y bajo Profesional, mientras se leen,
  «Cargando servicios…» / «Cargando profesionales…»; si no se pueden leer, «No se han podido cargar
  los servicios.» / «…los profesionales.» con **Reintentar**; si no hay ninguno reservable, «Todavía
  no hay servicios reservables. Dalos de alta en Servicios.» / «…profesionales… en Personal.» (el
  desplegable sin nada que elegir sale desactivado; appointments#319).
- **Editar** → panel «Editar la cita»: Día, Hora, Min., Servicio, Profesional, «Guardar cambios» y,
  debajo, el historial. **Historial** → panel «Historial de la cita».
- Diálogos: «Cita solapada» (**Reservar igual** / **Elegir otra hora**) y «Editar cita periódica»
  (**Solo esta cita** / **Esta y todas las siguientes**).
- Vacía: «Sin citas para este día.» · Cargando: «Cargando…» · Error: «Error cargando citas» o el
  motivo concreto · sin profesionales (en Por profesional): «Aún no hay profesionales reservables.» ·
  profesionales que no se pueden leer (en Por profesional): «No se han podido cargar los
  profesionales.» con **Reintentar** · dispositivo en otra
  zona: aviso con el reloj del negocio.
- La campana del hub muestra **Citas por confirmar** (reservas de la clienta pendientes) y lleva aquí.

### Periódicas
Tercer segmento de la Agenda. Tabla: Cliente, Servicio, Profesional, Repetición (por ejemplo, Cada
semana · Lunes · 11:00), Empieza, Termina («Sin fin», «Tras {n} citas» o la fecha), Estado (interruptor
**Activa**). Por fila: **Editar serie**, **Reservar citas**, **Borrar** (pide confirmación). El
botón de añadir de la tabla abre «Nueva cita periódica» (Cliente, Servicio, Profesional,
Repetición, Día de la semana, Día, Hora, Min., «Termina el (opcional)», «Número de citas
(opcional)») con **Crear cita periódica**; Servicio y Profesional dicen «Cargando…», «No se han podido
cargar…» con **Reintentar** o «Todavía no hay… reservables» igual que el alta de una cita; editar abre «Editar cita periódica» con **Guardar de esta
cita en adelante**. Tras reservar o guardar, un aviso «{booked} citas reservadas · {skipped} no se han podido reservar:» con
cada fecha y su motivo; si quedan fechas sin reservar, «Las fechas desde el {date} aún no están
reservadas: pulsa «Reservar citas» en la serie para reservarlas.». Vacía: «Todavía no hay citas periódicas.» · Error: «No se han podido cargar
las citas periódicas.»; un rechazo al guardar sale dentro del panel, encima del botón.

### Ajustes de Citas
Menú → **Citas** → pestaña **Ajustes**, que el hub añade sola porque el módulo declara sus ajustes.
Solo la ve quien tiene el permiso de cambiarlos (`appointments.manage_settings`; de fábrica, solo el
administrador): a los demás el hub no les enseña la pestaña (HUB_SHELL-F43, hub#2588). Campos: «Duración por defecto (minutos)», «Antelación
mínima para reservar (minutos)», «Reservar como máximo con esta antelación (días)», «Permitir citas
solapadas», «Enviar recordatorios» y «Enviar el recordatorio con estas horas de antelación» (los dos
se guardan pero no envían nada), «Permitir que el cliente cancele su cita», «Antelación mínima para
cancelar (horas)», «El calendario empieza a las (hora)» y «El calendario termina a las (hora)» (la
ventana en la que se ofrecen horas), «Intervalo entre huecos (minutos)», «Confirmar automáticamente
las citas que reserva el cliente»; botón **Guardar**. Cargando: «Cargando ajustes…» · Error: «No se
pudieron cargar los ajustes.» o «No se pudieron guardar los ajustes.» · Guardado: «Ajustes guardados.»

### Historial de visitas
Bloque dentro de la ficha de una clienta en **Clientes** (lo aporta Citas). Sus 10 últimas citas,
la más reciente primero, con servicio, profesional, estado y las notas (la interna primero). Vacía:
«Este cliente aún no tiene citas.» · Error: «No se pudo cargar el historial de visitas.»

## Flujos

El detalle de cada flujo (pasos, datos, fallos, implicados y QA) está en `workflow/`, con la
misma gramática y el mismo prefijo. Antes de tocar código, lee el fichero del flujo que cambias.

| ID | Flujo | Estado | Detalle |
|---|---|---|---|
| APPOINTMENTS-F01 | Reservar una cita desde la agenda | parcial — sin alta de clienta en el formulario (appointments#318); solo los 500 primeros servicios y profesionales, sin decirlo (appointments#324) | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F02 | Ver qué horas quedan libres | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F03 | Confirmar una cita pendiente | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F04 | Mover una cita o cambiarle el profesional o el servicio | parcial — editar no avisa si no cargan servicios o profesionales (appointments#333) | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F05 | Cancelar una cita desde la agenda | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F06 | La clienta cancela o mueve su propia cita | parcial | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F07 | Marcar la llegada y empezar el servicio | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F08 | Completar la cita | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F09 | Marcar que la clienta no se presentó | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F10 | Ver el historial de una cita | hecho | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F11 | Borrar una cita | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F12 | Crear una cita periódica | parcial — sin alta de clienta en el formulario (appointments#318); solo los 500 primeros servicios y profesionales, sin decirlo (appointments#324) | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F13 | Reservar las citas de una serie | parcial — con una antelación máxima de más de unos 400 días, una próxima fecha tan lejana da error en vez de avisar (appointments#331) | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F14 | Editar una serie de esta cita en adelante | parcial — no avisa si no cargan servicios o profesionales (appointments#333) | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F15 | Pausar, reactivar o borrar una serie | hecho | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F16 | Bloquear tiempo en la agenda | parcial | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F17 | Cobrar la cita en el TPV | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F18 | Cita que llega por WhatsApp | hecho | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F19 | Ajustar las reglas de reserva | parcial | [`workflow/agenda.md`](workflow/agenda.md) |
| APPOINTMENTS-F20 | Ver las citas de una clienta en su ficha | hecho | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F21 | Reservar varias citas de golpe (bono o curso) | parcial | [`workflow/periodicas.md`](workflow/periodicas.md) |
| APPOINTMENTS-F22 | Cambiar las notas o el contacto de una cita | parcial | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F23 | Unir las citas al fusionar dos fichas de clienta | hecho | [`workflow/canales.md`](workflow/canales.md) |
| APPOINTMENTS-F24 | Vaciar los datos de una clienta al borrarla | parcial | [`workflow/canales.md`](workflow/canales.md) |

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
| Cita → cobro en el TPV sin re-teclear | parcial — no completa la cita, la cita cobrada se puede mover, cancelar o borrar, y anulada la venta sigue como cobrada | APPOINTMENTS-F17, SALES-F26 |
| Motivo al cancelar y confirmación al borrar | parcial | APPOINTMENTS-F05, APPOINTMENTS-F11 |
| Bloqueos de agenda (festivo, vacaciones de un profesional) con pantalla | parcial — solo asistente o API | APPOINTMENTS-F16 |
| Bono o paquete de sesiones | parcial — solo asistente o API | APPOINTMENTS-F21 |
| Notas de la visita (fórmula) desde la agenda | parcial — solo asistente o API | APPOINTMENTS-F22 |
| Buscar a la clienta por nombre o teléfono al reservar, entre todas las fichas | hecho | APPOINTMENTS-F01, APPOINTMENTS-F12 |
| Alta rápida de la clienta sin ficha (walk-in) desde el formulario | no hecho — hay que crearla en Clientes (appointments#318) | CUSTOMERS-F25 |
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
| Ficha de la clienta | Clientes | lectura pública de su ficha al reservar; copia nombre, teléfono (en formato internacional, APPOINTMENTS-F22) y email en la cita |
| Servicio, precio y duración | Servicios | lectura pública al reservar; se congela en la cita |
| Profesional, competencia, duración y precio propios, turno y ausencias | Personal | lecturas públicas al reservar y al mover |
| Horario del negocio, festivos y excepciones | Horarios | lecturas públicas; Citas no lo guarda |
| Zona horaria del negocio | Hub | la entrega el hub; Citas no guarda copia |
| País del negocio (para leer un teléfono sin prefijo) | Hub | lo entrega el hub en cada orden; la tarea `phones_to_e164` lo lee de los ajustes del hub; Citas no guarda copia |
| Venta de la cita | TPV (sales) | solo se anota el número de la venta cobrada |

**Datos personales (inventario RGPD, recorriendo las migraciones):**
- **Cita:** nombre, teléfono y email de la clienta copiados de su ficha; nombre del profesional;
  dos notas libres (la interna puede llevar datos sensibles, como alergias o la fórmula del color);
  el motivo de cancelación, lo escriba la clienta o el personal.
- **Serie:** nombre de la clienta y del profesional.
- **Historial:** quién hizo cada cambio (usuario del hub), el nombre de la clienta en la línea
  «Reservada», los nombres del profesional de antes y de después al cambiarlo, y el motivo de
  cualquier cancelación.
- **Bloqueos:** título, motivo y profesional.
- **Auditoría** en todas las tablas: quién creó y quién cambió cada fila (usuarios del hub).
- **Tablas retiradas que siguen en la base de datos con otro nombre:** la de retenciones de hueco
  queda como `_deprecated_appointments_slot_hold`, con su etiqueta (el nombre o el teléfono de quien
  la pidió) y la referencia opaca a la solicitud; el horario propio retirado, también apartado con
  ese prefijo.
- **Lo que sale hacia otros:** el aviso de cita creada lleva el nombre de la clienta y la nota
  visible; la receta de WhatsApp «cita confirmada» lee la cita entera, con teléfono, email y las
  dos notas. La agenda del día y el historial por clienta que ve el asistente no llevan contacto ni notas.
- **Borrado:** al borrar los datos personales de una ficha en Clientes, Citas vacía el nombre, el
  contacto, las notas y el motivo de cancelación de sus citas, el nombre de sus series y el nombre y
  los motivos de su historial (APPOINTMENTS-F24). Eliminar la ficha sin borrar sus datos no toca
  nada. La tabla apartada de retenciones de hueco no lleva la ficha, así que no se puede saber qué
  etiqueta era suya: al borrar los datos de cualquier clienta se vacían todas las etiquetas de ese
  negocio (appointments#314).

## Reglas que no se rompen
- **Vínculos reales:** toda cita lleva clienta, servicio y profesional de sus fichas; nombre, precio
  y duración salen del catálogo, nunca de quien llama.
- **Sin solape por profesional:** dos profesionales distintos sí; el mismo, no, salvo el ajuste. La
  última palabra la tiene el servidor, aunque la pantalla avise antes.
- **El reloj es el del negocio**, nunca el del dispositivo; una serie conserva su hora al cambiar la hora oficial.
- **Transición fuera de orden = rechazo con motivo** y sin rastro: ni historial ni aviso duplicado
  (confirmar, iniciar, completar, no presentado, cancelar y mover). Excepción: Borrar una cita en
  curso o completada responde bien, no borra nada y avisa igualmente de cita borrada (APPOINTMENTS-F11).
- **Lo cobrado no lo mueve una serie:** editar una serie nunca toca una cita ya cobrada, y Cobrar
  no se ofrece dos veces. Una cita cobrada suelta, en cambio, se puede mover, cancelar, marcar No-show
  y borrar (hueco, APPOINTMENTS-F17).
- **La clienta solo cambia lo suyo:** cancelar o mover en su nombre exige que la cita sea suya, antes
  que el estado o la política. La respuesta sí distingue una cita que no existe de la de otra
  persona (hueco, APPOINTMENTS-F06).
- **Pasado y antelación mínima** solo los salta una persona del equipo en el mostrador; nunca una
  automatización ni la reserva de la clienta.
- **Lectura que falta = rechazo**, nunca reserva a ciegas.
- **Aislamiento por hub** en toda lectura y escritura; la fusión de fichas solo dentro de su negocio.
- **Permisos:** empleado ve y reserva; responsable cambia estados, mueve y bloquea; administrador
  además borra y ajusta.

## Lo que NO hace, a propósito
- No guarda el horario del negocio (es de Horarios) ni el turno del profesional (es de Personal).
- No escucha nada de Personal: desactivar o dar de baja a una profesional, o aprobarle una ausencia,
  no toca sus citas ya reservadas, que siguen en la agenda sin aviso (en «Por profesional», en su fila
  marcada «no reservable» o «de baja», appointments#334); solo las reservas nuevas se rechazan
  (STAFF-F05, STAFF-F06, STAFF-F18).
- No cobra ni arma ventas: Cobrar abre el TPV; Citas solo anota que se cobró.
- No envía mensajes ni recordatorios: eso es de WhatsApp y de las automatizaciones.
- No cambia todas las citas de una serie: solo **Solo esta cita** o **Esta y todas las siguientes**.
- No retiene un hueco mientras alguien decide (retirado en appointments#184).
- No sincroniza con calendarios externos (módulo aparte previsto, sin construir).

## Dudas abiertas
- ¿Una cita del mostrador debería nacer **Confirmada**? Hoy nace Pendiente y hay que pulsar
  Confirmar antes de Iniciar, también con la clienta ya sentada (walk-in).
- ¿Cobrar debería dejar la cita **Completada**, como hace el cobro en Fresha y Square?
- ¿Se debe poder cobrar una cita cancelada o no presentada? Hoy el botón está activo.
- ¿«No-show» debe exigir que la hora de la cita haya pasado?
- ¿Se ocultan «Enviar recordatorios» y «Enviar el recordatorio con estas horas de antelación» mientras no envíen nada, o se dejan con aviso?

## Fuentes contrastadas
Contra el código de `origin/main` (v1.1.141), una línea por discrepancia:
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
- La lista de horas libres trata un bloqueo de día entero por sus fechas, y la reserva solo por sus instantes de inicio y fin: si las horas del bloqueo no cubren el día, la lista puede esconder horas que la reserva acepta (APPOINTMENTS-F16).
- `locales/es.json` (`appointments.availability_unavailable`): el texto habla de «los bloqueos de la agenda», pero el mismo código sale cuando no llega una lista de Horarios (APPOINTMENTS-F01, SCHEDULES-F11).
- Oleada 2 (Horarios y Servicios, 05/10/2026): este fichero decía que «sin ninguna regla» la agenda deja reservar a cualquier hora; es solo sin ningún tramo semanal y sin excepción ese día, y Horarios ya siembra una semana al instalarse. Citas y la pregunta «¿está abierto?» de Horarios no responden igual en tres casos (APPOINTMENTS-F02, SCHEDULES-F10, SCHEDULES-F11). Y la regla «un servicio sin nadie asignado lo hace todo el equipo reservable» es de Citas: Personal solo devuelve la lista vacía y Servicios no sabe quién hace qué (STAFF-F12, SERVICES-F10).
