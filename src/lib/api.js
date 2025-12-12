// src/lib/api.js

// You can override this with VITE_API_BASE_URL in a .env file if you want.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';

async function handle(res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getSeasons() {
  const res = await fetch(`${API_BASE}/seasons`);
  return handle(res);
}

// This expects the JSON shape: { season, teams, matches, pokemon_stats }
export async function getSeasonDashboard(seasonId) {
  const res = await fetch(`${API_BASE}/seasons/${seasonId}/dashboard`);
  return handle(res);
}

export async function getSeasonBadges(seasonId) {
  const res = await fetch(`${API_BASE}/seasons/${seasonId}/badges`);
  return handle(res);
}

export async function getCoaches(leagueType = "major") {
  const res = await fetch(`${API_BASE}/coaches?league_type=${encodeURIComponent(leagueType)}`);
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}