const SPORTS = [
  { id: "football", name: "Fútbol", races: false },
  { id: "basketball", name: "Baloncesto", races: false },
  { id: "baseball", name: "Béisbol", races: false },
  { id: "ice-hockey", name: "Hockey sobre hielo", races: false },
  { id: "volleyball", name: "Voleibol", races: false },
  { id: "mma", name: "MMA", races: false },
  { id: "futsal", name: "Fútbol sala", races: false },
  { id: "cycling", name: "Ciclismo", races: true },
  { id: "motorsport", name: "Deportes de motor", races: true },
  { id: "handball", name: "Balonmano", races: false }
];

const EPG_URLS = [
  "https://iptv-epg.org/files/epg-es.xml",
  "https://iptv-epg.org/files/epg-ar.xml",
  "https://iptv-epg.org/files/epg-mx.xml",
  "https://iptv-epg.org/files/epg-co.xml",
  "https://iptv-epg.org/files/epg-ve.xml",
  "https://iptv-epg.org/files/epg-jm.xml",
  "https://iptv-epg.org/files/epg-gb.xml",
  "https://iptv-epg.org/files/epg-br.xml"
];

const SCHEDULE_PATH = "/auto-schedule";
const CHANNEL_CATALOG_PATH = "/catalog";
const MAX_CHANNELS = 10000;
const MAX_EVENTS = 160;
const MAX_CANDIDATES_PER_EVENT = 32;
const MAX_EPG_BYTES = 24 * 1024 * 1024;
const MAX_PLAYLIST_SECONDS = 3 * 60 * 60;
const LOOKAHEAD_HOURS = 26;
const PREPARE_MINUTES = 10;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlAttributes(value) {
  const result = {};
  for (const match of String(value || "").matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/g)) {
    result[match[1].toLowerCase()] = decodeXml(match[3]);
  }
  return result;
}

function xmlTag(value, tag) {
  const match = String(value || "").match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + "\\s*>", "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

function xmltvDate(value) {
  const match = String(value || "").trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/);
  if (!match) return null;
  const offset = match[7] ? match[7] + match[8] + ":" + match[9] : "Z";
  const iso = match[1] + "-" + match[2] + "-" + match[3] + "T" +
    match[4] + ":" + match[5] + ":" + match[6] + offset;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function parseXmltv(body) {
  const source = String(body || "");
  const channelNames = new Map();
  for (const match of source.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel\s*>/gi)) {
    const attrs = xmlAttributes(match[1]);
    if (!attrs.id) continue;
    const names = Array.from(match[2].matchAll(/<display-name\b[^>]*>([\s\S]*?)<\/display-name\s*>/gi))
      .map(item => decodeXml(item[1].replace(/<[^>]+>/g, "").trim()))
      .filter(Boolean);
    channelNames.set(attrs.id, names[0] || attrs.id);
  }

  const programmes = [];
  for (const match of source.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme\s*>/gi)) {
    const attrs = xmlAttributes(match[1]);
    const startsAt = xmltvDate(attrs.start);
    const endsAt = xmltvDate(attrs.stop);
    const title = xmlTag(match[2], "title");
    if (!attrs.channel || !startsAt || !endsAt || !title || endsAt <= startsAt) continue;
    programmes.push({
      channelId: attrs.channel,
      channelName: channelNames.get(attrs.channel) || attrs.channel,
      title,
      description: xmlTag(match[2], "desc"),
      startsAt,
      endsAt
    });
  }
  return programmes;
}

function isDirectStream(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || !url.host || url.username || url.password) return false;
    const path = url.pathname.toLowerCase();
    return [
      ".m3u8", ".mpd", ".mp4", ".m4v", ".mov", ".mkv", ".webm",
      ".ts", ".mpeg", ".mpg", ".flv", ".m2ts", ".mts"
    ].some(extension => path.endsWith(extension)) ||
      path.endsWith(".ism/manifest") || path.endsWith(".isml/manifest");
  } catch {
    return false;
  }
}

function localDate(date, timeZone = "America/Guyana") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function addDays(day, count) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + count));
  return value.getUTCFullYear().toString().padStart(4, "0") + "-" +
    (value.getUTCMonth() + 1).toString().padStart(2, "0") + "-" +
    value.getUTCDate().toString().padStart(2, "0");
}

async function fetchTextCached(url, fetchImpl, ttlSeconds, maxBytes = MAX_EPG_BYTES) {
  const request = new Request(url, { method: "GET" });
  const cache = globalThis.caches && globalThis.caches.default;
  if (cache) {
    try {
      const cached = await cache.match(request);
      if (cached) return await cached.text();
    } catch {
      // Un fallo de caché no impide consultar la fuente.
    }
  }

  const response = await fetchImpl(request, {
    headers: { Accept: "application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(18000)
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("La fuente respondió HTTP " + response.status + ".");
  }
  const text = await response.text();
  if (!text.trim() || text.length > maxBytes) {
    throw new Error("La fuente XML está vacía o supera el tamaño máximo.");
  }
  if (cache) {
    try {
      await cache.put(request, new Response(text, {
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "application/xml",
          "Cache-Control": "public, max-age=" + ttlSeconds
        }
      }));
    } catch {
      // El caché de borde es una optimización, no un requisito funcional.
    }
  }
  return text;
}

async function fetchJsonCached(url, apiKey, fetchImpl, ttlSeconds = 3600) {
  const request = new Request(url, { method: "GET" });
  const cache = globalThis.caches && globalThis.caches.default;
  if (cache) {
    try {
      const cached = await cache.match(request);
      if (cached) return await cached.json();
    } catch {
      // Se vuelve a consultar el proveedor si el caché no se puede leer.
    }
  }
  const response = await fetchImpl(request, {
    headers: {
      Authorization: "Bearer " + apiKey,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("SportsAPI respondió HTTP " + response.status + ".");
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("SportsAPI devolvió una respuesta sin data[].");
  }
  if (cache) {
    try {
      await cache.put(request, new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + ttlSeconds
        }
      }));
    } catch {
      // Ignora fallos de caché.
    }
  }
  return payload;
}

function parseFixture(row, sport, now) {
  const id = String(row && row.id || "").trim();
  const start = new Date(row && row.startTime || "");
  if (!id || !Number.isFinite(start.getTime())) return null;
  const statusValue = row && row.status && typeof row.status === "object"
    ? row.status.type : row && row.status;
  const status = String(statusValue || "scheduled").toLowerCase();
  if (["finished", "complete", "completed", "cancelled", "canceled", "postponed", "abandoned"].includes(status)) return null;
  if (start.getTime() < now.getTime() - 4 * 60 * 60 * 1000 ||
      start.getTime() > now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000) return null;

  const home = row.home && typeof row.home === "object" ? row.home : {};
  const away = row.away && typeof row.away === "object" ? row.away : {};
  const league = row.league && typeof row.league === "object" ? row.league : {};
  const homeTeam = String(home.name || "").trim();
  const awayTeam = String(away.name || "").trim();
  const title = homeTeam && awayTeam ? homeTeam + " vs " + awayTeam :
    String(row.name || "").trim() || "Evento de " + sport.name;
  const end = row.endTime ? new Date(row.endTime) : null;
  return {
    id: "sportsapi-fixture-" + id,
    title,
    sport: sport.name,
    competition: String(league.name || "").trim(),
    homeTeam,
    awayTeam,
    startsAt: start.toISOString(),
    endsAt: end && Number.isFinite(end.getTime()) ? end.toISOString() : null,
    status,
    detailUrl: "https://deporte-total-360-api.damian970609.workers.dev/api/sportsapi/fixtures/" + encodeURIComponent(id)
  };
}

function parseRace(row, sport, now) {
  const id = String(row && row.id || "").trim();
  if (!id) return null;
  const sessions = Array.isArray(row.sessions) ? row.sessions : [];
  const validSessions = sessions.map(session => ({
    id: String(session && session.id || "0"),
    start: new Date(session && session.startTime || "")
  })).filter(session => Number.isFinite(session.start.getTime()))
    .sort((a, b) => a.start - b.start);
  const selected = validSessions.find(session => session.start.getTime() >= now.getTime() - 4 * 60 * 60 * 1000) || validSessions[0];
  const start = selected ? selected.start : new Date(row.startDate || "");
  if (!Number.isFinite(start.getTime()) ||
      start.getTime() < now.getTime() - 4 * 60 * 60 * 1000 ||
      start.getTime() > now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000) return null;
  const series = row.series && typeof row.series === "object" ? row.series : {};
  return {
    id: "sportsapi-race-" + id + "-" + (selected ? selected.id : "0"),
    title: String(row.name || sport.name).trim(),
    sport: sport.name,
    competition: String(series.name || "").trim(),
    homeTeam: "",
    awayTeam: "",
    startsAt: start.toISOString(),
    endsAt: null,
    status: String(row.status && row.status.type || row.status || "scheduled").toLowerCase(),
    detailUrl: "https://deporte-total-360-api.damian970609.workers.dev/api/sportsapi/races/" + encodeURIComponent(id)
  };
}

async function fetchAgendaEvents(apiKey, fetchImpl, now) {
  const today = localDate(now);
  const dates = [today, addDays(today, 1)];
  let successful = 0;
  const results = await Promise.all(SPORTS.flatMap(sport => dates.map(async day => {
    const resource = sport.races ? "races" : "fixtures";
    const query = new URLSearchParams({ date: day, sport: sport.id });
    if (!sport.races) query.set("page", "0");
    const url = "https://api.sportsapi.app/v2/" + resource + "?" + query.toString();
    try {
      const payload = await fetchJsonCached(url, apiKey, fetchImpl);
      successful++;
      return payload.data.map(row => sport.races
        ? parseRace(row, sport, now)
        : parseFixture(row, sport, now)).filter(Boolean);
    } catch {
      return [];
    }
  })));
  if (successful === 0) throw new Error("No se pudo consultar ningún deporte en SportsAPI.");
  const unique = new Map();
  for (const event of results.flat()) unique.set(event.id, event);
  return Array.from(unique.values()).sort((a, b) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  ).slice(0, MAX_EVENTS);
}

async function fetchProgrammes(fetchImpl) {
  const programmes = [];
  let successful = 0;
  for (let offset = 0; offset < EPG_URLS.length; offset += 3) {
    const batch = EPG_URLS.slice(offset, offset + 3);
    const bodies = await Promise.all(batch.map(url =>
      fetchTextCached(url, fetchImpl, 1800).catch(() => null)
    ));
    for (const body of bodies) {
      if (!body) continue;
      try {
        programmes.push(...parseXmltv(body));
        successful++;
      } catch {
        // Una EPG dañada no invalida las guías restantes.
      }
    }
  }
  if (successful === 0) throw new Error("No respondió ninguna guía XMLTV configurada.");
  return programmes;
}

function channelLanguagePriority(channel) {
  const language = normalizeText(channel.language);
  if (["es", "spa", "spanish", "espanol"].includes(language)) return 2;
  if (["en", "eng", "english"].includes(language)) return 1;
  const metadata = normalizeText(String(channel.name || "") + " " + String(channel.groupTitle || ""));
  if (/(^| )(spanish|espanol|castellano|latino|latam|espana|mexico|argentina|colombia|venezuela)( |$)/.test(metadata)) return 2;
  if (/(^| )(english|ingles|sky sports|nbc sports|tnt sports)( |$)/.test(metadata)) return 1;
  return 0;
}

function channelQualityScore(channel) {
  const name = normalizeText(String(channel.name || "") + " " + String(channel.groupTitle || ""));
  if (/(^| )(4k|uhd|2160p?)( |$)/.test(name)) return 500;
  if (/(^| )(1080p?|full hd|fhd)( |$)/.test(name)) return 400;
  if (/(^| )(720p?|hd)( |$)/.test(name)) return 300;
  if (/(^| )(576p?|480p?|sd)( |$)/.test(name)) return 200;
  return 100;
}

function buildChannelIndex(channels) {
  const index = new Map();
  for (const channel of channels) {
    for (const key of [channel.identifier, channel.name]) {
      const normalized = normalizeText(key);
      if (!normalized) continue;
      if (!index.has(normalized)) index.set(normalized, []);
      index.get(normalized).push(channel);
    }
  }
  return index;
}

function channelsForProgramme(programme, index) {
  const exactKeys = [normalizeText(programme.channelId), normalizeText(programme.channelName)].filter(Boolean);
  const found = new Map();
  for (const key of exactKeys) {
    for (const channel of index.get(key) || []) found.set(channel.id, channel);
  }
  if (found.size) return Array.from(found.values());

  for (const [key, rows] of index.entries()) {
    if (key.length >= 5 && exactKeys.some(candidate =>
      candidate.length >= 5 && (candidate.includes(key) || key.includes(candidate))
    )) {
      for (const channel of rows) found.set(channel.id, channel);
    }
  }
  return Array.from(found.values());
}

function programmeMatchesEvent(programme, event) {
  const text = normalizeText(programme.title + " " + programme.description);
  if (event.homeTeam && event.awayTeam) {
    const home = normalizeText(event.homeTeam);
    const away = normalizeText(event.awayTeam);
    return home.length >= 3 && away.length >= 3 &&
      text.includes(home) && text.includes(away);
  }
  const title = normalizeText(event.title);
  return title.length >= 5 && text.includes(title);
}

async function probeBytes(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      headers: { Range: "bytes=0-1", Accept: "*/*" },
      signal: AbortSignal.timeout(7000)
    });
    const type = String(response.headers.get("Content-Type") || "").toLowerCase();
    const valid = response.ok && !type.includes("text/html");
    await response.body?.cancel();
    return valid;
  } catch {
    return false;
  }
}

async function probeHls(url, fetchImpl, depth = 0) {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const body = await response.text();
    if (body.length > 1024 * 1024 || !/^#EXTM3U/m.test(body)) return false;
    if (/METHOD\s*=\s*["']?SAMPLE-AES/i.test(body)) return false;
    const resource = body.split(/\r?\n/).map(line => line.trim())
      .find(line => line && !line.startsWith("#"));
    if (!resource) return /#EXT-X-ENDLIST/.test(body);
    const target = new URL(resource, response.url || url).toString();
    if (/\.m3u8(?:$|\?)/i.test(target) && depth < 2) {
      return probeHls(target, fetchImpl, depth + 1);
    }
    return probeBytes(target, fetchImpl);
  } catch {
    return false;
  }
}

async function probeCandidate(channel, fetchImpl) {
  const url = String(channel.url || "").trim();
  if (!isDirectStream(url)) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".m3u8")) return await probeHls(url, fetchImpl);
    if (path.endsWith(".mpd")) {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/dash+xml,application/xml,text/xml,*/*" },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        await response.body?.cancel();
        return false;
      }
      const body = await response.text();
      return body.length <= 1024 * 1024 && /<MPD\b/i.test(body) &&
        /<Period\b/i.test(body) && !/<ContentProtection\b/i.test(body);
    }
    if (/\.ism(?:l)?\/manifest$/i.test(path)) {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/vnd.ms-sstr+xml,application/xml,*/*" },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        await response.body?.cancel();
        return false;
      }
      const body = await response.text();
      return /<SmoothStreamingMedia\b/i.test(body);
    }
    return probeBytes(url, fetchImpl);
  } catch {
    return false;
  }
}

async function loadPublishedChannels(catalogStub) {
  const channels = [];
  for (let page = 0; page < 5; page++) {
    const offset = page * 2000;
    const response = await catalogStub.fetch(new Request(
      "https://channel-catalog.internal" + CHANNEL_CATALOG_PATH +
      "?limit=2000&offset=" + offset
    ));
    if (!response.ok) throw new Error("No se pudo leer el catálogo visible de canales.");
    const payload = await response.json();
    if (!Array.isArray(payload.channels)) throw new Error("El catálogo no contiene channels[].");
    channels.push(...payload.channels.filter(channel =>
      channel && channel.visible === true && channel.isSports === true &&
      isDirectStream(channel.url)
    ));
    if (!payload.hasMore || payload.channels.length === 0 || channels.length >= MAX_CHANNELS) break;
  }
  return channels.slice(0, MAX_CHANNELS);
}

export async function buildAutomaticLiveSchedule({
  channels,
  apiKey,
  fetchImpl = globalThis.fetch,
  now = new Date()
}) {
  if (!apiKey) throw new Error("SPORTAPI_API_KEY no está configurada.");
  if (!Array.isArray(channels)) throw new TypeError("channels debe ser una lista.");
  const visibleChannels = channels.filter(channel =>
    channel && channel.visible === true && channel.isSports === true && isDirectStream(channel.url)
  );
  if (visibleChannels.length === 0) {
    return { status: "ok", updatedAt: now.toISOString(), events: [], reason: "no_visible_channels" };
  }

  const events = await fetchAgendaEvents(apiKey, fetchImpl, now);
  if (events.length === 0) {
    return { status: "ok", updatedAt: now.toISOString(), events: [], reason: "no_upcoming_events" };
  }
  const programmes = await fetchProgrammes(fetchImpl);
  const channelIndex = buildChannelIndex(visibleChannels);
  const output = [];

  for (const event of events) {
    const startsAt = new Date(event.startsAt);
    const prepareAt = startsAt.getTime() - PREPARE_MINUTES * 60 * 1000;
    const eventEnd = event.endsAt ? new Date(event.endsAt) :
      new Date(startsAt.getTime() + MAX_PLAYLIST_SECONDS * 1000);
    if (now.getTime() < prepareAt || now >= eventEnd) continue;

    const matchingProgrammes = programmes.filter(programme =>
      programme.startsAt.getTime() < eventEnd.getTime() &&
      programme.endsAt.getTime() > prepareAt &&
      programmeMatchesEvent(programme, event)
    );
    const candidatesByUrl = new Map();
    for (const programme of matchingProgrammes) {
      for (const channel of channelsForProgramme(programme, channelIndex)) {
        if (candidatesByUrl.has(channel.url)) continue;
        candidatesByUrl.set(channel.url, {
          channel,
          programme,
          languagePriority: channelLanguagePriority(channel),
          qualityScore: channelQualityScore(channel)
        });
      }
    }

    const candidates = Array.from(candidatesByUrl.values())
      .sort((a, b) => b.languagePriority - a.languagePriority || b.qualityScore - a.qualityScore)
      .slice(0, MAX_CANDIDATES_PER_EVENT);
    if (!candidates.length) continue;

    const verified = [];
    for (let offset = 0; offset < candidates.length; offset += 6) {
      const batch = candidates.slice(offset, offset + 6);
      const results = await Promise.all(batch.map(async candidate => ({
        ...candidate,
        available: await probeCandidate(candidate.channel, fetchImpl)
      })));
      verified.push(...results.filter(candidate => candidate.available));
    }
    verified.sort((a, b) => b.languagePriority - a.languagePriority || b.qualityScore - a.qualityScore);
    if (!verified.length) continue;

    const selected = [];
    const spanish = verified.find(candidate => candidate.languagePriority === 2);
    const english = verified.find(candidate => candidate.languagePriority === 1);
    if (spanish) selected.push(spanish);
    if (english) selected.push(english);
    if (!selected.length) selected.push(verified[0]);

    const programmeEnd = Math.max(...selected.map(item => item.programme.endsAt.getTime()));
    const removeAt = event.endsAt ? new Date(event.endsAt) : new Date(programmeEnd);
    if (removeAt.getTime() <= now.getTime()) continue;

    output.push({
      event: { ...event, startsAt: event.startsAt, endsAt: event.endsAt },
      removeAt: removeAt.toISOString(),
      sources: selected.map(item => ({
        channelName: String(item.channel.name || ""),
        url: item.channel.url,
        programmeTitle: item.programme.title,
        programmeEndsAt: item.programme.endsAt.toISOString(),
        qualityScore: item.qualityScore,
        languagePriority: item.languagePriority,
        available: true
      }))
    });
  }

  output.sort((a, b) => new Date(a.event.startsAt) - new Date(b.event.startsAt));
  return {
    status: "ok",
    updatedAt: now.toISOString(),
    events: output.slice(0, MAX_EVENTS),
    reason: output.length ? "signals_verified" : "no_matching_verified_signals"
  };
}

export async function refreshAutomaticLiveSchedule(env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  if (!env || !env.CHANNEL_CATALOG) throw new Error("CHANNEL_CATALOG no está configurado.");
  const apiKey = env.SPORTAPI_API_KEY || env.SPORTSAPI_API_KEY;
  if (!apiKey) throw new Error("SPORTAPI_API_KEY no está configurada.");
  const roomId = env.CHANNEL_CATALOG.idFromName("deporte-total-360-channel-catalog");
  const room = env.CHANNEL_CATALOG.get(roomId);
  const channels = await loadPublishedChannels(room);
  const schedule = await buildAutomaticLiveSchedule({ channels, apiKey, fetchImpl, now });
  const stored = await room.fetch(new Request(
    "https://channel-catalog.internal" + SCHEDULE_PATH,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule)
    }
  ));
  if (!stored.ok) throw new Error("No se pudo guardar la programación central.");
  return schedule;
}
