# WORKFLOW — Citas · Agenda del día

Prefijo: APPOINTMENTS

## Flujos

### APPOINTMENTS-F01 Reservar una cita desde la agenda
Estado: parcial — no deja crear una clienta nueva desde el formulario (appointments#318); Servicio y Profesional ofrecen como mucho los 500 primeros, sin decirlo (appointments#324)
Actor: empleado
Pantalla: Agenda
Pasos:
1. En la Agenda pulsa **Añadir cita**, o en «Por profesional» toca un hueco libre (rellena profesional y hora).
2. Elige Cliente, Servicio y Profesional (los tres son obligatorios). La clienta se busca escribiendo su nombre,
   teléfono o email: cada tecla pregunta a Clientes y salen las 20 primeras que coinciden, sin
   importar mayúsculas ni acentos, entre todas las fichas del negocio, sean las que sean
   (appointments#306); con más de 20, «Se muestran los 20 primeros. Sigue escribiendo para afinar.». Si
   la búsqueda falla lo dice con **Reintentar**; sin coincidencias, «Ningún cliente coincide con lo que
   has escrito.». Aún no deja crear
   una clienta nueva desde aquí (CUSTOMERS-F25, appointments#318). Con un servicio
   elegido solo salen los profesionales Activos y Reservables que lo hacen; si no hay ninguno (nadie lo tiene
   asignado, o quien lo tiene está inactivo o no reservable), salen todos los reservables: esa regla es
   de Citas, no de Personal ni de Servicios; Personal solo contesta con la lista vacía (STAFF-F12). «Min.» se
   rellena con su duración propia o la del catálogo. Mientras Servicios o Personal contestan, bajo
   su desplegable sale «Cargando servicios…» / «Cargando profesionales…»; si la lista no se puede
   leer, «No se han podido cargar los servicios.» / «…los profesionales.» con **Reintentar** (vuelve a
   leer solo esa lista); si no hay ninguno reservable, «Todavía no hay servicios reservables. Dalos
   de alta en Servicios.» / «Todavía no hay profesionales reservables. Dalos de alta en Personal.». Un
   desplegable sin nada que elegir sale desactivado: nunca vacío sin explicación (appointments#319).
3. Escribe el Día y toca una de las **Horas libres** (o escribe otra hora; también vale pegar el día y la hora juntos, por ejemplo 26/09/2026 10:00).
4. Pulsa **Añadir cita**. Si el solape está permitido y choca, responde a «Cita solapada».
5. La cita aparece en la lista como **Pendiente** con su número `APT-AAAAMMDD-NNNN`.
Entra: la clienta (Clientes), el servicio con precio y duración (Servicios), el profesional y su competencia (Personal). Las cuatro listas de Horarios (semana, días especiales, cambios temporales y sus tramos), con las que Citas decide la apertura como se cuenta en F02 (SCHEDULES-F11).
Sale: la cita pendiente con nombre, precio y duración congelados del catálogo, su línea «Reservada» en el historial y el aviso de cita creada (`appointments.appointment.created`).
Si falla: el motivo sale dentro del panel y en un aviso (fuera de horario, el profesional no trabaja, franja bloqueada, ya tiene cita, demasiado lejos); lo tecleado se conserva para corregir. Desde el mostrador ni la antelación mínima ni una hora ya pasada rechazan: la hora pasada solo muestra un aviso antes de guardar. Si una lectura obligatoria no se puede leer (la ficha, el servicio, el equipo o una de las cuatro listas de Horarios), el hub corta la reserva antes de que Citas decida y no se reserva a ciegas; si una lista de Horarios no llega sin dar error, Citas rechaza con su código `appointments.availability_unavailable`, cuyo texto en español habla de «los bloqueos de la agenda» y no del horario (SCHEDULES-F11).
Implicados: CUSTOMERS-F11, CUSTOMERS-F25, CUSTOMERS-F30, SCHEDULES-F02, SCHEDULES-F04, SCHEDULES-F05, SCHEDULES-F06, SCHEDULES-F07, SCHEDULES-F10, SCHEDULES-F11, SERVICES-F02, SERVICES-F04, SERVICES-F05, SERVICES-F10, STAFF-F02, STAFF-F05, STAFF-F06, STAFF-F09, STAFF-F10, STAFF-F12, STAFF-F13, STAFF-F14, STAFF-F15, STAFF-F16, STAFF-F18, REC_PELUQUERIA-F06, ONLINE_BOOKING-F01
QA: B-02, BD-06

### APPOINTMENTS-F02 Ver qué horas quedan libres
Estado: hecho
Actor: empleado, asistente, cliente
Pantalla: Agenda
Pasos:
1. En el alta, con servicio, profesional y día elegidos, aparecen las **Horas libres** como botones.
2. Las horas candidatas salen cada «Intervalo entre huecos (minutos)» dentro de la ventana que
   marcan «El calendario empieza a las (hora)» y «El calendario termina a las (hora)». De ellas solo aparece la que cabe entera: dentro
   del horario del negocio (Horarios), dentro del turno del profesional y fuera de sus ausencias
   (Personal), sin bloqueo y sin otra cita suya; con el solape permitido, una hora ocupada también sale.
   Del horario, Citas aplica el mismo orden que Horarios (día especial de la fecha, día especial anual,
   cambio temporal, semana) y cuenta como abierta la madrugada de un tramo semanal que cruza la
   medianoche aunque la víspera la cerrara un día especial o un cambio temporal; pero no contesta igual
   que la pregunta «¿está abierto?» de Horarios (SCHEDULES-F10) en tres casos: sin ningún tramo semanal
   y sin excepción ese día deja reservar a cualquier hora (Horarios diría «sin horario», cerrado); la
   cita puede acabar justo a la hora de cierre; y puede cruzar la medianoche dentro de un tramo de día
   especial o de cambio temporal que la cruza (SCHEDULES-F11). Horarios ya siembra una semana al
   instalarse (SCHEDULES-F12), así que el primer caso solo se da si alguien la borra entera.
3. Desde el mostrador salen también las horas dentro de la antelación mínima; a la clienta no.
4. Si cambia el servicio, los minutos, el profesional o el día, la lista se vuelve a pedir.
Entra: horario del negocio (Horarios), turno y ausencias (Personal), bloqueos, citas vivas y ajustes de antelación propios.
Sale: la lista de horas; no guarda nada. El asistente y WhatsApp leen el mismo motor, pero sin las horas dentro de la antelación mínima.
Si falla: «No se han podido cargar las horas libres» con **Reintentar**; se puede escribir una hora igualmente y la reserva se juzga al guardar. Sin horas: «No quedan horas libres ese día…».
Implicados: SCHEDULES-F02, SCHEDULES-F04, SCHEDULES-F05, SCHEDULES-F06, SCHEDULES-F07, SCHEDULES-F10, SCHEDULES-F11, STAFF-F13, STAFF-F14, STAFF-F15, STAFF-F16, STAFF-F18, STAFF-F19, WHATSAPP_INBOX-F19, WHATSAPP_INBOX-F21, WHATSAPP_INBOX-F22, REC_PELUQUERIA-F06, REC_WA_CITA-F04
QA: B-02, BD-06, W-02

### APPOINTMENTS-F03 Confirmar una cita pendiente
Estado: hecho
Actor: responsable
Pantalla: Agenda
Pasos:
1. Entra desde la campana **Citas por confirmar** o busca la cita **Pendiente** en la Agenda.
2. Pulsa **Confirmar** en su fila.
3. La cita pasa a **Confirmada** y el historial dice «Confirmada».
Entra: una cita pendiente (del mostrador, de una serie o de la clienta con la confirmación automática apagada).
Sale: la cita confirmada, su línea de historial y el aviso de cita confirmada (`appointments.appointment.confirmed`), que dispara el WhatsApp de confirmación a la clienta si la tarjeta «Reservar citas» de WhatsApp está activa y su teléfono tiene conversación con el negocio (también si la cita era del mostrador).
Si falla: «Esta cita ya no se puede confirmar: ya no está pendiente.»; no se escribe nada ni se avisa dos veces.
Implicados: WHATSAPP_INBOX-F23, REC_PELUQUERIA-F05, REC_PELUQUERIA-F07, REC_PELUQUERIA-F08, REC_WA_CITA-F06, HUB_SHELL-F61
QA: BD-07, W-03 (discrepa)

### APPOINTMENTS-F04 Mover una cita o cambiarle el profesional o el servicio
Estado: parcial — arrastrar una cita de una serie la mueve sola, sin preguntar si es solo esta o también las siguientes
Actor: responsable
Pantalla: Agenda
Pasos:
1. Pulsa **Editar** en la fila (o toca el bloque en «Por profesional»): se abre «Editar la cita».
2. Cambia Día, Hora, Min., Servicio o Profesional (profesional y servicio van en pareja; la clienta no se cambia).
3. Pulsa **Guardar cambios**. Si la cita es de una serie, elige **Solo esta cita** o **Esta y todas las siguientes** (ver APPOINTMENTS-F14).
4. Atajo: en «Por profesional» arrastra el bloque a otra hora o a la fila de otro profesional. Arrastrando no se puede llevar a una hora ya pasada (eso solo desde el panel), y una cita de una serie se mueve sola.
5. La cita conserva su número y su historial dice «Cambio de hora», «Cambio de profesional» o «Cambio de servicio».
Entra: la cita (pendiente o confirmada) y, si cambia, el nuevo profesional y su competencia o el nuevo servicio con su precio.
Sale: la cita movida (un servicio nuevo trae su nombre y precio; un profesional nuevo conserva el precio), su línea de historial y el aviso de cita movida (`appointments.appointment.rescheduled`).
Si falla: el motivo sale en el panel y en un aviso; un bloque arrastrado vuelve a su sitio. Solo se mueven citas Pendiente o Confirmada: una en curso, completada, cancelada o no presentada no se mueve (**Editar** sale en gris).
Implicados: SCHEDULES-F11, SERVICES-F10, STAFF-F05, STAFF-F06, STAFF-F11, STAFF-F12, STAFF-F16, REC_PELUQUERIA-F08, REC_PELUQUERIA-F12
QA: B-02, B-04, B-08, BD-06

### APPOINTMENTS-F05 Cancelar una cita desde la agenda
Estado: parcial — la agenda no pide el motivo (se guarda vacío) ni pide confirmar antes de cancelar
Actor: responsable
Pantalla: Agenda
Pasos:
1. Pulsa **Cancelar** en la fila de una cita pendiente, confirmada, en curso o no presentada.
2. La cita pasa a **Cancelada** y el historial dice «Anulada» y «Lo hizo el mostrador».
Entra: la cita.
Sale: la cita cancelada (el hueco queda libre), su línea de historial y el aviso de cita cancelada (`appointments.appointment.cancelled`).
Si falla: «Esta cita ya no se puede cancelar en su estado actual.» si ya estaba cancelada o completada.
Implicados: REC_PELUQUERIA-F12
QA: B-02, B-08

### APPOINTMENTS-F07 Marcar la llegada y empezar el servicio
Estado: hecho
Actor: responsable
Pantalla: Agenda
Pasos:
1. Cuando llega la clienta, pulsa **Iniciar** en su cita **Confirmada** (una pendiente hay que confirmarla antes).
2. La cita pasa a **En curso** y el historial dice «Servicio iniciado».
Entra: una cita confirmada.
Sale: la cita en curso, su línea de historial y el aviso de servicio iniciado (`appointments.appointment.started`).
Si falla: «Esta cita no se puede iniciar: no está confirmada.»
Implicados: REC_PELUQUERIA-F08, REC_WA_CITA-F10
QA: B-03

### APPOINTMENTS-F08 Completar la cita
Estado: hecho
Actor: responsable
Pantalla: Agenda
Pasos:
1. Al terminar, pulsa **Completar** en la cita **En curso** (también se acepta desde **Confirmada**).
2. La cita pasa a **Completada** y el historial dice «Completada». Completar no cobra nada: el cobro es APPOINTMENTS-F17.
Entra: una cita confirmada o en curso.
Sale: la cita completada, su línea de historial y el aviso de cita completada (`appointments.appointment.completed`).
Si falla: «Esta cita no se puede completar…» si estaba pendiente, cancelada o ya completada.
Implicados: REC_PELUQUERIA-F08, REC_WA_CITA-F10
QA: B-04 (discrepa)

### APPOINTMENTS-F09 Marcar que la clienta no se presentó
Estado: parcial — no comprueba que la hora de la cita haya pasado (se puede marcar una cita futura) y no hay cargo por no presentarse
Actor: responsable
Pantalla: Agenda
Pasos:
1. Pulsa **No-show** en una cita pendiente o confirmada.
2. La cita pasa a **No-show**, el hueco se libera y el historial dice «No se presentó».
Entra: una cita pendiente o confirmada.
Sale: la cita no presentada, su línea de historial y el aviso correspondiente (`appointments.appointment.no_show`).
Si falla: «Esta cita no se puede marcar como no presentada en su estado actual.»
Implicados: FLOWS-F04, REC_PELUQUERIA-F12, REC_WA_CITA-F10
QA: B-02, B-08

### APPOINTMENTS-F10 Ver el historial de una cita
Estado: hecho
Actor: empleado
Pantalla: Agenda
Pasos:
1. Pulsa **Historial** en la fila (disponible en cualquier estado) o toca en «Por profesional» un bloque que ya no se puede mover.
2. Se abre «Historial de la cita»: cada cambio con su hora en el reloj del negocio, quién lo hizo
   (o «Lo pidió la clienta» con el motivo) y qué cambió: de qué profesional o servicio a cuál, y de
   la hora solo la nueva («Nueva hora»).
Entra: las líneas de historial de la cita y los nombres de los usuarios del hub.
Sale: nada; solo lectura.
Si falla: «No se pudo cargar el historial de la cita.» · sin líneas: «Esta cita aún no tiene cambios registrados.»
Implicados: ninguno
QA: ninguno

### APPOINTMENTS-F11 Borrar una cita
Estado: parcial — se borra sin pedir confirmación; Borrar nunca sale en gris, y en una cita en curso o completada responde como hecho, no borra nada y aun así avisa de cita borrada
Actor: administrador
Pantalla: Agenda
Pasos:
1. Pulsa **Borrar** en la fila. En el día a día es mejor **Cancelar**, que conserva el registro.
2. La cita desaparece de la agenda (queda archivada, no destruida).
Entra: la cita.
Sale: la cita archivada y el aviso de cita borrada (`appointments.appointment.deleted`). El aviso sale aunque la cita no se haya borrado (en curso o completada), y una cita ya cobrada sí se borra.
Si falla: el error sale encima de la lista; sin permiso se rechaza.
Implicados: ninguno
QA: ninguno

### APPOINTMENTS-F17 Cobrar la cita en el TPV
Estado: parcial — cobrar no deja la cita como Completada, Cobrar sigue activo en citas canceladas o no presentadas, una cita cobrada sigue Pendiente o Confirmada y se puede mover, cancelar, marcar No-show y borrar (riesgo fiscal: la venta queda sin cita coherente), y si la venta se anula la cita sigue marcada como cobrada con Cobrar en gris (SALES-F30)
Actor: responsable
Pantalla: Agenda
Pasos:
1. Pulsa **Cobrar** en la fila de la cita: se abre el TPV con la cita cargada (clienta, servicio,
   profesional y precio), sin volver a teclear.
2. En el TPV añade productos o descuentos y cobra como cualquier venta.
3. Al volver a la Agenda, **Cobrar** sale en gris en esa cita: ya está cobrada.
Entra: la cita leída por el TPV.
Sale: la venta es del TPV (SALES-F26); aquí solo queda anotado con qué venta se cobró la cita (al recibir `sales.sale.created_from_appointment`). El estado no cambia. Citas no escucha la anulación de la venta: anulada en Ventas, la cita sigue marcada como cobrada y Cobrar sigue en gris (SALES-F30).
Si falla: si la venta no se cierra, la cita sigue sin marcar como cobrada y **Cobrar** sigue activo para repetir. Lo que pasa dentro del TPV está en SALES-F26: si no puede enlazar la cita lo avisa, y el IVA del servicio lo pone Servicios aunque el TPV no lo haya cargado; si el servicio ya no existe, no tiene categoría fiscal o la cita no nombra ningún servicio, el cobro se rechaza con su aviso y no se cobra nada.
Implicados: SALES-F26, SALES-F30, REC_PELUQUERIA-F09, REC_PELUQUERIA-F14, REC_WA_CITA-F10
QA: B-05, B-06, BD-09

### APPOINTMENTS-F19 Ajustar las reglas de reserva
Estado: parcial — sin ajustes guardados cada pieza usa un valor distinto: la reserva no aplica ninguna antelación, la lista de horas 60 minutos y 90 días, y las series 90 días
Actor: administrador
Pantalla: Ajustes de Citas
Pasos:
1. En **Citas**, abre la pestaña **Ajustes** (sin ser administrador solo se puede leer).
2. Cambia la duración por defecto, la antelación mínima y máxima, el solape, la cancelación por la
   clienta, la ventana del calendario, el intervalo entre huecos o la confirmación automática.
3. Pulsa **Guardar**: sale «Ajustes guardados.» y las reservas siguientes ya usan las reglas nuevas. «Enviar recordatorios» y «Enviar el recordatorio con estas horas de antelación» se guardan pero hoy no envían nada.
Entra: nada de otros componentes.
Sale: los ajustes del negocio y el aviso de ajustes cambiados (`appointments.settings.updated`). La confirmación automática es la misma que el interruptor de la tarjeta «Reservar citas» de WhatsApp (WHATSAPP_INBOX-F16) y solo vale para las citas que reserva la clienta: las del mostrador nacen siempre Pendiente.
Si falla: «No se pudieron guardar los ajustes.» (o «No se pudieron cargar los ajustes.» al abrir) y los ajustes guardados no cambian; si un campo no vale, «Revisa los campos marcados y vuelve a guardar.».
Implicados: WHATSAPP_INBOX-F16, REC_PELUQUERIA-F07, REC_WA_CITA-F06
QA: W-02, W-03
