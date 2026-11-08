# Limitaciones

Lo que esta arquitectura no puede hacer o garantizar, y qué se ha hecho al respecto. Si alguna
de estas limitaciones llega a molestar de verdad, la sección final dice qué habría que cambiar.

## Lo más importante

### Los rankings no son una credencial

**Qué se impide:** escribir puntos a mano, atribuirse aportaciones de otros, declarar aciertos,
puntuar repitiendo, entregar fuera de plazo, entregar dos veces, usar otra cuenta sin sus claves.

**Qué NO se puede impedir:** contestar con la solución delante. El banco es público, respuestas
incluidas, y el navegador necesita tenerlas para funcionar sin conexión. Tampoco se puede impedir
que un programa envíe respuestas correctas a un ritmo creíble, que alguien busque las respuestas
de una competición mientras juega o que una persona use varias cuentas.

**Por qué:** corregir sin revelar la solución exige un servidor que guarde las respuestas en
secreto, y esta arquitectura lo descarta. **Mitigación:** topes que acotan el daño; un registro
público y reproducible que hace toda trampa auditable; la marca automática de lo inverosímil, y
moderación. **La app lo dice en la pantalla de rankings**: es un juego de estudio entre personas.

### Las respuestas publicadas son públicas

El registro de eventos está en un repositorio público, asociado a tu cuenta de GitHub. Cualquiera
puede ver qué preguntas respondiste y cuándo. **Por eso publicar es opcional y explícito:** estudiar
sin publicar no envía absolutamente nada.

### Git no olvida

Ocultar una pregunta la saca de la app, pero sigue en el historial de la rama. Borrarla de verdad
exige reescribirlo. La app lo avisa antes de publicar. Esto importa para contenido con derechos
de autor: por eso se pide declarar el origen y aceptar la licencia.

## Comunicación y tiempos

| Limitación | Causa | Consecuencia |
|---|---|---|
| **Sin «Iniciar sesión con GitHub»** | Los endpoints de OAuth no permiten CORS (comprobado), y tanto el Device Flow como el flujo web necesitan pasar por un servidor | Conexión por issue. Más rara que un botón, pero sin secretos |
| **Un clic en GitHub por envío** sin token | Sin token, sólo GitHub puede crear el issue | La app mete en cada issue todo lo que quepa (hasta unas 65 000 letras ya comprimidas) y en Envíos los deja en cola, uno tras otro. Con un token no hace falta ningún clic, con el riesgo que implica |
| **Las imágenes pesan** sin token | Cada issue admite unos 38 KB de imágenes | Un lote con muchas figuras se reparte en más envíos. Sólo se reduce una imagen si las de su pregunta no caben ni en un issue para ellas solas |
| **Los envíos grandes hay que pegarlos** sin token | No caben en la dirección prellenada de 6 000 caracteres, sobre todo con imágenes | La app los copia en un paso aparte y el formulario de GitHub dice dónde pegarlos. En el uso real, tres envíos llegaron vacíos antes de este cambio |
| **El token da demasiado permiso** | Los tokens de grano fino no pueden contribuir a repos públicos ajenos (documentado por GitHub) | `public_repo` da escritura en todos tus repos públicos. Es opcional y se avisa |
| **Publicar tarda de 1 a 3 minutos**, y a veces hasta 10 más | Action + despliegue, más la caché del CDN de Pages, de 10 minutos. No se puede saltar: ignora los parámetros de la URL (comprobado) | La app muestra el estado intermedio y, tras un envío, mira cada minuto durante 15 minutos |
| **Sin tiempo real** | Sin servidor no hay WebSocket; señalizar por issues tarda de 30 a 120 s; WebRTC necesita un STUN externo o intercambiar datos a mano | Competiciones asíncronas |
| **Sin notificaciones push** | Web Push necesita un servidor | Sólo las de GitHub: las invitaciones son menciones reales |
| **Los crons no son puntuales** | GitHub los retrasa y puede perderlos con carga; los desactiva tras 60 días sin actividad en repos públicos | Se ejecutan de más y son idempotentes. Los plazos oficiales usan la hora de GitHub, no la del cron |
| **GitHub falla de vez en cuando** | Comprobado al desplegar: 500 y 502 en la API, y hasta un `git push` rechazado, que funcionan al repetirlos. Un 502 puede incluso haber aplicado la operación | Todo se reintenta con esperas, las operaciones son idempotentes, y un envío afectado queda abierto para el siguiente barrido |
| **60 consultas por hora sin token**, por IP | Límite de GitHub. Un `304` también gasta cuota (comprobado) | Lo legible va por Pages. Sólo se consulta la API para el estado de los envíos, con tope. Varias personas en la misma red comparten cuota |

## Competiciones

| Garantizado por GitHub o Actions | Declarado por el cliente: no verificable |
|---|---|
| Quién entrega | **Cuánto tardó en cada intento**: sólo desempata y la app lo muestra como «declarado» |
| Cuándo llega la entrega | Si miró las respuestas de quien entregó antes |
| Una sola entrega por persona | Si jugó sin conexión o consultó algo |
| La corrección y la clasificación | |
| Qué preguntas tocaron | |

Las entregas son públicas, y las preguntas también en cuanto alguien las recibe. Quien juega el
último tiene ventaja si quiere aprovecharla. Se asume: es un juego entre personas que quieren
aprender. Los torneos pueden fijar rondas cortas para reducirlo.

## Datos en el dispositivo

- **El progreso no viaja solo entre dispositivos.** Hay exportación e importación; se combina sin
  duplicar. Sincronizarlo solo requeriría una nube privada.
- **El navegador puede borrar los datos** si se queda sin espacio. La app pide almacenamiento
  persistente y avisa si no lo consigue. En Safari, sin instalar, se pueden borrar tras 7 días sin
  uso: por eso conviene instalarla y descargar copias.
- **No todos los navegadores de escritorio permiten instalar** aplicaciones web. Sigue funcionando en una pestaña.
- **Sin Background Sync:** Safari y Firefox no lo tienen. Lo pendiente se envía al abrir la app.
- **El temario elegido y el objetivo diario son de este dispositivo.** Se guardan con las preferencias y viajan en la copia de seguridad, pero no se sincronizan solos.
- **Los amigos son una lista privada, no una amistad.** Viven en este dispositivo y en las copias:
  la otra persona no se entera ni tiene que aceptar. Hacerlo mutuo obligaría a publicar quién sigue
  a quién en el repositorio, que es público.
- **Una versión antigua de la app no ve lo nuevo hasta actualizarse.** Las preguntas de desarrollo con
  apartados o subapartados, las de más de 6 imágenes y los perfiles con nombre cambiado tienen campos que esa versión
  no conoce: los aparta como inválidos en vez de enseñarlos a medias. Al actualizar, aparecen.
- **El nombre visible no impide los parecidos.** Actions rechaza el de otra cuenta aunque cambien
  mayúsculas, tildes, signos o caracteres invisibles, pero no letras de otros alfabetos que se parecen
  (una «а» cirílica). Por eso el @usuario se muestra siempre al lado.

## Seguridad en Pages

- **Sin cabeceras propias:** la CSP va en una etiqueta `<meta>`, que no admite `frame-ancestors`.
  No se puede impedir que otra web incruste la app en un iframe. El riesgo es bajo: publicar exige
  siempre un paso en github.com o un token que un iframe no puede usar sin más.
- **El mismo origen en `*.github.io`:** cada repositorio de una cuenta comparte origen con los demás
  de esa cuenta en `usuario.github.io`, incluido IndexedDB. Si tienes otras apps en la misma cuenta,
  pueden leer estos datos. Con un dominio propio, o en un usuario u organización dedicados, se evita.

## Escala

Límites de GitHub: 1 GB publicado, 100 GB al mes de tráfico (blando), 1 GB recomendado de
repositorio, y 80 creaciones por minuto y 500 por hora en la API. Medido con 5 000 preguntas:
primera sincronización de 2,6 s, y 23 ms si nada cambió.

| Orden de magnitud | Qué pasa | Plan |
|---|---|---|
| Hasta 10 000 preguntas y 1 000 personas activas | Va bien | Nada |
| **Imágenes** cerca de 1 GB | Pages deja de aceptar el sitio | Moverlas a un repo aparte o a Releases, cambiando `communityUrl` |
| **Eventos** grandes (varios GB) | Clonar y compilar se vuelve lento | Consolidar los meses cerrados en un resumen y archivar los originales en Releases: el cálculo sigue siendo auditable |
| Más de 500 envíos por hora | Se alcanza el límite de la API | El intake ya procesa por lotes y se pondría al día, con más retraso |
| Decenas de miles de preguntas | La memoria del móvil y la primera descarga empiezan a pesar | Descarga selectiva por asignatura: los fragmentos ya están separados por asignatura |

GitHub Pages prohíbe los servicios comerciales: esto vale para una comunidad educativa, no para
un negocio.

## Qué se ha probado contra GitHub y qué no

Probado el 2026-11-05 en el despliegue real de `Tomasito25/questionbank` (hoy `Tomasito25/QB-Bachillerato-Internacional`), con **una sola cuenta**
de GitHub y un navegador de escritorio.

| Comprobado de principio a fin | Resultado |
|---|---|
| Despliegue y PWA | Publica en subcarpeta, sin violaciones de la CSP. El Service Worker se activa, avisa de la versión nueva y actualiza al pulsar. Los enlaces profundos abren la app |
| Conexión por issue | GitHub certifica la cuenta y la app la reconoce en unos 30 s |
| Publicar preguntas | Issue → PR del bot → fusión → despliegue → la app las trae como comunitarias, sin conflictos |
| Publicar resultados | Los corrige Actions. Sin tocar nada, 110 s entre crear el issue y verlos reflejados en la app |
| Envíos hostiles | Sin datos, con puntos falsificados o con una inyección en el título: rechazados sin ejecutar nada. Un issue normal se ignora |
| PR hostil | El que toca `.github/`, `events/` o `moderation/` se rechaza ruta por ruta, y la revisión no ejecuta código del PR. Uno legítimo se fusiona |
| Competición grupal | Crearla, unirse por código, jugar y entregar. La clasificación del servidor coincide con la corrección local, y una segunda entrega se rechaza |
| Retos diario y semanal | Se crean al lanzar el workflow a mano |
| Reporte y retirada | El reporte queda abierto para moderar; lo retirado deja de servirse |
| Fallos de GitHub | Hubo 500 y 502 reales en plena prueba. Un envío afectado se recuperó al reintentarlo, sin perder datos |
| Crons | Se disparan solos, pero con mucho retraso: el reto diario del 6 de noviembre se creó a las 05:59 UTC en vez de a las 00:07, y el barrido de cada 15 minutos corrió dos veces en 12 horas. Nada inmediato depende de ellos: cada envío se procesa al crear su issue |

| Sin comprobar en real | Por qué | Qué lo cubre |
|---|---|---|
| Pulsar «Create» en el formulario prellenado de GitHub | Los issues se crearon con `gh`, con el título y el cuerpo exactos que genera la app | La longitud de la URL se midió con `curl`. Lo cierra publicar una vez desde un navegador con sesión iniciada |
| PR desde el fork de otra persona, y cómo trata GitHub a quien contribuye por primera vez | Hace falta una segunda cuenta | Pruebas con la API simulada |
| Duelos, torneos y rankings con varias personas | Ídem | Pruebas automáticas del cálculo y del cuadro |
| Modo con token en el sitio publicado | No se escribe un token real durante una prueba | Pruebas con la API simulada, incluida la secuencia de Git Data |
| Instalarla, en móvil o en escritorio | No había dispositivos, y el navegador de la prueba no lo permite | Manifiesto, iconos y Service Worker revisados; nada más |
| Sin conexión en el sitio publicado | Se probó en local, con el servidor parado | En el sitio, el Service Worker está activo y con todo precacheado |

## Si un día se puede relajar la restricción

Ordenado por lo que aporta frente a lo que cuesta:

1. **Un Cloudflare Worker sin estado, de unas 30 líneas**, para el Device Flow. Da un botón de
   «Iniciar sesión» de verdad y un token con el alcance mínimo de una GitHub App, sin clics. No
   guarda nada ni necesita secretos.
2. **Un backend con base de datos.** Permitiría ocultar respuestas en competiciones, resultados
   privados, tiempo real y sincronización entre dispositivos. Es otra arquitectura: `core/` serviría
   tal cual.
