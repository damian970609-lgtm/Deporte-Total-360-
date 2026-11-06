import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { detectChannelLanguage, handleChannelRoutes, parsePlaylist, selectSportsChannels } from "../src/channel-catalog.js";

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


test("SportsAPI.app requiere SPORTAPI_API_KEY y nunca devuelve una clave", async () => {
  const response = await worker.fetch(request("/api/sportsapi/sports"), {});
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "sportsapi_not_configured");
});

test("catálogo de favoritos publica los diez deportes y competiciones", async () => {
  const response = await worker.fetch(request("/api/sportsapi/favorites"), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.sports.length, 10);
  assert.ok(body.sports.some(sport => sport.id === "futsal"));
  assert.ok(body.sports.some(sport => sport.id === "cycling"));
  assert.ok(body.sports.find(sport => sport.id === "football").competitions.includes("UEFA Champions League"));
  assert.deepEqual(body.sports.find(sport => sport.id === "basketball").competitions, ["NBA", "WNBA"]);
  assert.ok(body.sports.find(sport => sport.id === "football").competitions.includes("Women's Super League"));
  assert.ok(body.sports.find(sport => sport.id === "cycling").competitions.includes("Tour de France Femmes avec Zwift"));
  assert.ok(!body.sports.find(sport => sport.id === "basketball").competitions.includes("FIBA World Cup"));
});

test("proxy SportsAPI.app usa Bearer y conserva el sobre data/meta", async () => {
  let capturedUrl;
  let capturedAuthorization;
  globalThis.fetch = async (url, options) => {
    capturedUrl = new URL(url);
    capturedAuthorization = options.headers.Authorization;
    return new Response(JSON.stringify({
      data: [{ id: 123, sport: "football", league: { id: 195828, name: "Premier League" } }],
      meta: { date: "2026-11-03", count: 1 }
    }), { status: 200 });
  };
  const response = await worker.fetch(
    request("/api/sportsapi/fixtures?date=2026-11-03&sport=football&page=0"),
    { SPORTAPI_API_KEY: "sportsapi-test-secret" }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(capturedUrl.origin, "https://api.sportsapi.app");
  assert.equal(capturedUrl.pathname, "/v2/fixtures");
  assert.equal(capturedUrl.searchParams.get("sport"), "football");
  assert.equal(capturedAuthorization, "Bearer sportsapi-test-secret");
  assert.equal(body.data[0].id, 123);
});

test("proxy SportsAPI.app valida el deporte antes de llamar al proveedor", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  const response = await worker.fetch(
    request("/api/sportsapi/fixtures?date=2026-11-03&sport=not-a-sport"),
    { SPORTAPI_API_KEY: "test" }
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("SportsAPI filtra partidos a las competiciones favoritas masculinas y femeninas", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [
      { id: 11, league: { id: 1, name: "Premier League" } },
      { id: 12, league: { id: 2, name: "Championship" } },
      { id: 13, league: { id: 3, name: "LaLiga" } },
      { id: 14, league: { id: 4, name: "NWSL" } }
    ],
    meta: { count: 4, hasNextPage: false }
  }), { status: 200 });

  const response = await worker.fetch(
    request("/api/sportsapi/fixtures?date=2026-11-03&sport=football&page=0"),
    { SPORTAPI_API_KEY: "test" }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.map(item => item.league.name), [
    "Premier League", "LaLiga EA SPORTS", "NWSL"
  ]);
  assert.equal(body.meta.count, 3);
  assert.equal(body.meta.favoriteCompetitionFilter, true);
});

test("SportsAPI filtra ciclismo por nombre de carrera y motor por serie", async () => {
  globalThis.fetch = async url => {
    const upstream = new URL(url);
    if (upstream.pathname.endsWith("/races")) {
      if (upstream.searchParams.get("sport") === "cycling") {
        return new Response(JSON.stringify({
          data: [
            { id: 21, name: "Tour de France", series: { id: 1, name: "Cycling Men" } },
            { id: 22, name: "Paris-Nice", series: { id: 1, name: "Cycling Men" } }
          ],
          meta: { count: 2 }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: [
          { id: 31, name: "Australian GP", series: { id: 2, name: "Formula 1" } },
          { id: 32, name: "NASCAR Cup", series: { id: 3, name: "NASCAR Cup Series" } }
        ],
        meta: { count: 2 }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 });
  };

  const cycling = await worker.fetch(
    request("/api/sportsapi/races?date=2026-11-03&sport=cycling"),
    { SPORTAPI_API_KEY: "test" }
  );
  const cyclingBody = await cycling.json();
  assert.deepEqual(cyclingBody.data.map(item => item.name), ["Tour de France"]);
  assert.equal(cyclingBody.data[0].series.name, "Cycling Men");

  const motor = await worker.fetch(
    request("/api/sportsapi/races?date=2026-11-03&sport=motorsport"),
    { SPORTAPI_API_KEY: "test" }
  );
  const motorBody = await motor.json();
  assert.deepEqual(motorBody.data.map(item => item.series.name), ["Formula 1"]);
});

test("SportsAPI filtra también una respuesta sin filtrar que ya estuviera en caché", async () => {
  const cacheEntries = installCache();
  const url = "https://api.sportsapi.app/v2/fixtures?date=2026-11-03&sport=football&page=0";
  cacheEntries.set(url, new Response(JSON.stringify({
    data: [
      { id: 41, league: { id: 1, name: "Premier League" } },
      { id: 42, league: { id: 2, name: "Championship" } }
    ],
    meta: { count: 2 }
  }), { status: 200, headers: { "Cache-Control": "public, max-age=120" } }));

  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 });
  };

  const response = await worker.fetch(
    request("/api/sportsapi/fixtures?date=2026-11-03&sport=football&page=0"),
    { SPORTAPI_API_KEY: "test" }
  );
  const body = await response.json();

  assert.equal(upstreamCalled, false);
  assert.deepEqual(body.data.map(item => item.league.name), ["Premier League"]);
  assert.equal(body.meta.favoriteCompetitionFilter, true);
  assert.equal(response.headers.get("X-Data-Source"), "cache");
});

test("proxy SportsAPI.app admite resultados de carreras con sesión", async () => {
  let capturedUrl;
  globalThis.fetch = async url => {
    capturedUrl = new URL(url);
    return new Response(JSON.stringify({ data: [], meta: { count: 0 } }), { status: 200 });
  };
  const response = await worker.fetch(
    request("/api/sportsapi/races/987/results?session=654"),
    { SPORTAPI_API_KEY: "test" }
  );
  assert.equal(response.status, 200);
  assert.equal(capturedUrl.pathname, "/v2/races/987/results");
  assert.equal(capturedUrl.searchParams.get("session"), "654");
});


test("catálogo de canales devuelve un estado explícito cuando el Durable Object no está enlazado", async () => {
  const response = await worker.fetch(request("/api/channels"), {});
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.configured, false);
  assert.equal(body.error.code, "channel_catalog_not_configured");
});

test("la configuración OAuth pública confirma el cliente Web configurado sin emitir tokens", async () => {
  const clientId = "dt360-web-client.apps.googleusercontent.com";
  const response = await worker.fetch(
    request("/api/channels/auth-config"),
    { GOOGLE_OAUTH_CLIENT_ID: clientId }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.clientId, clientId);
  assert.equal(Object.hasOwn(body, "token"), false);
});

test("la configuración OAuth pública falla de forma explícita si falta el cliente Web", async () => {
  const response = await worker.fetch(request("/api/channels/auth-config"), {});
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.configured, false);
  assert.equal(body.error.code, "google_oauth_not_configured");
});
test("el panel de canales exige configurar OAuth antes de aceptar administración", async () => {
  const response = await worker.fetch(request("/api/channels/admin/catalog"), {});
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "google_oauth_not_configured");
});

test("las rutas de canales rechazan métodos que no están autorizados", async () => {
  const response = await worker.fetch(request("/api/channels", "POST"), {});
  assert.equal(response.status, 404);
});


test("detecta español e inglés desde metadatos explícitos de M3U", () => {
  assert.equal(detectChannelLanguage("es-MX", "ESPN 2", "Sports"), "es");
  assert.equal(detectChannelLanguage("English", "ESPN", "Sports"), "en");
});

test("detecta idioma por etiquetas del canal y deja desconocidos sin bandera", () => {
  assert.equal(detectChannelLanguage("", "Liga Española", "Deportes"), "es");
  assert.equal(detectChannelLanguage("", "Sports Network English", "Sports"), "en");
  assert.equal(detectChannelLanguage("", "ESPN 2", "Sports"), "unknown");
});

test("el catálogo público reenvía búsqueda y offset al Durable Object", async () => {
  let capturedUrl;
  const env = {
    CHANNEL_CATALOG: {
      idFromName(name) {
        assert.equal(name, "deporte-total-360-channel-catalog");
        return name;
      },
      get() {
        return {
          async fetch(internalRequest) {
            capturedUrl = new URL(internalRequest.url);
            return new Response(JSON.stringify({
              configured: true,
              channels: [],
              offset: 200,
              hasMore: false
            }), {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }
        };
      }
    }
  };

  const response = await worker.fetch(
    request("/api/channels?offset=200&q=ESPN"), env
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(capturedUrl.pathname, "/catalog");
  assert.equal(capturedUrl.searchParams.get("scope"), "public");
  assert.equal(capturedUrl.searchParams.get("offset"), "200");
  assert.equal(capturedUrl.searchParams.get("q"), "ESPN");
  assert.equal(body.offset, 200);
});



test("la licencia de la app se comprueba contra el catálogo usando el correo verificado", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    iss: "https://accounts.google.com",
    aud: "dt360-client.apps.googleusercontent.com",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    email: "comprador@example.com",
    email_verified: "true",
    sub: "google-user-123"
  }), { status: 200 });

  let captured;
  const env = {
    GOOGLE_OAUTH_CLIENT_ID: "dt360-client.apps.googleusercontent.com",
    CHANNEL_CATALOG: {
      idFromName: name => name,
      get: () => ({
        async fetch(internalRequest) {
          captured = internalRequest;
          return new Response(JSON.stringify({
            allowed: true, status: "active", licenseType: "paid"
          }), { status: 200 });
        }
      })
    }
  };
  const response = await worker.fetch(new Request("https://worker.example/api/license", {
    headers: { Authorization: "Bearer valid-test-token" }
  }), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.allowed, true);
  assert.equal(body.licenseType, "paid");
  assert.equal(new URL(captured.url).pathname, "/licenses/check");
  assert.equal(captured.headers.get("X-License-Email"), "comprador@example.com");
});

test("la cuenta administradora recibe acceso de propietario sin licencia comercial", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    iss: "accounts.google.com",
    aud: "dt360-client.apps.googleusercontent.com",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    email: "damian970609@gmail.com",
    email_verified: true,
    sub: "owner-google-sub"
  }), { status: 200 });

  const response = await worker.fetch(new Request("https://worker.example/api/license", {
    headers: { Authorization: "Bearer owner-token" }
  }), {
    GOOGLE_OAUTH_CLIENT_ID: "dt360-client.apps.googleusercontent.com",
    CHANNELS_ADMIN_EMAIL: "damian970609@gmail.com"
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.allowed, true);
  assert.equal(body.licenseType, "owner");
});

test("solo el propietario puede conceder licencias de pago o gratuitas", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    iss: "https://accounts.google.com",
    aud: "dt360-client.apps.googleusercontent.com",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    email: "damian970609@gmail.com",
    email_verified: "true",
    sub: "owner-google-sub"
  }), { status: 200 });

  let captured;
  const response = await worker.fetch(new Request("https://worker.example/api/channels/admin/licenses", {
    method: "POST",
    headers: {
      Authorization: "Bearer owner-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: "buyer@example.com",
      licenseType: "paid",
      note: "Pago confirmado"
    })
  }), {
    GOOGLE_OAUTH_CLIENT_ID: "dt360-client.apps.googleusercontent.com",
    CHANNELS_ADMIN_EMAIL: "damian970609@gmail.com",
    CHANNEL_CATALOG: {
      idFromName: name => name,
      get: () => ({
        async fetch(internalRequest) {
          captured = internalRequest;
          return new Response(JSON.stringify({ saved: true }), { status: 200 });
        }
      })
    }
  });

  assert.equal(response.status, 200);
  assert.equal(new URL(captured.url).pathname, "/licenses");
  assert.deepEqual(await captured.json(), {
    email: "buyer@example.com",
    licenseType: "paid",
    note: "Pago confirmado",
    grantedBy: "damian970609@gmail.com"
  });
});

test("una cuenta no administradora no puede gestionar licencias", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    iss: "https://accounts.google.com",
    aud: "dt360-client.apps.googleusercontent.com",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    email: "buyer@example.com",
    email_verified: "true",
    sub: "buyer-google-sub"
  }), { status: 200 });

  const response = await worker.fetch(new Request("https://worker.example/api/channels/admin/licenses", {
    method: "GET",
    headers: { Authorization: "Bearer buyer-token" }
  }), {
    GOOGLE_OAUTH_CLIENT_ID: "dt360-client.apps.googleusercontent.com",
    CHANNELS_ADMIN_EMAIL: "damian970609@gmail.com"
  });

  assert.equal(response.status, 403);
});


test("el panel admin puede retirar una fuente y reintentarla con sesión Google verificada", async () => {
  const previousFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.hostname, "oauth2.googleapis.com");
    return new Response(JSON.stringify({
      aud: "test-web-client",
      iss: "https://accounts.google.com",
      exp: String(Math.floor(Date.now() / 1000) + 3600),
      email: "admin@example.com",
      email_verified: true,
      sub: "google-user-123"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const env = {
      GOOGLE_OAUTH_CLIENT_ID: "test-web-client",
      CHANNELS_ADMIN_EMAIL: "admin@example.com",
      CHANNEL_CATALOG: {
        idFromName: () => "catalog",
        get: () => ({
          async fetch(internalRequest) {
            forwarded.push({
              method: internalRequest.method,
              path: new URL(internalRequest.url).pathname
            });
            return new Response(JSON.stringify({ ok: true }), {
              status: internalRequest.method === "DELETE" ? 200 : 202,
              headers: { "Content-Type": "application/json" }
            });
          }
        })
      }
    };
    const headers = { Authorization: "Bearer signed-google-id-token" };
    const removeRequest = new Request(
      "https://worker.example/api/channels/admin/sources/source-123",
      { method: "DELETE", headers }
    );
    const remove = await handleChannelRoutes(
      removeRequest, env, new URL(removeRequest.url).pathname
    );
    assert.equal(remove.status, 200);

    const retryRequest = new Request(
      "https://worker.example/api/channels/admin/sources/source-123/retry",
      { method: "POST", headers }
    );
    const retry = await handleChannelRoutes(
      retryRequest, env, new URL(retryRequest.url).pathname
    );
    assert.equal(retry.status, 202);
    assert.deepEqual(forwarded, [
      { method: "DELETE", path: "/sources/source-123" },
      { method: "POST", path: "/sources/source-123/retry" }
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});


test("lee listas PLS, XSPF/XML, JSON y TXT y extrae URLs reproducibles", () => {
  const base = "https://lists.example/source.txt";

  const pls = parsePlaylist(
    "[playlist]\nNumberOfEntries=1\nFile1=https://media.example/live.m3u8\nTitle1=ESPN Sports\nLength1=-1",
    base
  );
  assert.equal(pls.format, "pls");
  assert.equal(pls.channels.length, 1);
  assert.equal(pls.channels[0].name, "ESPN Sports");
  assert.equal(pls.channels[0].isSports, 1);

  const xspf = parsePlaylist(
    '<?xml version="1.0"?><playlist version="1"><trackList><track><title>Fútbol TV</title><location>https://media.example/football.mpd</location></track></trackList></playlist>',
    base
  );
  assert.equal(xspf.format, "xspf");
  assert.equal(xspf.channels[0].url, "https://media.example/football.mpd");

  const json = parsePlaylist(
    JSON.stringify({ channels: [{ name: "Basketball Live", url: "https://media.example/basket.m3u8", group: "Sports" }] }),
    base
  );
  assert.equal(json.format, "json");
  assert.equal(json.channels.length, 1);
  assert.equal(json.channels[0].isSports, 1);

  const txt = parsePlaylist(
    "Sports Network|https://media.example/sports.ts",
    base
  );
  assert.equal(txt.format, "txt");
  assert.equal(txt.channels.length, 1);
  assert.equal(txt.channels[0].url, "https://media.example/sports.ts");
});

test("rechaza formatos legibles que no contienen señales multimedia compatibles", () => {
  const result = parsePlaylist("Nombre del canal\\nesto no es una URL", "https://lists.example/channels.txt");
  assert.equal(result.format, "txt");
  assert.deepEqual(result.channels, []);
});


test("un fallo del Durable Object de chat no derriba el Worker y responde 503 controlado", async () => {
  const previousFetch = globalThis.fetch;
  const response = await worker.fetch(
    request("/api/chat/messages"),
    {
      PUBLIC_CHAT_ROOM: {
        idFromName: () => "public-chat",
        get: () => ({
          async fetch() {
            return new Response("error code: 1101", { status: 500 });
          }
        })
      }
    }
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "chat_temporarily_unavailable");
  globalThis.fetch = previousFetch;
});


test("solo selecciona canales deportivos y limita importación por fuente a 1000", () => {
  const mixed = [
    { name: "General TV", url: "https://media.example/general.m3u8", isSports: 0 },
    ...Array.from({ length: 1200 }, (_, index) => ({
      name: "Sports Channel " + index,
      url: "https://media.example/sports-" + index + ".m3u8",
      isSports: 1
    }))
  ];
  const selected = selectSportsChannels(mixed);
  assert.equal(selected.length, 1000);
  assert.equal(selected[0].name, "Sports Channel 0");
  assert.equal(selected.every(channel => channel.isSports === 1), true);
});
