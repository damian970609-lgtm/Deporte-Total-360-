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

Para desplegar, agrega SPORTAPI_API_KEY como GitHub Actions secret del
repositorio del Worker. El workflow lo instala en Cloudflare como secreto y
verifica sportsapi_configured y los diez deportes favoritos. Si el secreto ya
existe solo en otro repositorio, también debe configurarse aquí.

## Chat público

La aplicación usa una única sala compartida implementada con un Durable Object SQLite (`PublicChatRoom`). El historial conserva los últimos 120 mensajes, admite alias de hasta 24 caracteres y mensajes de hasta 500 caracteres, y aplica un límite básico de frecuencia por dirección IP en memoria. Los alias no están autenticados ni verificados; la app advierte a los usuarios que no publiquen datos personales. No se guardan direcciones IP en los mensajes.

El Durable Object está incluido en `wrangler.toml` con una migración SQLite `v1-public-chat`. El despliegue de producción provisiona esa clase al publicar el Worker.

## Seguridad

- La clave API solo se lee desde los secretos del Worker.
- Solo se permiten solicitudes GET y OPTIONS.
- Los recursos y parámetros se validan con listas permitidas.
- Las respuestas incluyen CORS y tipos de contenido seguros.

## Pruebas y despliegue

`npm test` ejecuta las pruebas Node.js.
El workflow de GitHub Actions ejecuta las pruebas antes de desplegar el Worker.
