# Tareas y aprobaciones en Inicio

La pantalla Inicio muestra las tareas del broker y las acciones que necesitan
una decisión. El panel también está disponible cuando falta conectar la cuenta
del modelo. Las propuestas de aprendizaje siguen en Sistema, en su panel propio.

`useActivity` conserva el estado mientras se navega entre Inicio y Sistema.
Consulta tareas y confirmaciones cada tres segundos, cada quince con la ventana
oculta, y actualiza al volver a la ventana o terminar un turno. Un fallo conserva
los datos anteriores, los marca como desactualizados y desactiva las decisiones
hasta que se pueda consultar el estado. También hay actualización manual.

Las tarjetas muestran el contenido revisable de correos, citas, comandos,
archivos, instalaciones y memoria. Los campos se seleccionan explícitamente;
no se vuelca el objeto de entrada ni sus credenciales. Cuando el broker incluye
`taskId`, la aprobación muestra la petición de esa tarea. No se atribuyen las
aprobaciones sin vínculo al último turno de conversación.

La decisión envía el identificador de la confirmación al endpoint existente.
El broker ejecuta la acción registrada y resuelve la continuación de la tarea
asociada. La interfaz no vuelve a construir el envío ni lo ejecuta por otra vía.
Bloquea las dos opciones durante la petición y conserva el resultado recibido.
Una confirmación observada como aprobada por otro cliente no se anuncia como
una ejecución terminada. Un error de transporte tampoco permite afirmar que
el efecto no ocurrió: se muestra un resultado incierto y no se reenvía la decisión.

Las tareas activas muestran estado y avance. Las anteriores quedan plegadas.
Cada tarea permite leer los eventos y el resultado registrado por el worker;
esa lectura se actualiza mientras la tarea siga activa. No se generan porcentajes
ni resultados a partir de las respuestas del modelo.

## Transporte

El renderer usa `window.agenosActivity` cuando el puente Electron está activo.
El preload expone cuatro operaciones acotadas: listar confirmaciones, listar
tareas, leer eventos y resolver una confirmación. El proceso principal valida
el identificador y la decisión, y autentica las peticiones con el token local del
broker. El token no viaja al renderer.

El modo web utiliza los mismos endpoints HTTP con la sesión del navegador.
Las consultas tienen ocho segundos de límite; una decisión dispone de dos
minutos porque su respuesta espera a la ejecución. Ningún transporte reintenta
automáticamente una mutación.

## Comprobaciones y límites

Las pruebas del panel cubren contenido, doble pulsación, rechazo, fallos,
decisiones externas, pérdida de conexión y consulta de resultados. Las pruebas
de clientes comprueban autenticación, codificación de identificadores y errores.
Las pruebas existentes del broker cubren ejecución única y continuación de tareas.

Se muestran hasta cincuenta tareas y las confirmaciones que devuelve el broker.
Al abrir la UI se incorporan las pendientes; las resueltas durante esa sesión
siguen visibles para que se pueda leer su estado. Los acuses detallados de una
decisión permanecen durante la sesión de la UI. Los eventos de tareas sí se
recuperan del broker tras recargar.

Este cambio no añade un planificador al worker, edición de borradores ni deshacer.
La ejecución en segundo plano sigue requiriendo un backend operativo. Las
tarjetas usan botones nativos y anuncios de estado para lectores de pantalla;
no añaden reconocimiento de órdenes de voz para elegir una aprobación.
