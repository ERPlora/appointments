# WORKFLOW — Citas · Lo que llega de fuera de la agenda

Prefijo: APPOINTMENTS

## Flujos

### APPOINTMENTS-F06 La clienta cancela o mueve su propia cita
Estado: parcial — la respuesta distingue una cita que no existe de una que es de otra persona, así que deja averiguar qué números de cita existen
Actor: cliente
Pantalla: ninguna
Pasos:
1. La clienta escribe por WhatsApp que no puede ir o que quiere cambiar la cita a otro día.
2. La automatización busca sus citas próximas y, si hay dos, pregunta cuál.
3. Para cancelar se aplica la política del negocio: si no se permite o no llega a la antelación
   mínima para cancelar, se le dice y la cita sigue en pie.
4. Para mover, se le ofrecen horas libres y la cita se mueve respetando la antelación mínima.
5. En el historial de la cita queda «Lo pidió la clienta» con el motivo.
Entra: la petición de la clienta identificada por su ficha.
Sale: la cita cancelada o movida, con «Lo pidió la clienta» en su historial, y su aviso (`appointments.appointment.cancelled` o `.rescheduled`).
Si falla: una cita que no existe se rechaza diciendo que ya no se puede cancelar o mover en su estado actual; una que existe pero es de otra persona, diciendo que es de otro cliente (la automatización lo cuenta con sus palabras). Fuera de plazo o con la cancelación desactivada se le explica que contacte con el negocio.
Implicados: SCHEDULES-F11, WHATSAPP_INBOX-F14, WHATSAPP_INBOX-F22, REC_PELUQUERIA-F12, REC_WA_CITA-F03, REC_WA_CITA-F08, HUB_SHELL-F66
QA: W-04

### APPOINTMENTS-F16 Bloquear tiempo en la agenda
Estado: parcial — no hay pantalla para crear, ver ni quitar bloqueos (solo el asistente o la API), y la repetición de un bloqueo se guarda pero no se aplica
Actor: responsable, asistente
Pantalla: asistente
Pasos:
1. Pide al asistente un bloqueo con título, inicio y fin, tipo (festivo, vacaciones, descanso,
   mantenimiento u otro), si es de día entero y, si es solo de un profesional, cuál.
2. Desde ese momento nadie puede reservar en esa franja: sin profesional bloquea todo el negocio. Un
   bloqueo de día entero lo juzgan distinto la reserva (por sus horas de inicio y fin) y la lista de
   horas libres (por sus fechas).
Entra: el título, la franja y el profesional opcional.
Sale: el bloqueo guardado y el aviso de bloqueo creado (`appointments.blocked_time.created`); la disponibilidad deja de ofrecer esa franja.
Si falla: el asistente cuenta el rechazo; sin permiso se rechaza.
Implicados: REC_PELUQUERIA-F05
QA: ninguno

### APPOINTMENTS-F18 Cita que llega por WhatsApp
Estado: hecho
Actor: cliente
Pantalla: Agenda
Pasos:
1. La clienta pide hora por WhatsApp; la automatización le ofrece horas libres reales (APPOINTMENTS-F02) y ella elige.
2. Con **Confirmar automáticamente las citas que reserva el cliente** encendido (por defecto), la
   cita nace **Confirmada**: la clienta recibe la respuesta «te he reservado…» y, como nacer
   confirmada avisa de cita confirmada, también el WhatsApp «¡Confirmada!…» (WHATSAPP_INBOX-F23).
3. Con ese ajuste apagado, la cita nace **Pendiente**, suma en la campana **Citas por confirmar** y
   alguien la confirma en la Agenda (APPOINTMENTS-F03).
4. La cita queda marcada como reservada por la clienta y sigue la antelación mínima: nunca en el pasado ni dentro de la ventana.
Entra: la clienta reconocida por su teléfono, el servicio, el profesional (o cualquiera que lo haga) y la hora elegida.
Sale: la cita con su historial («Reservada» y, si se confirma sola, «Confirmada») y los avisos de cita creada y confirmada.
Si falla: la automatización le dice a la clienta que esa hora ya no está y le ofrece otra; nunca inventa una hora.
Implicados: WHATSAPP_INBOX-F14, WHATSAPP_INBOX-F16, WHATSAPP_INBOX-F21, WHATSAPP_INBOX-F23, REC_PELUQUERIA-F07, REC_WA_CITA-F03, REC_WA_CITA-F05, REC_WA_CITA-F06, HUB_SHELL-F61, HUB_SHELL-F66
QA: W-02, W-03 (discrepa), W-07, BD-07, L-12

### APPOINTMENTS-F20 Ver las citas de una clienta en su ficha
Estado: hecho
Actor: empleado
Pantalla: Historial de visitas
Pasos:
1. Abre la ficha de la clienta en **Clientes**.
2. El bloque **Historial de visitas** enseña sus últimas citas con servicio, profesional, estado y las notas de cada visita.
Entra: la clienta abierta en la ficha.
Sale: nada; solo lectura. Si Citas no está instalada, la ficha no tiene el bloque.
Si falla: «No se pudo cargar el historial de visitas.»
Implicados: CUSTOMERS-F03, CUSTOMERS-F24, REC_PELUQUERIA-F08
QA: B-03, L-10

### APPOINTMENTS-F22 Cambiar las notas o el contacto de una cita
Estado: parcial — solo por el asistente, una automatización o la API; la agenda no tiene campo para las notas
Actor: responsable, asistente
Pantalla: asistente
Pasos:
1. Pide al asistente que anote en la cita la nota de la visita (por ejemplo, la fórmula del color) o que corrija el teléfono o el email.
2. Solo cambia lo que se pide; lo demás se queda como estaba. Las notas se pueden escribir en cualquier estado.
3. El teléfono se guarda en formato internacional (`+34600111222`), leído como número del país del negocio si llega sin prefijo, que es como el WhatsApp de cita confirmada encuentra la conversación de la clienta. Cualquier edición reescribe también así el teléfono antiguo que la cita guardaba tal como se tecleó; si no se puede leer como número, se queda como estaba.
4. Si además se cambia hora, profesional o servicio, se juzga como APPOINTMENTS-F04.
Entra: la cita y lo que cambia.
Sale: la cita actualizada y el aviso de cita editada (`appointments.appointment.updated`); solo un cambio de hora, profesional o servicio deja línea de historial. Aparte, cada 15 minutos la tarea `phones_to_e164` pasa a formato internacional el teléfono de las citas pendientes o confirmadas que aún no han pasado y lo guardan tal como se tecleó (reservadas antes de este cambio), sin historial ni aviso: el número es el mismo.
Si falla: el asistente cuenta el motivo (la pareja profesional y servicio incompleta, la hora de fin no cuadra, la cita no existe, o el teléfono no es un número válido del país del negocio: `appointments.phone_invalid`, y no se guarda nada de la edición).
Implicados: SCHEDULES-F11, HUB-F36
QA: L-12

### APPOINTMENTS-F23 Unir las citas al fusionar dos fichas de clienta
Estado: hecho
Actor: sistema
Pantalla: ninguna
Pasos:
1. En **Clientes** se fusionan dos fichas duplicadas.
2. Todas las citas y series de la ficha absorbida pasan a la que se queda, en ese mismo negocio.
3. Los nombres guardados en cada cita no cambian: son la foto de cuando se reservó.
Entra: la fusión de fichas (`customer.merged`).
Sale: citas y series apuntando a la ficha que se queda.
Si falla: no hay nada que ver en pantalla; repetir la fusión no cambia nada más.
Implicados: CUSTOMERS-F13, ONLINE_BOOKING-F09
QA: ninguno

### APPOINTMENTS-F24 Vaciar los datos de una clienta al borrarla
Estado: parcial — el paso 5 necesita un hub posterior a v1.1.30; un hub más viejo rechaza esta versión de Citas con un error de «tabla ajena» en vez de pedir que se actualice el hub (ERPlora/appointments#328)
Actor: sistema
Pantalla: Agenda
Pasos:
1. En **Clientes** el administrador borra los datos personales de una ficha.
2. Todas las citas de esa clienta en este negocio, en cualquier estado y también las borradas, se
   quedan sin su nombre, teléfono y email, sin las dos notas y sin el motivo de cancelación.
3. Sus series periódicas se quedan sin su nombre; siguen activas o pausadas como estaban, pero ya no
   reservan fechas nuevas porque su ficha ya no existe.
4. En el historial de esas citas se borran el nombre de la línea «Reservada» y el motivo de cada
   cancelación; el resto de la línea (qué pasó, cuándo y quién del equipo lo hizo) se queda.
5. Los huecos que apartaba la antigua bandeja de WhatsApp (retirada, ya no se ven en ninguna
   pantalla) guardaban como etiqueta el nombre o el teléfono de quien los pidió, sin saber de qué
   ficha: se vacían las etiquetas de todos los huecos de este negocio, y el hueco se queda.
6. Donde estaba el nombre, la Agenda, la lista de Periódicas y sus avisos dicen «Cliente borrado».
Entra: el aviso de borrado de la ficha (`customer.anonymized`) con su identificador.
Sale: las citas, series e historial sin datos de la clienta, y los huecos apartados retirados sin
etiqueta. Se quedan la cita, su número, el
servicio, el precio, el profesional, la hora, el estado y la venta: la agenda sigue diciendo qué
hizo cada profesional y qué se cobró. Una cita futura no se cancela sola.
Si falla: no hay nada que ver en pantalla; el hub reintenta el aviso hasta que entra, y repetirlo no
cambia nada más. Una ficha de otro negocio con el mismo identificador no se toca.
Implicados: pendiente
Pendiente de enlazar: customers — CUSTOMERS-F16, borrar los datos personales de un cliente, que publica el aviso
Pendiente de enlazar: hub — HUB-F248 y HUB-F250, el aviso único de borrado y lo que le toca a cada app (todavía dicen que Citas no lo escucha)
QA: ninguno
