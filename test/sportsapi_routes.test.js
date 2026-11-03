import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(path) {
  return new Request("https://worker.example" + path);
}

test("publica la lista de los diez deportes favoritos sin exponer credenciales", async () => {
  const response = await worker.fetch(request("/api/sportsapi/favorites"), {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.provider, "SportsAPI.app");
  assert.equal(body.data.sports.length, 10);
  assert.ok(body.data.sports.some(item => item.id === "ice-hockey"));
  assert.ok(body.data.sports.some(item => item.id === "motorsport"));
  assert.equal(JSON.stringify(body).includes("sk_live"), false);
});

test("sirve estadísticas con la clave solo en el Worker", async () => {
  let requested;
  globalThis.fetch = async (url, init) => {
    requested = { url: new URL(url), headers: init.headers };
    return new Response(JSON.stringify({
      data: { periods: [{ period: "all", groups: [] }] }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const response = await worker.fetch(
    request("/api/sportsapi/statistics?type=fixture-statistics&id=123"),
    { SPORTAPI_API_KEY: "server-side-test-key" }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(requested.url.pathname, "/v2/fixtures/123/statistics");
  assert.equal(requested.headers.Authorization, "Bearer server-side-test-key");
  assert.deepEqual(body.data.periods, [{ period: "all", groups: [] }]);
});

test("rechaza recursos estadísticos no permitidos antes de llamar al proveedor", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("No debería llamar al proveedor");
  };

  const response = await worker.fetch(
    request("/api/sportsapi/statistics?type=anything&id=123"),
    { SPORTAPI_API_KEY: "key" }
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("devuelve error claro cuando el Worker no tiene SPORTAPI_API_KEY", async () => {
  const response = await worker.fetch(
    request("/api/sportsapi/statistics?type=fixture-statistics&id=123"),
    {}
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /SPORTAPI_API_KEY/);
});
