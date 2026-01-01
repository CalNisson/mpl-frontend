// src/lib/api.js
import { auth } from "./authStore";
import { getLeagueId, getLeagueSlug } from "./leagueStore";

// You can override this with VITE_API_BASE_URL in a .env file if you want.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function handle(res) {
  if (!res.ok) {
    const text = await res.text();

    // Auto-clear token on unauthorized
    if (res.status === 401) {
      auth.clear();
      // Optional: if you want to kick them to login immediately
      // window.location.hash = "#/login";
    }

    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  // Some endpoints might return no content (204)
  if (res.status === 204) return null;

  return res.json();
}

async function apiFetch(path, options = {}) {
  const token = auth.getToken();

  const headers = new Headers(options.headers || {});
  // Only set JSON content-type when we actually send a body and caller didn't specify.
  if (options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

// ----------------------------
// Simple in-memory cache (per session)
// ----------------------------
const cache = new Map(); // key -> { t: number, v: any }
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function cached(key, fetcher, ttlMs = DEFAULT_TTL_MS) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttlMs) return hit.v;

  const v = await fetcher();
  cache.set(key, { t: now, v });
  return v;
}

// Optional helper if you ever want to bust cache after a POST, etc.
export function clearApiCache(prefix = "") {
  for (const k of cache.keys()) {
    if (!prefix || k.startsWith(prefix)) cache.delete(k);
  }
}

// ----------------------------
// Auth endpoints
// ----------------------------

export async function register({ email, username, password }) {
  const res = await apiFetch(`/auth/register`, {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
  return handle(res);
}

export async function login({ emailOrUsername, password }) {
  const res = await apiFetch(`/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email_or_username: emailOrUsername, password }),
  });

  const out = await handle(res); // expect { token: "...", user?: {...} }
  if (out?.token) auth.setToken(out.token);
  if (out?.user) auth.me.set(out.user);
  return out;
}

export async function getMe() {
  const res = await apiFetch(`/auth/me`, { method: "GET" });
  const out = await handle(res);
  auth.me.set(out);
  return out;
}

export function logout() {
  auth.clear();
  // optional: window.location.hash = "#/login";
}

// ----------------------------
// League query helpers
// ----------------------------

// Acceptable "league input" forms:
// - undefined/null => use current league context (getLeagueId/getLeagueSlug)
// - number/string => treated as league_id
// - { league_id, league_slug } => explicit
function normalizeLeagueBits(leagueArg) {
  // Explicit object
  if (leagueArg && typeof leagueArg === "object") {
    // accept both the API-style keys and your ctx-style keys
    const league_id =
      leagueArg.league_id ??
      leagueArg.leagueId ??
      leagueArg.id ??
      null;

    const league_slug =
      leagueArg.league_slug ??
      leagueArg.leagueSlug ??
      leagueArg.slug ??
      null;

    if (league_id != null) return { league_id: String(league_id) };
    if (league_slug) return { league_slug: String(league_slug) };

    throw new Error("Invalid league argument: missing league_id or league_slug.");
  }

  // Explicit primitive league id
  if (leagueArg != null) {
    return { league_id: String(leagueArg) };
  }

  // Default to current league context
  const id = getLeagueId();
  if (id != null) return { league_id: String(id) };

  const slug = getLeagueSlug();
  if (slug) return { league_slug: String(slug) };

  throw new Error("No active league selected.");
}

function leagueKeyFromBits(bits) {
  if (bits.league_id != null) return `id:${bits.league_id}`;
  if (bits.league_slug != null) return `slug:${String(bits.league_slug).toLowerCase()}`;
  return "none";
}

function withLeague(path) {
  // implicit (current context)
  const params = new URLSearchParams(normalizeLeagueBits(null));
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${params.toString()}`;
}

function withLeagueExplicit(path, leagueArg) {
  const params = new URLSearchParams(normalizeLeagueBits(leagueArg));
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${params.toString()}`;
}

// ----------------------------
// API calls
// ----------------------------

export async function getSeasons(leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `seasons:${leagueKeyFromBits(bits)}`;
  return cached(key, async () => {
    const res = await apiFetch(withLeagueExplicit(`/seasons`, bits));
    return handle(res);
  });
}

export async function getSeasonDashboard(seasonId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `season-dashboard:${leagueKeyFromBits(bits)}:${seasonId}`;
  return cached(key, async () => {
    const res = await apiFetch(withLeagueExplicit(`/seasons/${seasonId}/dashboard`, bits));
    return handle(res);
  });
}

export async function getSeasonBadges(seasonId, leagueArg) {
  // NOTE: your backend route /seasons/:id/badges currently is NOT league-scoped.
  // If/when you add league scope, this already supports it.
  const bits = normalizeLeagueBits(leagueArg);
  const key = `season-badges:${leagueKeyFromBits(bits)}:${seasonId}`;
  return cached(key, async () => {
    const res = await apiFetch(withLeagueExplicit(`/seasons/${seasonId}/badges`, bits));
    return handle(res);
  });
}

export async function getCoaches(leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `coaches:${leagueKeyFromBits(bits)}`;
  return cached(key, async () => {
    const res = await apiFetch(withLeagueExplicit(`/coaches`, bits));
    return handle(res);
  });
}

export async function getAllCoaches() {
  return cached("coaches:all", async () => {
    const res = await apiFetch(`/coaches/all`, { method: "GET" });
    return handle(res);
  });
}

// ----------------------------
// Season teams (manage season participants)
// ----------------------------

export async function getSeasonTeams(seasonId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `season-teams:${leagueKeyFromBits(bits)}:${seasonId}`;
  return cached(key, async () => {
    const res = await apiFetch(withLeagueExplicit(`/seasons/${seasonId}/teams`, bits));
    return handle(res);
  });
}

export async function createSeasonTeam(seasonId, payload, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const res = await apiFetch(withLeagueExplicit(`/seasons/${seasonId}/teams`, bits), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const out = await handle(res);
  clearApiCache(`season-teams:${leagueKeyFromBits(bits)}:${seasonId}`);
  clearApiCache("seasons:");
  return out;
}

export async function updateSeasonTeam(seasonId, teamId, payload, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const res = await apiFetch(
    withLeagueExplicit(`/seasons/${seasonId}/teams/${teamId}`, bits),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    }
  );
  const out = await handle(res);
  clearApiCache(`season-teams:${leagueKeyFromBits(bits)}:${seasonId}`);
  clearApiCache("seasons:");
  return out;
}

export async function getPokemonCareerStats() {
  return cached("pokemon-career-stats", async () => {
    const res = await apiFetch(`/pokemon/stats`);
    return handle(res);
  });
}

export async function runPokemonStatsRollup() {
  const res = await apiFetch(`/pokemon/stats/run`);
  const out = await handle(res);
  clearApiCache("pokemon-career-stats");
  return out;
}

export async function getCoachCrosstable(namesCsv = "", leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `crosstable:${leagueKeyFromBits(bits)}:${namesCsv || ""}`;

  return cached(key, async () => {
    const params = new URLSearchParams();
    if (namesCsv?.trim()) params.set("names", namesCsv.trim());
    Object.entries(bits).forEach(([k, v]) => params.set(k, v));

    const res = await apiFetch(`/coaches/crosstable?${params.toString()}`);
    return handle(res);
  });
}

// If you don't actually have this endpoint, you can delete this.
export async function refreshCoachCrosstableCache() {
  const res = await apiFetch(`/coaches/crosstable/refresh`, { method: "POST" });
  const out = await handle(res);
  clearApiCache("crosstable:");
  return out;
}

export async function getMvps(leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `mvps:${leagueKeyFromBits(bits)}`;
  return cached(key, async () => {
    const res = await apiFetch(withLeagueExplicit(`/mvps`, bits));
    return handle(res);
  });
}

export async function getBadges(leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `badges:${leagueKeyFromBits(bits)}`;
  return cached(key, async () => {
    const res = await apiFetch(withLeagueExplicit(`/badges`, bits));
    return handle(res);
  });
}

export async function getCoachProfileByName(name, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `coach-profile:${leagueKeyFromBits(bits)}:${(name ?? "").toLowerCase()}`;
  return cached(key, async () => {
    const res = await apiFetch(
      withLeagueExplicit(`/coaches/by-name/${encodeURIComponent(name)}/profile`, bits)
    );
    return handle(res);
  });
}

export async function getCoachSeasonDetails(coachId, seasonId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `coach-season-details:${leagueKeyFromBits(bits)}:${coachId}:${seasonId}`;
  return cached(key, async () => {
    const res = await apiFetch(
      withLeagueExplicit(`/coaches/${coachId}/seasons/${seasonId}/details`, bits)
    );
    return handle(res);
  });
}

export async function getMyOrganizations() {
  return cached("my-orgs", async () => {
    const res = await apiFetch(`/organizations/mine`);
    return handle(res);
  });
}

export async function createOrganization({ name, slug, description }) {
  const res = await apiFetch(`/organizations`, {
    method: "POST",
    body: JSON.stringify({ name, slug, description }),
  });
  clearApiCache("my-orgs");
  return handle(res);
}

export async function getOrganizationLeagues(orgSlug) {
  return cached(`org-leagues:${orgSlug}`, async () => {
    const res = await apiFetch(`/organizations/${encodeURIComponent(orgSlug)}/leagues`);
    return handle(res);
  });
}

// kept for backwards compatibility if you were using getOrgLeagues()
export async function getOrgLeagues(orgSlug) {
  return getOrganizationLeagues(orgSlug);
}

export async function createLeague({ organization_slug, name, slug, description }) {
  const res = await apiFetch(`/leagues`, {
    method: "POST",
    body: JSON.stringify({ organization_slug, name, slug, description }),
  });
  clearApiCache(`org-leagues:${organization_slug}`);
  return handle(res);
}

export async function getLeagueMe(leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const qs = new URLSearchParams(bits).toString();
  const res = await apiFetch(`/auth/league-me?${qs}`);
  return handle(res);
}


export async function createSeason({ league_id, name, start_date, format }) {
  const res = await apiFetch(`/seasons`, {
    method: "POST",
    body: JSON.stringify({ league_id, name, start_date, format }),
  });
  clearApiCache("seasons:");
  clearApiCache("season-dashboard:");
  return handle(res);
}

// ----------------------------
// Tier List (season-scoped)
// ----------------------------

export async function getSeasonTierList(seasonId, opts = {}) {
  const includeHidden = !!opts?.include_hidden;

  // IMPORTANT: include_hidden changes the response, so it must be part of the cache key
  const key = `season-tierlist:${seasonId}:hidden=${includeHidden ? 1 : 0}`;

  return cached(key, async () => {
    const params = new URLSearchParams();
    if (includeHidden) params.set("include_hidden", "true");

    const qs = params.toString();
    const url = qs
      ? `/seasons/${seasonId}/tierlist?${qs}`
      : `/seasons/${seasonId}/tierlist`;

    const res = await apiFetch(url, { method: "GET" });
    return handle(res);
  });
}

export async function patchSeasonTierAssignments(seasonId, changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("patchSeasonTierAssignments: changes must be a non-empty array");
  }

  const res = await apiFetch(`/seasons/${seasonId}/tierlist/assignments`, {
    method: "PATCH",
    body: JSON.stringify({ changes }),
  });

  const out = await handle(res);

  clearApiCache(`season-tierlist:${seasonId}:hidden=`);
  clearApiCache("season-dashboard:");

  return out;
}

export async function createSeasonTier(
  seasonId,
  { name, sort_order, is_banned, is_undraftable }
) {
  const res = await apiFetch(`/seasons/${seasonId}/tierlist/tiers`, {
    method: "POST",
    body: JSON.stringify({
      name,
      sort_order: sort_order ?? 50,
      is_banned: is_banned ?? false,
      is_undraftable: is_undraftable ?? false,
    }),
  });

  clearApiCache(`season-tierlist:${seasonId}:hidden=`);
  return handle(res);
}

export async function putTierColumns(tierId, points) {
  const res = await apiFetch(`/tiers/${tierId}/columns`, {
    method: "PUT",
    body: JSON.stringify({ points }),
  });

  clearApiCache("season-tierlist:");
  return handle(res);
}

export async function patchTier(tierId, payload) {
  const res = await apiFetch(`/tiers/${tierId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  clearApiCache("season-tierlist:");
  return handle(res);
}

export async function deleteTier(tierId) {
  const res = await apiFetch(`/tiers/${tierId}`, {
    method: "DELETE",
  });

  clearApiCache("season-tierlist:");
  return handle(res);
}

export async function patchSeasonTierListSettings(seasonId, payload) {
  const res = await apiFetch(`/seasons/${seasonId}/tierlist`, {
    method: "PATCH",
    body: JSON.stringify(payload ?? {}),
  });

  clearApiCache(`season-tierlist:${seasonId}:hidden=`);
  clearApiCache("season-dashboard:");
  return handle(res);
}

// ----------------------------
// Draft (season-scoped)
// ----------------------------

export async function getDraftSnapshot(seasonId) {
  const res = await apiFetch(`/seasons/${seasonId}/draft`, { method: "GET" });
  return handle(res);
}

export async function listDraftCandidates(seasonId) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/candidates`, { method: "GET" });
  return handle(res);
}

export async function putDraftSettings(seasonId, payload) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/settings`, {
    method: "PUT",
    body: JSON.stringify(payload ?? {}),
  });
  return handle(res);
}

export async function addDraftTeamToSeason(seasonId, payload) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/teams`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
  return handle(res);
}

export async function putDraftOrder(seasonId, team_ids) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/order`, {
    method: "PUT",
    body: JSON.stringify({ team_ids }),
  });
  return handle(res);
}

export async function randomizeDraftOrder(seasonId) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/order/randomize`, {
    method: "POST",
  });
  return handle(res);
}

export async function startDraft(seasonId) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/start`, { method: "POST" });
  return handle(res);
}

export async function pauseDraft(seasonId) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/pause`, { method: "POST" });
  return handle(res);
}

export async function endDraft(seasonId) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/end`, { method: "POST" });
  return handle(res);
}

export async function skipDraftTurn(seasonId) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/skip`, { method: "POST" });
  return handle(res);
}

export async function makeDraftPick(seasonId, payload) {
  const res = await apiFetch(`/seasons/${seasonId}/draft/pick`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
  return handle(res);
}

export async function deleteSeasonTeam(seasonId, teamId) {
  return apiFetch(`/seasons/${seasonId}/teams/${teamId}`, {
    method: "DELETE",
  });
}