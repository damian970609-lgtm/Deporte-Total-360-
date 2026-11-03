import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  AutomaticLiveSchedule,
  parseM3u,
  parseMarcaAgendaHtml,
  parseXmltv,
  programmeMatchesEvent
} from "../src/automatic_live_scheduler.js";

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;

function request(path, method = "GET") {
  return new Request(`https://worker.example${path}`, { method });
}

function installCache() {
  const data = new Map();

  globalThis.caches = {
    default: {
      async match(key) {
        const value = data.get(key.url);
        return value ? value.clone() : undefined;
      },
      async put(key, response) {
        data.set(key.url, response.clone());
      }
    }
  };

  return data;
}

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalCaches === undefined) {
    delete globalThis.caches;
  } else {
    globalThis.caches = originalCaches;
  }
});

test("health responde sin clave de proveedor", async () => {
  const response = await worker.fetch(request("/health"), {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "online");
  assert.equal(body.provider_configured, false);
});


test("catálogo en vivo devuelve vacío cuando no está configurado", async () => {
  const response = await worker.fetch(request("/api/live/sources"), {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.configured, false);
  assert.deepEqual(body.sources, []);
});

test("catálogo en vivo filtra por deporte, fecha y URL multimedia directa", async () => {
  const catalog = [
    {
      id: "football-123-main",
      eventId: "123",
      sport: "football",
      name: "Señal oficial",
      url: "https://media.example/live.m3u8",
      startsAt: "2026-11-03T19:00:00Z"
    },
    {
      id: "football-124-page",
      eventId: "124",
      sport: "football",
      name: "Página no válida",
      url: "https://example.com/watch?id=124",
      startsAt: "2026-11-03T20:00:00Z"
    },
    {
      id: "basketball-125",
      eventId: "125",
      sport: "basketball",
      name: "Otro deporte",
      url: "https://media.example/basketball.mp4",
      startsAt: "2026-11-03T21:00:00Z"
    },
    {
      id: "football-126-old",
      eventId: "126",
      sport: "football",
      name: "Fuera del rango",
      url: "https://media.example/old.mp4",
      startsAt: "2026-11-02T21:00:00Z"
    },
    {
      id: "football-127-http",
      eventId: "127",
      sport: "football",
      name: "HTTP no seguro",
      url: "http://media.example/live.m3u8",
      startsAt: "2026-11-03T19:00:00Z"
    }
  ];

  const response = await worker.fetch(
    request("/api/live/sources?sport=football&from=2026-11-03&to=2026-11-03"),
    { LIVE_STREAM_CATALOG_JSON: JSON.stringify(catalog) }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.count, 1);
  assert.equal(body.sources[0].eventId, "123");
  assert.equal(body.sources[0].url, "https://media.example/live.m3u8");
});


test("catálogo usa el día de Guyana al filtrar marcas UTC", async () => {
  const catalog = [{
    id: "football-128-local-date",
    eventId: "128",
    sport: "football",
    name: "Señal autorizada",
    url: "https://media.example/local-date.m3u8",
    startsAt: "2026-11-04T02:00:00Z"
  }];

  const response = await worker.fetch(
    request("/api/live/sources?sport=football&from=2026-11-03&to=2026-11-03&timezone=America%2FGuyana"),
    { LIVE_STREAM_CATALOG_JSON: JSON.stringify(catalog) }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.sources[0].eventId, "128");
});

test("catálogo en vivo rechaza JSON mal formado", async () => {
  const response = await worker.fetch(
    request("/api/live/sources"),
    { LIVE_STREAM_CATALOG_JSON: "{mal JSON" }
  );

  assert.equal(response.status, 503);
});

test("catálogo en vivo rechaza fechas de consulta imposibles", async () => {
  const response = await worker.fetch(
    request("/api/live/sources?from=2026-02-30"),
    { LIVE_STREAM_CATALOG_JSON: "[]" }
  );

  assert.equal(response.status, 400);
});


test("la agenda MARCA reconoce eventos SportsEvent y normaliza sus datos", () => {
  const html = `<html><script type="application/ld+json">
    {
      "@context":"https://schema.org",
      "@type":"SportsEvent",
      "name":"Equipo Azul vs Equipo Rojo",
      "sport":"Soccer",
      "startDate":"2026-11-03T19:30:00Z",
      "endDate":"2026-11-03T21:30:00Z",
      "homeTeam":{"@type":"SportsTeam","name":"Equipo Azul"},
      "awayTeam":{"@type":"SportsTeam","name":"Equipo Rojo"},
      "superEvent":{"@type":"SportsEvent","name":"Liga de prueba"}
    }
  </script></html>`;
  const events = parseMarcaAgendaHtml(html, Date.parse("2026-11-03T18:00:00Z"));
  assert.equal(events.length, 1);
  assert.equal(events[0].homeTeam, "Equipo Azul");
  assert.equal(events[0].awayTeam, "Equipo Rojo");
  assert.equal(events[0].sport, "Fútbol");
  assert.equal(events[0].competition, "Liga de prueba");
  assert.equal(events[0].startsAt, Date.parse("2026-11-03T19:30:00Z"));
});

test("mantiene en agenda un evento que comenzó hace dos horas y sigue en curso", () => {
  const html = `<script type="application/ld+json">
    {"@type":"SportsEvent","name":"Equipo Azul vs Equipo Rojo",
     "sport":"football","startDate":"2026-11-03T16:00:00Z",
     "endDate":"2026-11-03T19:30:00Z"}
  </script>`;
  const now = Date.parse("2026-11-03T18:30:00Z");
  const events = parseMarcaAgendaHtml(html, now);
  assert.equal(events.length, 1);
  assert.equal(events[0].endsAt, Date.parse("2026-11-03T19:30:00Z"));
});

test("el parseo de MARCA convierte horarios locales Europe/Madrid", () => {
  const html = `<script type="application/ld+json">
    {"@type":"SportsEvent","name":"Equipo Azul vs Equipo Rojo",
     "sport":"football","startDate":"2026-11-03T19:30"}
  </script>`;
  const events = parseMarcaAgendaHtml(html, Date.parse("2026-11-03T10:00:00Z"));
  assert.equal(events.length, 1);
  assert.equal(events[0].startsAt, Date.parse("2026-11-03T18:30:00Z"));
});

test("M3U y XMLTV se cruzan por tvg-id y nombres de canal", () => {
  const channels = parseM3u(`#EXTM3U
#EXTINF:-1 tvg-id="sports.es" tvg-name="Deportes ES" tvg-language="Spanish" group-title="Deportes",Canal Deportes HD
https://media.example/live.m3u8
`);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].language, "Spanish");
  const programmes = parseXmltv(`<tv>
    <channel id="sports.es"><display-name>Deportes ES</display-name></channel>
    <programme channel="sports.es" start="20261103193000 +0000" stop="20261103213000 +0000">
      <title>Equipo Azul vs Equipo Rojo</title>
    </programme>
  </tv>`);
  assert.equal(programmes.length, 1);
  assert.equal(programmes[0].channelName, "Deportes ES");
  assert.equal(programmeMatchesEvent(programmes[0].title, {
    title: "Equipo Azul vs Equipo Rojo",
    homeTeam: "Equipo Azul",
    awayTeam: "Equipo Rojo"
  }), true);
});

test("el Durable Object conserva una instantánea para los teléfonos", async () => {
  const values = new Map([["snapshot", {
    status: "ok",
    source: "marca",
    updatedAt: "2026-11-03T19:00:00.000Z",
    events: [{ event: { id: "match-1" }, sources: [] }]
  }]]);
  const scheduler = new AutomaticLiveSchedule({
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); }
    }
  }, {});
  const response = await scheduler.fetch(
    new Request("https://automatic-live.internal/snapshot")
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.events[0].event.id, "match-1");
});

test("la ruta pública entrega la instantánea común a todos los clientes", async () => {
  let requested = "";
  const binding = {
    idFromName(name) { assert.equal(name, "deporte-total-360-global"); return "global"; },
    get() {
      return {
        async fetch(request) {
          requested = new URL(request.url).pathname;
          return new Response(JSON.stringify({
            status: "ok", source: "marca", events: []
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      };
    }
  };
  const response = await worker.fetch(
    request("/api/live/auto/schedule"),
    { AUTOMATIC_LIVE_SCHEDULE: binding }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(requested, "/snapshot");
  assert.equal(body.source, "marca");
  assert.deepEqual(body.events, []);
});

test("el disparador programado ordena actualizar el planificador central", async () => {
  let requested = "";
  const binding = {
    idFromName() { return "global"; },
    get() {
      return {
        async fetch(request) {
          requested = new URL(request.url).pathname;
          return new Response(JSON.stringify({
            status: "ok", events: [{ event: { id: "match-1" } }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      };
    }
  };
  await worker.scheduled({ cron: "* * * * *" }, { AUTOMATIC_LIVE_SCHEDULE: binding }, {});
  assert.equal(requested, "/refresh");
});

test("ruta desconocida devuelve 404", async () => {
  const response = await worker.fetch(request("/desconocida"), {});
  assert.equal(response.status, 404);
});

test("POST devuelve 405 y OPTIONS devuelve 204", async () => {
  const post = await worker.fetch(request("/health", "POST"), {});
  const options = await worker.fetch(request("/api/fixtures", "OPTIONS"), {});

  assert.equal(post.status, 405);
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Allow-Origin"), "*");
});

test("API requiere APIFOOTBALL_KEY", async () => {
  const response = await worker.fetch(
    request("/api/fixtures?date=2026-10-31"),
    {}
  );

  assert.equal(response.status, 503);
});

test("rechaza fechas imposibles", async () => {
  const response = await worker.fetch(
    request("/api/fixtures?date=2026-02-30"),
    { APIFOOTBALL_KEY: "test" }
  );

  assert.equal(response.status, 400);
});

test("requiere from y to juntos", async () => {
  const response = await worker.fetch(
    request("/api/fixtures?from=2026-10-31"),
    { APIFOOTBALL_KEY: "test" }
  );

  assert.equal(response.status, 400);
});

test("rechaza rangos invertidos", async () => {
  const response = await worker.fetch(
    request("/api/fixtures?from=2026-11-02&to=2026-11-01"),
    { APIFOOTBALL_KEY: "test" }
  );

  assert.equal(response.status, 400);
});

test("envía from/to/timezone y almacena caché", async () => {
  installCache();

  let calls = 0;
  let capturedUrl;
  let capturedKey;

  globalThis.fetch = async (url, options) => {
    calls++;
    capturedUrl = new URL(url);
    capturedKey = options.headers["x-apisports-key"];

    return new Response(JSON.stringify({
      response: [{ fixture: { id: 123 } }],
      errors: []
    }), { status: 200 });
  };

  const path =
    "/api/fixtures?from=2026-10-31&to=2026-11-06&timezone=America%2FGuyana";

  const first = await worker.fetch(request(path), {
    APIFOOTBALL_KEY: "test-secret"
  });

  const firstBody = await first.json();

  const second = await worker.fetch(request(path), {
    APIFOOTBALL_KEY: "test-secret"
  });

  assert.equal(first.status, 200);
  assert.equal(firstBody.response[0].fixture.id, 123);
  assert.equal(capturedUrl.searchParams.get("from"), "2026-10-31");
  assert.equal(capturedUrl.searchParams.get("to"), "2026-11-06");
  assert.equal(capturedUrl.searchParams.get("timezone"), "America/Guyana");
  assert.equal(capturedKey, "test-secret");
  assert.equal(second.headers.get("X-Data-Source"), "cache");
  assert.equal(calls, 1);
});

test("pasa respuesta 204 del proveedor", async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });

  const response = await worker.fetch(
    request("/api/fixtures?date=2026-10-31"),
    { APIFOOTBALL_KEY: "test" }
  );

  assert.equal(response.status, 204);
});

test("convierte el límite por minuto de API-Sports en HTTP 429", async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      response: [],
      errors: {
        rateLimit: "Too many requests. You have exceeded the limit of requests per minute."
      }
    }),
    { status: 200 }
  );

  const response = await worker.fetch(
    request("/api/fixtures?date=2026-11-02"),
    { APISPORTS_KEY: "test" }
  );
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(body.retry_after_seconds, 60);
  assert.match(body.error, /60 segundos/);
});

test("convierte HTTP 429 del proveedor en respuesta reintentable", async () => {
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });

  const response = await worker.fetch(
    request("/api/fixtures?date=2026-11-02"),
    { APISPORTS_KEY: "test" }
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
});

test("errores del proveedor producen 502", async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ errors: { token: "invalid" } }),
    { status: 200 }
  );

  const response = await worker.fetch(
    request("/api/fixtures?date=2026-10-31"),
    { APIFOOTBALL_KEY: "test" }
  );

  assert.equal(response.status, 502);
});

test("ruta live envía live=all", async () => {
  let capturedUrl;

  globalThis.fetch = async url => {
    capturedUrl = new URL(url);
    return new Response(JSON.stringify({ response: [], errors: [] }), {
      status: 200
    });
  };

  const response = await worker.fetch(
    request("/api/live?timezone=America%2FGuyana"),
    { APIFOOTBALL_KEY: "test" }
  );

  assert.equal(response.status, 200);
  assert.equal(capturedUrl.pathname, "/fixtures");
  assert.equal(capturedUrl.searchParams.get("live"), "all");
  assert.equal(capturedUrl.searchParams.get("timezone"), "America/Guyana");
});

test("clasificación requiere liga y temporada", async () => {
  const response = await worker.fetch(
    request("/api/standings?league=39"),
    { APIFOOTBALL_KEY: "test" }
  );

  assert.equal(response.status, 400);
});

test("un error de caché no interrumpe la API", async () => {
  globalThis.caches = {
    default: {
      async match() {
        throw new Error("cache unavailable");
      },
      async put() {
        throw new Error("cache unavailable");
      }
    }
  };

  globalThis.fetch = async () => new Response(
    JSON.stringify({ response: [], errors: [] }),
    { status: 200 }
  );

  const response = await worker.fetch(
    request("/api/fixtures?date=2026-10-31"),
    { APIFOOTBALL_KEY: "test" }
  );

  assert.equal(response.status, 200);
});
