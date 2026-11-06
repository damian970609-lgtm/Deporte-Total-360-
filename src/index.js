import { ChannelCatalogRoom, handleChannelRoutes } from "./channel-catalog.js";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};

const DEFAULT_TTL = 180;
const MAX_QUERY_VALUE = 120;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, ...extra }
  });
}

function empty(status = 204, extra = {}) {
  return new Response(null, {
    status,
    headers: { ...HEADERS, ...extra }
  });
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function providerErrors(errors) {
  if (errors == null) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors).length > 0;
  return Boolean(errors);
}

const SPORTS = {
  football: {
    label: "Fútbol",
    base: "https://v3.football.api-sports.io",
    resources: {
      fixtures: {
        endpoint: "fixtures",
        ttl: 180,
        params: [
          "id", "ids", "live", "date", "from", "to", "league", "season",
          "team", "last", "next", "round", "status", "venue", "timezone"
        ],
        selectors: ["id", "ids", "live", "date", "from", "league", "team", "next", "last"]
      },
      live: {
        endpoint: "fixtures",
        ttl: 45,
        fixed: { live: "all" },
        params: ["timezone"]
      },
      leagues: {
        endpoint: "leagues",
        ttl: 3600,
        params: ["id", "name", "country", "code", "season", "team", "type", "current", "search"]
      },
      standings: {
        endpoint: "standings",
        ttl: 1800,
        params: ["league", "season", "team"],
        required: ["league", "season"]
      }
    }
  },

  basketball: {
    label: "Baloncesto",
    base: "https://v1.basketball.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team", "timezone"],
        selectors: ["id", "date", "league", "team"]
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "country", "country_id", "season", "search"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team", "stage", "group"],
        required: ["league", "season"],
        ttl: 900
      }
    }
  },

  nba: {
    label: "NBA",
    base: "https://v2.nba.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team"],
        selectors: ["id", "date", "league", "team"]
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "season"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team"],
        required: ["league", "season"],
        ttl: 900
      },
      teams: {
        endpoint: "teams",
        params: ["id", "name", "search", "code", "league", "season"]
      },
      players: {
        endpoint: "players",
        params: ["id", "name", "search", "team", "league", "season"]
      }
    }
  },

  baseball: {
    label: "Béisbol",
    base: "https://v1.baseball.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team", "timezone"],
        selectors: ["id", "date", "league", "team"]
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "country", "season", "search"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team", "stage", "group"],
        required: ["league", "season"],
        ttl: 900
      }
    }
  },

  "american-football": {
    label: "Fútbol americano",
    base: "https://v1.american-football.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team", "live", "h2h", "timezone"],
        selectors: ["id", "date", "league", "team", "live", "h2h"]
      },
      live: {
        endpoint: "games",
        fixed: { live: "all" },
        params: ["timezone"],
        ttl: 45
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "country", "season", "search"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team"],
        required: ["league", "season"],
        ttl: 900
      }
    }
  },

  "formula-1": {
    label: "Fórmula 1",
    base: "https://v1.formula-1.api-sports.io",
    resources: {
      races: {
        endpoint: "races",
        params: ["id", "season", "competition", "circuit", "driver", "team", "type"],
        selectors: ["id", "season", "competition"]
      },
      "driver-rankings": {
        endpoint: "rankings/drivers",
        params: ["season", "race", "team", "driver"],
        selectors: ["season"]
      },
      "team-rankings": {
        endpoint: "rankings/teams",
        params: ["season", "race", "team"],
        selectors: ["season"]
      },
      drivers: {
        endpoint: "drivers",
        params: ["id", "name", "search", "team", "season"]
      },
      teams: {
        endpoint: "teams",
        params: ["id", "name", "search", "season"]
      },
      circuits: {
        endpoint: "circuits",
        params: ["id", "name", "search", "country"]
      }
    }
  },

  hockey: {
    label: "Hockey sobre hielo",
    base: "https://v1.hockey.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team", "timezone"],
        selectors: ["id", "date", "league", "team"]
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "country", "season", "search"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team", "group"],
        required: ["league", "season"],
        ttl: 900
      }
    }
  },

  handball: {
    label: "Balonmano",
    base: "https://v1.handball.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team", "timezone"],
        selectors: ["id", "date", "league", "team"]
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "country", "season", "search"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team", "group"],
        required: ["league", "season"],
        ttl: 900
      }
    }
  },

  rugby: {
    label: "Rugby",
    base: "https://v1.rugby.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team", "timezone"],
        selectors: ["id", "date", "league", "team"]
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "country", "season", "search"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team", "group"],
        required: ["league", "season"],
        ttl: 900
      }
    }
  },

  volleyball: {
    label: "Voleibol",
    base: "https://v1.volleyball.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team", "timezone"],
        selectors: ["id", "date", "league", "team"]
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "country", "season", "search"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team", "group"],
        required: ["league", "season"],
        ttl: 900
      }
    }
  },

  mma: {
    label: "Artes marciales mixtas",
    base: "https://v1.mma.api-sports.io",
    resources: {
      fights: {
        endpoint: "fights",
        params: ["id", "date", "season", "fighter", "category", "timezone"],
        selectors: ["id", "date", "season", "fighter"],
        ttl: 60
      },
      fighters: {
        endpoint: "fighters",
        params: ["id", "team", "name", "category", "search"]
      },
      categories: {
        endpoint: "categories",
        params: ["search"]
      },
      results: {
        endpoint: "results",
        params: ["id", "ids", "date"],
        selectors: ["id", "ids", "date"],
        ttl: 60
      }
    }
  },

  afl: {
    label: "Fútbol australiano",
    base: "https://v1.afl.api-sports.io",
    resources: {
      games: {
        endpoint: "games",
        params: ["id", "date", "league", "season", "team", "timezone"],
        selectors: ["id", "date", "league", "team"]
      },
      leagues: {
        endpoint: "leagues",
        params: ["id", "name", "country", "season", "search"]
      },
      standings: {
        endpoint: "standings",
        params: ["league", "season", "team"],
        required: ["league", "season"],
        ttl: 900
      }
    }
  }
};

// Conserva las rutas originales de fútbol para no romper la app actual.
const FOOTBALL_LEGACY = {
  "/api/fixtures": SPORTS.football.resources.fixtures,
  "/api/live": SPORTS.football.resources.live,
  "/api/leagues": SPORTS.football.resources.leagues,
  "/api/standings": SPORTS.football.resources.standings
};

function validateParameter(key, value) {
  if (!value || value.length > MAX_QUERY_VALUE) {
    return "Parámetro vacío o demasiado largo";
  }

  if (/[\u0000-\u001F\u007F]/.test(value)) {
    return "El parámetro contiene caracteres no válidos";
  }

  if (["date", "from", "to"].includes(key) && !validDate(value)) {
    return `Fecha inválida: ${key}`;
  }

  if ([
    "id", "league", "team", "venue", "next", "last", "race",
    "driver", "fighter", "competition", "circuit", "country_id",
    "bookmaker", "bet"
  ].includes(key)) {
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1
    ) {
      return `Valor numérico inválido: ${key}`;
    }

    if (["next", "last"].includes(key) && Number(value) > 99) {
      return `${key} no puede superar 99`;
    }
  }

  if (key === "season" && !/^\d{4}(?:-\d{4})?$/.test(value)) {
    return "La temporada debe tener formato YYYY o YYYY-YYYY";
  }

  if (key === "ids") {
    const ids = value.split("-");
    if (
      ids.length > 20 ||
      !ids.every(id =>
        /^\d+$/.test(id) &&
        Number(id) > 0 &&
        Number.isSafeInteger(Number(id))
      )
    ) {
      return "ids debe contener hasta 20 identificadores numéricos";
    }
  }

  if (key === "live" && value !== "all") {
    const ids = value.split("-");
    if (!ids.every(id => /^\d+$/.test(id) && Number(id) > 0)) {
      return "live debe ser all o una lista de identificadores";
    }
  }

  if (key === "current" && !["true", "false"].includes(value.toLowerCase())) {
    return "current debe ser true o false";
  }

  if (key === "type" && !["league", "cup", "race"].includes(value.toLowerCase())) {
    return "type no tiene un valor permitido";
  }

  if (key === "status" && !/^[A-Z0-9-]+$/i.test(value)) {
    return "status contiene caracteres no válidos";
  }

  if (key === "timezone" && !validTimezone(value)) {
    return "Zona horaria no válida";
  }

  return null;
}

function validateRouteQuery(resource, params, config) {
  if (resource === "fixtures" && config === SPORTS.football.resources.fixtures) {
    const hasFrom = params.has("from");
    const hasTo = params.has("to");

    if (hasFrom !== hasTo) {
      return "Debes indicar from y to juntos";
    }

    if (hasFrom && params.get("from") > params.get("to")) {
      return "La fecha from no puede ser posterior a to";
    }

    if (params.has("date") && (hasFrom || hasTo)) {
      return "Usa date o el rango from/to, no ambos";
    }
  }

  if (config.required) {
    const missing = config.required.filter(key => !params.has(key));
    if (missing.length) {
      return `Faltan parámetros obligatorios: ${missing.join(" y ")}`;
    }
  }

  if (config.selectors && !config.selectors.some(key => params.has(key))) {
    return "Debes indicar al menos un filtro válido para esta consulta";
  }

  if (
    resource === "fighters" &&
    !["id", "team", "name", "category", "search"].some(key => params.has(key))
  ) {
    return "Para buscar luchadores indica id, team, name, category o search";
  }

  return null;
}

function providerRateLimitError(errors) {
  const message = typeof errors === "string"
    ? errors
    : JSON.stringify(errors ?? "");
  return /too many requests|rate.?limit|requests? per minute/i.test(message);
}

function rateLimitResponse(details = null) {
  return json({
    error: "API-Sports alcanzó el límite de solicitudes por minuto. Espera al menos 60 segundos antes de volver a intentarlo.",
    retry_after_seconds: 60,
    ...(details == null ? {} : { details })
  }, 429, { "Retry-After": "60", "Cache-Control": "no-store" });
}

async function cacheMatch(cache, key) {
  if (!cache || typeof cache.match !== "function") return null;

  try {
    return await cache.match(key);
  } catch {
    return null;
  }
}

async function cachePut(cache, key, response) {
  if (!cache || typeof cache.put !== "function") return;

  try {
    await cache.put(key, response);
  } catch {
    // La API sigue funcionando aunque falle la caché.
  }
}

// Public catalogue reads are identical for every user. Cache them briefly at
// the edge so repeated app opens and pagination do not consume DO read work.
async function cachedPublicChannelCatalog(request, env, path) {
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const cache = globalThis.caches?.default;
  const cached = await cacheMatch(cache, cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Data-Source", "cache");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers
    });
  }

  const live = await handleChannelRoutes(request, env, path);
  if (!live.ok) return live;

  const headers = new Headers(live.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "public, max-age=60");
  headers.set("X-Data-Source", "durable-object");
  const cacheable = new Response(await live.arrayBuffer(), {
    status: live.status,
    statusText: live.statusText,
    headers
  });
  await cachePut(cache, cacheKey, cacheable.clone());
  return cacheable;
}

function buildUpstreamParams(incoming, config) {
  const params = new URLSearchParams(config.fixed || {});
  const seen = new Set();

  for (const [key, value] of incoming.searchParams.entries()) {
    if (!config.params.includes(key)) {
      return { error: `Parámetro no permitido: ${key}` };
    }

    if (seen.has(key) || Object.hasOwn(config.fixed || {}, key)) {
      return { error: `Parámetro repetido o reservado: ${key}` };
    }

    seen.add(key);

    const error = validateParameter(key, value);
    if (error) return { error };

    params.set(key, value);
  }

  return { params };
}

async function proxyToProvider(request, env, base, config, resource) {
  const incoming = new URL(request.url);
  const built = buildUpstreamParams(incoming, config);

  if (built.error) {
    return json({ error: built.error }, 400);
  }

  const queryError = validateRouteQuery(resource, built.params, config);
  if (queryError) {
    return json({ error: queryError }, 400);
  }

  const cacheKey = new Request(incoming.toString(), { method: "GET" });
  const cache = globalThis.caches?.default;
  const cached = await cacheMatch(cache, cacheKey);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("X-Data-Source", "cache");
    return response;
  }

  const endpoint = String(config.endpoint || "").replace(/^\/+|\/+$/g, "");
  const upstreamUrl =
    `${base}/${endpoint}${built.params.size ? `?${built.params.toString()}` : ""}`;

  // Admite el secreto actual y el nombre alternativo.
  const apiKey = env.APISPORTS_KEY || env.APIFOOTBALL_KEY;

  if (!apiKey) {
    return json({
      error: "Servidor sin clave APISPORTS_KEY o APIFOOTBALL_KEY configurada"
    }, 503);
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "x-apisports-key": apiKey
      }
    });

    if (upstream.status === 204) {
      return empty(204, {
        "Cache-Control": `public, max-age=${config.ttl || DEFAULT_TTL}`,
        "X-Data-Source": "api"
      });
    }

    const body = await upstream.text();

    if (upstream.status === 429) {
      return rateLimitResponse({
        provider_status: upstream.status,
        message: "El proveedor rechazó temporalmente la solicitud por límite de consultas."
      });
    }

    if (!upstream.ok) {
      return json({
        error: "Error del proveedor deportivo",
        provider_status: upstream.status
      }, 502);
    }

    let parsed;

    try {
      parsed = JSON.parse(body);
    } catch {
      return json({
        error: "Respuesta inválida del proveedor deportivo"
      }, 502);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({
        error: "Formato inválido del proveedor deportivo"
      }, 502);
    }

    if (providerErrors(parsed.errors)) {
      if (providerRateLimitError(parsed.errors)) {
        return rateLimitResponse(parsed.errors);
      }
      return json({
        error: "El proveedor devolvió errores",
        details: parsed.errors
      }, 502);
    }

    const response = json(parsed, 200, {
      "Cache-Control": `public, max-age=${config.ttl || DEFAULT_TTL}`,
      "X-Data-Source": "api"
    });

    await cachePut(cache, cacheKey, response.clone());
    return response;

  } catch {
    return json({
      error: "No se pudo conectar con el proveedor deportivo"
    }, 502);
  }
}

function sportsCatalog() {
  return Object.entries(SPORTS).map(([id, sport]) => ({
    id,
    name: sport.label,
    routes: Object.keys(sport.resources).map(
      resource => `/api/${id}/${resource}`
    )
  }));
}

function cleanChatField(value) {
  // Quita caracteres de control sin alterar tildes, emojis ni alfabetos Unicode.
  return Array.from(value, (character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim();
}

const CHAT_MAX_MESSAGES = 120;
const CHAT_MAX_NAME_LENGTH = 24;
const CHAT_MAX_TEXT_LENGTH = 500;
const CHAT_RATE_LIMIT_MS = 2000;

/**
 * Sala pública compartida. El historial se conserva en SQLite del Durable Object.
 * Los nombres son alias públicos, no identidades autenticadas.
 */
export class PublicChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.writeQueue = Promise.resolve();
    this.lastMessageAt = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/messages") {
      return json({ error: "Ruta del chat no encontrada" }, 404);
    }
    if (request.method === "OPTIONS") return empty(204);
    if (request.method === "GET") {
      const messages = await this.state.storage.get("messages") || [];
      return json({ messages }, 200, { "Cache-Control": "no-store" });
    }
    if (request.method !== "POST") {
      return json({ error: "Método no permitido" }, 405, { Allow: "GET, POST, OPTIONS" });
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 8192) {
      return json({ error: "El mensaje enviado es demasiado grande" }, 413);
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return json({ error: "El chat solo acepta JSON" }, 415);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "El mensaje no contiene JSON válido" }, 400);
    }

    const name = typeof payload?.name === "string"
      ? Array.from(cleanChatField(payload.name)).slice(0, CHAT_MAX_NAME_LENGTH).join('')
      : "";
    const text = typeof payload?.text === "string"
      ? cleanChatField(payload.text)
      : "";

    if (name.length < 2) {
      return json({ error: "Escribe un nombre de al menos 2 caracteres" }, 400);
    }
    if (!text || Array.from(text).length > CHAT_MAX_TEXT_LENGTH) {
      return json({ error: "El mensaje debe tener entre 1 y 500 caracteres" }, 400);
    }

    // La IP se usa solo en memoria para limitar spam; no se guarda en mensajes.
    const clientKey = request.headers.get("CF-Connecting-IP") || "anonymous";
    const now = Date.now();
    const previous = this.lastMessageAt.get(clientKey) || 0;
    if (now - previous < CHAT_RATE_LIMIT_MS) {
      return json(
        { error: "Espera un momento antes de enviar otro mensaje" },
        429,
        { "Retry-After": "2" }
      );
    }
    this.lastMessageAt.set(clientKey, now);

    const write = this.writeQueue.then(async () => {
      const messages = await this.state.storage.get("messages") || [];
      const message = {
        id: crypto.randomUUID(),
        name,
        text,
        createdAt: new Date(now).toISOString()
      };
      messages.push(message);
      if (messages.length > CHAT_MAX_MESSAGES) {
        messages.splice(0, messages.length - CHAT_MAX_MESSAGES);
      }
      await this.state.storage.put("messages", messages);
      return message;
    });
    this.writeQueue = write.then(() => undefined, () => undefined);

    try {
      const message = await write;
      return json({ message }, 201, { "Cache-Control": "no-store" });
    } catch {
      return json({ error: "No se pudo guardar el mensaje. Inténtalo de nuevo." }, 500);
    }
  }
}


function isAllowedLiveMediaUrl(value) {
  try {
    const uri = new URL(String(value || "").trim());
    const path = uri.pathname.toLowerCase();
    return uri.protocol === "https:" &&
      !uri.username &&
      !uri.password &&
      (path.endsWith(".m3u8") || path.endsWith(".mp4"));
  } catch {
    return false;
  }
}

// Catálogo de señales directas suministradas por el propietario del servicio.
// No busca, rastrea ni extrae enlaces de reproductores o páginas de terceros.
function localCatalogDate(value, timeZone) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return validDate(text) ? text : null;
  }
  const instant = new Date(text);
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(instant)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return null;
  }
}

function liveSourcesResponse(request, env) {
  const rawCatalog = env.LIVE_STREAM_CATALOG_JSON;
  if (!rawCatalog) {
    return json(
      { configured: false, count: 0, sources: [] },
      200,
      { "Cache-Control": "public, max-age=15" }
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(rawCatalog);
  } catch {
    return json({ error: "El catálogo de señales no contiene JSON válido." }, 503);
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.sources) ? parsed.sources : null);
  if (!entries) {
    return json({ error: "El catálogo debe ser una lista JSON de señales." }, 503);
  }

  const params = new URL(request.url).searchParams;
  const sportFilter = (params.get("sport") || "").trim().toLowerCase();
  const from = params.get("from") || params.get("date") || "";
  const to = params.get("to") || from;
  const timeZone = params.get("timezone") || "America/Guyana";

  if (!validTimezone(timeZone)) {
    return json({ error: "La zona horaria del catálogo no es válida." }, 400);
  }
  if ((from && !validDate(from)) || (to && !validDate(to))) {
    return json({ error: "El rango de fechas del catálogo no es válido." }, 400);
  }
  if (sportFilter && !SPORTS[sportFilter]) {
    return json({
      error: "Deporte no disponible para el catálogo.",
      available: Object.keys(SPORTS)
    }, 400);
  }

  const sources = [];
  for (const entry of entries.slice(0, 500)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const sport = String(entry.sport || entry.sportId || "").trim().toLowerCase();
    const eventId = String(entry.eventId || entry.fixtureId || "").trim();
    const name = String(entry.name || entry.title || "").trim();
    const url = String(entry.url || "").trim();
    const startsAt = String(entry.startsAt || entry.date || "").trim();
    const eventDate = localCatalogDate(startsAt, timeZone);

    if (!SPORTS[sport] || !eventId || eventId.length > 120 ||
        !name || name.length > 100 || !isAllowedLiveMediaUrl(url) ||
        !eventDate) {
      continue;
    }
    if (sportFilter && sport !== sportFilter) continue;
    if (from && eventDate < from) continue;
    if (to && eventDate > to) continue;

    sources.push({
      id: String(entry.id || `${sport}:${eventId}:${name}`).slice(0, 180),
      eventId,
      eventTitle: String(entry.eventTitle || entry.fixtureTitle || "").slice(0, 180),
      sport,
      name,
      url,
      startsAt
    });
  }

  return json(
    { configured: true, count: sources.length, sources },
    200,
    { "Cache-Control": "public, max-age=20" }
  );
}


// Proxy seguro de SportsAPI.app: la clave solo vive en Cloudflare Secrets.
const SPORTSAPI_BASE = "https://api.sportsapi.app/v2";
const SPORTSAPI_SLUGS = new Set(["football","basketball","baseball","ice-hockey","volleyball","mma","futsal","cycling","motorsport","handball"]);
const FAVORITE_SPORTS = [
  {
    id: "football",
    name: "Fútbol",
    competitions: [
      "LaLiga EA SPORTS", "Premier League", "Serie A", "Bundesliga", "Ligue 1",
      "Major League Soccer", "Brasileirão Série A", "FIFA World Cup",
      "UEFA European Championship", "Copa América", "FIFA World Cup Qualifiers",
      "International Friendlies", "Africa Cup of Nations", "AFC Asian Cup",
      "CONCACAF Gold Cup", "UEFA Nations League", "CONCACAF Nations League",
      "OFC Men's Nations Cup", "UEFA Champions League", "FIFA Club World Cup",
      "Copa Libertadores", "Copa Sudamericana", "FA Cup", "Copa del Rey",
      "Coppa Italia", "DFB-Pokal", "Liga F Moeve", "Women's Super League",
      "Serie A Women", "Google Pixel Frauen-Bundesliga", "Première Ligue", "NWSL",
      "Campeonato Brasileiro Feminino Série A1", "FIFA Women's World Cup",
      "UEFA Women's EURO", "Copa América Femenina",
      "UEFA Women's European Qualifiers", "AFC Women's Asian Cup",
      "Women's Africa Cup of Nations", "CONCACAF W Championship",
      "OFC Women's Nations Cup", "International Women's Friendlies",
      "CONCACAF W Gold Cup", "UEFA Women's Nations League"
    ]
  },
  {
    id: "basketball",
    name: "Baloncesto",
    competitions: ["NBA", "WNBA"]
  },
  {
    id: "baseball",
    name: "Béisbol",
    competitions: [
      "Major League Baseball", "World Baseball Classic", "WBSC Premier12",
      "WBSC Women's Baseball World Cup"
    ]
  },
  {
    id: "ice-hockey",
    name: "Hockey sobre hielo",
    competitions: [
      "NHL", "PWHL", "IIHF Ice Hockey World Championship",
      "IIHF Women's World Championship", "Olympic Ice Hockey Tournament",
      "Olympic Women's Ice Hockey Tournament"
    ]
  },
  {
    id: "volleyball",
    name: "Voleibol",
    competitions: [
      "Volleyball Nations League", "FIVB Volleyball World Championship",
      "FIVB Men's Club World Championship", "Olympic Volleyball Tournament",
      "Women's Volleyball Nations League", "FIVB Women's Volleyball World Championship",
      "FIVB Women's Club World Championship", "Women's Olympic Volleyball Tournament"
    ]
  },
  {
    id: "mma",
    name: "MMA",
    competitions: ["UFC"]
  },
  {
    id: "futsal",
    name: "Fútbol sala",
    competitions: [
      "FIFA Futsal World Cup", "UEFA Futsal EURO", "Copa América de Futsal",
      "AFC Futsal Asian Cup", "FIFA Futsal Women's World Cup",
      "AFC Women's Futsal Asian Cup", "Copa América de Futsal Femenina"
    ]
  },
  {
    id: "cycling",
    name: "Ciclismo",
    competitions: [
      "Vuelta a España", "Giro d'Italia", "Tour de France",
      "La Vuelta Femenina", "Giro d'Italia Women",
      "Tour de France Femmes avec Zwift"
    ]
  },
  {
    id: "motorsport",
    name: "Deportes de motor",
    competitions: [
      "Formula 1", "MotoGP", "F1 Academy",
      "FIM Women's Circuit Racing World Championship (WorldWCR)"
    ]
  },
  {
    id: "handball",
    name: "Balonmano",
    competitions: [
      "IHF Men's World Championship", "EHF EURO Men", "Olympic Handball Tournament",
      "IHF Women's World Championship", "EHF EURO Women",
      "Women's Olympic Handball Tournament"
    ]
  }
];

const SPORTSAPI_COMPETITION_ALIASES = {
  football: {
    "LaLiga EA SPORTS": ["LaLiga", "La Liga", "Primera Division"],
    "Major League Soccer": ["MLS"],
    "Brasileirão Série A": ["Campeonato Brasileiro Série A", "Brasileirao", "Serie A Brazil"],
    "UEFA European Championship": ["UEFA Euro", "Euro"],
    "FIFA World Cup Qualifiers": [
      "World Cup Qualification Europe", "World Cup Qualification Africa",
      "World Cup Qualification Asia", "World Cup Qualification Oceania",
      "World Cup Qualification South America", "World Cup Qualification CONCACAF",
      "World Cup Qualification Intercontinental Play-offs",
      "UEFA World Cup Qualifiers", "CONMEBOL World Cup Qualifiers",
      "CONCACAF World Cup Qualifiers", "CAF World Cup Qualifiers",
      "AFC World Cup Qualifiers", "OFC World Cup Qualifiers",
      "FIFA World Cup Qualification"
    ],
    "Africa Cup of Nations": ["AFCON"],
    "OFC Men's Nations Cup": ["OFC Nations Cup"],
    "Liga F Moeve": ["Liga F", "Primera Division Women"],
    "Women's Super League": ["FA Women's Super League", "Women's Super League England"],
    "NWSL": ["National Women's Soccer League"],
    "Campeonato Brasileiro Feminino Série A1": ["Brasileirao Feminino Serie A1"],
    "FIFA Women's World Cup": ["Women's World Cup"],
    "UEFA Women's EURO": ["Women's European Championship", "UEFA Women's European Championship"],
    "Women's Africa Cup of Nations": ["WAFCON", "Africa Cup of Nations Women"],
    "CONCACAF W Championship": ["CONCACAF Women's Championship", "Concacaf Women's Championship"],
    "CONCACAF W Gold Cup": ["W Gold Cup", "Concacaf W Gold Cup"]
  },
  baseball: {
    "Major League Baseball": ["MLB"],
    "WBSC Premier12": ["Premier12", "Premier 12"]
  },
  "ice-hockey": {
    "Olympic Ice Hockey Tournament": ["Men's Olympic Ice Hockey Tournament", "Olympic Men's Ice Hockey"],
    "Olympic Women's Ice Hockey Tournament": ["Women's Olympic Ice Hockey", "Olympic Women's Hockey"]
  },
  volleyball: {
    "Volleyball Nations League": ["Men's Volleyball Nations League", "VNL Men"],
    "FIVB Volleyball World Championship": ["FIVB Men's Volleyball World Championship", "Men's Volleyball World Championship"],
    "Women's Volleyball Nations League": ["FIVB Women's Volleyball Nations League", "VNL Women"],
    "FIVB Women's Volleyball World Championship": ["Women's Volleyball World Championship"],
    "Olympic Volleyball Tournament": ["Men's Olympic Volleyball Tournament", "Men's Volleyball Olympic Tournament"],
    "Women's Olympic Volleyball Tournament": ["Olympic Women's Volleyball Tournament"]
  },
  futsal: {
    "Copa América de Futsal": ["Copa America Futsal"],
    "Copa América de Futsal Femenina": ["Women's Copa America Futsal", "Copa America Femenina de Futsal"]
  },
  cycling: {
    "Vuelta a España": ["La Vuelta", "La Vuelta a España", "Vuelta a Espana"],
    "Giro d'Italia": ["Giro d’Italia", "Giro d Italia"],
    "La Vuelta Femenina": ["La Vuelta Femenina by Carrefour.es"],
    "Giro d'Italia Women": ["Giro d’Italia Women", "Giro Women"],
    "Tour de France Femmes avec Zwift": ["Tour de France Femmes", "Tour de France Femmes avec Zwift"]
  },
  motorsport: {
    "Formula 1": ["Formula One", "FIA Formula One World Championship"],
    "FIM Women's Circuit Racing World Championship (WorldWCR)": [
      "WorldWCR", "FIM Women's Circuit Racing World Championship"
    ]
  },
  handball: {
    "IHF Men's World Championship": ["Men's World Championship", "World Championship Men"],
    "IHF Women's World Championship": ["Women's World Championship", "World Championship Women"],
    "Olympic Handball Tournament": ["Men's Olympic Handball Tournament", "Olympic Men's Handball"],
    "Women's Olympic Handball Tournament": ["Olympic Women's Handball Tournament", "Olympic Women's Handball"]
  }
};

function normalizeFavoriteCompetition(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchFavoriteCompetition(sportId, providerName) {
  const sport = FAVORITE_SPORTS.find(item => item.id === sportId);
  if (!sport) return null;
  const target = normalizeFavoriteCompetition(providerName);
  if (!target) return null;

  for (const canonical of sport.competitions) {
    const aliases = SPORTSAPI_COMPETITION_ALIASES[sportId]?.[canonical] || [];
    if ([canonical, ...aliases].some(
      name => normalizeFavoriteCompetition(name) === target
    )) {
      return canonical;
    }
  }
  return null;
}

function filterSportsApiFavoriteData(payload, request, route) {
  const params = new URL(request.url).searchParams;
  const sportId = params.get("sport");
  if (!params.has("date") || !sportId || !Array.isArray(payload?.data)) {
    return payload;
  }

  const isFixtureList = route.upstream === "fixtures" &&
    sportId !== "cycling" && sportId !== "motorsport";
  const isRaceList = route.upstream === "races" &&
    (sportId === "cycling" || sportId === "motorsport");
  if (!isFixtureList && !isRaceList) return payload;

  const filtered = [];
  for (const item of payload.data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const providerCompetition = isFixtureList
      ? item.league?.name
      : sportId === "cycling" ? item.name : item.series?.name;
    const canonical = matchFavoriteCompetition(sportId, providerCompetition);
    if (!canonical) continue;

    if (isFixtureList && item.league && typeof item.league === "object") {
      filtered.push({ ...item, league: { ...item.league, name: canonical } });
    } else if (isRaceList && sportId === "cycling") {
      filtered.push({ ...item, name: canonical });
    } else if (isRaceList && item.series && typeof item.series === "object") {
      filtered.push({ ...item, series: { ...item.series, name: canonical } });
    } else {
      filtered.push(item);
    }
  }

  return {
    ...payload,
    data: filtered,
    meta: {
      ...(payload.meta && typeof payload.meta === "object" ? payload.meta : {}),
      count: filtered.length,
      favoriteCompetitionFilter: true
    }
  };
}

function sportsApiFavoritesResponse() {
  return json({sports:FAVORITE_SPORTS.map(s=>({...s,kind:s.id==="cycling"||s.id==="motorsport"?"races":"fixtures"}))},200,{"Cache-Control":"public, max-age=3600"});
}
function sportsApiRoute(path) {
  const suffix=path.replace(/^\/api\/sportsapi\/?/,"");
  if(!suffix||suffix.includes("..")||suffix.includes("\\")||suffix.includes("//")) return null;
  const roots={sports:[],livescores:["sport"],fixtures:["date","sport","league","page"],races:["date","sport","series","page"],categories:["sport"],leagues:["category","sport","country"],series:["category","sport"]};
  if(Object.hasOwn(roots,suffix)) return {upstream:suffix,allowed:roots[suffix]};
  let m=suffix.match(/^fixtures\/(\d+)(?:\/(statistics|events|lineups|h2h|form|streaks|best-players))?$/);
  if(m) return {upstream:"fixtures/"+m[1]+(m[2]?"/"+m[2]:""),allowed:[]};
  m=suffix.match(/^races\/(\d+)(?:\/(results))?$/);
  if(m) return {upstream:"races/"+m[1]+(m[2]?"/"+m[2]:""),allowed:m[2]?["session"]:[]};
  m=suffix.match(/^leagues\/(\d+)\/(standings|seasons|top-players|top-teams|fixtures|rounds)$/);
  if(m) return {upstream:"leagues/"+m[1]+"/"+m[2],allowed:["season","type","round","page","limit","statistic"]};
  m=suffix.match(/^series\/(\d+)\/(standings|seasons|races)$/);
  if(m) return {upstream:"series/"+m[1]+"/"+m[2],allowed:["season","type","page"]};
  return null;
}
function validateSportsApiQuery(params,allowed) {
  for(const [key,value] of params.entries()) if(!allowed.includes(key)||!value||value.length>120||/[\u0000-\u001F\u007F]/.test(value)) return "Parámetro no permitido o inválido: "+key;
  const date=params.get("date"); if(date&&!validDate(date)) return "Fecha inválida: YYYY-MM-DD.";
  const sport=params.get("sport"); if(sport&&!SPORTSAPI_SLUGS.has(sport)) return "Deporte no incluido en favoritos.";
  const page=params.get("page"); if(page&&(!/^\d+$/.test(page)||Number(page)>99)) return "Página fuera del rango permitido.";
  for(const key of ["league","series","category","season","session","round","limit"]) { const value=params.get(key); if(value&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1)) return "Identificador inválido: "+key; }
  return null;
}
async function sportsApiProxy(request,env,route) {
  const apiKey=env.SPORTAPI_API_KEY||env.SPORTSAPI_API_KEY;
  if(!apiKey) return json({error:{code:"sportsapi_not_configured",message:"Configura SPORTAPI_API_KEY como secreto del Worker de Cloudflare."}},503,{"Cache-Control":"no-store"});
  const incoming=new URL(request.url);
  const validationError=validateSportsApiQuery(incoming.searchParams,route.allowed);
  if(validationError) return json({error:{code:"bad_request",message:validationError}},400);
  const upstreamUrl=SPORTSAPI_BASE+"/"+route.upstream+incoming.search;
  const cacheKey=new Request(upstreamUrl,{method:"GET"});
  const cache=globalThis.caches?.default;
  const cached=await cacheMatch(cache,cacheKey);
  if(cached) {
    try {
      const cachedPayload = await cached.json();
      return json(filterSportsApiFavoriteData(cachedPayload, request, route), 200, {
        "Cache-Control": cached.headers.get("Cache-Control") || "public, max-age=120",
        "X-Data-Source": "cache"
      });
    } catch {
      // Una entrada antigua o corrupta no debe impedir consultar al proveedor.
    }
  }
  try {
    const upstream=await fetch(upstreamUrl,{method:"GET",headers:{"Authorization":"Bearer "+apiKey,"Accept":"application/json"}});
    const body=await upstream.text(); let parsed;
    try { parsed=JSON.parse(body); } catch { return json({error:{code:"invalid_upstream_response",message:"SportsAPI devolvió una respuesta no JSON."}},502); }
    if(!upstream.ok) { const retry=upstream.headers.get("Retry-After"); return json(parsed,upstream.status,{"Cache-Control":"no-store",...(retry?{"Retry-After":retry}:{})}); }
    const ttl=route.upstream==="sports"||route.upstream==="categories"||route.upstream==="leagues"||route.upstream==="series"?3600:route.upstream==="livescores"?15:route.upstream.startsWith("fixtures/")||route.upstream.startsWith("races/")?45:120;
    const filteredPayload = filterSportsApiFavoriteData(parsed, request, route);
    const response=json(filteredPayload,200,{"Cache-Control":"public, max-age="+ttl,"X-Data-Source":"sportsapi"});
    await cachePut(cache,cacheKey,response.clone()); return response;
  } catch { return json({error:{code:"upstream_unavailable",message:"No se pudo conectar con SportsAPI."}},503,{"Retry-After":"30"}); }
}

export { ChannelCatalogRoom };

export default {
  async scheduled(controller, env, ctx) {
    if (!env.CHANNEL_CATALOG) return;
    const id = env.CHANNEL_CATALOG.idFromName("deporte-total-360-channel-catalog");
    const stub = env.CHANNEL_CATALOG.get(id);
    ctx.waitUntil(stub.fetch(new Request("https://channel-catalog.internal/refresh", { method: "POST" })));
  },
  async fetch(request, env = {}) {
    if (request.method === "OPTIONS") {
      return empty(204);
    }

    const incoming = new URL(request.url);
    const path = incoming.pathname.replace(/\/+$/, "") || "/";

    // Una única sala pública compartida por todos los usuarios de la APK.
    if (path === "/api/chat/messages") {
      if (request.method !== "GET" && request.method !== "POST") {
        return json(
          { error: "Método no permitido" },
          405,
          { Allow: "GET, POST, OPTIONS" }
        );
      }
      if (!env.PUBLIC_CHAT_ROOM) {
        return json({ error: "La sala de chat todavía no está configurada" }, 503);
      }
      const roomId = env.PUBLIC_CHAT_ROOM.idFromName("deporte-total-360-public");
      const room = env.PUBLIC_CHAT_ROOM.get(roomId);
      const target = new URL("https://public-chat.internal/messages");
      try {
        const roomResponse = await room.fetch(new Request(target.toString(), request));
        if (roomResponse.status >= 500) {
          let detail = "";
          try { detail = (await roomResponse.clone().text()).slice(0, 500); } catch {}
          console.error("PublicChatRoom devolvió un error", roomResponse.status, detail);
          return json({
            error: {
              code: "chat_temporarily_unavailable",
              message: "El chat está temporalmente no disponible. El catálogo de canales sigue funcionando."
            }
          }, 503, { "Retry-After": "15" });
        }
        return roomResponse;
      } catch (error) {
        console.error("PublicChatRoom lanzó una excepción", error);
        return json({
          error: {
            code: "chat_temporarily_unavailable",
            message: "El chat está temporalmente no disponible. El catálogo de canales sigue funcionando."
          }
        }, 503, { "Retry-After": "15" });
      }
    }

    if (path === "/api/channels" && request.method === "GET") {
      return cachedPublicChannelCatalog(request, env, path);
    }
    if (path === "/api/license" || path.startsWith("/api/channels")) {
      return handleChannelRoutes(request, env, path);
    }

    if (request.method !== "GET") {
      return json(
        { error: "Método no permitido" },
        405,
        { Allow: "GET, OPTIONS" }
      );
    }

    if (path === "/api/live/sources") {
      return liveSourcesResponse(request, env);
    }

    if (path === "/api/sportsapi/favorites") return sportsApiFavoritesResponse();
    if (path.startsWith("/api/sportsapi/")) {
      const config = sportsApiRoute(path);
      if (!config) return json({error:{code:"not_found",message:"Ruta SportsAPI no disponible."}},404);
      return sportsApiProxy(request,env,config);
    }

    if (path === "/health") {
      return json({
        service: "Deporte Total 360 API",
        status: "online",
        provider_configured: Boolean(
          env.APISPORTS_KEY || env.APIFOOTBALL_KEY
        ),
        sportsapi_configured: Boolean(env.SPORTAPI_API_KEY || env.SPORTSAPI_API_KEY),
        sportsapi_favorite_sports: FAVORITE_SPORTS.length,
        sports: Object.keys(SPORTS).length,
        live_catalog_configured: Boolean(env.LIVE_STREAM_CATALOG_JSON),
        channels_catalog_configured: Boolean(env.CHANNEL_CATALOG),
        channels_google_login_configured: Boolean(env.GOOGLE_OAUTH_CLIENT_ID)
      });
    }

    if (path === "/api/sports") {
      return json(
        { sports: sportsCatalog() },
        200,
        { "Cache-Control": "public, max-age=3600" }
      );
    }

    // Rutas antiguas de fútbol: permanecen activas.
    const legacyConfig = FOOTBALL_LEGACY[path];

    if (legacyConfig) {
      return proxyToProvider(
        request,
        env,
        SPORTS.football.base,
        legacyConfig,
        path.slice("/api/".length)
      );
    }

    // Rutas nuevas: /api/deporte/recurso
    const match = path.match(/^\/api\/([a-z-]+)\/([a-z-]+)$/);

    if (!match) {
      return json({ error: "Ruta no encontrada" }, 404);
    }

    const [, sportId, resource] = match;
    const sport = SPORTS[sportId];

    if (!sport) {
      return json({
        error: "Deporte no disponible",
        available: Object.keys(SPORTS)
      }, 404);
    }

    const config = sport.resources[resource];

    if (!config) {
      return json({
        error: "Recurso no disponible para este deporte",
        sport: sportId,
        available: Object.keys(sport.resources)
      }, 404);
    }

    return proxyToProvider(
      request,
      env,
      sport.base,
      config,
      resource
    );
  }
};