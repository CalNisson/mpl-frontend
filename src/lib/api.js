// src/lib/api.js

// You can override this with VITE_API_BASE_URL in a .env file if you want.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function handle(res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
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
// API calls
// ----------------------------

export async function getSeasons() {
  return cached("seasons", async () => {
    const res = await fetch(`${API_BASE}/seasons`);
    return handle(res);
  });
}

export async function getSeasonDashboard(seasonId) {
  return cached(`season-dashboard:${seasonId}`, async () => {
    const res = await fetch(`${API_BASE}/seasons/${seasonId}/dashboard`);
    return handle(res);
  });
}

export async function getSeasonBadges(seasonId) {
  return cached(`season-badges:${seasonId}`, async () => {
    const res = await fetch(`${API_BASE}/seasons/${seasonId}/badges`);
    return handle(res);
  });
}

export async function getCoaches(leagueType = "major") {
  const qs = leagueType ? `?league_type=${encodeURIComponent(leagueType)}` : "";
  return cached(`coaches:${leagueType}`, async () => {
    const res = await fetch(`${API_BASE}/coaches${qs}`);
    return handle(res);
  });
}

export async function getPokemonCareerStats() {
  return cached("pokemon-career-stats", async () => {
    const res = await fetch(`${API_BASE}/pokemon/stats`);
    return handle(res);
  });
}

export async function runPokemonStatsRollup() {
  const res = await fetch(`${API_BASE}/pokemon/stats/run`);
  const out = await handle(res);
  clearApiCache("pokemon-career-stats");
  return out;
}

export async function getCoachCrosstable(namesCsv = "", leagueType = "") {
  const params = new URLSearchParams();
  if (namesCsv?.trim()) params.set("names", namesCsv.trim());
  if (leagueType?.trim()) params.set("league_type", leagueType.trim());

  const qs = params.toString() ? `?${params.toString()}` : "";
  const key = `crosstable:${params.toString() || "all"}`;

  return cached(key, async () => {
    const res = await fetch(`${API_BASE}/coaches/crosstable${qs}`);
    return handle(res);
  });
}

export async function refreshCoachCrosstableCache() {
  const res = await fetch(`${API_BASE}/coaches/crosstable/refresh`, { method: "POST" });
  const out = await handle(res);
  clearApiCache("crosstable:");
  return out;
}

export async function getMvps(leagueType) {
  const qs = leagueType ? `?league_type=${encodeURIComponent(leagueType)}` : "";
  const key = `mvps:${leagueType || "all"}`;

  return cached(key, async () => {
    const res = await fetch(`${API_BASE}/mvps${qs}`);
    return handle(res);
  });
}

export async function getBadges(leagueType = "major") {
  const qs = leagueType ? `?league_type=${encodeURIComponent(leagueType)}` : "";
  const key = `badges:${leagueType}`;

  return cached(key, async () => {
    const res = await fetch(`${API_BASE}/badges${qs}`);
    return handle(res);
  });
}

export async function getCoachProfileByName(name) {
  return cached(`coach-profile:${name.toLowerCase()}`, async () => {
    const res = await fetch(`${API_BASE}/coaches/by-name/${encodeURIComponent(name)}/profile`);
    return handle(res);
  });
}

export async function getCoachSeasonDetails(coachId, seasonId) {
  return cached(`coach-season-details:${coachId}:${seasonId}`, async () => {
    const res = await fetch(`${API_BASE}/coaches/${coachId}/seasons/${seasonId}/details`);
    return handle(res);
  });
}