# Deporte Total 360 API

Cloudflare Worker que sirve como intermediario seguro entre la aplicación
Deporte Total 360 y API-Football.

## Rutas

- GET /health
- GET /api/fixtures?date=YYYY-MM-DD
- GET /api/live
- GET /api/leagues?country=England&season=2026
- GET /api/standings?league=39&season=2026

## Configuración

Configurar APIFOOTBALL_KEY como secreto del Worker en Cloudflare.

No incluir la clave en la aplicación móvil ni en el repositorio.

## Despliegue

El despliegue se realiza mediante GitHub Actions y Cloudflare Wrangler.
