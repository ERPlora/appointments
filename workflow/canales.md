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
Implicados: WHATSAPP_INBOX-F14, WHATSAPP_INBOX-F22, REC_WA_CITA-F03, REC_WA_CITA-F08
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
Implicados: ninguno
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
Implicados: WHATSAPP_INBOX-F14, WHATSAPP_INBOX-F16, WHATSAPP_INBOX-F21, WHATSAPP_INBOX-F23, REC_WA_CITA-F03, REC_WA_CITA-F05, REC_WA_CITA-F06
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
Implicados: pendiente
Pendiente de enlazar: customers — la ficha de la clienta que aloja el bloque
QA: B-03, L-10

### APPOINTMENTS-F22 Cambiar las notas o el contacto de una cita
Estado: parcial — solo por el asistente, una automatización o la API; la agenda no tiene campo para las notas
Actor: responsable, asistente
Pantalla: asistente
Pasos:
1. Pide al asistente que anote en la cita la nota de la visita (por ejemplo, la fórmula del color) o que corrija el teléfono o el email.
2. Solo cambia lo que se pide; lo demás se queda como estaba. Las notas se pueden escribir en cualquier estado.
3. Si además se cambia hora, profesional o servicio, se juzga como APPOINTMENTS-F04.
Entra: la cita y lo que cambia.
Sale: la cita actualizada y el aviso de cita editada (`appointments.appointment.updated`); solo un cambio de hora, profesional o servicio deja línea de historial.
Si falla: el asistente cuenta el motivo (la pareja profesional y servicio incompleta, la hora de fin no cuadra, la cita no existe).
Implicados: ninguno
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
Implicados: pendiente
Pendiente de enlazar: customers — fusionar dos fichas de clienta
QA: ninguno
