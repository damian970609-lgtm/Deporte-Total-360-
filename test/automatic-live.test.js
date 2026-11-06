import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutomaticLiveSchedule,
  parseXmltv,
  refreshAutomaticLiveSchedule
} from "../src/automatic-live.js";

const fixedNow = new Date("2026-11-06T15:00:00.000Z");
const eventStart = new Date(fixedNow.getTime() + 5 * 60 * 1000);
const eventEnd = new Date(fixedNow.getTime() + 90 * 60 * 1000);

function xmltvTime(date) {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "").replace(/\.\d{3}Z$/, " +0000");
}

const guide = [
  '<tv>',
  '<channel id="espn-es"><display-name>ESPN Español</display-name></channel>',
  '<channel id="espn-en"><display-name>ESPN</display-name></channel>',
  '<programme channel="espn-es" start="' + xmltvTime(new Date(fixedNow.getTime() - 10 * 60 * 1000)) +
    '" stop="' + xmltvTime(eventEnd) + '"><title>Blue FC vs Red FC</title></programme>',
  '<programme channel="espn-en" start="' + xmltvTime(new Date(fixedNow.getTime() - 10 * 60 * 1000)) +
    '" stop="' + xmltvTime(eventEnd) + '"><title>Blue FC vs Red FC</title></programme>',
  '</tv>'
].join("");

const channels = [
  {
    id: "channel-es",
    identifier: "espn-es",
    name: "ESPN Español",
    url: "https://media.example/es.m3u8",
    groupTitle: "Deportes",
    language: "es",
    isSports: true,
    visible: true
  },
  {
    id: "channel-en",
    identifier: "espn-en",
    name: "ESPN",
    url: "https://media.example/en.m3u8",
    groupTitle: "Sports",
    language: "en",
    isSports: true,
    visible: true
  },
  {
    id: "hidden-channel",
    identifier: "hidden",
    name: "Oculto",
    url: "https://media.example/hidden.m3u8",
    groupTitle: "Sports",
    language: "en",
    isSports: true,
    visible: false
  },
  {
    id: "web-player",
    identifier: "web-player",
    name: "Player HTML",
    url: "https://media.example/watch?id=1",
    groupTitle: "Sports",
    language: "en",
    isSports: true,
    visible: true
  }
];

function mockFetch({ blockSegments = false } = {}) {
  return async input => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "api.sportsapi.app") {
      if (url.searchParams.get("sport") === "football" &&
          url.searchParams.get("date") === "2026-11-06") {
        return new Response(JSON.stringify({
          data: [{
            id: 123,
            startTime: eventStart.toISOString(),
            endTime: eventEnd.toISOString(),
            home: { name: "Blue FC" },
            away: { name: "Red FC" },
            league: { name: "Liga de prueba" },
            status: { type: "scheduled" }
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (url.hostname === "iptv-epg.org") {
      return new Response(guide, {
        status: 200,
        headers: { "Content-Type": "application/xml" }
      });
    }
    if (url.pathname.endsWith(".m3u8")) {
      return new Response("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n", {
        status: 200,
        headers: { "Content-Type": "application/vnd.apple.mpegurl" }
      });
    }
    if (url.pathname.endsWith(".ts")) {
      return new Response(blockSegments ? "Forbidden" : "segment", {
        status: blockSegments ? 403 : 206,
        headers: { "Content-Type": "video/mp2t" }
      });
    }
    return new Response("not found", { status: 404 });
  };
}

test("parseXmltv interpreta nombres, entidades y zonas horarias", () => {
  const rows = parseXmltv(
    '<tv><channel id="one"><display-name>ESPN &amp; Deportes</display-name></channel>' +
    '<programme channel="one" start="20261106120000 +0000" stop="20261106130000 +0000">' +
    '<title>Blue FC vs Red FC</title><desc>Partido de prueba</desc></programme></tv>'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channelName, "ESPN & Deportes");
  assert.equal(rows[0].title, "Blue FC vs Red FC");
  assert.equal(rows[0].startsAt.toISOString(), "2026-11-06T12:00:00.000Z");
});

test("programa central el mejor canal español e inglés y descarta canales ocultos o páginas", async () => {
  const result = await buildAutomaticLiveSchedule({
    channels,
    apiKey: "test-api-key",
    fetchImpl: mockFetch(),
    now: fixedNow
  });

  assert.equal(result.status, "ok");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event.id, "sportsapi-fixture-123");
  assert.equal(result.events[0].sources.length, 2);
  assert.deepEqual(
    result.events[0].sources.map(source => source.languagePriority),
    [2, 1]
  );
  assert.deepEqual(
    result.events[0].sources.map(source => source.channelName),
    ["ESPN Español", "ESPN"]
  );
  assert.ok(result.events[0].sources.every(source => source.available === true));
});

test("no publica canales cuya URL responde con error al comprobar el segmento", async () => {
  const result = await buildAutomaticLiveSchedule({
    channels: channels.slice(0, 2),
    apiKey: "test-api-key",
    fetchImpl: mockFetch({ blockSegments: true }),
    now: fixedNow
  });

  assert.equal(result.events.length, 0);
  assert.equal(result.reason, "no_matching_verified_signals");
});

test("el programador lee el catálogo publicado y guarda la instantánea en Durable Object", async () => {
  let saved = null;
  const room = {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/catalog") {
        return new Response(JSON.stringify({
          channels: channels.slice(0, 2),
          total: 2,
          hasMore: false
        }), { status: 200 });
      }
      if (url.pathname === "/auto-schedule" && request.method === "PUT") {
        saved = await request.json();
        return new Response(JSON.stringify({ saved: true }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }
  };
  const namespace = {
    idFromName(name) {
      assert.equal(name, "deporte-total-360-channel-catalog");
      return "catalog-room";
    },
    get(id) {
      assert.equal(id, "catalog-room");
      return room;
    }
  };

  const result = await refreshAutomaticLiveSchedule(
    { CHANNEL_CATALOG: namespace, SPORTAPI_API_KEY: "test-api-key" },
    { fetchImpl: mockFetch(), now: fixedNow }
  );

  assert.equal(result.events.length, 1);
  assert.ok(saved);
  assert.equal(saved.status, "ok");
  assert.equal(saved.events[0].sources.length, 2);
});

test("falla de forma clara cuando falta la clave SportsAPI", async () => {
  await assert.rejects(
    buildAutomaticLiveSchedule({ channels }),
    /SPORTAPI_API_KEY no está configurada/
  );
});


test("el cron de cinco minutos genera y persiste un calendario aunque no haya canales visibles", async () => {
  let saved = null;
  const room = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/catalog") {
        return new Response(JSON.stringify({ channels: [], total: 0, hasMore: false }), {
          status: 200
        });
      }
      if (path === "/auto-schedule" && request.method === "PUT") {
        saved = await request.json();
        return new Response(JSON.stringify({ saved: true }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }
  };
  const namespace = {
    idFromName() { return "catalog-room"; },
    get() { return room; }
  };
  const tasks = [];

  await (async () => {
    const worker = (await import("../src/index.js")).default;
    await worker.scheduled(
      { cron: "*/5 * * * *" },
      { CHANNEL_CATALOG: namespace, SPORTAPI_API_KEY: "test-api-key" },
      { waitUntil(task) { tasks.push(task); } }
    );
    await Promise.all(tasks);
  })();

  assert.ok(saved);
  assert.equal(saved.reason, "no_visible_channels");
  assert.deepEqual(saved.events, []);
});


test("no acepta una página HTML como si fuera una guía XMLTV válida", async () => {
  const fallback = mockFetch();
  const fetchImpl = async input => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "iptv-epg.org") {
      return new Response("<html><body>Access denied</body></html>", { status: 200 });
    }
    return fallback(input);
  };

  await assert.rejects(
    buildAutomaticLiveSchedule({
      channels: channels.slice(0, 2),
      apiKey: "test-api-key",
      fetchImpl,
      now: fixedNow
    }),
    /No respondió ninguna guía XMLTV/
  );
});
