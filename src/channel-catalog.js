const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
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
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
const MAX_IMPORTED_CHANNELS = 12000;
const REFRESH_BATCH_SIZE = 3;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
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
    return url.protocol === "https:" && !url.username && !url.password &&
      (path.endsWith(".m3u8") || path.endsWith(".mp4") || path.endsWith(".ts"));
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
      if (channels.length >= MAX_IMPORTED_CHANNELS) break;
    }
    metadata = null;
  }
  return channels;
}

async function readTextLimited(sourceResponse) {
  const declared = Number(sourceResponse.headers.get("Content-Length") || 0);
  if (declared > MAX_PLAYLIST_BYTES) throw new Error("La lista supera el límite de 4 MB.");
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
      throw new Error("La lista supera el límite de 4 MB.");
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
  return stub.fetch(internalRequest);
}

export async function handleChannelRoutes(request, env, path) {
  const method = request.method.toUpperCase();

  if (path === "/api/channels" && method === "GET") {
    const incoming = new URL(request.url);
    const offset = Math.max(
      0,
      Math.min(100000, Number(incoming.searchParams.get("offset") || 0) || 0)
    );
    return callCatalog(env, "/catalog?scope=public&offset=" + offset);
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

  if (path === "/api/channels/admin/catalog" && method === "GET") {
    const incoming = new URL(request.url);
    const search = cleanText(incoming.searchParams.get("q") || "", 100);
    const cursor = Math.max(0, Math.min(100000, Number(incoming.searchParams.get("offset") || 0) || 0));
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
      this.sql.exec(
        "INSERT OR IGNORE INTO channel_catalog_schema_migrations (version) VALUES (1)"
      );
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_channels_sports_visible ON channels(is_sports, visible, name)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS sources (" +
      "id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, label TEXT NOT NULL, " +
      "status TEXT NOT NULL DEFAULT 'queued', last_imported_at TEXT, " +
      "last_error TEXT NOT NULL DEFAULT '', imported_count INTEGER NOT NULL DEFAULT 0, " +
      "next_refresh_at INTEGER NOT NULL DEFAULT 0)"
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS favorites (" +
      "user_sub TEXT NOT NULL, channel_id TEXT NOT NULL, created_at TEXT NOT NULL, " +
      "PRIMARY KEY(user_sub, channel_id))"
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return response({}, 204);

    if (path === "/catalog" && request.method === "GET") {
      const admin = url.searchParams.get("scope") === "admin";
      const search = cleanText(url.searchParams.get("q") || "", 100);
      const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get("offset") || 0) || 0));
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
        " ORDER BY name COLLATE NOCASE LIMIT 200 OFFSET ?",
        ...params, offset
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

    if (path === "/sources" && request.method === "GET") {
      const rows = Array.from(this.sql.exec(
        "SELECT id, url, label, status, last_imported_at, last_error, imported_count FROM sources ORDER BY label COLLATE NOCASE"
      ));
      return response({ sources: rows, count: rows.length });
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
      const id = existing ? existing.id : crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO sources (id, url, label, status, next_refresh_at) VALUES (?, ?, ?, 'queued', 0) " +
        "ON CONFLICT(url) DO UPDATE SET label = excluded.label, status = 'queued', last_error = '', next_refresh_at = 0",
        id, sourceUrl, label
      );
      await this.state.storage.setAlarm(Date.now() + 1000);
      return response({ saved: true, status: "queued", message: "Lista añadida. Se importará en segundo plano." }, 202);
    }

    if (path === "/refresh" && request.method === "POST") {
      await this.state.storage.setAlarm(Date.now() + 1000);
      return response({
        queued: true,
        message: "La actualización se ejecutará en segundo plano por lotes."
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
    } catch {
      await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
    }
  }

  async refreshBatch() {
    const due = Array.from(this.sql.exec(
      "SELECT id, url, label FROM sources WHERE next_refresh_at <= ? " +
      "ORDER BY next_refresh_at ASC, label COLLATE NOCASE LIMIT ?",
      Date.now(), REFRESH_BATCH_SIZE
    ));
    let imported = 0;
    const results = [];
    for (const source of due) {
      try {
        if (!validPublicHttpsUrl(source.url)) throw new Error("La fuente no es una URL HTTPS pública.");
        const sourceResponse = await fetch(source.url, {
          method: "GET",
          redirect: "manual",
          headers: {
            "Accept": "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain;q=0.9",
            "User-Agent": "DeporteTotal360-ChannelCatalog/1.0"
          },
          signal: AbortSignal.timeout(15000)
        });
        if (sourceResponse.status >= 300 && sourceResponse.status < 400) {
          throw new Error("La fuente redirige; registra la URL HTTPS final de la lista.");
        }
        if (!sourceResponse.ok) throw new Error("La fuente respondió HTTP " + sourceResponse.status + ".");
        const contentType = (sourceResponse.headers.get("Content-Type") || "").toLowerCase();
        if (contentType.includes("text/html")) throw new Error("La URL abre HTML, no una lista M3U directa.");
        const text = await readTextLimited(sourceResponse);
        if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("La respuesta no es una playlist M3U válida.");
        const parsed = parseM3u(text, source.url);
        const timestamp = new Date().toISOString();
        for (const channel of parsed) {
          const identifier = await identifierFor(channel.name, channel.url);
          this.sql.exec(
            "INSERT INTO channels (id, identifier, name, stream_url, logo_url, group_title, is_sports, language, visible, source_url, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(stream_url) DO UPDATE SET " +
            "name = excluded.name, identifier = excluded.identifier, logo_url = excluded.logo_url, " +
            "group_title = excluded.group_title, is_sports = excluded.is_sports, " +
            "language = CASE WHEN excluded.language != 'unknown' THEN excluded.language ELSE channels.language END, " +
            "source_url = excluded.source_url, updated_at = excluded.updated_at",
            identifier, identifier, channel.name, channel.url, channel.logoUrl,
            channel.groupTitle, channel.isSports, channel.language, source.url, timestamp
          );
        }
        imported += parsed.length;
        this.sql.exec(
          "UPDATE sources SET status = 'imported', last_imported_at = ?, last_error = '', imported_count = ?, next_refresh_at = ? WHERE id = ?",
          timestamp, parsed.length, Date.now() + REFRESH_INTERVAL_MS, source.id
        );
        results.push({ label: source.label, imported: parsed.length, status: "ok" });
      } catch (error) {
        const message = cleanText(error && error.message || "Error al importar la fuente.", 240);
        this.sql.exec(
          "UPDATE sources SET status = 'error', last_error = ?, next_refresh_at = ? WHERE id = ?",
          message, Date.now() + 30 * 60 * 1000, source.id
        );
        results.push({ label: source.label, imported: 0, status: "error", error: message });
      }
    }
    const nextRows = Array.from(this.sql.exec(
      "SELECT MIN(next_refresh_at) AS next_at FROM sources"
    ));
    const nextAt = Number(nextRows[0] && nextRows[0].next_at || 0);
    if (nextAt > 0) {
      const alarmAt = nextAt <= Date.now() ? Date.now() + 60 * 1000 : nextAt;
      await this.state.storage.setAlarm(alarmAt);
    }
    return { processed: due.length, queued: due.length, imported, results };
  }
}
