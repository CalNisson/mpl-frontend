// src/lib/api.js
import { auth } from "./authStore";
import { getLeagueId, getLeagueSlug, clearLeagueContext } from "./leagueStore";

// You can override this with VITE_API_BASE_URL in a .env file if you want.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function handle(res) {
  if (!res.ok) {
    const text = await res.text();

    // Auto-clear token on unauthorized
    if (res.status === 401) {
      auth.clear();
      clearApiCache();
      clearLeagueContext();
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
  clearApiCache();
  clearLeagueContext();
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

// ----------------------------
// Schedule (regular season)
// ----------------------------

export async function getSeasonSchedule(seasonId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `season-schedule:${leagueKeyFromBits(bits)}:${seasonId}`;

  return cached(key, async () => {
    const res = await apiFetch(
      withLeagueExplicit(`/seasons/${seasonId}/schedule`, bits),
      { method: "GET" }
    );
    return handle(res);
  });
}

export async function generateSeasonSchedule(seasonId, { weeks, overwrite = true }, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);

  const res = await apiFetch(
    withLeagueExplicit(`/seasons/${seasonId}/schedule/generate`, bits),
    {
      method: "POST",
      body: JSON.stringify({ weeks, overwrite }),
    }
  );

  const out = await handle(res);

  // bust schedule cache so UI updates immediately
  clearApiCache(`season-schedule:${leagueKeyFromBits(bits)}:${seasonId}`);

  return out;
}

export async function createSeasonScheduleMatch(seasonId, { week, team1_id, team2_id }, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);

  const res = await apiFetch(
    withLeagueExplicit(`/seasons/${seasonId}/schedule/matches`, bits),
    {
      method: "POST",
      body: JSON.stringify({ week, team1_id, team2_id }),
    }
  );

  const out = await handle(res);

  clearApiCache(`season-schedule:${leagueKeyFromBits(bits)}:${seasonId}`);

  return out;
}

export async function deleteSeasonScheduleMatch(seasonId, matchId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);

  const res = await apiFetch(
    withLeagueExplicit(`/seasons/${seasonId}/schedule/matches/${matchId}`, bits),
    { method: "DELETE" }
  );

  const out = await handle(res);

  clearApiCache(`season-schedule:${leagueKeyFromBits(bits)}:${seasonId}`);

  return out;
}

// Patch (edit) a scheduled regular-season match
// body can include: { week?: number, team1_id?: number, team2_id?: number, replay?: string | null }
export async function patchSeasonScheduleMatch(seasonId, matchId, body, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);

  const res = await apiFetch(
    withLeagueExplicit(`/seasons/${seasonId}/schedule/matches/${matchId}`, bits),
    {
      method: "PATCH",
      body: JSON.stringify(body ?? {}),
    }
  );

  const out = await handle(res);

  clearApiCache(`season-schedule:${leagueKeyFromBits(bits)}:${seasonId}`);

  return out;
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
  const t = auth.getToken() || "anon";
  return cached(`my-orgs:${t}`, async () => {
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
  const t = auth.getToken() || "anon";
  return cached(`org-leagues:${t}:${orgSlug}`, async () => {
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

// ----------------------------
// Season teams (delete) - FIXED
// ----------------------------

// NOTE: now properly returns parsed JSON (or null on 204) and clears caches.
// Added optional leagueArg at end to match the rest of the season-team API.
export async function deleteSeasonTeam(seasonId, teamId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);

  const res = await apiFetch(
    withLeagueExplicit(`/seasons/${seasonId}/teams/${teamId}`, bits),
    { method: "DELETE" }
  );

  const out = await handle(res);

  clearApiCache(`season-teams:${leagueKeyFromBits(bits)}:${seasonId}`);
  clearApiCache("seasons:");
  clearApiCache("season-dashboard:");

  return out;
}

// ----------------------------
// Match Reporting (season-scoped)
// ----------------------------

export async function getSeasonMatchesForReporting(seasonId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `season-matches-for-reporting:${leagueKeyFromBits(bits)}:${seasonId}`;

  return cached(key, async () => {
    const res = await apiFetch(
      withLeagueExplicit(`/seasons/${seasonId}/matches/reporting`, bits),
      { method: "GET" }
    );
    return handle(res);
  });
}

export async function getSeasonRostersForReporting(seasonId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `season-rosters-for-reporting:${leagueKeyFromBits(bits)}:${seasonId}`;

  return cached(key, async () => {
    const res = await apiFetch(
      withLeagueExplicit(`/seasons/${seasonId}/rosters/reporting`, bits),
      { method: "GET" }
    );
    return handle(res);
  });
}

// Upload a completed match report.
// Expects `payload` to be a plain JS object that matches your backend schema.
export async function uploadMatchReport(matchId, payload) {
  return apiFetch(`/matches/${matchId}/report`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}


// ----------------------------
// Transactions
// ----------------------------

export async function getSeasonTransactions(seasonId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `season-transactions:${leagueKeyFromBits(bits)}:${seasonId}`;

  return cached(key, async () => {
    const res = await apiFetch(
      withLeagueExplicit(`/seasons/${seasonId}/transactions`, bits),
      { method: "GET" }
    );
    return handle(res); // expect { trades: [...], free_agency: [...] }
  });
}

export async function getTransactionsMeta(seasonId, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);
  const key = `transactions-meta:${leagueKeyFromBits(bits)}:${seasonId}`;

  return cached(key, async () => {
    const res = await apiFetch(
      withLeagueExplicit(`/seasons/${seasonId}/transactions/meta`, bits),
      { method: "GET" }
    );
    return handle(res);
  });
}

export async function createTradeTransaction(seasonId, body, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);

  const res = await apiFetch(
    withLeagueExplicit(`/seasons/${seasonId}/transactions/trade`, bits),
    {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }
  );

  const out = await handle(res);

  // Bust caches so UI refreshes correctly
  clearApiCache(`season-transactions:${leagueKeyFromBits(bits)}:${seasonId}`);
  clearApiCache(`transactions-meta:${leagueKeyFromBits(bits)}:${seasonId}`);
  clearApiCache("season-dashboard:");

  return out;
}

export async function createFreeAgencyTransaction(seasonId, body, leagueArg) {
  const bits = normalizeLeagueBits(leagueArg);

  const res = await apiFetch(
    withLeagueExplicit(`/seasons/${seasonId}/transactions/free-agency`, bits),
    {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }
  );

  const out = await handle(res);

  clearApiCache(`season-transactions:${leagueKeyFromBits(bits)}:${seasonId}`);
  clearApiCache(`transactions-meta:${leagueKeyFromBits(bits)}:${seasonId}`);
  clearApiCache("season-dashboard:");

  return out;
}

// Fetch all games for a match
export async function getMatchGames(matchId) {
  const res = await apiFetch(`/matches/${matchId}/games`, { method: "GET" });
  return handle(res); // expect array of match_games rows
}

// Upsert one game for a match (by game_number)
export async function upsertMatchGame(matchId, gameNumber, payload) {
  const res = await apiFetch(`/matches/${matchId}/games/${gameNumber}`, {
    method: "PUT",
    body: JSON.stringify(payload ?? {}),
  });
  return handle(res);
}

// Patch match summary (series score + winner)
export async function patchMatchSummary(matchId, payload) {
  const res = await apiFetch(`/matches/${matchId}`, {
    method: "PATCH",
    body: JSON.stringify(payload ?? {}),
  });
  return handle(res);
}



// ----------------------------
// Admin
// ----------------------------

// NOTE: These endpoints require the caller to have the global role "admin".
// Suggested backend routes:
// - GET    /admin/users
// - PATCH  /admin/users/:user_id    { coach_id?: number|null, status?: "active"|"banned"|... }
// - GET    /admin/organizations     (returns orgs with leagues[])
export async function adminListUsers() {
  const res = await apiFetch(`/admin/users`, { method: "GET" });
  return handle(res);
}

export async function adminUpdateUser(userId, patch) {
  const res = await apiFetch(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch ?? {}),
  });
  return handle(res);
}

export async function getAllOrganizationsWithLeagues() {
  const res = await apiFetch(`/admin/organizations`, { method: "GET" });
  return handle(res);
}


// ---- Aliases / Admin helpers ----
export async function adminListOrgsWithLeagues() {
  return getAllOrganizationsWithLeagues();
}

// ---- Coach Accounts (admin) ----
export async function adminUpsertCoachAccount(body) {
  const res = await apiFetch(`/admin/coach_accounts`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

export async function adminDeleteCoachAccount(body) {
  const res = await apiFetch(`/admin/coach_accounts`, {
    method: "DELETE",
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

// ---- Organization Invites (admin/org owner) ----
//
// NOTE: These endpoints may differ depending on your backend routes.
// If you named them differently, change the paths here in one place.
const ORG_INVITES_BASE = "/org_invites";

export async function adminListOrgInvites(orgId) {
  const res = await apiFetch(`${ORG_INVITES_BASE}?org_id=${encodeURIComponent(orgId)}`, {
    method: "GET",
  });
  return handle(res);
}

export async function adminCreateOrgInvite(body) {
  const res = await apiFetch(`${ORG_INVITES_BASE}`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

export async function adminRevokeOrgInvite(inviteId) {
  if (inviteId == null) throw new Error("adminRevokeOrgInvite: missing inviteId");
  const res = await apiFetch(`${ORG_INVITES_BASE}/${encodeURIComponent(inviteId)}`, {
    method: "DELETE",
  });
  return handle(res);
}

// Accept an organization invite (used by InviteAccept.svelte)
// Backend route is: POST /invites/:token/accept (requires Authorization)
export async function acceptOrgInvite(token) {
  if (!token || !String(token).trim()) throw new Error("acceptOrgInvite: missing token");
  const res = await apiFetch(`/invites/${encodeURIComponent(String(token).trim())}/accept`, {
    method: "POST",
  });
  return handle(res);
}
