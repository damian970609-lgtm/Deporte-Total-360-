const API_BASE = "https://v3.football.api-sports.io";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
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

const ROUTES = {
  "/api/fixtures": {
    endpoint: "fixtures",
    ttl: 300,
    params: [
      "id", "ids", "live", "date", "from", "to", "league", "season",
      "team", "last", "next", "round", "status", "venue", "timezone"
    ]
  },
  "/api/live": {
    endpoint: "fixtures",
    ttl: 60,
    fixed: { live: "all" },
    params: ["timezone"]
  },
  "/api/leagues": {
    endpoint: "leagues",
    ttl: 3600,
    params: [
      "id", "name", "country", "code", "season", "team",
      "type", "current", "search"
    ]
  },
  "/api/standings": {
    endpoint: "standings",
    ttl: 1800,
    params: ["league", "season", "team"]
  }
};

function validateParameter(key, value) {
  if (!value || value.length > 100) return "Parámetro inválido";

  if (["date", "from", "to"].includes(key) && !validDate(value)) {
    return `Fecha inválida: ${key}`;
  }

  if (["id", "league", "season", "team", "venue", "next", "last"].includes(key)) {
    if (!/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1) {
      return `Valor numérico inválido: ${key}`;
    }

    if (key === "season" && !/^\d{4}$/.test(value)) {
      return "La temporada debe tener cuatro dígitos";
    }

    if (["next", "last"].includes(key) && Number(value) > 99) {
      return `${key} no puede superar 99`;
    }
  }

  if (key === "ids") {
    const ids = value.split("-");
    if (ids.length > 20 ||
        !ids.every(id =>
          /^\d+$/.test(id) &&
          Number(id) > 0 &&
          Number.isSafeInteger(Number(id))
        )) {
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

  if (key === "type" && !["league", "cup"].includes(value.toLowerCase())) {
    return "type debe ser league o cup";
  }

  if (key === "status" && !/^[A-Z0-9-]+$/i.test(value)) {
    return "status contiene caracteres no válidos";
  }

  if (key === "timezone" && !validTimezone(value)) {
    return "Zona horaria no válida";
  }

  return null;
}

function validateRouteQuery(path, params) {
  if (path === "/api/fixtures") {
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

    const selectors = [
      "id", "ids", "live", "date", "from",
      "league", "team", "next", "last"
    ];

    if (!selectors.some(key => params.has(key))) {
      return "Indica date, from/to, league, team, next, last, id o live";
    }
  }

  if (path === "/api/standings" &&
      (!params.has("league") || !params.has("season"))) {
    return "La clasificación requiere league y season";
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

export default {
  async fetch(request, env = {}) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: HEADERS });
    }

    if (request.method !== "GET") {
      return json({ error: "Método no permitido" }, 405, {
        Allow: "GET, OPTIONS"
      });
    }

    const incoming = new URL(request.url);
    const path = incoming.pathname;

    // La salud del Worker no depende de la clave del proveedor.
    if (path === "/health") {
      return json({
        service: "Deporte Total 360 API",
        status: "online",
        provider_configured: Boolean(env.APIFOOTBALL_KEY)
      });
    }

    const route = ROUTES[path];

    if (!route) {
      return json({ error: "Ruta no encontrada" }, 404);
    }

    if (!env.APIFOOTBALL_KEY) {
      return json({
        error: "Servidor sin API-Football configurada"
      }, 503);
    }

    const upstreamParams = new URLSearchParams(route.fixed || {});
    const seen = new Set();

    for (const [key, value] of incoming.searchParams.entries()) {
      if (!route.params.includes(key)) {
        return json({ error: `Parámetro no permitido: ${key}` }, 400);
      }

      if (seen.has(key)) {
        return json({ error: `Parámetro repetido: ${key}` }, 400);
      }

      seen.add(key);

      const error = validateParameter(key, value);
      if (error) return json({ error }, 400);

      upstreamParams.set(key, value);
    }

    const queryError = validateRouteQuery(path, upstreamParams);
    if (queryError) return json({ error: queryError }, 400);

    const cacheKey = new Request(incoming.toString(), { method: "GET" });
    const cache = globalThis.caches?.default;

    const cached = await cacheMatch(cache, cacheKey);

    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set("Access-Control-Allow-Origin", "*");
      response.headers.set("X-Data-Source", "cache");
      return response;
    }

    const upstreamUrl =
      `${API_BASE}/${route.endpoint}?${upstreamParams.toString()}`;

    try {
      const upstream = await fetch(upstreamUrl, {
        headers: {
          "x-apisports-key": env.APIFOOTBALL_KEY
        }
      });

      if (upstream.status === 204) {
        return new Response(null, {
          status: 204,
          headers: {
            ...HEADERS,
            "Cache-Control": `public, max-age=${route.ttl}`,
            "X-Data-Source": "api"
          }
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
          error: "Respuesta inválida del proveedor"
        }, 502);
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Formato inválido del proveedor" }, 502);
      }

      if (providerErrors(parsed.errors)) {
        return json({
          error: "El proveedor devolvió errores",
          details: parsed.errors
        }, 502);
      }

      const response = json(parsed, 200, {
        "Cache-Control": `public, max-age=${route.ttl}`,
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
};
