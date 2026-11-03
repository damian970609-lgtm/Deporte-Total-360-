/**
 * SportsAPI.app adapter for the Deporte Total 360 favourite-sports feed.
 * The provider key is read only from the Cloudflare Worker environment.
 */
const API_BASE = "https://api.sportsapi.app/v2";
const DETAIL_URL = "https://sportsapi.app";

export const SPORTSAPI_FAVORITES = [
  { id: "football", name: "Fútbol", kind: "fixtures", competitions: [
    "LaLiga", "Premier League", "Serie A", "Bundesliga", "Ligue 1", "MLS", "Brasileirao",
    "FIFA World Cup", "World Cup Qualifiers", "UEFA European Championship", "Euro",
    "Copa America", "International Friendly", "FIFA Club World Cup", "UEFA Champions League",
    "Africa Cup of Nations", "Asian Cup", "Gold Cup", "UEFA Nations League",
    "CONCACAF Nations League", "OFC Nations Cup", "Copa Libertadores", "Copa Sudamericana",
    "FA Cup", "Copa del Rey", "Coppa Italia", "DFB-Pokal",
    "Liga F", "Women's Super League", "Serie A Women", "Frauen-Bundesliga",
    "Premiere Ligue", "Première Ligue", "NWSL", "Brasileirao Feminino",
    "FIFA Women's World Cup", "Women's World Cup Qualifiers", "UEFA Women's EURO",
    "Copa America Femenina", "Women's International Friendly", "WAFCON",
    "Women's Africa Cup of Nations", "AFC Women's Asian Cup", "Concacaf W Gold Cup",
    "UEFA Women's Nations League", "CONCACAF W Championship", "OFC Women's Nations Cup",
    "UEFA Women's Champions League", "Women's Champions Cup", "Women's Club World Cup",
    "Copa Libertadores Femenina", "Women's FA Cup", "Copa de la Reina",
    "Coppa Italia Women", "DFB-Pokal Frauen", "Coupe de France Feminine"
  ]},
  { id: "basketball", name: "Baloncesto", kind: "fixtures", competitions: [
    "NBA", "WNBA", "FIBA Basketball World Cup", "Women's Basketball World Cup",
    "Olympic Basketball", "Women's Olympic Basketball"
  ]},
  { id: "baseball", name: "Béisbol", kind: "fixtures", competitions: [
    "MLB", "Major League Baseball", "World Baseball Classic", "WBSC Premier12",
    "Women's Baseball World Cup"
  ]},
  { id: "ice-hockey", name: "Hockey sobre hielo", kind: "fixtures", competitions: [
    "NHL", "National Hockey League", "PWHL", "Professional Women's Hockey League",
    "IIHF Ice Hockey World Championship", "IIHF Women's World Championship",
    "Olympic Ice Hockey", "Women's Olympic Ice Hockey"
  ]},
  { id: "volleyball", name: "Voleibol", kind: "fixtures", competitions: [
    "Volleyball Nations League", "Women's Volleyball Nations League",
    "FIVB Volleyball World Championship", "FIVB Women's Volleyball World Championship",
    "FIVB Men's Club World Championship", "FIVB Women's Club World Championship",
    "Olympic Volleyball", "Women's Olympic Volleyball"
  ]},
  { id: "mma", name: "MMA", kind: "fixtures", competitions: [
    "UFC", "Ultimate Fighting Championship"
  ]},
  { id: "futsal", name: "Fútbol sala", kind: "fixtures", competitions: [
    "FIFA Futsal World Cup", "UEFA Futsal EURO", "Copa America Futsal",
    "AFC Futsal Asian Cup", "FIFA Futsal Women's World Cup",
    "AFC Women's Futsal Asian Cup", "Women's Futsal Copa America"
  ]},
  { id: "cycling", name: "Ciclismo", kind: "races", competitions: [
    "Vuelta a España", "La Vuelta Femenina", "Giro d'Italia", "Giro d'Italia Women",
    "Tour de France", "Tour de France Femmes"
  ]},
  { id: "motorsport", name: "Deportes de motor", kind: "races", competitions: [
    "Formula 1", "MotoGP", "F1 Academy", "FIM Women's Circuit Racing World Championship",
    "WorldWCR"
  ]},
  { id: "handball", name: "Balonmano", kind: "fixtures", competitions: [
    "IHF Men's World Championship", "IHF Women's World Championship",
    "EHF EURO Men", "EHF EURO Women", "Olympic Handball", "Olympic Women's Handball"
  ]}
];

const FAVORITES_BY_ID = new Map(SPORTSAPI_FAVORITES.map(item => [item.id, item]));
const LIVE_REFRESH_MS = 30 * 60 * 1000;
const DAY_REFRESH_MS = 20 * 60 * 60 * 1000;
const COMPETITION_ALIASES = {
  "LaLiga": ["La Liga", "Primera Division Spain"],
  "Brasileirao": ["Campeonato Brasileiro Serie A", "Brazil Serie A", "Brasileiro Serie A"],
  "Brasileirao Feminino": [
    "Campeonato Brasileiro Feminino", "Brasileiro Feminino Serie A1",
    "Brazil Women Serie A"
  ],
  "UEFA European Championship": ["European Championship", "UEFA Euro"],
  "FIFA World Cup": ["World Cup Men", "FIFA World Cup Men"],
  "FIFA Women's World Cup": ["Women's World Cup", "World Cup Women"],
  "FIFA Club World Cup": ["Club World Cup"],
  "Women's Super League": ["FA Women's Super League", "WSL"],
  "Frauen-Bundesliga": ["Google Pixel Frauen Bundesliga"],
  "Serie A Women": ["Serie A Femminile"],
  "Premiere Ligue": ["Premiere Ligue Women", "French Women's League"],
  "UEFA Women's EURO": ["Women's European Championship", "Women's Euro"],
  "Women's Africa Cup of Nations": ["WAFCON"],
  "FIVB Volleyball World Championship": ["Volleyball World Championship"],
  "FIVB Women's Volleyball World Championship": ["Women's Volleyball World Championship"],
  "FIFA Futsal Women's World Cup": ["Women's Futsal World Cup"],
  "Tour de France Femmes": ["Tour de France Women", "Tour de France Femmes avec Zwift"],
  "La Vuelta Femenina": ["Vuelta a Espana Femenina", "La Vuelta Femenina by Carrefour.es"],
  "Giro d'Italia Women": ["Giro d Italia Women", "Giro Donne"],
  "FIM Women's Circuit Racing World Championship": ["WorldWCR", "FIM Women's Circuit Racing World Championship"]
};


function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\s+/g, " ");
}

function isFavouriteCompetition(sport, name) {
  const config = FAVORITES_BY_ID.get(sport);
  const value = normalize(name);
  if (!config || !value) return false;
  const candidates = config.competitions.flatMap(candidate => [
    candidate,
    ...(COMPETITION_ALIASES[candidate] || [])
  ]);
  return candidates.some(candidate => {
    const expected = normalize(candidate);
    return value === expected || value.includes(expected) || expected.includes(value);
  });
}

function statusValue(status) {
  const type = String(
    typeof status === "string" ? status : (status?.type || status?.description || "")
  ).toLowerCase();
  if (type === "inprogress" || type === "live") return "live";
  if (type === "finished" || type === "ended") return "finished";
  if (type === "postponed") return "postponed";
  if (type === "canceled" || type === "cancelled") return "cancelled";
  return "scheduled";
}

function scoreValue(score) {
  return score && score.current !== null && score.current !== undefined
    ? String(score.current) : "";
}

function mapFixture(row) {
  const sport = String(row?.sport || row?.league?.sport || "");
  const config = FAVORITES_BY_ID.get(sport);
  const competition = String(row?.league?.name || "");
  if (!config || !isFavouriteCompetition(sport, competition)) return null;
  const start = row.startTime ? Date.parse(row.startTime) : NaN;
  if (!Number.isFinite(start)) return null;
  const home = row.home || {};
  const away = row.away || {};
  const homeName = String(home.name || "").trim();
  const awayName = String(away.name || "").trim();
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const status = statusValue(row.status);
  const duration = sport === "mma" ? 4 : sport === "basketball" ? 3 : sport === "baseball" ? 4 : 3;
  return {
    id: "sportsapi-fixture-" + id,
    providerId: id,
    providerType: "fixture",
    sport: config.name,
    sportId: sport,
    title: homeName && awayName ? homeName + " vs " + awayName : competition,
    competition,
    homeTeam: homeName,
    awayTeam: awayName,
    homeTeamLogo: String(home.image || ""),
    awayTeamLogo: String(away.image || ""),
    participants: [],
    imageUrl: String(row.league?.image || ""),
    venue: String(row.venue?.name || ""),
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + duration * 60 * 60 * 1000).toISOString(),
    status,
    statusLabel: String(row.status?.description || status),
    providerLeagueId: Number(row.league?.id) || null,
    providerSeasonId: Number(row.season?.id) || null,
    homeScore: scoreValue(row.homeScore),
    awayScore: scoreValue(row.awayScore),
    detailUrl: DETAIL_URL + "/"
  };
}

function mapRace(row) {
  const sport = String(row?.sport || "");
  const config = FAVORITES_BY_ID.get(sport);
  const seriesName = String(row?.series?.name || "");
  const raceName = String(row?.name || "");
  if (!config || !isFavouriteCompetition(sport, seriesName + " " + raceName)) return [];
  const sessions = Array.isArray(row.sessions) ? row.sessions : [];
  const output = [];
  for (const session of sessions) {
    const start = session?.startTime ? Date.parse(session.startTime) : NaN;
    const sessionId = Number(session?.id);
    if (!Number.isFinite(start) || !Number.isSafeInteger(sessionId) || sessionId < 1) continue;
    output.push({
      id: "sportsapi-race-" + Number(row.id) + "-" + sessionId,
      providerId: Number(row.id),
      providerSessionId: sessionId,
      providerSeriesId: Number(row.series?.id) || null,
      providerSeasonId: Number(row.season?.id) || null,
      providerType: "race",
      sport: config.name,
      sportId: sport,
      title: raceName + (session.name ? " · " + session.name : ""),
      competition: seriesName || raceName,
      homeTeam: "",
      awayTeam: "",
      homeTeamLogo: "",
      awayTeamLogo: "",
      participants: [],
      imageUrl: "",
      venue: [row.circuit?.name, row.country?.name].filter(Boolean).join(" · "),
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 2 * 60 * 60 * 1000).toISOString(),
      status: statusValue(session.status || row.status),
      statusLabel: String(
        typeof session.status === "string"
          ? session.status
          : (session.status?.description || session.status?.type || row.status || "scheduled")
      ),
      homeScore: "",
      awayScore: "",
      detailUrl: DETAIL_URL + "/"
    });
  }
  return output;
}

async function providerGet(env, path, query = {}) {
  const key = env.SPORTAPI_API_KEY;
  if (!key || typeof key !== "string" || !key.trim()) {
    const error = new Error("Falta el secreto SPORTAPI_API_KEY en el entorno del Cloudflare Worker.");
    error.status = 503;
    throw error;
  }
  const url = new URL(API_BASE + path);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      url.searchParams.set(name, String(value));
    }
  }
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Authorization": "Bearer " + key.trim(), "Accept": "application/json" },
    signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
  });
  let body;
  try { body = await response.json(); }
  catch { throw new Error("SportsAPI devolvió JSON inválido (HTTP " + response.status + ")."); }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || "SportsAPI respondió HTTP " + response.status;
    const error = new Error(String(message).slice(0, 260));
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    throw error;
  }
  if (!body || !Object.hasOwn(body, "data")) {
    throw new Error("SportsAPI devolvió una respuesta sin el campo data.");
  }
  return body;
}

function utcDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export async function fetchSportsApiDailyAgenda(env, now = Date.now()) {
  const date = utcDate(now);
  const fixtureSports = SPORTSAPI_FAVORITES.filter(item => item.kind === "fixtures");
  const raceSports = SPORTSAPI_FAVORITES.filter(item => item.kind === "races");
  const jobs = [
    ...fixtureSports.map(async item => {
      const result = await providerGet(env, "/fixtures", { sport: item.id, date, page: 0 });
      const rows = Array.isArray(result.data) ? result.data : [];
      return {
        sport: item.id,
        events: rows.map(mapFixture).filter(Boolean),
        hasNextPage: result.meta?.hasNextPage === true
      };
    }),
    ...raceSports.map(async item => {
      const result = await providerGet(env, "/races", { sport: item.id, date });
      const rows = Array.isArray(result.data) ? result.data : [];
      return { sport: item.id, events: rows.flatMap(mapRace), hasNextPage: false };
    })
  ];
  const groups = await Promise.all(jobs);
  const unique = new Map();
  for (const group of groups) {
    for (const event of group.events) unique.set(event.id, event);
  }
  const pageQueue = groups
    .filter(group => group.hasNextPage)
    .map(group => ({
      sport: group.sport,
      page: 1,
      // Hasta 40 ligas por deporte seleccionado; evita recorrer el catálogo
      // entero y limita las consultas adicionales dentro de la cuota diaria.
      maxPage: 4
    }));
  return {
    source: "sportsapi",
    date,
    refreshedAt: now,
    pageQueue,
    events: Array.from(unique.values()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  };
}

export async function fetchSportsApiFixturePage(env, date, sport, page) {
  const selectedPage = Number(page);
  const config = FAVORITES_BY_ID.get(String(sport));
  const maxPage = 4;
  if (!config || config.kind !== "fixtures" ||
      !/^\\d{4}-\\d{2}-\\d{2}$/.test(String(date || "")) ||
      !Number.isInteger(selectedPage) || selectedPage < 1 || selectedPage > maxPage) {
    throw new Error("La fecha, deporte o página adicional no es válida.");
  }
  const result = await providerGet(env, "/fixtures", {
    sport: config.id, date, page: selectedPage
  });
  const rows = Array.isArray(result.data) ? result.data : [];
  return {
    sport: config.id,
    page: selectedPage,
    hasNextPage: result.meta?.hasNextPage === true,
    events: rows.map(mapFixture).filter(Boolean)
  };
}

export async function fetchSportsApiLiveScores(env) {
  const result = await providerGet(env, "/livescores");
  return (Array.isArray(result.data) ? result.data : []).map(mapFixture).filter(Boolean);
}

export function mergeSportsApiLiveScores(dailyEvents, liveEvents) {
  const events = new Map((dailyEvents || []).map(item => [item.id, item]));
  for (const live of liveEvents || []) {
    const existing = events.get(live.id);
    events.set(live.id, existing ? { ...existing, ...live } : live);
  }
  return Array.from(events.values()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function sportsApiFavoritesPayload() {
  return {
    provider: "SportsAPI.app",
    sports: SPORTSAPI_FAVORITES.map(item => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      competitions: item.competitions
    }))
  };
}

/** Proxy a narrow, validated set of provider resources; the API key never leaves this Worker. */
export async function fetchSportsApiStatistics(env, type, id, extra = {}) {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId < 1) {
    const error = new Error("El identificador debe ser un entero positivo.");
    error.status = 400;
    throw error;
  }
  const params = {};
  if (type === "fixture-statistics") return providerGet(env, "/fixtures/" + numericId + "/statistics");
  if (type === "fixture") return providerGet(env, "/fixtures/" + numericId);
  if (type === "race-results") {
    const query = {};
    if (extra.session) {
      const session = Number(extra.session);
      if (!Number.isSafeInteger(session) || session < 1) {
        const error = new Error("El identificador de sesión no es válido.");
        error.status = 400;
        throw error;
      }
      query.session = session;
    }
    return providerGet(env, "/races/" + numericId + "/results", query);
  }
  if (type === "league-standings" || type === "series-standings") {
    const season = Number(extra.season);
    if (!Number.isSafeInteger(season) || season < 1) {
      const error = new Error("Selecciona un identificador de temporada válido.");
      error.status = 400;
      throw error;
    }
    const resource = type === "league-standings" ? "leagues" : "series";
    return providerGet(env, "/" + resource + "/" + numericId + "/standings", { season });
  }
  if (type === "seasons") {
    const resource = extra.kind === "series" ? "series" : "leagues";
    return providerGet(env, "/" + resource + "/" + numericId + "/seasons");
  }
  const error = new Error("Recurso estadístico no permitido.");
  error.status = 404;
  throw error;
}

export { LIVE_REFRESH_MS, DAY_REFRESH_MS };
