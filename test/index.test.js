import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

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
