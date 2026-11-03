# Deporte Total 360° — API multideporte

Cloudflare Worker que sirve como intermediario seguro entre la aplicación
Android Flutter y SportsAPI.app para los diez deportes favoritos. También
conserva las rutas antiguas de API-Sports para compatibilidad. Las claves
permanecen en Cloudflare: nunca deben incluirse en el APK ni en Flutter.

## Estado y catálogo

- `GET /health` — estado del Worker, clave SportsAPI configurada y número de deportes favoritos.
- `GET /api/sportsapi/favorites` — deportes y competiciones favoritas de Deporte Total 360°.
- `GET /api/sportsapi/statistics?type=...&id=...` — estadísticas seguras de partidos, resultados de carreras y clasificaciones.
- `GET /api/sports` — catálogo antiguo de API-Sports, conservado por compatibilidad.
- `GET /api/chat/messages` — devuelve los últimos mensajes de la sala pública.
- `POST /api/chat/messages` — publica un mensaje `{ "name": "Alias", "text": "Mensaje" }` en esa misma sala.

## Recursos disponibles

| ID del deporte | Recursos principales |
|---|---|
| `football` | `fixtures`, `live`, `leagues`, `standings` |
| `basketball` | `games`, `leagues`, `standings` |
| `nba` | `games`, `leagues`, `standings`, `teams`, `players` |
| `baseball` | `games`, `leagues`, `standings` |
| `american-football` | `games`, `live`, `leagues`, `standings` |
| `hockey` | `games`, `leagues`, `standings` |
| `handball` | `games`, `leagues`, `standings` |
| `rugby` | `games`, `leagues`, `standings` |
| `volleyball` | `games`, `leagues`, `standings` |
| `afl` | `games`, `leagues`, `standings` |
| `formula-1` | `races`, `driver-rankings`, `team-rankings`, `drivers`, `teams`, `circuits` |
| `mma` | `fights`, `fighters`, `categories`, `results` |

Las rutas nuevas siguen el formato `GET /api/{sportId}/{resource}`.
Ejemplos:

- `/api/football/fixtures?date=2026-11-02&timezone=America%2FGuyana`
- `/api/basketball/leagues?search=NBA`
- `/api/nba/leagues?name=NBA`
- `/api/formula-1/driver-rankings?season=2026`
- `/api/mma/fights?date=2026-11-02`

Las rutas antiguas de fútbol (`/api/fixtures`, `/api/live`,
`/api/leagues`, `/api/standings`) se mantienen para compatibilidad.

## SportsAPI.app — agenda, estadísticas y deportes favoritos

La agenda nativa usa SportsAPI.app como proveedor principal. La clave se lee
exclusivamente desde el secreto de Cloudflare Worker `SPORTAPI_API_KEY` y
se envía al proveedor mediante `Authorization: Bearer`. La APK nunca recibe
ni almacena esa clave.

Los diez deportes configurados son:
`football`, `basketball`, `baseball`, `ice-hockey`, `volleyball`,
`mma`, `futsal`, `cycling`, `motorsport` y `handball`.
El módulo `src/sportsapi_favorites.js` mantiene las competiciones masculinas
y femeninas seleccionadas para cada deporte y descarta los eventos de otras
competiciones. En carreras, ciclismo y motor se usan las series y las sesiones
publicadas por el proveedor; no se inventan horas de salida.

El planificador refresca la agenda por día UTC, obtiene las primeras páginas
de los ocho deportes de partidos y los calendarios de las dos disciplinas de
carreras. Las páginas adicionales de partidos se consultan de una en una,
con una pausa mínima de un minuto entre páginas y un máximo de 40 ligas por
deporte. Los marcadores en vivo globales se refrescan cada 30 minutos y se
mezclan con la agenda diaria. Esto controla el uso de cuota; las consultas
adicionales de estadísticas también consumen cuota de SportsAPI.

Rutas nuevas:
- `GET /api/sportsapi/favorites` — lista de los diez deportes y las competiciones favoritas.
- `GET /api/live/auto/schedule` — agenda diaria y asignaciones automáticas compartidas.
- `GET /api/sportsapi/statistics?type=fixture-statistics&id=ID` — estadísticas de un partido.
- `GET /api/sportsapi/statistics?type=race-results&id=ID&session=ID_SESION` — resultados de una sesión o carrera.

Los identificadores de partido y carrera se conservan en la agenda para abrir
sus estadísticas. Las carreras se muestran por sesión (por ejemplo, prácticas,
clasificación, carrera o etapas ciclistas) con las horas UTC exactas convertidas
al huso horario local de cada dispositivo.

La búsqueda automática de canales sigue siendo un proceso separado: SportsAPI
aporta eventos, equipos, competiciones, fechas, marcadores y sesiones; el
planificador compara nombres de equipos/eventos con las guías XMLTV y busca
una señal directa válida en las listas M3U configuradas. SportsAPI no entrega
vídeos ni enlaces IPTV. Una coincidencia EPG no garantiza que exista una señal
reproducible; el Worker comprueba el manifiesto y no evita DRM, geobloqueos,
inicios de sesión ni restricciones del proveedor.

## Catálogo de señales autorizadas para Deportes en vivo

La ruta `GET /api/live/sources` entrega únicamente señales directas HTTPS
`.m3u8` o `.mp4` que el propietario haya agregado al catálogo. No rastrea
páginas, no extrae enlaces de reproductores y no evita DRM, inicios de sesión,
geobloqueos ni restricciones del proveedor.

Configura la variable/secret de Worker `LIVE_STREAM_CATALOG_JSON` con una lista
JSON. Cada elemento debe usar el ID de deporte del catálogo, el ID del evento
que devuelve API-Sports y una URL directa que tengas derecho a distribuir:

```json
[
  {
    "id": "football-fixture-123-main",
    "eventId": "123",
    "sport": "football",
    "eventTitle": "Equipo local vs Equipo visitante",
    "name": "Señal oficial",
    "url": "https://media.example/live.m3u8",
    "startsAt": "2026-11-03T19:00:00Z"
  }
]
```

Consulta por deporte y rango de fechas:
`/api/live/sources?sport=football&from=2026-11-03&to=2026-11-09`.
La APK combina ese catálogo con el estado real del evento: el botón de
reproducción solo se habilita cuando la agenda confirma que el evento está
en vivo. No pongas contraseñas ni tokens privados en URLs expuestas por esta
ruta. Sin catálogo configurado, la ruta devuelve una lista vacía de forma
segura.

## Planificador central de transmisiones

El Worker también ejecuta un planificador automático en la nube, independiente de cualquier teléfono:
- Un Cron Trigger de Cloudflare ejecuta el planificador cada minuto.
- El planificador consulta la agenda pública de MARCA en `https://www.marca.com/programacion-tv.html`, conserva el último resultado válido ante errores temporales y detecta el estado final cuando la fuente lo publica.
- Cada cinco minutos combina las listas M3U y guías XMLTV integradas, cruza nombres de equipos con la programación EPG y ordena las señales en español antes de probar otros idiomas.
- Diez minutos antes del inicio del evento empieza a comprobar manifiestos y segmentos directos. Una señal solo se publica si supera la comprobación disponible; las URL HTML, DRM, credenciales y geobloqueos no se eluden.
- El estado común se guarda en un Durable Object SQLite. `GET /api/live/auto/schedule` entrega a todas las APK la misma agenda y las asignaciones verificadas, incluyendo hora final para liberar el reproductor.
- Una guía EPG puede anunciar una emisión pero no crea el vídeo. Si ninguna señal coincide o responde, el evento sigue en espera y no se inventa una transmisión.

El planificador continúa cuando el teléfono del propietario está apagado o la APK está desinstalada, una vez que este Worker actualizado esté desplegado en Cloudflare. Los teléfonos con la APK actualizada consultan el endpoint al estar conectados. Firebase Cloud Messaging envía un aviso al tema `deporte_total_360_live` cuando una señal directa queda verificada dentro de la ventana previa al evento. Cada APK se suscribe al tema solo si el usuario activa Notificaciones y se da de baja al desactivarlas. El Worker envía una sola notificación al tema, sin almacenar tokens de dispositivos. Al tocar el aviso, la APK abre Deportes en vivo; Android no permite forzar la reproducción con la app cerrada y el usuario debe pulsar Play. El envío requiere el secreto `FCM_SERVICE_ACCOUNT_JSON` en Cloudflare Worker.

El contenido de la página MARCA puede cambiar o impedir el acceso automatizado. En tal caso el estado publicado marca la fuente como desactualizada o no disponible y conserva solo eventos anteriores que aún no hayan vencido; la captura estructurada de MARCA debe verificarse en los registros del Worker tras el primer despliegue.

## Configuración de Cloudflare

Configura estos secretos/variables en el repositorio de GitHub usado por el
workflow de despliegue:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SPORTAPI_API_KEY` (obligatoria para la nueva agenda y estadísticas).
- `APISPORTS_KEY` (solo si deseas mantener activas las rutas antiguas de API-Sports).

Además, configura `FCM_SERVICE_ACCOUNT_JSON` como secreto del Worker en Cloudflare Dashboard (Settings → Variables and Secrets). Debe contener el JSON de una cuenta de servicio del mismo proyecto Firebase, con permiso para enviar mensajes de Firebase Cloud Messaging. No guardes ese JSON en GitHub, el APK ni el repositorio. La APK debe usar los cuatro secretos cliente Firebase descritos en el README del repositorio de la app.

El workflow publica `SPORTAPI_API_KEY` y, cuando esté configurada, `APISPORTS_KEY` en Cloudflare Worker mediante Wrangler. El secreto `SPORTAPI_API_KEY` debe guardarse en los secretos Actions de ESTE repositorio del Worker, no solo en el repositorio Flutter. El binding SQLite del planificador y su Cron Trigger se crean desde `wrangler.toml`.
El Worker admite también `APIFOOTBALL_KEY` como nombre antiguo alternativo,
pero el nombre recomendado es `APISPORTS_KEY`.

## API-Sports: cobertura y cuotas

La aplicación solicita cada deporte a su API independiente. Una respuesta
vacía no significa que la pantalla se haya detenido: la liga, la temporada o
el deporte pueden no tener eventos/datos disponibles en ese momento. La
cobertura y los endpoints dependen de la suscripción habilitada para cada API.
El Worker conserva respuestas en caché para reducir consultas.

## Chat público

La aplicación usa una única sala compartida implementada con un Durable Object SQLite (`PublicChatRoom`). El historial conserva los últimos 120 mensajes, admite alias de hasta 24 caracteres y mensajes de hasta 500 caracteres, y aplica un límite básico de frecuencia por dirección IP en memoria. Los alias no están autenticados ni verificados; la app advierte a los usuarios que no publiquen datos personales. No se guardan direcciones IP en los mensajes.

El Durable Object está incluido en `wrangler.toml` con una migración SQLite `v1-public-chat`. El despliegue de producción provisiona esa clase al publicar el Worker.

## Seguridad

- La clave API solo se lee desde los secretos del Worker.
- Los endpoints de lectura usan GET; el chat y el registro/baja de tokens FCM usan POST con validación de contenido.
- Los recursos y parámetros se validan con listas permitidas.
- Las respuestas incluyen CORS y tipos de contenido seguros.

## Pruebas y despliegue

`npm test` ejecuta las pruebas Node.js.
El workflow de GitHub Actions ejecuta las pruebas antes de desplegar el Worker.
