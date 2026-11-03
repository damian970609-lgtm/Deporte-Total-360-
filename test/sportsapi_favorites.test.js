import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  SPORTSAPI_FAVORITES,
  fetchSportsApiDailyAgenda,
  fetchSportsApiFixturePage,
  fetchSportsApiLiveScores,
  sportsApiFavoritesPayload
} from "../src/sportsapi_favorites.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fixture(id, sport, leagueName, startTime = "2026-11-03T19:00:00.000Z") {
  return {
    id,
    sport,
    startTime,
    status: { type: "inprogress", description: "In progress" },
    home: { name: "Home Club", image: "https://cdn.example/home.png" },
    away: { name: "Away Club", image: "https://cdn.example/away.png" },
    homeScore: { current: 2 },
    awayScore: { current: 1 },
    league: { id: 10, name: leagueName, sport },
    season: { id: 2026 }
  };
}

function jsonResponse(data, meta = {}) {
  return new Response(JSON.stringify({ data, meta }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("configura exactamente los diez deportes favoritos", () => {
  assert.deepEqual(
    SPORTSAPI_FAVORITES.map(item => item.id),
    [
      "football", "basketball", "baseball", "ice-hockey", "volleyball",
      "mma", "futsal", "cycling", "motorsport", "handball"
    ]
  );
  assert.equal(sportsApiFavoritesPayload().sports.length, 10);
  assert.ok(SPORTSAPI_FAVORITES.find(item => item.id === "football")
    .competitions.includes("UEFA Women's Champions League"));
});

test("consulta las diez fuentes de SportsAPI con Bearer y normaliza eventos favoritos", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ parsed, init });
    assert.equal(init.headers.Authorization, "Bearer sportsapi-test-secret");
    if (parsed.pathname.endsWith("/fixtures")) {
      const sport = parsed.searchParams.get("sport");
      const rows = sport === "football"
        ? [
            fixture(1, "football", "LaLiga"),
            fixture(2, "football", "A competition not selected")
          ]
        : sport === "basketball"
          ? [fixture(3, "basketball", "NBA")]
          : [];
      return jsonResponse(rows, { hasNextPage: sport === "football" });
    }
    const sport = parsed.searchParams.get("sport");
    if (sport === "cycling") {
      return jsonResponse([{
        id: 20,
        sport: "cycling",
        name: "Tour de France",
        series: { name: "Cycling Men" },
        status: "inprogress",
        sessions: [{
          id: 21,
          name: "Stage 4",
          startTime: "2026-11-03T10:00:00.000Z",
          status: "finished"
        }]
      }]);
    }
    if (sport === "motorsport") {
      return jsonResponse([{
        id: 30,
        sport: "motorsport",
        name: "Singapore GP",
        series: { name: "Formula 1" },
        status: "inprogress",
        sessions: [{
          id: 31,
          name: "Grand Prix",
          startTime: "2026-11-03T12:00:00.000Z",
          status: "inprogress"
        }]
      }]);
    }
    return jsonResponse([]);
  };

  const result = await fetchSportsApiDailyAgenda(
    { SPORTAPI_API_KEY: "sportsapi-test-secret" },
    Date.parse("2026-11-03T12:00:00.000Z")
  );

  assert.equal(calls.length, 10);
  assert.ok(calls.every(call => call.parsed.origin === "https://api.sportsapi.app"));
  assert.equal(result.source, "sportsapi");
  assert.equal(result.events.length, 4);
  assert.ok(result.events.some(event => event.sport === "Fútbol" && event.competition === "LaLiga"));
  assert.ok(!result.events.some(event => event.competition === "A competition not selected"));
  assert.ok(result.events.some(event => event.sport === "Ciclismo" && event.status === "finished"));
  assert.ok(result.events.some(event => event.sport === "Deportes de motor" && event.status === "live"));
  assert.ok(result.pageQueue.some(task => task.sport === "football" && task.page === 1));
});

test("la paginación está acotada y valida deporte y página", async () => {
  let requested;
  globalThis.fetch = async (url, init) => {
    requested = new URL(url);
    assert.equal(init.headers.Authorization, "Bearer key");
    return jsonResponse([fixture(8, "football", "Premier League")], {
      hasNextPage: false
    });
  };

  const result = await fetchSportsApiFixturePage(
    { SPORTAPI_API_KEY: "key" }, "2026-11-03", "football", 2
  );
  assert.equal(requested.searchParams.get("page"), "2");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].homeScore, "2");
  await assert.rejects(
    fetchSportsApiFixturePage({ SPORTAPI_API_KEY: "key" }, "2026-11-03", "cycling", 1),
    /no es válida/
  );
  await assert.rejects(
    fetchSportsApiFixturePage({ SPORTAPI_API_KEY: "key" }, "2026-11-03", "football", 5),
    /no es válida/
  );
});

test("los marcadores en vivo solo conservan ligas seleccionadas", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).pathname, "/v2/livescores");
    assert.equal(init.headers.Authorization, "Bearer key");
    return jsonResponse([
      fixture(101, "football", "Premier League"),
      fixture(102, "football", "Not selected league")
    ]);
  };
  const result = await fetchSportsApiLiveScores({ SPORTAPI_API_KEY: "key" });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "sportsapi-fixture-101");
});
