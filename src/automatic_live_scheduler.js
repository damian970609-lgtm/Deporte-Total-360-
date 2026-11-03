import {
  fetchSportsApiDailyAgenda,
  fetchSportsApiFixturePage,
  fetchSportsApiLiveScores,
  mergeSportsApiLiveScores,
  DAY_REFRESH_MS,
  LIVE_REFRESH_MS
} from "./sportsapi_favorites.js";

const MARCA_AGENDA_URL = "https://www.marca.com/programacion-tv.html";
const REFRESH_CATALOG_MS = 5 * 60 * 1000;
const MAX_AGENDA_AGE_MS = 36 * 60 * 60 * 1000;
const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000;
const MAX_TEXT_BYTES = 12 * 1024 * 1024;

export const AUTO_LIVE_PLAYLIST_URLS = [
  "https://teleonline.github.io/listas/tv.m3u8",
  "https://iptv-org.github.io/iptv/languages/spa.m3u",
  "https://iptv-org.github.io/iptv/countries/es.m3u",
  "https://iptv-org.github.io/iptv/countries/mx.m3u",
  "https://iptv-org.github.io/iptv/countries/ar.m3u",
  "https://iptv-org.github.io/iptv/regions/hispam.m3u",
  "https://iptv-org.github.io/iptv/regions/lac.m3u",
  "https://iptv-org.github.io/iptv/categories/sports.m3u",
  "https://raw.githubusercontent.com/freecasthub/public-iptv/main/sports.m3u",
  "https://dearbulut.github.io/iptv/playlists/category/sports.m3u",
  "https://dearbulut.github.io/iptv/playlists/online.m3u",
  "https://dearbulut.github.io/iptv/playlists/best.m3u"
];

export const AUTO_LIVE_EPG_URLS = [
  "https://iptv-epg.org/files/epg-es.xml",
  "https://iptv-epg.org/files/epg-ar.xml",
  "https://iptv-epg.org/files/epg-mx.xml",
  "https://iptv-epg.org/files/epg-co.xml",
  "https://iptv-epg.org/files/epg-ve.xml",
  "https://iptv-epg.org/files/epg-cl.xml",
  "https://iptv-epg.org/files/epg-pe.xml",
  "https://iptv-epg.org/files/epg-uy.xml",
  "https://iptv-epg.org/files/epg-py.xml",
  "https://iptv-epg.org/files/epg-bo.xml",
  "https://iptv-epg.org/files/epg-cr.xml",
  "https://iptv-epg.org/files/epg-gt.xml",
  "https://iptv-epg.org/files/epg-hn.xml",
  "https://iptv-epg.org/files/epg-ni.xml",
  "https://iptv-epg.org/files/epg-pa.xml",
  "https://iptv-epg.org/files/epg-cw.xml",
  "https://iptv-epg.org/files/epg-jm.xml",
  "https://iptv-epg.org/files/epg-br.xml",
  "https://raw.githubusercontent.com/teleonline/listas/main/epg.xml.gz",
  "https://dearbulut.github.io/iptv/epg/guide.xml.gz"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function textValue(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return textValue(value.name || value.alternateName || value.title || "");
  }
  return "";
}

function safeDirectMediaUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password &&
      /\.(m3u8|mpd|mp4|ts|webm|mkv|flv)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function spanishPriority(channel) {
  const metadata = normalize([
    channel.language, channel.country, channel.group,
    channel.name, channel.tvgName, channel.tvgId
  ].join(" "));
  return /\b(spanish|espanol|castellano|espana|spain|mexico|argentina|colombia|venezuela|chile|peru|uruguay|paraguay|bolivia|ecuador|teledeporte|esport 3)\b/.test(metadata) ||
    /\b(es|spa)\b/.test(metadata) ? 2 : 0;
}

function qualityScore(channel) {
  const label = normalize(channel.name + " " + channel.group);
  if (/\b(2160|4k|uhd)\b/.test(label)) return 500;
  if (/\b(1080|fhd|full hd)\b/.test(label)) return 400;
  if (/\b(720|hd)\b/.test(label)) return 300;
  if (/\b(480|sd)\b/.test(label)) return 200;
  return 50;
}

export function parseM3u(body, baseUrl = "https://example.invalid/list.m3u") {
  const result = [];
  let pending = null;
  for (const raw of String(body || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const comma = line.indexOf(",");
      const metadata = comma >= 0 ? line.slice(0, comma) : line;
      const name = comma >= 0 ? line.slice(comma + 1).trim() : "";
      const attributes = {};
      for (const match of metadata.matchAll(/([\w-]+)="([^"]*)"/g)) {
        attributes[match[1].toLowerCase()] = match[2].trim();
      }
      pending = { name, attributes };
      continue;
    }
    if (line.startsWith("#") || !pending) continue;
    let url;
    try { url = new URL(line, baseUrl).toString(); } catch { pending = null; continue; }
    if (safeDirectMediaUrl(url)) {
      const attr = pending.attributes;
      result.push({
        name: pending.name || attr["tvg-name"] || attr["tvg-id"] || "Canal",
        url,
        tvgId: attr["tvg-id"] || "",
        tvgName: attr["tvg-name"] || "",
        group: attr["group-title"] || "",
        language: attr["tvg-language"] || attr.language || "",
        country: attr["tvg-country"] || attr.country || ""
      });
    }
    pending = null;
  }
  return result;
}

function parseXmltvTime(value) {
  const match = /^(\d{14})\s*([+-]\d{4})?$/.exec(String(value || "").trim());
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const digits = match[1];
  const utc = Date.UTC(
    Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1,
    Number(digits.slice(6, 8)), Number(digits.slice(8, 10)),
    Number(digits.slice(10, 12)), Number(digits.slice(12, 14))
  );
  if (!match[2]) return utc;
  const offset = match[2];
  const sign = offset.startsWith("-") ? -1 : 1;
  const minutes = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5));
  return utc - sign * minutes * 60 * 1000;
}

function xmlAttr(attributes, name) {
  const match = new RegExp("\\b" + name + '="([^"]*)"', "i").exec(attributes);
  return match ? decodeEntities(match[1]) : "";
}

function decodeEntities(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function parseXmltv(body) {
  const text = String(body || "");
  const channelNames = new Map();
  for (const match of text.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi)) {
    const id = xmlAttr(match[1], "id");
    const display = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/i.exec(match[2]);
    if (id) channelNames.set(id, display ? decodeEntities(display[1].replace(/<[^>]+>/g, "")).trim() : "");
  }
  const programmes = [];
  for (const match of text.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi)) {
    const channelId = xmlAttr(match[1], "channel");
    const startsAt = parseXmltvTime(xmlAttr(match[1], "start"));
    const endsAt = parseXmltvTime(xmlAttr(match[1], "stop"));
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(match[2]);
    const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, "")).trim() : "";
    if (!channelId || !title || !Number.isFinite(startsAt) ||
        !Number.isFinite(endsAt) || endsAt <= startsAt) continue;
    programmes.push({
      channelId, channelName: channelNames.get(channelId) || "",
      title, startsAt, endsAt
    });
  }
  return programmes;
}

function madridWallClockToEpoch(year, monthIndex, day, hour, minute) {
  const target = Date.UTC(year, monthIndex, day, hour, minute, 0);
  let candidate = target;
  for (let pass = 0; pass < 3; pass++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit",
      second: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(parts.map(p => [p.type, Number(p.value)]));
    const represented = Date.UTC(
      values.year, values.month - 1, values.day,
      values.hour, values.minute, values.second
    );
    candidate += target - represented;
  }
  return candidate;
}

function parseDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (!explicitZone) {
    const wallClock = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
    if (wallClock) {
      return madridWallClockToEpoch(
        Number(wallClock[1]), Number(wallClock[2]) - 1,
        Number(wallClock[3]), Number(wallClock[4]), Number(wallClock[5])
      ) + Number(wallClock[6] || 0) * 1000;
    }
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventSport(event) {
  const value = normalize([
    event.sport, event.discipline, event.category, event.description, event.name
  ].join(" "));
  if (/basket|baloncesto|nba/.test(value)) return "Baloncesto";
  if (/tennis|tenis|wta|atp|padel|paddle|squash/.test(value)) return "Tenis";
  if (/formula 1|formula one|motogp|nascar|rally|motorsport|automovil|gran premio/.test(value)) return "Motor";
  if (/cycling|ciclismo|tour de|giro d|vuelta a espana/.test(value)) return "Ciclismo";
  if (/athlet|atletismo|marathon|maraton|running|carrera a pie/.test(value)) return "Atletismo";
  if (/swimming|natacion|clavados|water polo/.test(value)) return "Natación";
  if (/golf|pga tour|ryder cup/.test(value)) return "Golf";
  if (/surf|surfing|snowboard|ski|esqui/.test(value)) return "Deportes de acción";
  if (/baseball|beisbol|mlb/.test(value)) return "Béisbol";
  if (/rugby/.test(value)) return "Rugby";
  if (/hockey|nhl/.test(value)) return "Hockey";
  if (/volley|voleibol/.test(value)) return "Voleibol";
  if (/boxing|boxeo|mma|ufc|wrestling|lucha/.test(value)) return "Combate";
  if (/cricket/.test(value)) return "Críquet";
  if (/chess|ajedrez/.test(value)) return "Ajedrez";
  if (/esport|e sports|videojuegos/.test(value)) return "eSports";
  if (/football|futbol|soccer|laliga|champions|premier|liga/.test(value)) return "Fútbol";
  return textValue(event.sport || event.discipline || event.category) || "Deporte";
}

function safeImageUrl(value, depth = 0) {
  if (depth > 5 || value == null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = safeImageUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (value && typeof value === "object") {
    for (const key of [
      "url", "contentUrl", "thumbnailUrl", "src", "image",
      "logo", "crest", "badge", "photo", "picture", "avatar", "href"
    ]) {
      const found = safeImageUrl(value[key], depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  if (!candidate || candidate.toLowerCase().startsWith("data:")) return "";
  try {
    // MARCA suele publicar imágenes con URL //cdn... o rutas /images/...
    // Resuélvelas contra el dominio de la propia agenda.
    const url = new URL(candidate, MARCA_AGENDA_URL);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function teamName(value) {
  return textValue(value?.name || value?.alternateName || value?.title || value);
}

function participantInfo(value, role = "") {
  if (typeof value === "string" || typeof value === "number") {
    const name = textValue(value);
    return name ? { name: name.slice(0, 100), imageUrl: "", country: "", role } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = textValue(value.name || value.alternateName || value.title || value.athlete);
  if (!name) return null;
  return {
    name: name.slice(0, 100),
    imageUrl: safeImageUrl(
      value.imageUrl || value.logo || value.crest || value.badge ||
      value.image || value.thumbnailUrl || value.photo || value.picture || value.avatar
    ),
    country: textValue(value.nationality || value.country || value.affiliation).slice(0, 60),
    role: textValue(value.role || role)
  };
}

function collectParticipants(values) {
  const list = Array.isArray(values) ? values : values == null ? [] : [values];
  const unique = new Map();
  for (const value of list) {
    const participant = participantInfo(value);
    if (!participant) continue;
    const key = normalize(participant.name);
    if (key && !unique.has(key)) unique.set(key, participant);
  }
  return Array.from(unique.values()).slice(0, 12);
}

function splitTeams(title) {
  const parts = String(title || "").split(/\s+(?:vs?\.?|versus|contra|[-–—])\s+/i);
  return parts.length >= 2
    ? { homeTeam: parts[0].trim(), awayTeam: parts.slice(1).join(" vs ").trim() }
    : { homeTeam: "", awayTeam: "" };
}

function stableId(title, startsAt) {
  const input = normalize(title) + "|" + startsAt;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "marca-" + (hash >>> 0).toString(16);
}

function unwrapEventObject(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const type = textValue(item["@type"] || item.type).toLowerCase();
  const name = textValue(item.name || item.title || item.eventTitle || item.matchTitle);
  const startValue = item.startDate || item.startTime || item.startsAt ||
    item.start_time || item.datetime || item.date;
  const startsAt = parseDateTime(startValue);
  if (!name || !startsAt) return null;

  const homeRaw = item.homeTeam || item.home || item.teamHome ||
    item.localTeam || item.team1 || item.home_team;
  const awayRaw = item.awayTeam || item.away || item.teamAway ||
    item.visitorTeam || item.away_team || item.team2;
  const teamSplit = splitTeams(name);
  const homeTeam = teamName(homeRaw) || teamSplit.homeTeam;
  const awayTeam = teamName(awayRaw) || teamSplit.awayTeam;
  let homeTeamLogo = safeImageUrl(
    homeRaw?.logo || homeRaw?.logoUrl || homeRaw?.crest ||
    homeRaw?.badge || homeRaw?.image || homeRaw?.photo ||
    item.homeTeamLogo || item.homeTeamLogoUrl || item.homeLogo ||
    item.localTeamLogo || item.homeTeamImage
  );
  let awayTeamLogo = safeImageUrl(
    awayRaw?.logo || awayRaw?.logoUrl || awayRaw?.crest ||
    awayRaw?.badge || awayRaw?.image || awayRaw?.photo ||
    item.awayTeamLogo || item.awayTeamLogoUrl || item.awayLogo ||
    item.visitorTeamLogo || item.awayTeamImage
  );

  const participantSource = item.participants || item.competitors ||
    item.competitor || item.performers || item.performer ||
    item.athletes || item.athlete || item.players;
  const participants = collectParticipants(participantSource);
  if (homeTeam && !participants.some(row => normalize(row.name) === normalize(homeTeam))) {
    participants.unshift({
      name: homeTeam, imageUrl: homeTeamLogo, country: "", role: "home"
    });
  } else if (homeTeam && homeTeamLogo) {
    const current = participants.find(row => normalize(row.name) === normalize(homeTeam));
    if (current && !current.imageUrl) current.imageUrl = homeTeamLogo;
  }
  if (awayTeam && !participants.some(row => normalize(row.name) === normalize(awayTeam))) {
    participants.push({
      name: awayTeam, imageUrl: awayTeamLogo, country: "", role: "away"
    });
  } else if (awayTeam && awayTeamLogo) {
    const current = participants.find(row => normalize(row.name) === normalize(awayTeam));
    if (current && !current.imageUrl) current.imageUrl = awayTeamLogo;
  }
  const uniqueParticipants = collectParticipants(participants);
  if (!homeTeamLogo && homeTeam) {
    homeTeamLogo = uniqueParticipants.find(row => normalize(row.name) === normalize(homeTeam))?.imageUrl || "";
  }
  if (!awayTeamLogo && awayTeam) {
    awayTeamLogo = uniqueParticipants.find(row => normalize(row.name) === normalize(awayTeam))?.imageUrl || "";
  }

  const eventText = normalize([
    type, item.sport, item.discipline, item.category, name,
    item.description, homeTeam, awayTeam
  ].join(" "));
  const sportsType = /sports?event|sport|football|futbol|soccer|basket|tennis|tenis|hockey|baseball|rugby|formula|motogp|cricket|volley|boxing|mma|athlet|golf|cycling|ciclismo|swimming|natacion|padel|surf|esport|chess/.test(eventText);
  if (!sportsType && !(homeTeam && awayTeam)) return null;

  const endsAt = parseDateTime(item.endDate || item.endTime || item.endsAt || item.end_time);
  const competition = textValue(
    item.competition || item.league || item.superEvent || item.tournament || item.eventSeries
  );
  const status = normalize(textValue(item.eventStatus || item.status || item.state));
  const finished = /finished|end|final|terminad|finalizad|eventcompleted|eventcancelled|eventpostponed|cancelad|suspendid/.test(status) ||
    /\b(finalizado|finalizada|terminado|terminada|full time|ft|cancelado|cancelada|suspendido|suspendida)\b/.test(normalize(item.description));
  const sport = eventSport({
    sport: item.sport, discipline: item.discipline,
    category: item.category, description: item.description, name
  });
  const duration = sport === "Tenis" ? 4 : sport === "Motor" ? 3 : 3;
  const location = item.location?.name || item.location || item.venue;
  return {
    id: textValue(item.identifier || item.id) || stableId(name, startsAt),
    title: name.slice(0, 180),
    sport,
    competition: competition.slice(0, 120),
    homeTeam: homeTeam.slice(0, 80),
    awayTeam: awayTeam.slice(0, 80),
    homeTeamLogo,
    awayTeamLogo,
    participants: uniqueParticipants,
    imageUrl: safeImageUrl(
      item.image || item.imageUrl || item.thumbnailUrl || item.thumbnail ||
      item.photo || item.picture || item.poster
    ),
    venue: textValue(location).slice(0, 120),
    startsAt,
    endsAt: endsAt && endsAt > startsAt ? endsAt : startsAt + duration * 60 * 60 * 1000,
    status: finished ? "finished" : "scheduled",
    detailUrl: MARCA_AGENDA_URL
  };
}
function walkStructuredData(value, output, depth = 0) {
  if (!value || depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) walkStructuredData(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const parsed = unwrapEventObject(value);
  if (parsed) output.push(parsed);
  for (const [key, child] of Object.entries(value)) {
    if (key === "image" || key === "logo" || key === "thumbnailUrl") continue;
    if (child && typeof child === "object") walkStructuredData(child, output, depth + 1);
  }
}

function parseEmbeddedJson(scriptBody) {
  const source = String(scriptBody || "").trim().replace(/;\s*$/, "");
  const first = source.search(/[{[]/);
  if (first < 0) return null;
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = first; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === "}" || character === "]") {
      if (stack.pop() !== character) return null;
      if (stack.length === 0) {
        try { return JSON.parse(source.slice(first, index + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

function extractMarcaStructuredEvents(html) {
  const found = [];
  for (const match of String(html).matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try { walkStructuredData(JSON.parse(decodeEntities(match[1])), found); } catch { /* JSON-LD inválido */ }
  }
  // Algunos CMS publican el calendario como JSON de aplicación o como
  // estado hidratado (por ejemplo __NEXT_DATA__), no solo como JSON-LD.
  for (const match of String(html).matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  )) {
    const body = match[2] || "";
    if (body.length > 2 * 1024 * 1024 ||
        !/(startDate|startsAt|start_time|homeTeam|awayTeam|participants|competitors|performer)/i.test(body)) {
      continue;
    }
    const embedded = parseEmbeddedJson(body);
    if (embedded) walkStructuredData(embedded, found);
  }
  // Respaldo para pequeños objetos JavaScript serializados.
  for (const match of String(html).matchAll(
    /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const body = match[1];
    if (!/(startDate|startsAt|start_time|homeTeam|awayTeam)/i.test(body)) continue;
    const objectPattern = /\{[^{}]{0,4000}(?:startDate|startsAt|start_time)[^{}]{0,4000}\}/g;
    for (const objectMatch of body.matchAll(objectPattern)) {
      const fragment = objectMatch[0];
      const name = /"(?:name|title|eventTitle|matchTitle)"\s*:\s*"((?:\\.|[^"\\]){5,180})"/i.exec(fragment);
      const start = /"(?:startDate|startsAt|start_time|startTime)"\s*:\s*"([^"]+)"/i.exec(fragment);
      if (!name || !start) continue;
      const unescaped = name[1].replace(/\\u([0-9a-f]{4})/gi, (_, n) =>
        String.fromCharCode(parseInt(n, 16))).replace(/\\(["\\/])/g, "$1");
      const event = unwrapEventObject({ name: unescaped, startDate: start[1], sport: "sports" });
      if (event) found.push(event);
    }
  }
  const unique = new Map();
  for (const event of found) {
    const key = event.id || stableId(event.title, event.startsAt);
    if (!unique.has(key)) unique.set(key, { ...event, id: key });
  }
  return Array.from(unique.values()).sort((a, b) => a.startsAt - b.startsAt);
}

function extractPlainTextAgendaEvents(html, now) {
  const text = decodeEntities(String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n"))
    .replace(/\u00a0/g, " ");
  const lines = text.split(/[\r\n]+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const madrid = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(now)).map(part => [part.type, Number(part.value)]));
  const output = [];
  const pairPattern = /([A-ZÀ-Ý0-9][^|•]{2,75}?)\s+(?:vs?\.?|versus|contra|[-–—])\s+([A-ZÀ-Ý0-9][^|•]{2,75})/i;
  const timePattern = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
  const genericLines = /^(hoy|manana|ayer|programacion|programacion tv|agenda|deportes|horarios|en directo|television)$/i;

  for (let index = 0; index < lines.length; index++) {
    const time = timePattern.exec(lines[index]);
    if (!time) continue;
    const contextLines = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3));
    const context = contextLines.join(" · ").slice(0, 420);
    const pair = pairPattern.exec(context);
    const sport = eventSport({ description: context });
    if (!pair && sport === "Deporte") continue;

    const candidate = contextLines
      .map(line => line.replace(timePattern, "").replace(/[|•·]+/g, " ").trim())
      .filter(line => line.length >= 5 && !genericLines.test(normalize(line)))
      .sort((a, b) => b.length - a.length)[0] || "";
    const title = pair
      ? pair[1].trim() + " vs " + pair[2].trim()
      : candidate.slice(0, 180);
    if (title.length < 5) continue;

    const hour = Number(time[1]);
    const minute = Number(time[2]);
    let startsAt = madridWallClockToEpoch(
      madrid.year, madrid.month - 1, madrid.day, hour, minute
    );
    if (startsAt < now - 5 * 60 * 60 * 1000) startsAt += 24 * 60 * 60 * 1000;
    const contextNormalized = normalize(context);
    const finished = /\b(finalizado|finalizada|terminado|terminada|finished|full time|ft|cancelado|cancelada|suspendido|suspendida)\b/.test(contextNormalized);
    const homeTeam = pair ? pair[1].trim().slice(0, 80) : "";
    const awayTeam = pair ? pair[2].trim().slice(0, 80) : "";
    output.push({
      id: stableId(title, startsAt),
      title: title.slice(0, 180),
      sport: sport === "Deporte" && pair ? "Fútbol" : sport,
      competition: "",
      homeTeam,
      awayTeam,
      homeTeamLogo: "",
      awayTeamLogo: "",
      participants: pair ? [
        { name: homeTeam, imageUrl: "", country: "", role: "home" },
        { name: awayTeam, imageUrl: "", country: "", role: "away" }
      ] : [],
      imageUrl: "",
      venue: "",
      startsAt,
      endsAt: startsAt + (sport === "Tenis" ? 4 : 3) * 60 * 60 * 1000,
      status: finished ? "finished" : "scheduled",
      detailUrl: MARCA_AGENDA_URL
    });
  }
  const unique = new Map();
  for (const event of output) unique.set(event.id, event);
  return Array.from(unique.values());
}
export function parseMarcaAgendaHtml(html, now = Date.now()) {
  const structured = extractMarcaStructuredEvents(html);
  const events = structured.length ? structured : extractPlainTextAgendaEvents(html, now);
  // Mantiene eventos en curso aunque hayan comenzado hace varias horas.
  const cutoff = now - 6 * 60 * 60 * 1000;
  const horizon = now + MAX_AGENDA_AGE_MS;
  return events.filter(event =>
    event.startsAt >= cutoff && event.startsAt <= horizon &&
    event.status !== "finished"
  );
}

function aliases(team) {
  const value = normalize(team);
  const replacements = {
    "manchester united": ["man utd", "man united", "manchester utd"],
    "paris saint germain": ["psg", "paris sg"],
    "atletico madrid": ["atleti", "atletico de madrid"],
    "fc barcelona": ["barcelona", "barca"],
    "internazionale": ["inter milan", "inter"],
    "bayern munich": ["bayern"],
    "borussia dortmund": ["dortmund", "bvb"],
    "tottenham hotspur": ["tottenham", "spurs"]
  };
  for (const [key, values] of Object.entries(replacements)) {
    if (value === key || values.includes(value)) return [key, ...values];
  }
  return [value];
}

function teamMatches(team, programme) {
  const normalized = normalize(programme);
  const possible = aliases(team).filter(Boolean);
  if (!possible.length) return false;
  if (possible.some(alias => normalized.includes(alias))) return true;
  const ignored = new Set(["club", "united", "city", "team", "fc", "cf", "afc", "the"]);
  const tokens = normalize(team).split(" ").filter(token => token.length >= 3 && !ignored.has(token));
  if (!tokens.length) return false;
  const found = tokens.filter(token => normalized.split(" ").includes(token)).length;
  return found >= (tokens.length === 1 ? 1 : Math.ceil(tokens.length * 0.67));
}

export function programmeMatchesEvent(title, event) {
  const programme = normalize(title);
  if (!programme) return false;
  if (event.homeTeam && event.awayTeam) {
    return teamMatches(event.homeTeam, programme) && teamMatches(event.awayTeam, programme);
  }
  // Para carreras (F1, MotoGP y ciclismo) el nombre de la serie y el evento
  // ayudan a encontrar la programación EPG aunque no haya dos equipos.
  const identity = normalize([event.competition, event.title].filter(Boolean).join(" "));
  const identityTokens = identity.split(" ").filter(t => t.length >= 4);
  const titleTokens = normalize(event.title).split(" ").filter(t => t.length >= 4);
  const identityHits = identityTokens.filter(t => programme.includes(t)).length;
  const titleHits = titleTokens.filter(t => programme.includes(t)).length;
  return (titleTokens.length >= 2 && titleHits >= 2) ||
    (identityTokens.length >= 3 && identityHits >= 3);
}

async function limitedMap(items, limit, callback) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await callback(items[index], index); }
      catch { output[index] = null; }
    }
  });
  await Promise.all(workers);
  return output;
}

async function fetchText(url, maxBytes = MAX_TEXT_BYTES) {
  const response = await fetch(url, {
    headers: {
      "Accept": "*/*",
      "User-Agent": "Mozilla/5.0 (compatible; DeporteTotal360/1.0)"
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " en " + url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("Fuente demasiado grande: " + url);
  let decodedBytes = bytes;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("GZIP no disponible");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const expanded = new Uint8Array(await new Response(stream).arrayBuffer());
    if (expanded.length > maxBytes) throw new Error("XML descomprimido demasiado grande");
    decodedBytes = expanded;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(decodedBytes);
}

async function buildCandidateIndex(events) {
  const playlistBodies = await limitedMap(AUTO_LIVE_PLAYLIST_URLS, 4,
    async url => ({ url, body: await fetchText(url, 8 * 1024 * 1024) }));
  const channels = [];
  for (const item of playlistBodies.filter(Boolean)) {
    channels.push(...parseM3u(item.body, item.url));
  }
  const uniqueChannels = new Map();
  for (const channel of channels) {
    if (!uniqueChannels.has(channel.url)) uniqueChannels.set(channel.url, channel);
  }

  const epgBodies = await limitedMap(AUTO_LIVE_EPG_URLS, 3,
    async url => await fetchText(url, 18 * 1024 * 1024));
  const programmes = [];
  for (const body of epgBodies.filter(Boolean)) {
    try { programmes.push(...parseXmltv(body)); } catch { /* guía inválida */ }
  }

  const channelsById = new Map();
  const channelsByName = new Map();
  for (const channel of uniqueChannels.values()) {
    if (channel.tvgId) {
      if (!channelsById.has(channel.tvgId)) channelsById.set(channel.tvgId, []);
      channelsById.get(channel.tvgId).push(channel);
    }
    for (const raw of [channel.name, channel.tvgName, channel.tvgId]) {
      const key = normalize(raw);
      if (!key) continue;
      if (!channelsByName.has(key)) channelsByName.set(key, []);
      channelsByName.get(key).push(channel);
    }
  }

  const index = {};
  for (const event of events) {
    const prepareAt = event.startsAt - 10 * 60 * 1000;
    const limit = event.endsAt || event.startsAt + DEFAULT_EVENT_DURATION_MS;
    const relevant = programmes.filter(programme =>
      programme.startsAt < limit && programme.endsAt > prepareAt &&
      programmeMatchesEvent(programme.title, event)
    );
    const candidates = new Map();
    for (const programme of relevant) {
      const mapped = [
        ...(channelsById.get(programme.channelId) || []),
        ...(channelsByName.get(normalize(programme.channelName)) || []),
        ...(channelsByName.get(normalize(programme.channelId)) || [])
      ];
      for (const channel of mapped) {
        if (!safeDirectMediaUrl(channel.url) || candidates.has(channel.url)) continue;
        candidates.set(channel.url, {
          channelName: channel.name,
          url: channel.url,
          programmeTitle: programme.title,
          programmeEndsAt: programme.endsAt,
          languagePriority: spanishPriority(channel),
          qualityScore: qualityScore(channel)
        });
      }
    }
    index[event.id] = Array.from(candidates.values()).sort((a, b) =>
      b.languagePriority - a.languagePriority || b.qualityScore - a.qualityScore
    ).slice(0, 24);
  }
  return {
    refreshedAt: Date.now(),
    playlistCount: uniqueChannels.size,
    programmeCount: programmes.length,
    candidatesByEvent: index
  };
}

async function probeCandidate(candidate, depth = 0) {
  if (!safeDirectMediaUrl(candidate.url) || depth > 2) return false;
  try {
    const response = await fetch(candidate.url, {
      headers: {
        "Range": "bytes=0-4095",
        "Accept": candidate.url.toLowerCase().includes(".m3u8")
          ? "application/vnd.apple.mpegurl,*/*" : "*/*"
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
    });
    if (!response.ok && response.status !== 206) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 1024 * 1024) return false;
    const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const lower = candidate.url.toLowerCase();
    if (lower.includes(".m3u8")) {
      if (!body.trimStart().startsWith("#EXTM3U")) return false;
      const lines = body.replace(/\r/g, "").split("\n").map(line => line.trim());
      let target = null;
      for (const line of lines) {
        if (!line || line.startsWith("#")) continue;
        target = line;
        break;
      }
      if (!target) return false;
      const resolved = new URL(target, candidate.url).toString();
      if (depth === 0 && /\.m3u8(?:$|\?)/i.test(resolved)) {
        return await probeCandidate({ ...candidate, url: resolved }, depth + 1);
      }
      const segment = await fetch(resolved, {
        headers: { "Range": "bytes=0-2047" },
        signal: AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined
      });
      if (!segment.ok && segment.status !== 206) return false;
      const chunk = await segment.arrayBuffer();
      return chunk.byteLength > 0;
    }
    if (lower.includes(".mpd")) return /<MPD\b/i.test(body);
    return true;
  } catch {
    return false;
  }
}

async function chooseSource(candidates, now) {
  const spanish = candidates.filter(item => item.languagePriority > 0);
  const other = candidates.filter(item => item.languagePriority === 0);
  const verify = async list => {
    for (const candidate of list.slice(0, 12)) {
      if (await probeCandidate(candidate)) {
        return {
          ...candidate,
          available: true,
          checkedAt: new Date(now).toISOString()
        };
      }
    }
    return null;
  };
  return await verify(spanish) || await verify(other);
}

async function fetchMarcaAgenda() {
  const response = await fetch(MARCA_AGENDA_URL, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "es-ES,es;q=0.9",
      "User-Agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36"
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
  });
  if (!response.ok) throw new Error("MARCA respondió HTTP " + response.status);
  const html = await response.text();
  if (!html || html.length < 1000) throw new Error("La página de MARCA llegó vacía o incompleta");
  const events = parseMarcaAgendaHtml(html);
  if (!events.length) throw new Error("No se reconocieron eventos estructurados en la agenda MARCA");
  return events;
}


let cachedFcmAccessToken = null;
let cachedFcmAccessTokenExpiresAt = 0;

function base64Url(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getFcmAccessToken(serviceAccount) {
  if (cachedFcmAccessToken && Date.now() < cachedFcmAccessTokenExpiresAt - 60000) {
    return cachedFcmAccessToken;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claims;
  const pem = String(serviceAccount.private_key || "")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!pem || !serviceAccount.client_email || !serviceAccount.project_id) {
    throw new Error("La cuenta de servicio FCM está incompleta");
  }
  const binary = atob(pem);
  const keyBytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = unsigned + "." + base64Url(new Uint8Array(signature));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("OAuth FCM respondió HTTP " + response.status);
  const body = await response.json();
  cachedFcmAccessToken = body.access_token;
  cachedFcmAccessTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return cachedFcmAccessToken;
}

async function sendFcmMessage(serviceAccount, event) {
  const accessToken = await getFcmAccessToken(serviceAccount);
  const sport = String(event.event.sport || "Deporte");
  const home = String(event.event.homeTeam || "");
  const away = String(event.event.awayTeam || "");
  const teams = home && away ? home + " vs " + away : String(event.event.title || "Evento deportivo");
  const response = await fetch(
    "https://fcm.googleapis.com/v1/projects/" +
      encodeURIComponent(serviceAccount.project_id) + "/messages:send",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          topic: "deporte_total_360_live",
          notification: {
            title: "TRANSMISIÓN DISPONIBLE · " + sport,
            body: teams + " ya tiene una señal comprobada. Toca para abrir Deportes en vivo."
          },
          data: {
            eventId: String(event.event.id),
            route: "live"
          },
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "sports_live_events",
              click_action: "FLUTTER_NOTIFICATION_CLICK"
            }
          }
        }
      })
    }
  );
  if (response.ok) return { delivered: true, invalid: false };
  const details = await response.text();
  const invalid = response.status === 404 ||
    /UNREGISTERED|registration-token-not-registered/i.test(details);
  return { delivered: false, invalid };
}

async function dispatchLiveNotifications(state, env, snapshot, now) {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return;
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  } catch {
    console.error('FCM_SERVICE_ACCOUNT_JSON no contiene JSON válido');
    return;
  }
  const progress = await state.storage.get('notification_progress') || {};
  const events = (snapshot.events || []).filter(item =>
    item.state === 'verified' &&
    item.sources?.length &&
    item.event?.status !== 'finished' &&
    Date.parse(item.event?.startsAt) <= now + 10 * 60 * 1000 &&
    Date.parse(item.removeAt) > now
  );

  for (const item of events) {
    const eventId = String(item.event.id || '');
    if (!eventId || progress[eventId]?.sent) continue;
    try {
      const result = await sendFcmMessage(serviceAccount, item);
      if (result.delivered) {
        progress[eventId] = { sent: true, sentAt: now };
      }
    } catch (error) {
      console.error('No se pudo enviar una notificación FCM:', String(error?.message || error));
    }
  }

  for (const [eventId, record] of Object.entries(progress)) {
    const current = (snapshot.events || []).find(item => String(item.event?.id) === eventId);
    if (!current && now - Number(record.sentAt || 0) > 48 * 60 * 60 * 1000) {
      delete progress[eventId];
    }
  }
  await state.storage.put('notification_progress', progress);
}
async function fetchSportsApiEvents(state, env, now) {
  const todayUtc = new Date(now).toISOString().slice(0, 10);
  let daily = await state.storage.get("sportsapi_daily_agenda") || null;
  let rebuilt = false;

  if (!daily || daily.date !== todayUtc ||
      now - Number(daily.refreshedAt || 0) >= DAY_REFRESH_MS) {
    daily = await fetchSportsApiDailyAgenda(env, now);
    await state.storage.put("sportsapi_daily_agenda", daily);
    await state.storage.put("sportsapi_page_checked_at", now);
    rebuilt = true;
  }

  // Las páginas adicionales se descargan escalonadamente para no superar
  // el límite por minuto de SportsAPI. Cada deporte solo se pagina cuando
  // el proveedor informa meta.hasNextPage.
  let pageQueue = Array.isArray(daily.pageQueue) ? [...daily.pageQueue] : [];
  const pageCheckedAt = Number(await state.storage.get("sportsapi_page_checked_at") || 0);
  if (!rebuilt && pageQueue.length && now - pageCheckedAt >= 60000) {
    const task = pageQueue.shift();
    try {
      const pageResult = await fetchSportsApiFixturePage(
        env, daily.date, task.sport, task.page
      );
      const merged = new Map((daily.events || []).map(item => [item.id, item]));
      for (const event of pageResult.events || []) merged.set(event.id, event);
      if (pageResult.hasNextPage && task.page < task.maxPage) {
        pageQueue.push({ ...task, page: task.page + 1 });
      }
      daily = {
        ...daily,
        events: Array.from(merged.values()).sort((a, b) =>
          Date.parse(a.startsAt) - Date.parse(b.startsAt)
        ),
        pageQueue
      };
    } catch (error) {
      // Una página fallida no elimina los resultados que ya se descargaron.
      console.error(
        "SportsAPI pagination " + task.sport + " page " + task.page + ":",
        String(error?.message || error)
      );
      daily = { ...daily, pageQueue };
    }
    await state.storage.put("sportsapi_daily_agenda", daily);
    await state.storage.put("sportsapi_page_checked_at", now);
    rebuilt = true;
  }

  let live = await state.storage.get("sportsapi_live_scores") || null;
  if (!rebuilt && (!live || now - Number(live.refreshedAt || 0) >= LIVE_REFRESH_MS)) {
    try {
      const liveEvents = await fetchSportsApiLiveScores(env);
      live = { refreshedAt: now, events: liveEvents };
      await state.storage.put("sportsapi_live_scores", live);
    } catch (error) {
      // La agenda diaria válida permanece disponible si fallan los marcadores en vivo.
      console.error("SportsAPI live scores:", String(error?.message || error));
    }
  }

  const merged = mergeSportsApiLiveScores(daily.events || [], live?.events || []);
  return merged.map(item => ({
    ...item,
    startsAt: Date.parse(item.startsAt),
    endsAt: Date.parse(item.endsAt)
  })).filter(item =>
    Number.isFinite(item.startsAt) &&
    Number.isFinite(item.endsAt) &&
    item.endsAt > item.startsAt
  );
}

async function refreshState(state, env, now = Date.now()) {
  const previous = await state.storage.get("snapshot") || null;
  let events;
  let sourceError = null;
  const agendaSource = env.SPORTAPI_API_KEY ? "sportsapi" : "marca";
  try {
    events = env.SPORTAPI_API_KEY
      ? await fetchSportsApiEvents(state, env, now)
      : await fetchMarcaAgenda();
  } catch (error) {
    sourceError = String(error?.message || error).slice(0, 300);
    if (previous?.events?.length) {
      const retained = previous.events.filter(item =>
        Date.parse(item.removeAt) > now &&
        Date.parse(item.event.startsAt) <= now + MAX_AGENDA_AGE_MS
      );
      const snapshot = {
        ...previous,
        status: "stale",
        source: agendaSource,
        sourceError,
        lastAttemptAt: new Date(now).toISOString(),
        events: retained,
        updatedAt: previous.updatedAt
      };
      await state.storage.put("snapshot", snapshot);
      return snapshot;
    }
    const emptySnapshot = {
      status: "source_unavailable",
      source: agendaSource,
      sourceError,
      lastAttemptAt: new Date(now).toISOString(),
      updatedAt: null,
      events: []
    };
    await state.storage.put("snapshot", emptySnapshot);
    return emptySnapshot;
  }

  let catalog = await state.storage.get("candidate_index") || null;
  if (!catalog || now - Number(catalog.refreshedAt || 0) >= REFRESH_CATALOG_MS ||
      events.some(event => !Object.hasOwn(catalog.candidatesByEvent || {}, event.id))) {
    try {
      catalog = await buildCandidateIndex(events);
      await state.storage.put("candidate_index", catalog);
    } catch (error) {
      // Conserva el índice anterior; un feed caído no vacía transmisiones publicadas.
      sourceError = "Catálogos M3U/EPG: " + String(error?.message || error).slice(0, 240);
    }
  }

  const priorProbes = await state.storage.get("probe_cache") || {};
  const probeCache = { ...priorProbes };
  for (const [url, value] of Object.entries(probeCache)) {
    if (!value || now - Number(value.checkedAt || 0) > 24 * 60 * 60 * 1000) {
      delete probeCache[url];
    }
  }
  // Reservamos margen dentro del límite de subsolicitudes del Worker.
  // Una prueba HLS puede requerir manifiesto, variante y segmento.
  let probeBudget = 5;
  const output = [];
  for (const event of events) {
    const candidates = catalog?.candidatesByEvent?.[event.id] || [];
    let selected = null;
    const scheduledAt = event.startsAt - 10 * 60 * 1000;
    if (now >= scheduledAt && now < event.endsAt && event.status !== "finished") {
      const verifyGroup = async group => {
        for (const candidate of group.slice(0, 12)) {
          const cached = probeCache[candidate.url];
          if (cached && now - cached.checkedAt < 45000) {
            if (cached.available) {
              return {
                ...candidate,
                available: true,
                checkedAt: new Date(cached.checkedAt).toISOString()
              };
            }
            continue;
          }
          if (probeBudget <= 0) break;
          probeBudget--;
          const available = await probeCandidate(candidate);
          probeCache[candidate.url] = { available, checkedAt: now };
          if (available) {
            return {
              ...candidate,
              available: true,
              checkedAt: new Date(now).toISOString()
            };
          }
        }
        return null;
      };
      // No se prueba otra lengua hasta agotar los candidatos en español.
      const spanish = candidates.filter(item => item.languagePriority > 0);
      const international = candidates.filter(item => item.languagePriority === 0);
      selected = await verifyGroup(spanish);
      if (!selected) selected = await verifyGroup(international);
    }
    const programmeEndsAt = selected?.programmeEndsAt || 0;
    const expectedEnd = event.endsAt || event.startsAt + DEFAULT_EVENT_DURATION_MS;
    const removeAt = programmeEndsAt > event.startsAt
      ? Math.min(expectedEnd, programmeEndsAt)
      : expectedEnd;
    if (removeAt <= now || event.status === "finished") continue;
    output.push({
      event: {
        ...event,
        startsAt: new Date(event.startsAt).toISOString(),
        endsAt: new Date(event.endsAt).toISOString()
      },
      removeAt: new Date(removeAt).toISOString(),
      sources: selected ? [{
        ...selected,
        programmeEndsAt: new Date(selected.programmeEndsAt).toISOString()
      }] : [],
      state: selected ? "verified" : now >= scheduledAt ? "searching" : "waiting"
    });
  }
  await state.storage.put("probe_cache", probeCache);
  const snapshot = {
    status: "ok",
    source: agendaSource,
    sourceError,
    updatedAt: new Date(now).toISOString(),
    lastAttemptAt: new Date(now).toISOString(),
    catalogUpdatedAt: catalog?.refreshedAt
      ? new Date(catalog.refreshedAt).toISOString() : null,
    playlistCount: catalog?.playlistCount || 0,
    programmeCount: catalog?.programmeCount || 0,
    events: output
  };
  await state.storage.put("snapshot", snapshot);
  await dispatchLiveNotifications(state, env, snapshot, now);
  return snapshot;
}

export class AutomaticLiveSchedule {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.refreshPromise = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/snapshot" && request.method === "GET") {
      const snapshot = await this.state.storage.get("snapshot");
      if (!snapshot) {
        return json({
          status: "pending",
          source: "marca",
          updatedAt: null,
          events: []
        });
      }
      return json(snapshot);
    }
    if (url.pathname === "/refresh" && request.method === "POST") {
      if (this.refreshPromise) return json({ status: "already_running" }, 202);
      this.refreshPromise = refreshState(this.state, this.env);
      try {
        const snapshot = await this.refreshPromise;
        return json(snapshot);
      } catch (error) {
        return json({
          status: "error",
          error: String(error?.message || error).slice(0, 300)
        }, 500);
      } finally {
        this.refreshPromise = null;
      }
    }
    return json({ error: "Ruta interna no encontrada" }, 404);
  }
}
