# WORKFLOW — Citas · Citas periódicas y lotes

Prefijo: APPOINTMENTS

## Flujos

### APPOINTMENTS-F12 Crear una cita periódica
Estado: parcial — no deja crear una clienta nueva desde el formulario (appointments#318); Servicio y Profesional ofrecen como mucho los 500 primeros, sin decirlo (appointments#324)
Actor: empleado
Pantalla: Periódicas
Pasos:
1. En **Periódicas**, pulsa añadir: se abre «Nueva cita periódica».
2. Elige Cliente (se busca escribiendo nombre, teléfono o email, igual que en APPOINTMENTS-F01, entre
   todas las fichas; appointments#306), Servicio y Profesional (solo los que hacen el servicio), la Repetición (cada día,
   semana, dos semanas o mes), el Día de la semana si aplica, el Día y la Hora de inicio, los Min. y,
   si quieres, «Termina el» o «Número de citas». Servicio y Profesional dicen «Cargando…», «No se
   han podido cargar…» con **Reintentar** o «Todavía no hay… reservables» igual que en
   APPOINTMENTS-F01 (appointments#319).
3. Pulsa **Crear cita periódica**: se crea la serie y se reservan sus citas de la ventana (APPOINTMENTS-F13).
4. Sale «Cita periódica creada y sus citas reservadas», la lista de fechas que no se pudieron reservar
   o, si la serie aún no tiene ninguna fecha dentro de la antelación máxima, el aviso con la fecha de
   su primera cita (APPOINTMENTS-F13, appointments#316).
Entra: clienta, servicio y profesional de sus fichas, igual que una cita suelta.
Sale: la serie activa, sus citas pendientes y el aviso de serie creada (`appointments.recurring.created`).
Si falla: el motivo sale dentro del panel; si la serie se creó pero no se reservó nada, se dice y se usa **Reservar citas** en su fila.
Implicados: CUSTOMERS-F25, CUSTOMERS-F30, STAFF-F09, STAFF-F10, STAFF-F12
QA: ninguno

### APPOINTMENTS-F13 Reservar las citas de una serie
Estado: hecho
Actor: empleado
Pantalla: Periódicas
Pasos:
1. Pulsa **Reservar citas** en la fila de la serie.
2. Se reservan las fechas de la ventana (de ahora hasta la antelación máxima, contada a la hora: el
   último día, una cita más tarde que la hora en que se reserva no se rechaza, entra la próxima vez
   que se reserven las citas de la serie, appointments#289; si la antelación máxima está a 0, sin
   límite, la ventana es de 90 días) que aún no estaban dadas, todas de un toque: cada vuelta reserva
   como mucho 50 y la pantalla sigue sola con la siguiente (appointments#299).
3. Una fecha que no cabe (cerrado, el profesional no trabaja, bloqueo, otra cita, pasado) se salta y
   se lista con su motivo; las demás se reservan.
4. Si la serie aún no tiene ninguna fecha dentro de la ventana (empieza más lejos que la antelación
   máxima, o su próxima fecha lo está), no se reserva nada y no es un fallo: el aviso dice «Aún no hay
   nada que reservar: la próxima fecha de esta serie, el {fecha}, queda más lejos que la antelación
   máxima» y se vuelve a pulsar **Reservar citas** cuando se acerque (appointments#316).
Entra: la serie y las mismas comprobaciones que una cita suelta (APPOINTMENTS-F02).
Sale: una cita pendiente por fecha reservada, cada una con su aviso de cita creada; nunca duplica una fecha ya dada.
Si falla: «No se han podido reservar las citas de esta serie.»; una serie desactivada pide activarla;
una serie que ya no tiene fechas (pasó su fecha de fin o se dieron todas sus citas) dice «Esta cita
periódica ya no tiene fechas que reservar»;
si la ventana no se termina de reservar, el aviso dice «Las fechas desde el {fecha} aún no están
reservadas» y se vuelve a pulsar **Reservar citas**.
Implicados: CUSTOMERS-F30, SCHEDULES-F11, STAFF-F12, STAFF-F16
QA: ninguno

### APPOINTMENTS-F14 Editar una serie de esta cita en adelante
Estado: hecho
Actor: responsable
Pantalla: Periódicas
Pasos:
1. Pulsa **Editar serie** en **Periódicas**, o mueve en la Agenda una cita de la serie y elige **Esta y todas las siguientes**.
2. Cambia la Hora, los Min., la Repetición, el Día de la semana, el Profesional o el Servicio. El panel
   dice desde qué fecha se aplica, cuántas citas alcanza y cuáles no se tocarán por estar ya cobradas.
3. Pulsa **Guardar de esta cita en adelante**.
4. Lo anterior a hoy, lo cancelado, lo en curso y lo cobrado no se toca. Las citas que siguen
   cayendo en la pauta se mueven; las que ya no caen se cancelan; las que no caben se quedan como
   estaban y se listan; si cambió la pauta, las fechas nuevas se reservan solas. Al mover una serie
   se aplica también la antelación mínima: no hay excepción de mostrador.
Entra: la serie, sus citas ya dadas y las comprobaciones de horario, turno, bloqueos y solape.
Sale: la serie partida en dos (la vieja termina el día antes) o, si el cambio empieza en la primera cita de la serie o antes, la misma serie editada sin partir; las citas movidas o canceladas con su historial y el aviso de serie cambiada (`appointments.recurring.updated`).
Si falla: el motivo sale en el panel y nada cambia; con la agenda del profesional muy llena puede no mover ninguna (appointments#297).
Implicados: SCHEDULES-F11, STAFF-F11, STAFF-F12, STAFF-F16
QA: ninguno

### APPOINTMENTS-F15 Pausar, reactivar o borrar una serie
Estado: hecho
Actor: responsable
Pantalla: Periódicas
Pasos:
1. Apaga el interruptor **Activa** de la serie para que deje de reservar citas nuevas; enciéndelo para reactivarla.
2. Para quitarla, pulsa **Borrar** y confirma «¿Borrar la serie de citas de …?».
3. Las citas ya reservadas se conservan en los dos casos.
Entra: la serie.
Sale: la serie pausada, reactivada o borrada (`appointments.recurring.updated` al pausar o reactivar).
Si falla: «No se ha podido cambiar el estado…» o «No se ha podido borrar…» encima de la lista.
Implicados: ninguno
QA: ninguno

### APPOINTMENTS-F21 Reservar varias citas de golpe (bono o curso)
Estado: parcial — solo por el asistente o la API, no hay pantalla; y con la agenda del profesional muy llena el lote falla entero (appointments#296)
Actor: responsable, asistente
Pantalla: asistente
Pasos:
1. Pide al asistente varias citas para la misma clienta, servicio y profesional (hasta 50).
2. Se reservan todas o ninguna: si una no cabe, no se reserva el lote y se dice por qué.
Entra: clienta, servicio y profesional de sus fichas y la lista de horas.
Sale: una cita pendiente por hora, cada una con su aviso de cita creada.
Si falla: el lote entero se rechaza con el motivo de la primera hora que no cabe.
Implicados: CUSTOMERS-F30, SCHEDULES-F11, STAFF-F12, STAFF-F16
QA: B-08
