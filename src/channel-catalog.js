const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

const ADMIN_EMAIL_DEFAULT = "damian970609@gmail.com";

export function detectChannelLanguage(declaredLanguage, name = "", groupTitle = "") {
  const normalize = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const declared = normalize(declaredLanguage).split(/[;,|/]/)[0].trim();
  if (/^(es|spa|spanish|espanol|castellano)([-_].*)?$/.test(declared)) return "es";
  if (/^(en|eng|english|ingles)([-_].*)?$/.test(declared)) return "en";

  const descriptiveText = normalize(name + " " + groupTitle);
  if (/\b(espanol(?:a)?|spanish|castellano|latino|latina|latam)\b/.test(descriptiveText)) return "es";
  if (/\b(english|ingles)\b/.test(descriptiveText)) return "en";
  return "unknown";
}
const MAX_PLAYLIST_BYTES = 25 * 1024 * 1024;
// Admite catálogos grandes y procesa sus canales por lotes para no bloquear
// una invocación del Durable Object ni agotar de golpe la cuota de escrituras.
// Limita el impacto de cada lista importada en el presupuesto diario de
// escrituras de Durable Objects. La APK consume páginas y mantiene una copia
// local; 5.000 canales por fuente permiten selección manual sin importaciones
// descontroladas de listas globales de decenas de miles de entradas.
const MAX_PARSED_PLAYLIST_CHANNELS = 50000;
const MAX_IMPORTED_CHANNELS = 50000;
const MAX_SOURCE_COUNT = 100;
const MAX_CHANNEL_CATALOG_OFFSET = 5000000;
const IMPORT_CHANNEL_BATCH_SIZE = 500;
const REFRESH_BATCH_SIZE = 2;
const BUILT_IN_SOURCE_IDS = [
  "iptv-org-sports-default",
  "freecasthub-sports-public",
  "iptv-validated-sports",
  "doubo-sports-public",
  "shovo-global-sports-filter",
  "free-tv-global-sports-filter"
];
const BUILT_IN_SOURCE_SQL = BUILT_IN_SOURCE_IDS.map(() => "?").join(", ");
const BUILT_IN_SOURCE_RETIRE_AT = Date.UTC(2100, 0, 1);

function isDurableObjectWriteQuotaError(error) {
  return String(error && error.message || error).includes(
    "Exceeded allowed rows written in Durable Objects free tier"
  );
}

function recordCatalogMigration(sql, version) {
  try {
    sql.exec(
      "INSERT OR IGNORE INTO channel_catalog_schema_migrations (version) VALUES (?)",
      version
    );
  } catch (error) {
    // Un límite temporal de escrituras no debe impedir lecturas del catálogo.
    if (!isDurableObjectWriteQuotaError(error)) throw error;
    console.error("Cuota de escrituras agotada al registrar la migración del catálogo.");
  }
}
// Las fuentes públicas no cambian cada pocas horas; refrescar a diario evita
// escribir de nuevo miles de filas idénticas en el plan gratuito.
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SPORTS_WORDS = /\b(sports?|deportes?|espn|fox sports|tudn|bein sports|dazn|futbol|fútbol|football|soccer|basketball|nba|mlb|ufc|mma|motogp|formula 1|f1|tennis|tenis|golf|rugby|cricket|baseball|hockey|volleyball|voleibol|sportv|gol tv|tyc sports|win sports|teledeporte|liga mx|champions)\b/i;

function response(data, status = 200) {
  if (status === 204 || status === 304) {
    return new Response(null, { status, headers: JSON_HEADERS });
  }
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function validPublicHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !url.host || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        host.endsWith(".internal") || host === "0.0.0.0" || host === "127.0.0.1" ||
        host.startsWith("10.") || host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "[::1]" ||
        host === "169.254.169.254") return false;
    return true;
  } catch {
    return false;
  }
}

function validStreamUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || "").trim(), baseUrl);
    const path = url.pathname.toLowerCase();
    const supported = [
      ".m3u8", ".mpd", ".mp4", ".m4v", ".mov", ".mkv",
      ".webm", ".ts", ".mpeg", ".mpg", ".flv", ".m2ts", ".2ts", ".mts",
    ].some(extension => path.endsWith(extension)) ||
      path.endsWith(".ism/manifest") || path.endsWith(".isml/manifest");
    return url.protocol === "https:" && !url.username && !url.password &&
      supported;
  } catch {
    return false;
  }
}

function cleanText(value, max = 180) {
  return Array.from(String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim())
    .slice(0, max).join("");
}

function slug(value) {
  return cleanText(value, 120).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "canal";
}

async function identifierFor(name, url) {
  const bytes = new TextEncoder().encode(name.toLowerCase() + "\n" + url);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const suffix = Array.from(digest.slice(0, 5), byte => byte.toString(16).padStart(2, "0")).join("");
  return slug(name) + "-" + suffix;
}

function parseM3u(text, sourceUrl) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let metadata = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      metadata = line;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!metadata) continue;

    const comma = metadata.indexOf(",");
    const attributeText = comma >= 0 ? metadata.slice(0, comma) : metadata;
    const nameFromLine = comma >= 0 ? metadata.slice(comma + 1).trim() : "";
    const attrs = {};
    for (const match of attributeText.matchAll(/([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g)) {
      attrs[match[1].toLowerCase()] = match[2];
    }
    const name = cleanText(nameFromLine || attrs["tvg-name"] || attrs["tvg-id"], 120);
    let streamUrl = "";
    try {
      streamUrl = new URL(line, sourceUrl).toString();
    } catch {
      streamUrl = "";
    }
    if (name && validStreamUrl(streamUrl, sourceUrl)) {
      const group = cleanText(attrs["group-title"] || "", 100);
      const declaredLanguage = attrs["tvg-language"] || attrs["language"] || attrs["lang"] || "";
      channels.push({
        name,
        url: streamUrl,
        logoUrl: validPublicHttpsUrl(attrs["tvg-logo"]) ? attrs["tvg-logo"] : "",
        groupTitle: group,
        language: detectChannelLanguage(declaredLanguage, name, group),
        isSports: SPORTS_WORDS.test(name + " " + group) ? 1 : 0
      });
      if (channels.length >= MAX_PARSED_PLAYLIST_CHANNELS) break;
    }
    metadata = null;
  }
  return channels;
}


function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function channelFromPlaylistEntry(nameValue, urlValue, sourceUrl, groupTitle = "", logoValue = "") {
  let streamUrl = "";
  try {
    streamUrl = new URL(String(urlValue || "").trim(), sourceUrl).toString();
  } catch {
    return null;
  }
  const name = cleanText(nameValue || new URL(streamUrl).hostname, 120);
  if (!name || !validStreamUrl(streamUrl, sourceUrl)) return null;
  const group = cleanText(groupTitle, 100);
  return {
    name,
    url: streamUrl,
    logoUrl: validPublicHttpsUrl(logoValue) ? logoValue : "",
    groupTitle: group,
    language: detectChannelLanguage("", name, group),
    isSports: SPORTS_WORDS.test(name + " " + group) ? 1 : 0
  };
}

function parsePls(text, sourceUrl) {
  const entries = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(File|Title)(\d+)\s*=\s*(.*)$/i);
    if (!match) continue;
    const id = Number(match[2]);
    if (!Number.isInteger(id) || id < 1) continue;
    const row = entries.get(id) || {};
    row[match[1].toLowerCase()] = match[3].trim();
    entries.set(id, row);
  }
  const channels = [];
  for (const [id, row] of entries) {
    if (!row.file) continue;
    const channel = channelFromPlaylistEntry(row.title || "Canal " + id, row.file, sourceUrl);
    if (channel) channels.push(channel);
    if (channels.length >= MAX_PARSED_PLAYLIST_CHANNELS) break;
  }
  return channels;
}

function parseXspf(text, sourceUrl) {
  const channels = [];
  for (const trackMatch of text.matchAll(/<track\b[^>]*>([\s\S]*?)<\/track>/gi)) {
    const track = trackMatch[1];
    const location = track.match(/<location\b[^>]*>([\s\S]*?)<\/location>/i);
    if (!location) continue;
    const title = track.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const logo = track.match(/<(?:image|annotation)\b[^>]*>([\s\S]*?)<\/(?:image|annotation)>/i);
    const channel = channelFromPlaylistEntry(
      title ? decodeXmlEntities(title[1].trim()) : "",
      decodeXmlEntities(location[1].trim()),
      sourceUrl,
      "",
      logo ? decodeXmlEntities(logo[1].trim()) : ""
    );
    if (channel) channels.push(channel);
    if (channels.length >= MAX_PARSED_PLAYLIST_CHANNELS) break;
  }
  return channels;
}

function parseJsonPlaylist(text, sourceUrl) {
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("El archivo JSON no contiene datos válidos.");
  }
  const channels = [];
  const visited = new Set();
  const nestedKeys = ["channels", "streams", "items", "results", "data", "playlist", "entries"];
  const visit = (value, depth = 0) => {
    if (!value || depth > 6 || channels.length >= MAX_PARSED_PLAYLIST_CHANNELS) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    const pick = keys => {
      for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      }
      return "";
    };
    const url = pick(["url", "stream_url", "streamUrl", "src", "link", "file", "direct_source"]);
    if (url) {
      const channel = channelFromPlaylistEntry(
        pick(["name", "title", "channel", "tvg_name", "tvg-name"]),
        url,
        sourceUrl,
        pick(["groupTitle", "group_title", "group", "category", "genre"]),
        pick(["logoUrl", "logo", "tvg_logo", "tvg-logo"])
      );
      if (channel) channels.push(channel);
    }
    for (const key of nestedKeys) {
      if (value[key] && typeof value[key] === "object") visit(value[key], depth + 1);
    }
  };
  visit(root);
  return channels;
}

function parseCsvRecord(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((char === "," || char === ";") && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value.trim());
  return values;
}

function parseCsvPlaylist(text, sourceUrl) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#"));
  if (lines.length === 0) return [];
  const first = parseCsvRecord(lines[0]).map(value => value.toLowerCase().replace(/[\s_-]/g, ""));
  const findColumn = names => first.findIndex(value => names.includes(value));
  const nameColumn = findColumn(["name", "title", "channel", "channelname", "displayname"]);
  const urlColumn = findColumn(["url", "stream", "streamurl", "src", "link", "file", "directsource"]);
  const groupColumn = findColumn(["group", "grouptitle", "category", "genre"]);
  const logoColumn = findColumn(["logo", "logourl", "tvglogo"]);
  const hasHeader = urlColumn >= 0;
  const channels = [];
  for (let index = hasHeader ? 1 : 0; index < lines.length; index++) {
    const columns = parseCsvRecord(lines[index]);
    const url = hasHeader ? columns[urlColumn] : columns[1] || columns[0];
    const name = hasHeader
      ? (nameColumn >= 0 ? columns[nameColumn] || "" : "")
      : (columns[1] ? columns[0] : "");
    const group = groupColumn >= 0 ? columns[groupColumn] || "" : "";
    const logo = logoColumn >= 0 ? columns[logoColumn] || "" : "";
    const channel = channelFromPlaylistEntry(name, url, sourceUrl, group, logo);
    if (channel) channels.push(channel);
    if (channels.length >= MAX_PARSED_PLAYLIST_CHANNELS) break;
  }
  return channels;
}

function parseGenericXmlPlaylist(text, sourceUrl) {
  const channels = [];
  const blocks = /<(?:entry|item|channel|track|media)\b([^>]*)>([\s\S]*?)<\/(?:entry|item|channel|track|media)>/gi;
  for (const match of text.matchAll(blocks)) {
    const attributes = match[1] || "";
    const body = match[2] || "";
    const attr = name => {
      const found = attributes.match(new RegExp(name + "\\s*=\\s*(['\\\"])([\\s\\S]*?)\\1", "i"));
      return found ? decodeXmlEntities(found[2]) : "";
    };
    const tag = names => {
      for (const name of names) {
        const found = body.match(new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)<\\/" + name + ">", "i"));
        if (found) return decodeXmlEntities(found[1].trim());
      }
      return "";
    };
    const ref = body.match(/<ref\b[^>]*\bhref\s*=\s*(['"])([\s\S]*?)\1/i);
    const streamUrl = attr("url") || attr("src") || attr("href") ||
      tag(["location", "url", "stream", "stream-url", "src"]) ||
      (ref ? decodeXmlEntities(ref[2].trim()) : "");
    const name = attr("name") || attr("title") || tag(["title", "name", "display-name"]);
    const logo = attr("logo") || attr("tvg-logo") || tag(["image", "logo"]);
    const group = attr("group-title") || tag(["group-title", "category", "genre"]);
    const channel = channelFromPlaylistEntry(name, streamUrl, sourceUrl, group, logo);
    if (channel) channels.push(channel);
    if (channels.length >= MAX_PARSED_PLAYLIST_CHANNELS) break;
  }
  return channels;
}

function parsePlainTextPlaylist(text, sourceUrl) {
  const channels = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue;
    let name = "";
    let url = line;
    const pipe = line.indexOf("|");
    if (pipe > 0) {
      const left = line.slice(0, pipe).trim();
      const right = line.slice(pipe + 1).trim();
      if (/^https?:\/\//i.test(right)) {
        name = left;
        url = right;
      } else if (/^https?:\/\//i.test(left)) {
        url = left;
        name = right;
      }
    } else {
      const comma = line.indexOf(",");
      if (comma > 0 && /^https?:\/\//i.test(line.slice(comma + 1).trim())) {
        name = line.slice(0, comma).trim();
        url = line.slice(comma + 1).trim();
      }
    }
    const channel = channelFromPlaylistEntry(name, url, sourceUrl);
    if (channel) channels.push(channel);
    if (channels.length >= MAX_PARSED_PLAYLIST_CHANNELS) break;
  }
  return channels;
}

/**
 * Detecta y lee formatos habituales de listas IPTV. Las extensiones de cada
 * señal se validan aparte para no enviar archivos de listas al reproductor.
 */
export function parsePlaylist(text, sourceUrl) {
  const normalized = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!normalized) return { format: "unknown", channels: [] };
  if (normalized.startsWith("#EXTM3U")) {
    return { format: "m3u", channels: parseM3u(normalized, sourceUrl) };
  }
  if (/^\[playlist\]/i.test(normalized)) {
    return { format: "pls", channels: parsePls(normalized, sourceUrl) };
  }
  if (/^<\?xml|^<(?:playlist|asx|tv|mpd|root|channels|streams)\b/i.test(normalized)) {
    const xspf = parseXspf(normalized, sourceUrl);
    const channels = xspf.length ? xspf : parseGenericXmlPlaylist(normalized, sourceUrl);
    return { format: xspf.length ? "xspf" : "xml", channels };
  }
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    return { format: "json", channels: parseJsonPlaylist(normalized, sourceUrl) };
  }
  const firstLine = normalized.split(/\r?\n/).find(line => line.trim()) || "";
  const isCsvHeader = /(?:^|[,;])\s*(?:name|title|channel|url|stream|stream_url)(?:\s*[,;]|$)/i.test(firstLine);
  const filePath = new URL(sourceUrl).pathname.toLowerCase();
  if (isCsvHeader || filePath.endsWith(".csv")) {
    return { format: "csv", channels: parseCsvPlaylist(normalized, sourceUrl) };
  }
  return { format: "txt", channels: parsePlainTextPlaylist(normalized, sourceUrl) };
}

/** Conserva solo canales reconocidos como deportivos y limita las escrituras */
export function selectSportsChannels(channels) {
  if (!Array.isArray(channels)) return [];
  return channels
    .filter(channel => channel && channel.isSports === 1)
    .slice(0, MAX_IMPORTED_CHANNELS);
}

/** Conserva todos los canales reproducibles; la marca deportiva solo controla
 * si posteriormente pueden publicarse en la sección Canales deportivos. */
export function selectAllChannels(channels) {
  if (!Array.isArray(channels)) return [];
  return channels
    .filter(channel => channel && typeof channel.url === "string" && channel.url)
    .slice(0, MAX_IMPORTED_CHANNELS);
}

async function fetchPublicPlaylist(sourceUrl) {
  let currentUrl = sourceUrl;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!validPublicHttpsUrl(currentUrl)) {
      throw new Error("La redirección apunta a una URL no segura.");
    }
    const result = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "Accept": "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain;q=0.9",
        "User-Agent": "DeporteTotal360-ChannelCatalog/1.1"
      },
      signal: AbortSignal.timeout(25000)
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.get("Location");
      if (!location) throw new Error("La fuente redirige sin indicar la dirección de destino.");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { response: result, finalUrl: currentUrl };
  }
  throw new Error("La fuente realizó demasiadas redirecciones.");
}

async function readTextLimited(sourceResponse) {
  const declared = Number(sourceResponse.headers.get("Content-Length") || 0);
  if (declared > MAX_PLAYLIST_BYTES) throw new Error("La lista supera el límite de 25 MB.");
  if (!sourceResponse.body) return "";
  const reader = sourceResponse.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > MAX_PLAYLIST_BYTES) {
      await reader.cancel();
      throw new Error("La lista supera el límite de 25 MB.");
    }
    chunks.push(item.value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

async function googleIdentity(request, env) {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  if (!clientId) return { error: response({
    error: { code: "google_oauth_not_configured", message: "Falta configurar GOOGLE_OAUTH_CLIENT_ID en Cloudflare." }
  }, 503) };

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length > 8192) return { error: response({
    error: { code: "authentication_required", message: "Inicia sesión con Google para continuar." }
  }, 401) };

  try {
    const url = new URL("https://oauth2.googleapis.com/tokeninfo");
    url.searchParams.set("id_token", token);
    const checked = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
    if (!checked.ok) throw new Error("Token Google rechazado.");
    const claims = await checked.json();
    const expiresAt = Number(claims.exp || 0) * 1000;
    const email = String(claims.email || "").trim().toLowerCase();
    const verified = claims.email_verified === true || claims.email_verified === "true";
    const issuerOk = claims.iss === "accounts.google.com" ||
      claims.iss === "https://accounts.google.com";
    if (claims.aud !== clientId || !issuerOk || !verified ||
        !email || !claims.sub || expiresAt <= Date.now()) {
      throw new Error("Token Google inválido o vencido.");
    }
    return { sub: String(claims.sub), email };
  } catch {
    return { error: response({
      error: { code: "invalid_google_token", message: "La sesión de Google no es válida. Vuelve a iniciar sesión." }
    }, 401) };
  }
}

function isAdmin(identity, env) {
  const allowed = String(env.CHANNELS_ADMIN_EMAIL || ADMIN_EMAIL_DEFAULT).trim().toLowerCase();
  return Boolean(identity && identity.email && identity.email === allowed);
}

function catalogStub(env) {
  if (!env.CHANNEL_CATALOG) return null;
  const id = env.CHANNEL_CATALOG.idFromName("deporte-total-360-channel-catalog");
  return env.CHANNEL_CATALOG.get(id);
}

async function callCatalog(env, path, method = "GET", payload = null, headers = {}) {
  const stub = catalogStub(env);
  if (!stub) return response({
    configured: false,
    error: { code: "channel_catalog_not_configured", message: "El catálogo todavía no está desplegado." }
  }, 503);
  const requestHeaders = new Headers(headers);
  if (payload !== null) requestHeaders.set("Content-Type", "application/json");
  const internalRequest = new Request("https://channel-catalog.internal" + path, {
    method,
    headers: requestHeaders,
    body: payload === null ? undefined : JSON.stringify(payload)
  });
  try {
    return await stub.fetch(internalRequest);
  } catch (error) {
    return response({
      error: {
        code: "channel_catalog_unavailable",
        message: "El catálogo de listas no respondió correctamente. Vuelve a intentarlo.",
        detail: cleanText(error && error.message || error, 180)
      }
    }, 503);
  }
}

/**
 * Autoriza el Chat con la misma identidad Google y el registro de licencias
 * que ya protege la APK completa. Solo licencias pagadas activas y el dueño
 * pueden leer o publicar. El pase gratuito habilita la APK, pero no el Chat.
 */
export async function authorizeChatAccess(request, env) {
  const identity = await googleIdentity(request, env);
  if (identity.error) return { error: identity.error };

  if (isAdmin(identity, env)) {
    return { identity, role: "admin" };
  }

  const licenseResponse = await callCatalog(
    env,
    "/licenses/check",
    "GET",
    null,
    { "X-License-Email": identity.email }
  );
  if (!licenseResponse.ok) return { error: licenseResponse };

  let license;
  try {
    license = await licenseResponse.json();
  } catch {
    return {
      error: response({
        error: {
          code: "license_check_unavailable",
          message: "No se pudo comprobar tu licencia. Inténtalo de nuevo."
        }
      }, 503)
    };
  }

  if (license.allowed !== true ||
      license.status !== "active" ||
      license.licenseType !== "paid") {
    return {
      error: response({
        error: {
          code: "paid_license_required",
          message: "El Chat es exclusivo para compradores con una licencia de pago activa de Deporte Total 360°."
        }
      }, 403)
    };
  }

  return { identity, role: "member" };
}

export async function handleChannelRoutes(request, env, path) {
  const method = request.method.toUpperCase();

  // El ID de cliente OAuth es público por diseño. Esta ruta permite que la APK
  // compruebe que usa el mismo cliente Web configurado en el Worker.
  if (path === "/api/channels/auth-config") {
    if (method !== "GET") return response({ error: "Método no permitido" }, 405);
    const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
    if (!clientId) return response({
      configured: false,
      error: { code: "google_oauth_not_configured", message: "Falta configurar GOOGLE_OAUTH_CLIENT_ID en Cloudflare." }
    }, 503);
    return response({ configured: true, clientId }, 200);
  }
  if (path === "/api/channels" && method === "GET") {
    const incoming = new URL(request.url);
    const offset = Math.max(
      0,
      Math.min(MAX_CHANNEL_CATALOG_OFFSET, Number(incoming.searchParams.get("offset") || 0) || 0)
    );
    const limit = Math.max(
      1,
      Math.min(2000, Number(incoming.searchParams.get("limit") || 200) || 200)
    );
    const search = cleanText(incoming.searchParams.get("q") || "", 100);
    return callCatalog(
      env,
      "/catalog?scope=public&q=" + encodeURIComponent(search) + "&offset=" + offset + "&limit=" + limit
    );
  }

  // Comprobación de licencia para la aplicación completa.
  // El correo solo se acepta después de verificar el ID token con Google.
  if (path === "/api/license") {
    if (method !== "GET") return response({ error: "Método no permitido" }, 405);
    const identity = await googleIdentity(request, env);
    if (identity.error) return identity.error;
    if (isAdmin(identity, env)) {
      return response({
        allowed: true,
        licenseType: "owner",
        status: "active",
        email: identity.email
      });
    }
    return callCatalog(env, "/licenses/check", "GET", null, {
      "X-License-Email": identity.email
    });
  }

  if (path === "/api/channels/favorites") {
    if (method !== "GET" && method !== "PUT") return response({ error: "Método no permitido" }, 405);
    const identity = await googleIdentity(request, env);
    if (identity.error) return identity.error;
    if (method === "GET") {
      return callCatalog(env, "/favorites", "GET", null, {
        "X-Channel-User-Sub": identity.sub
      });
    }
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    if (!Array.isArray(payload && payload.channelIds) || payload.channelIds.length > 2000 ||
        !payload.channelIds.every(id => typeof id === "string" && id.length <= 100)) {
      return response({ error: "La lista de favoritos no es válida." }, 400);
    }
    return callCatalog(env, "/favorites", "PUT", {
      channelIds: Array.from(new Set(payload.channelIds))
    }, { "X-Channel-User-Sub": identity.sub });
  }

  if (!path.startsWith("/api/channels/admin/")) return response({ error: "Ruta de canales no encontrada." }, 404);
  const identity = await googleIdentity(request, env);
  if (identity.error) return identity.error;
  if (!isAdmin(identity, env)) {
    return response({ error: { code: "admin_required", message: "Esta cuenta no tiene permisos de administrador." } }, 403);
  }

  if (path === "/api/channels/admin/sources/bulk" && method === "POST") {
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    if (!Array.isArray(payload && payload.sources) ||
        payload.sources.length === 0 || payload.sources.length > MAX_SOURCE_COUNT) {
      return response({
        error: "Envía entre 1 y 100 listas en el lote."
      }, 400);
    }
    const sources = [];
    for (let index = 0; index < payload.sources.length; index++) {
      const item = payload.sources[index];
      const url = String(item && item.url || "").trim();
      const label = cleanText(item && item.label || "Lista IPTV", 80);
      if (!validPublicHttpsUrl(url) || !label) {
        return response({
          error: "La lista número " + (index + 1) + " necesita un nombre y una URL HTTPS pública válida."
        }, 400);
      }
      sources.push({ url, label });
    }
    return callCatalog(env, "/sources/bulk", "POST", { sources });
  }

  // Gestión de licencias: solo la cuenta administradora puede conceder,
  // consultar o revocar accesos de pago y pases gratuitos.
  if (path === "/api/channels/admin/licenses" && method === "GET") {
    return callCatalog(env, "/licenses", "GET");
  }

  if (path === "/api/channels/admin/licenses" && method === "POST") {
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    const email = String(payload && payload.email || "").trim().toLowerCase();
    const licenseType = String(payload && payload.licenseType || "").trim().toLowerCase();
    const note = cleanText(payload && payload.note || "", 180);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return response({ error: "Introduce un correo electrónico válido." }, 400);
    }
    if (!["paid", "free"].includes(licenseType)) {
      return response({ error: "La licencia debe ser paid o free." }, 400);
    }
    return callCatalog(env, "/licenses", "POST", {
      email, licenseType, note, grantedBy: identity.email
    });
  }

  if (path === "/api/channels/admin/licenses/revoke" && method === "PATCH") {
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    const email = String(payload && payload.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return response({ error: "Introduce un correo electrónico válido." }, 400);
    }
    return callCatalog(env, "/licenses/revoke", "PATCH", {
      email, revokedBy: identity.email
    });
  }

  if (path === "/api/channels/admin/catalog" && method === "GET") {
    const incoming = new URL(request.url);
    const search = cleanText(incoming.searchParams.get("q") || "", 100);
    const cursor = Math.max(0, Math.min(MAX_CHANNEL_CATALOG_OFFSET, Number(incoming.searchParams.get("offset") || 0) || 0));
    return callCatalog(env, "/catalog?scope=admin&q=" + encodeURIComponent(search) + "&offset=" + cursor);
  }

  if (path === "/api/channels/admin/sources" && method === "GET") {
    return callCatalog(env, "/sources");
  }

  if (path === "/api/channels/admin/sources" && method === "POST") {
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    const url = String(payload && payload.url || "").trim();
    const label = cleanText(payload && payload.label || "Lista IPTV", 80);
    if (!validPublicHttpsUrl(url)) {
      return response({ error: "Usa una URL HTTPS pública, sin credenciales ni direcciones locales." }, 400);
    }
    return callCatalog(env, "/sources", "POST", { url, label });
  }

  const sourceUpdate = path.match(/^\/api\/channels\/admin\/sources\/([a-zA-Z0-9_-]{1,100})$/);
  if (sourceUpdate && method === "PUT") {
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    const url = String(payload && payload.url || "").trim();
    const label = cleanText(payload && payload.label || "Lista IPTV", 80);
    if (!validPublicHttpsUrl(url)) {
      return response({ error: "Usa una URL HTTPS pública, sin credenciales ni direcciones locales." }, 400);
    }
    return callCatalog(env, "/sources/" + encodeURIComponent(sourceUpdate[1]), "PUT", {
      url, label
    });
  }

  const sourceRetry = path.match(/^\/api\/channels\/admin\/sources\/([a-zA-Z0-9_-]{1,100})\/retry$/);
  if (sourceRetry && method === "POST") {
    return callCatalog(env, "/sources/" + encodeURIComponent(sourceRetry[1]) + "/retry", "POST", {});
  }

  const sourceRemoval = path.match(/^\/api\/channels\/admin\/sources\/([a-zA-Z0-9_-]{1,100})$/);
  if (sourceRemoval && method === "DELETE") {
    return callCatalog(env, "/sources/" + encodeURIComponent(sourceRemoval[1]), "DELETE");
  }

  if (path === "/api/channels/admin/refresh" && method === "POST") {
    return callCatalog(env, "/refresh", "POST", {});
  }

  const visibility = path.match(/^\/api\/channels\/admin\/channels\/([a-zA-Z0-9_-]{1,100})\/visibility$/);
  if (visibility && method === "PATCH") {
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    if (typeof (payload && payload.visible) !== "boolean") {
      return response({ error: "El estado de visibilidad debe ser verdadero o falso." }, 400);
    }
    return callCatalog(env, "/visibility/" + encodeURIComponent(visibility[1]), "PATCH", {
      visible: payload.visible
    });
  }

  const classification = path.match(/^\/api\/channels\/admin\/channels\/([a-zA-Z0-9_-]{1,100})\/classification$/);
  if (classification && method === "PATCH") {
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    if (typeof (payload && payload.isSports) !== "boolean") {
      return response({ error: "La clasificación deportiva debe ser verdadera o falsa." }, 400);
    }
    return callCatalog(env, "/classification/" + encodeURIComponent(classification[1]), "PATCH", {
      isSports: payload.isSports
    });
  }

  const channelRemoval = path.match(/^\/api\/channels\/admin\/channels\/([a-zA-Z0-9_-]{1,100})$/);
  if (channelRemoval && method === "DELETE") {
    return callCatalog(env, "/channels/" + encodeURIComponent(channelRemoval[1]), "DELETE");
  }

  const languagePrefix = "/api/channels/admin/channels/";
  if (path.startsWith(languagePrefix) && path.endsWith("/language") && method === "PATCH") {
    const channelId = path.slice(languagePrefix.length, -"/language".length);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(channelId)) {
      return response({ error: "Identificador de canal no válido." }, 400);
    }
    let payload;
    try { payload = await request.json(); } catch {
      return response({ error: "El cuerpo debe ser JSON válido." }, 400);
    }
    const value = String(payload && payload.language || "").trim().toLowerCase();
    if (!["es", "en", "unknown"].includes(value)) {
      return response({ error: "El idioma debe ser es, en o unknown." }, 400);
    }
    return callCatalog(env, "/language/" + encodeURIComponent(channelId), "PATCH", {
      language: value
    });
  }

  return response({ error: "Ruta de administración no encontrada." }, 404);
}

export class ChannelCatalogRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS channels (" +
      "id TEXT PRIMARY KEY, identifier TEXT NOT NULL UNIQUE, name TEXT NOT NULL, " +
      "stream_url TEXT NOT NULL UNIQUE, logo_url TEXT NOT NULL DEFAULT '', " +
      "group_title TEXT NOT NULL DEFAULT '', is_sports INTEGER NOT NULL DEFAULT 0, " +
      "language TEXT NOT NULL DEFAULT 'unknown', visible INTEGER NOT NULL DEFAULT 0, " +
      "source_url TEXT NOT NULL, updated_at TEXT NOT NULL)"
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS blocked_channels (" +
      "stream_url TEXT PRIMARY KEY, channel_id TEXT NOT NULL, " +
      "identifier TEXT NOT NULL, name TEXT NOT NULL, blocked_at TEXT NOT NULL)"
    );
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_blocked_channels_id ON blocked_channels(channel_id)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS channel_catalog_schema_migrations (" +
      "version INTEGER PRIMARY KEY)"
    );
    const languageMigration = Array.from(this.sql.exec(
      "SELECT version FROM channel_catalog_schema_migrations WHERE version = 1"
    ));
    if (languageMigration.length === 0) {
      try {
        this.sql.exec("ALTER TABLE channels ADD COLUMN language TEXT NOT NULL DEFAULT 'unknown'");
      } catch (error) {
        const message = String(error && error.message || error).toLowerCase();
        if (!message.includes("duplicate column name")) throw error;
      }
      recordCatalogMigration(this.sql, 1);
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_channels_sports_visible ON channels(is_sports, visible, name)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS sources (" +
      "id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, label TEXT NOT NULL, " +
      "status TEXT NOT NULL DEFAULT 'queued', format TEXT NOT NULL DEFAULT '', last_imported_at TEXT, " +
      "last_error TEXT NOT NULL DEFAULT '', imported_count INTEGER NOT NULL DEFAULT 0, " +
      "import_offset INTEGER NOT NULL DEFAULT 0, next_refresh_at INTEGER NOT NULL DEFAULT 0)"
    );
    const sourceFormatMigration = Array.from(this.sql.exec(
      "SELECT version FROM channel_catalog_schema_migrations WHERE version = 4"
    ));
    if (sourceFormatMigration.length === 0) {
      try {
        this.sql.exec("ALTER TABLE sources ADD COLUMN format TEXT NOT NULL DEFAULT ''");
      } catch (error) {
        const message = String(error && error.message || error).toLowerCase();
        if (!message.includes("duplicate column name")) throw error;
      }
      recordCatalogMigration(this.sql, 4);
    }
    const sourceImportMigration = Array.from(this.sql.exec(
      "SELECT version FROM channel_catalog_schema_migrations WHERE version = 5"
    ));
    if (sourceImportMigration.length === 0) {
      try {
        this.sql.exec("ALTER TABLE sources ADD COLUMN import_offset INTEGER NOT NULL DEFAULT 0");
      } catch (error) {
        const message = String(error && error.message || error).toLowerCase();
        if (!message.includes("duplicate column name")) throw error;
      }
      recordCatalogMigration(this.sql, 5);
    }
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS favorites (" +
      "user_sub TEXT NOT NULL, channel_id TEXT NOT NULL, created_at TEXT NOT NULL, " +
      "PRIMARY KEY(user_sub, channel_id))"
    );

    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS user_licenses (" +
      "email TEXT PRIMARY KEY, license_type TEXT NOT NULL CHECK(license_type IN ('paid','free')), " +
      "status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')), " +
      "note TEXT NOT NULL DEFAULT '', granted_at TEXT NOT NULL, granted_by TEXT NOT NULL, " +
      "updated_at TEXT NOT NULL)"
    );
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_user_licenses_status ON user_licenses(status, license_type)");

    // Migración idempotente: registra una lista deportiva pública por defecto
    // una sola vez y la coloca primero en la cola de importación.
    // Las listas públicas genéricas ya no se importan automáticamente.
    // El administrador conserva sus fuentes guardadas y decide cuáles usar.
    // Desactivar IDs predeterminados antiguos de forma idempotente, sin borrar
    // las fuentes ni los canales que ya se hayan importado.
    try {
      const retiredDefaults = Array.from(this.sql.exec(
        "SELECT version FROM channel_catalog_schema_migrations WHERE version = 6"
      ));
      if (retiredDefaults.length === 0) {
        this.sql.exec(
          "UPDATE sources SET status = 'imported', import_offset = 0, next_refresh_at = ?, last_error = '' " +
          "WHERE id IN (" + BUILT_IN_SOURCE_SQL + ") AND " +
          "(status != 'imported' OR import_offset != 0 OR next_refresh_at < ?)",
          BUILT_IN_SOURCE_RETIRE_AT,
          ...BUILT_IN_SOURCE_IDS,
          BUILT_IN_SOURCE_RETIRE_AT
        );
        recordCatalogMigration(this.sql, 6);
      }
    } catch (error) {
      if (!isDurableObjectWriteQuotaError(error)) throw error;
      console.error("Cuota agotada; se pospone la desactivación de fuentes predeterminadas.");
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return response({}, 204);

    if (path === "/catalog" && request.method === "GET") {
      const admin = url.searchParams.get("scope") === "admin";
      const search = cleanText(url.searchParams.get("q") || "", 100);
      const offset = Math.max(0, Math.min(MAX_CHANNEL_CATALOG_OFFSET, Number(url.searchParams.get("offset") || 0) || 0));
      const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 200) || 200));
      const where = admin ? "1=1" : "visible = 1 AND is_sports = 1";
      const filter = search ? " AND (lower(name) LIKE ? OR lower(group_title) LIKE ?)" : "";
      const params = search ? ["%" + search.toLowerCase() + "%", "%" + search.toLowerCase() + "%"] : [];
      const countRows = Array.from(this.sql.exec(
        "SELECT COUNT(*) AS total FROM channels WHERE " + where + filter,
        ...params
      ));
      const total = Number(countRows[0] && countRows[0].total || 0);
      const rows = Array.from(this.sql.exec(
        "SELECT id, identifier, name, stream_url, logo_url, group_title, is_sports, language, visible " +
        "FROM channels WHERE " + where + filter +
        " ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?",
        ...params, limit, offset
      ));
      return response({
        configured: true,
        total,
        offset,
        hasMore: offset + rows.length < total,
        channels: rows.map(row => ({
          id: row.id,
          identifier: row.identifier,
          name: row.name,
          url: row.stream_url,
          logoUrl: row.logo_url,
          groupTitle: row.group_title,
          isSports: Boolean(row.is_sports),
          language: ["es", "en"].includes(row.language) ? row.language : "unknown",
          visible: Boolean(row.visible)
        }))
      });
    }

    if (path === "/licenses/check" && request.method === "GET") {
      const email = String(request.headers.get("X-License-Email") || "")
        .trim().toLowerCase();
      if (!email) return response({ error: "Correo verificado no disponible." }, 400);
      const row = Array.from(this.sql.exec(
        "SELECT email, license_type, status, granted_at FROM user_licenses WHERE email = ?",
        email
      ))[0];
      if (!row) {
        return response({
          allowed: false, status: "not_found", licenseType: null, email
        });
      }
      return response({
        allowed: row.status === "active",
        status: row.status,
        licenseType: row.license_type,
        email: row.email,
        grantedAt: row.granted_at
      });
    }

    if (path === "/licenses" && request.method === "GET") {
      const rows = Array.from(this.sql.exec(
        "SELECT email, license_type, status, note, granted_at, granted_by, updated_at " +
        "FROM user_licenses ORDER BY updated_at DESC, email COLLATE NOCASE LIMIT 500"
      ));
      return response({ licenses: rows, count: rows.length });
    }

    if (path === "/licenses" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      const email = String(payload && payload.email || "").trim().toLowerCase();
      const licenseType = String(payload && payload.licenseType || "").trim().toLowerCase();
      const note = cleanText(payload && payload.note || "", 180);
      const grantedBy = cleanText(payload && payload.grantedBy || "", 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !["paid", "free"].includes(licenseType) || !grantedBy) {
        return response({ error: "Los datos de la licencia no son válidos." }, 400);
      }
      const now = new Date().toISOString();
      this.sql.exec(
        "INSERT INTO user_licenses (email, license_type, status, note, granted_at, granted_by, updated_at) " +
        "VALUES (?, ?, 'active', ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET " +
        "license_type = excluded.license_type, status = 'active', note = excluded.note, " +
        "granted_at = excluded.granted_at, granted_by = excluded.granted_by, updated_at = excluded.updated_at",
        email, licenseType, note, now, grantedBy, now
      );
      return response({
        saved: true, email, licenseType, status: "active", grantedAt: now
      });
    }

    if (path === "/licenses/revoke" && request.method === "PATCH") {
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      const email = String(payload && payload.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return response({ error: "Correo electrónico no válido." }, 400);
      }
      const now = new Date().toISOString();
      const existing = Array.from(this.sql.exec(
        "SELECT email FROM user_licenses WHERE email = ?", email
      ))[0];
      if (!existing) return response({ error: "No hay una licencia registrada para ese correo." }, 404);
      this.sql.exec(
        "UPDATE user_licenses SET status = 'revoked', updated_at = ? WHERE email = ?",
        now, email
      );
      return response({ revoked: true, email, status: "revoked" });
    }

    if (path === "/sources" && request.method === "GET") {
      const rows = Array.from(this.sql.exec(
        "SELECT id, url, label, status, format, last_imported_at, last_error, imported_count, import_offset FROM sources ORDER BY label COLLATE NOCASE"
      ));
      return response({
        sources: rows,
        count: rows.length,
        limit: MAX_SOURCE_COUNT,
        remaining: Math.max(0, MAX_SOURCE_COUNT - rows.length)
      });
    }

    if (path === "/sources" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      const sourceUrl = String(payload && payload.url || "").trim();
      const label = cleanText(payload && payload.label || "Lista IPTV", 80);
      if (!validPublicHttpsUrl(sourceUrl)) return response({ error: "URL HTTPS pública no válida." }, 400);
      const existing = Array.from(this.sql.exec("SELECT id FROM sources WHERE url = ?", sourceUrl))[0];
      const totalRows = Array.from(this.sql.exec("SELECT COUNT(*) AS total FROM sources"))[0];
      const total = Number(totalRows && totalRows.total || 0);
      if (!existing && total >= MAX_SOURCE_COUNT) {
        return response({
          error: "El catálogo ya tiene sus 100 listas. Quita una fuente antes de añadir otra.",
          count: total,
          limit: MAX_SOURCE_COUNT
        }, 409);
      }
      const id = existing ? existing.id : crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO sources (id, url, label, status, imported_count, import_offset, next_refresh_at) VALUES (?, ?, ?, 'queued', 0, 0, 0) " +
        "ON CONFLICT(url) DO UPDATE SET label = excluded.label, status = 'queued', last_error = '', imported_count = 0, import_offset = 0, next_refresh_at = 0",
        id, sourceUrl, label
      );
      await this.state.storage.setAlarm(Date.now() + 1000);
      return response({ saved: true, status: "queued", message: "Lista añadida. Se importará en segundo plano.", count: existing ? total : total + 1, limit: MAX_SOURCE_COUNT }, 202);
    }

    if (path === "/sources/bulk" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      const batch = Array.isArray(payload && payload.sources) ? payload.sources : [];
      if (batch.length === 0 || batch.length > MAX_SOURCE_COUNT) {
        return response({ error: "El lote debe contener entre 1 y 100 listas." }, 400);
      }
      let total = Number(Array.from(this.sql.exec(
        "SELECT COUNT(*) AS total FROM sources"
      ))[0]?.total || 0);
      let added = 0;
      let duplicates = 0;
      let skipped = 0;
      for (const item of batch) {
        const sourceUrl = String(item && item.url || "").trim();
        const label = cleanText(item && item.label || "Lista IPTV", 80);
        if (!validPublicHttpsUrl(sourceUrl) || !label) {
          skipped += 1;
          continue;
        }
        const existing = Array.from(this.sql.exec(
          "SELECT id FROM sources WHERE url = ?", sourceUrl
        ))[0];
        if (existing) {
          duplicates += 1;
          continue;
        }
        if (total >= MAX_SOURCE_COUNT) {
          skipped += 1;
          continue;
        }
        this.sql.exec(
          "INSERT INTO sources (id, url, label, status, imported_count, import_offset, next_refresh_at) VALUES (?, ?, ?, 'queued', 0, 0, 0)",
          crypto.randomUUID(), sourceUrl, label
        );
        total += 1;
        added += 1;
      }
      if (added > 0) await this.state.storage.setAlarm(Date.now() + 1000);
      return response({
        added,
        duplicates,
        skipped,
        total,
        limit: MAX_SOURCE_COUNT,
        complete: total === MAX_SOURCE_COUNT
      }, 202);
    }

    const sourceUpdate = path.match(/^\/sources\/([a-zA-Z0-9_-]{1,100})$/);
    if (sourceUpdate && request.method === "PUT") {
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      const sourceUrl = String(payload && payload.url || "").trim();
      const label = cleanText(payload && payload.label || "Lista IPTV", 80);
      if (!validPublicHttpsUrl(sourceUrl)) {
        return response({ error: "URL HTTPS pública no válida." }, 400);
      }
      const existing = Array.from(this.sql.exec(
        "SELECT id FROM sources WHERE id = ?", sourceUpdate[1]
      ))[0];
      if (!existing) return response({ error: "La lista ya no está registrada." }, 404);
      const duplicate = Array.from(this.sql.exec(
        "SELECT id FROM sources WHERE url = ? AND id != ?",
        sourceUrl, sourceUpdate[1]
      ))[0];
      if (duplicate) {
        return response({ error: "Otra lista ya utiliza esa URL." }, 409);
      }
      this.sql.exec(
        "UPDATE sources SET url = ?, label = ?, status = 'queued', format = '', last_error = '', imported_count = 0, next_refresh_at = 0 WHERE id = ?",
        sourceUrl, label, sourceUpdate[1]
      );
      await this.state.storage.setAlarm(Date.now() + 1000);
      return response({ updated: true, id: sourceUpdate[1], status: "queued" }, 200);
    }

    const sourceRetry = path.match(/^\/sources\/([a-zA-Z0-9_-]{1,100})\/retry$/);
    if (sourceRetry && request.method === "POST") {
      const existing = Array.from(this.sql.exec(
        "SELECT id FROM sources WHERE id = ?", sourceRetry[1]
      ))[0];
      if (!existing) return response({ error: "La lista ya no está registrada." }, 404);
      this.sql.exec(
        "UPDATE sources SET status = 'queued', format = '', last_error = '', imported_count = 0, next_refresh_at = 0 WHERE id = ?",
        sourceRetry[1]
      );
      await this.state.storage.setAlarm(Date.now() + 1000);
      return response({ queued: true, id: sourceRetry[1] }, 202);
    }

    const sourceRemoval = path.match(/^\/sources\/([a-zA-Z0-9_-]{1,100})$/);
    if (sourceRemoval && request.method === "DELETE") {
      const existing = Array.from(this.sql.exec(
        "SELECT id FROM sources WHERE id = ?", sourceRemoval[1]
      ))[0];
      if (!existing) return response({ error: "La lista ya no está registrada." }, 404);
      this.sql.exec("DELETE FROM sources WHERE id = ?", sourceRemoval[1]);
      // Los canales ya importados se conservan en el catálogo; solo se retira
      // la fuente para detener sus futuras actualizaciones automáticas.
      return response({
        removed: true,
        id: sourceRemoval[1],
        preservedChannels: true
      });
    }

    const channelRemoval = path.match(/^\/channels\/([a-zA-Z0-9_-]{1,100})$/);
    if (channelRemoval && request.method === "DELETE") {
      const channel = Array.from(this.sql.exec(
        "SELECT id, identifier, name, stream_url FROM channels WHERE id = ?",
        channelRemoval[1]
      ))[0];
      if (!channel) return response({ error: "Canal no encontrado." }, 404);
      const blockedAt = new Date().toISOString();
      this.sql.exec(
        "INSERT OR IGNORE INTO blocked_channels (stream_url, channel_id, identifier, name, blocked_at) VALUES (?, ?, ?, ?, ?)",
        channel.stream_url, channel.id, channel.identifier, channel.name, blockedAt
      );
      this.sql.exec("DELETE FROM favorites WHERE channel_id = ?", channel.id);
      this.sql.exec("DELETE FROM channels WHERE id = ?", channel.id);
      return response({
        deleted: true,
        id: channel.id,
        identifier: channel.identifier,
        blockedFromReimport: true
      });
    }

    if (path === "/scheduled-refresh" && request.method === "POST") {
      const dueRows = Array.from(this.sql.exec(
        "SELECT COUNT(*) AS total FROM sources WHERE next_refresh_at <= ? " +
        "AND id NOT IN (" + BUILT_IN_SOURCE_SQL + ")",
        Date.now(), ...BUILT_IN_SOURCE_IDS
      ));
      const due = Number(dueRows[0] && dueRows[0].total || 0);
      if (due > 0) await this.state.storage.setAlarm(Date.now() + 1000);
      return response({
        queued: due > 0,
        due,
        message: due > 0
          ? "Se programaron solo las fuentes cuyo intervalo de actualización venció."
          : "No hay fuentes pendientes de actualización."
      }, due > 0 ? 202 : 200);
    }

    if (path === "/refresh" && request.method === "POST") {
      this.sql.exec(
        "UPDATE sources SET status = 'queued', imported_count = 0, import_offset = 0, next_refresh_at = 0 " +
        "WHERE status != 'importing' AND id NOT IN (" + BUILT_IN_SOURCE_SQL + ")",
        ...BUILT_IN_SOURCE_IDS
      );
      await this.state.storage.setAlarm(Date.now() + 1000);
      return response({
        queued: true,
        total: Number(Array.from(this.sql.exec(
          "SELECT COUNT(*) AS total FROM sources"
        ))[0]?.total || 0),
        message: "Las fuentes se actualizarán en segundo plano por lotes."
      }, 202);
    }

    const visibility = path.match(/^\/visibility\/([a-zA-Z0-9_-]{1,100})$/);
    if (visibility && request.method === "PATCH") {
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      const visible = payload && payload.visible === true;
      const existing = Array.from(this.sql.exec(
        "SELECT id, is_sports FROM channels WHERE id = ?",
        visibility[1]
      ))[0];
      if (!existing) return response({ error: "Canal no encontrado." }, 404);
      if (visible && !existing.is_sports) {
        return response({ error: "Solo los canales deportivos se pueden publicar en Canales deportivos." }, 422);
      }
      this.sql.exec("UPDATE channels SET visible = ?, updated_at = ? WHERE id = ?",
        visible ? 1 : 0, new Date().toISOString(), visibility[1]);
      return response({ updated: true, visible });
    }

    const classification = path.match(/^\/classification\/([a-zA-Z0-9_-]{1,100})$/);
    if (classification && request.method === "PATCH") {
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      if (typeof (payload && payload.isSports) !== "boolean") {
        return response({ error: "La clasificación deportiva debe ser verdadera o falsa." }, 400);
      }
      const existing = Array.from(this.sql.exec(
        "SELECT id FROM channels WHERE id = ?",
        classification[1]
      ))[0];
      if (!existing) return response({ error: "Canal no encontrado." }, 404);
      const isSports = payload.isSports;
      this.sql.exec(
        "UPDATE channels SET is_sports = ?, visible = CASE WHEN ? = 0 THEN 0 ELSE visible END, updated_at = ? WHERE id = ?",
        isSports ? 1 : 0, isSports ? 1 : 0, new Date().toISOString(), classification[1]
      );
      const row = Array.from(this.sql.exec(
        "SELECT visible FROM channels WHERE id = ?",
        classification[1]
      ))[0];
      return response({
        updated: true,
        isSports,
        visible: Boolean(row && row.visible)
      });
    }

    const languagePrefix = "/language/";
    if (path.startsWith(languagePrefix) && request.method === "PATCH") {
      const channelId = path.slice(languagePrefix.length);
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(channelId)) {
        return response({ error: "Identificador de canal no válido." }, 400);
      }
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      const value = String(payload && payload.language || "").trim().toLowerCase();
      if (!["es", "en", "unknown"].includes(value)) {
        return response({ error: "Idioma no válido." }, 400);
      }
      const existing = Array.from(this.sql.exec(
        "SELECT id FROM channels WHERE id = ?",
        channelId
      ))[0];
      if (!existing) return response({ error: "Canal no encontrado." }, 404);
      this.sql.exec(
        "UPDATE channels SET language = ?, updated_at = ? WHERE id = ?",
        value, new Date().toISOString(), channelId
      );
      return response({ updated: true, language: value });
    }

    if (path === "/favorites" && request.method === "GET") {
      const userSub = request.headers.get("X-Channel-User-Sub") || "";
      if (!userSub) return response({ error: "Identidad no disponible." }, 401);
      const rows = Array.from(this.sql.exec(
        "SELECT f.channel_id FROM favorites f INNER JOIN channels c ON c.id = f.channel_id " +
        "WHERE f.user_sub = ? AND c.visible = 1 AND c.is_sports = 1",
        userSub
      ));
      return response({ channelIds: rows.map(row => row.channel_id) });
    }

    if (path === "/favorites" && request.method === "PUT") {
      const userSub = request.headers.get("X-Channel-User-Sub") || "";
      if (!userSub) return response({ error: "Identidad no disponible." }, 401);
      let payload;
      try { payload = await request.json(); } catch {
        return response({ error: "JSON inválido." }, 400);
      }
      const ids = Array.isArray(payload && payload.channelIds)
        ? Array.from(new Set(payload.channelIds.filter(id => typeof id === "string").slice(0, 2000)))
        : [];
      this.sql.exec("DELETE FROM favorites WHERE user_sub = ?", userSub);
      for (const channelId of ids) {
        this.sql.exec(
          "INSERT OR IGNORE INTO favorites (user_sub, channel_id, created_at) " +
          "SELECT ?, id, ? FROM channels WHERE id = ? AND visible = 1 AND is_sports = 1",
          userSub, new Date().toISOString(), channelId
        );
      }
      return response({ saved: true, count: ids.length });
    }

    return response({ error: "Ruta interna no encontrada." }, 404);
  }

  async alarm() {
    try {
      await this.refreshBatch();
    } catch (error) {
      const message = String(error && error.message || error);
      if (message.includes("Exceeded allowed rows written in Durable Objects free tier")) {
        // La cuota gratuita se restablece a las 00:00 UTC. No crear otro
        // setAlarm (también consumiría una fila escrita); el cron volverá a
        // poner la cola en marcha en el siguiente ciclo.
        console.error("Cuota diaria de filas escritas agotada; se reintentará en el siguiente cron.");
        return;
      }
      await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
    }
  }

  async refreshBatch() {
    const due = Array.from(this.sql.exec(
      "SELECT id, url, label, status, imported_count, import_offset FROM sources WHERE next_refresh_at <= ? " +
      "AND id NOT IN (" + BUILT_IN_SOURCE_SQL + ") " +
      "ORDER BY next_refresh_at ASC, label COLLATE NOCASE LIMIT ?",
      Date.now(), ...BUILT_IN_SOURCE_IDS, REFRESH_BATCH_SIZE
    ));
    let imported = 0;
    const results = [];
    for (const source of due) {
      try {
        const isContinuing = source.status === "importing";
        const offset = isContinuing ? Number(source.import_offset || 0) : 0;
        const importedBefore = isContinuing ? Number(source.imported_count || 0) : 0;
        this.sql.exec(
          "UPDATE sources SET status = 'importing', last_error = '', import_offset = ?, imported_count = ? WHERE id = ?",
          offset, importedBefore, source.id
        );
        if (!validPublicHttpsUrl(source.url)) throw new Error("La fuente no es una URL HTTPS pública.");
        const fetched = await fetchPublicPlaylist(source.url);
        const sourceResponse = fetched.response;
        if (!sourceResponse.ok) throw new Error("La fuente respondió HTTP " + sourceResponse.status + ".");
        const contentType = (sourceResponse.headers.get("Content-Type") || "").toLowerCase();
        if (contentType.includes("text/html")) throw new Error("La URL abre HTML, no una lista multimedia directa.");
        const text = await readTextLimited(sourceResponse);
        const parsedPlaylist = parsePlaylist(text, fetched.finalUrl);
        // Deporte Total 360 mantiene únicamente señales deportivas en su
        // catálogo compartido. Las fuentes originales se conservan para que
        // el administrador pueda volver a importarlas o editarlas.
        const parsed = selectSportsChannels(parsedPlaylist.channels);
        if (parsed.length === 0) {
          throw new Error("La lista " + parsedPlaylist.format.toUpperCase() +
            " no contiene canales marcados o reconocidos como deportivos.");
        }
        // La fuente pudo retirarse mientras se descargaba. En ese caso no se
        // añaden canales nuevos después de que el administrador la haya quitado.
        const stillRegistered = Array.from(this.sql.exec(
          "SELECT id FROM sources WHERE id = ?", source.id
        ))[0];
        if (!stillRegistered) continue;

        const timestamp = new Date().toISOString();
        const batch = parsed.slice(offset, offset + IMPORT_CHANNEL_BATCH_SIZE);
        let sourceImported = 0;
        for (const channel of batch) {
          const blocked = Array.from(this.sql.exec(
            "SELECT stream_url FROM blocked_channels WHERE stream_url = ?",
            channel.url
          ))[0];
          if (blocked) continue;
          const identifier = await identifierFor(channel.name, channel.url);
          this.sql.exec(
            "INSERT INTO channels (id, identifier, name, stream_url, logo_url, group_title, is_sports, language, visible, source_url, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(stream_url) DO UPDATE SET " +
            "name = excluded.name, identifier = excluded.identifier, logo_url = excluded.logo_url, " +
            "group_title = excluded.group_title, is_sports = excluded.is_sports, " +
            "language = CASE WHEN excluded.language != 'unknown' THEN excluded.language ELSE channels.language END, " +
            "updated_at = excluded.updated_at WHERE " +
            "channels.name != excluded.name OR channels.identifier != excluded.identifier OR " +
            "channels.logo_url != excluded.logo_url OR channels.group_title != excluded.group_title OR " +
            "channels.is_sports != excluded.is_sports OR " +
            "(excluded.language != 'unknown' AND channels.language != excluded.language)",
            identifier, identifier, channel.name, channel.url, channel.logoUrl,
            channel.groupTitle, channel.isSports ? 1 : 0, channel.language, source.url, timestamp
          );
          sourceImported += 1;
        }

        const nextOffset = offset + batch.length;
        const totalImported = importedBefore + sourceImported;
        imported += sourceImported;
        if (nextOffset < parsed.length) {
          this.sql.exec(
            "UPDATE sources SET status = 'importing', format = ?, last_error = '', imported_count = ?, import_offset = ?, next_refresh_at = ? WHERE id = ?",
            parsedPlaylist.format, totalImported, nextOffset, Date.now() + 2000, source.id
          );
          results.push({
            label: source.label,
            imported: totalImported,
            totalChannels: parsed.length,
            status: "importing"
          });
        } else {
          this.sql.exec(
            "UPDATE sources SET status = 'imported', format = ?, last_imported_at = ?, last_error = '', imported_count = ?, import_offset = 0, next_refresh_at = ? WHERE id = ?",
            parsedPlaylist.format, timestamp, totalImported, Date.now() + REFRESH_INTERVAL_MS, source.id
          );
          results.push({
            label: source.label,
            imported: totalImported,
            totalChannels: parsed.length,
            format: parsedPlaylist.format,
            status: "ok"
          });
        }
      } catch (error) {
        const message = cleanText(error && error.message || "Error al importar la fuente.", 240);
        if (message.includes("Exceeded allowed rows written in Durable Objects free tier")) {
          console.error("Cuota diaria de filas escritas agotada durante la importación.");
          results.push({ label: source.label, imported: 0, status: "quota_exhausted" });
          return {
            processed: results.length,
            queued: due.length,
            imported,
            results,
            quotaExhausted: true
          };
        }
        this.sql.exec(
          "UPDATE sources SET status = 'error', last_error = ?, import_offset = 0, next_refresh_at = ? WHERE id = ?",
          message, Date.now() + 30 * 60 * 1000, source.id
        );
        results.push({ label: source.label, imported: 0, status: "error", error: message });
      }
    }
    const nextRows = Array.from(this.sql.exec(
      "SELECT MIN(next_refresh_at) AS next_at FROM sources"
    ));
    const nextAt = Number(nextRows[0] && nextRows[0].next_at || 0);
    const pendingRows = Array.from(this.sql.exec(
      "SELECT COUNT(*) AS total FROM sources WHERE next_refresh_at <= ?",
      Date.now()
    ));
    const hasPending = Number(pendingRows[0] && pendingRows[0].total || 0) > 0;
    if (hasPending) {
      await this.state.storage.setAlarm(Date.now() + 2000);
    } else if (nextAt > 0) {
      await this.state.storage.setAlarm(nextAt);
    }
    return { processed: due.length, queued: due.length, imported, results };
  }
}
