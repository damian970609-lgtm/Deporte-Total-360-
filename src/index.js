const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
      ? payload.name.replace(/[\\u0000-\\u001F\\u007F]/g, " ").replace(/\\s+/g, " ").trim().slice(0, CHAT_MAX_NAME_LENGTH)
      : "";
    const text = typeof payload?.text === "string"
      ? payload.text.replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, " ").trim()
      : "";

    if (name.length < 2) {
      return json({ error: "Escribe un nombre de al menos 2 caracteres" }, 400);
    }
    if (!text || text.length > CHAT_MAX_TEXT_LENGTH) {
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

export default {
  async fetch(request, env = {}) {
    if (request.method === "OPTIONS") {
      return empty(204);
    }

    const incoming = new URL(request.url);
    const path = incoming.pathname.replace(/\\/+$/, "") || "/";

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
      return room.fetch(new Request(target.toString(), request));
    }

    if (request.method !== "GET") {
      return json(
        { error: "Método no permitido" },
        405,
        { Allow: "GET, OPTIONS" }
      );
    }

    if (path === "/health") {
      return json({
        service: "Deporte Total 360 API",
        status: "online",
        provider_configured: Boolean(
          env.APISPORTS_KEY || env.APIFOOTBALL_KEY
        ),
        sports: Object.keys(SPORTS).length
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