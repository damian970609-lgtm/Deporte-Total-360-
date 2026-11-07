# Deporte Total 360° — API multideporte

Cloudflare Worker que sirve como intermediario seguro entre la aplicación
Android Flutter y API-Sports. La clave del proveedor permanece en Cloudflare:
nunca debe incluirse en el APK ni en el código Flutter.

## Estado y catálogo

- `GET /health` — estado del Worker y número de deportes configurados.
- `GET /api/sports` — catálogo de deportes, identificadores y recursos disponibles.
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

## Configuración de Cloudflare

Configura estos secretos/variables en el repositorio de GitHub usado por el
workflow de despliegue:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `APISPORTS_KEY`

El workflow publica `APISPORTS_KEY` en Cloudflare Worker mediante Wrangler.
El Worker admite también `APIFOOTBALL_KEY` como nombre antiguo alternativo,
pero el nombre recomendado es `APISPORTS_KEY`.

## API-Sports: cobertura y cuotas

La aplicación solicita cada deporte a su API independiente. Una respuesta
vacía no significa que la pantalla se haya detenido: la liga, la temporada o
el deporte pueden no tener eventos/datos disponibles en ese momento. La
cobertura y los endpoints dependen de la suscripción habilitada para cada API.
El Worker conserva respuestas en caché para reducir consultas.

## Integración SportsAPI.app para los diez deportes favoritos

El Worker también ofrece un proxy independiente para SportsAPI.app. La clave
se guarda como secreto SPORTAPI_API_KEY en Cloudflare y nunca se incluye en
Flutter ni en la APK.

Rutas principales:

- GET /api/sportsapi/favorites — catálogo de diez deportes y competiciones favoritas.
- GET /api/sportsapi/sports — deportes disponibles en el proveedor.
- GET /api/sportsapi/fixtures?date=YYYY-MM-DD&sport=football&page=0 — agenda de deportes de equipo.
- GET /api/sportsapi/races?date=YYYY-MM-DD&sport=cycling — ciclismo y deportes de motor.
- GET /api/sportsapi/fixtures/{id}/statistics — estadísticas de un partido.
- GET /api/sportsapi/races/{id}/results — clasificación de una carrera.
- GET /api/sportsapi/leagues/{id}/standings?season={seasonId} y /api/sportsapi/series/{id}/standings — clasificaciones.

El adaptador valida rutas, deportes y parámetros, envía Authorization: Bearer
desde Cloudflare, conserva el sobre JSON data/meta, respeta Retry-After y usa
caché para limitar consultas. La agenda solicita una página por deporte; la
cobertura de cada competición depende del catálogo y del plan contratado.
La lista favorita es la configuración deseada, no una garantía de que cada
torneo tenga fixtures publicados en el proveedor.
El Worker aplica una lista permitida de competiciones en las respuestas diarias de partidos y carreras. Se excluyen las ligas y carreras no seleccionadas antes de entregar la agenda a la APK. En ciclismo, se filtra por el nombre de cada carrera, porque la serie del proveedor agrupa únicamente el calendario masculino o femenino.

Para desplegar, agrega SPORTAPI_API_KEY como GitHub Actions secret del
repositorio del Worker. El workflow lo instala en Cloudflare como secreto y
verifica sportsapi_configured y los diez deportes favoritos. Si el secreto ya
existe solo en otro repositorio, también debe configurarse aquí.

## Chat privado de compradores

La sala `PublicChatRoom` es una comunidad compartida, pero no es pública: `GET /api/chat/messages` y `POST /api/chat/messages` requieren un ID token de Google válido para el mismo cliente OAuth configurado en la APK y en Cloudflare. El Worker comprueba que el correo verificado tenga una licencia `paid` con estado `active` en el registro central de licencias. Las cuentas sin licencia, con licencia gratuita o revocada reciben HTTP 403. La cuenta administradora configurada en `CHANNELS_ADMIN_EMAIL` conserva acceso de propietario y permisos de moderación.

Cada petición valida la identidad en el servidor; nunca se confía en un correo, ID de usuario o rol enviado por Flutter. El Worker reemplaza los encabezados internos de identidad antes de llamar al Durable Object. Los mensajes almacenan internamente el ID de Google para asociar un alias estable a cada comprador, pero ese identificador no se devuelve a los demás miembros. El alias se fija con el primer mensaje válido de esa cuenta.

El historial conserva los últimos 120 mensajes en SQLite. Los alias admiten hasta 24 caracteres y los mensajes hasta 500. El límite de frecuencia es de un mensaje cada dos segundos por cuenta y se conserva en almacenamiento del Durable Object, no solo en memoria. La cuenta propietaria puede eliminar mensajes mediante `DELETE /api/chat/messages/{id}`; la eliminación es moderada y deja un aviso visible en el historial, sin exponer el contenido anterior.

El Durable Object está incluido en `wrangler.toml` con la migración SQLite `v1-public-chat`. El despliegue de producción provisiona esa clase al publicar el Worker. Las pruebas cubren verificación de licencia, bloqueo de cuentas gratuitas/revocadas, separación entre miembros y propietario, límites de mensajes y moderación.

## Seguridad

- La clave API solo se lee desde los secretos del Worker.
- Solo se permiten solicitudes GET y OPTIONS.
- Los recursos y parámetros se validan con listas permitidas.
- Las respuestas incluyen CORS y tipos de contenido seguros.

## Pruebas y despliegue

`npm test` ejecuta las pruebas Node.js.
El workflow de GitHub Actions ejecuta las pruebas antes de desplegar el Worker.

## Catálogo global de canales deportivos (Cloudflare)

La APK consulta `GET /api/channels`, que solo publica las señales deportivas
que el administrador haya marcado como visibles. Cada canal recibe un ID estable
(slug del nombre y huella corta de la URL). El panel administrador también ve
ese ID; la URL multimedia solo aparece en las vistas de la aplicación después
de publicar el canal.

El catálogo, las listas fuente y los favoritos se guardan en un Durable Object
SQLite de Cloudflare. La importación se procesa en lotes pequeños y continúa
aunque la aplicación esté cerrada o desinstalada. Un Cron Trigger vuelve a
consultar las fuentes cada seis horas.

Rutas:
- `GET /api/channels`: catálogo público visible.
- `GET/PUT /api/channels/favorites`: favoritos privados por identidad Google.
- `GET /api/channels/admin/catalog?q=...`: catálogo de administración.
- `GET/POST /api/channels/admin/sources`: ver y registrar listas M3U.
- `POST /api/channels/admin/refresh`: iniciar importación/actualización.
- `PATCH /api/channels/admin/channels/{id}/visibility`: publicar u ocultar.

La API verifica un ID token de Google, su audiencia `GOOGLE_OAUTH_CLIENT_ID`,
emisor, caducidad y correo verificado. Solo el correo indicado en
`CHANNELS_ADMIN_EMAIL` puede usar el panel administrador; por defecto es
`damian970609@gmail.com`. La APK no contiene una clave maestra. Configura
`GOOGLE_OAUTH_CLIENT_ID` como secreto del Worker y como secreto de Actions de
la APK. Usa el ID de cliente OAuth de tipo Web y registra también el cliente
Android con el package name y SHA-1 del certificado de firma de la APK.

Las listas añadidas empiezan ocultas. El nombre/grupo se utiliza para sugerir
la categoría deportiva; el administrador debe confirmar que puede distribuir
cada señal antes de publicarla. Solo se aceptan listas M3U HTTPS y flujos
HTTPS directos HLS (.m3u8), MP4 o MPEG-TS (.ts). No se extraen reproductores web, ni se
eluden DRM, suscripciones, credenciales o geobloqueos. Las fuentes con redirección
deben registrarse con su URL final. Tamaño máximo por lista: 4 MB.


## Idioma de cada canal

El importador lee los metadatos `tvg-language`, `language` o `lang` de
cada entrada M3U y también reconoce etiquetas explícitas como Español/Latino o
English. Cuando la fuente no identifica el idioma, el panel privado permite
elegir Español 🇪🇸, Inglés 🇺🇸 o Sin definir antes de publicar. La selección se
guarda en el catálogo global y se conserva durante las actualizaciones de la
lista, salvo que una importación traiga un idioma explícito nuevo.

Ruta de administración: `PATCH /api/channels/admin/channels/{id}/language`.
Valores admitidos: `es`, `en` y `unknown`.
