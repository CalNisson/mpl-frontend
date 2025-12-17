// src/lib/leagueStore.js
import { writable, get } from "svelte/store";

const KEY = "mpl.leagueContext.v2";

/**
 * Shape is ALWAYS stable:
 * {
 *   organization: {...} | null,
 *   league: {...} | null
 * }
 */
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && typeof v === "object") {
      return {
        organization: v.organization ?? null,
        league: v.league ?? null,
      };
    }
  } catch {}
  return {
    organization: null,
    league: null,
  };
}

export const leagueContext = writable(load());

leagueContext.subscribe((v) => {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {}
});

/* -----------------------------
   Mutators
----------------------------- */

export function setOrganization(organization) {
  leagueContext.set({
    organization,
    league: null, // reset league when org changes
  });
}

export function setLeague(league) {
  leagueContext.update((cur) => ({
    ...cur,
    league,
  }));
}

export function clearLeagueContext() {
  leagueContext.set({
    organization: null,
    league: null,
  });
}

/**
 * ✅ Back-compat: some components may still call setLeagueContext({ organization, league })
 */
export function setLeagueContext(ctx) {
  leagueContext.set({
    organization: ctx?.organization ?? null,
    league: ctx?.league ?? null,
  });
}

/* -----------------------------
   Selectors
----------------------------- */

export function getOrganization() {
  return get(leagueContext).organization;
}

export function getLeague() {
  return get(leagueContext).league;
}

export function getLeagueId() {
  return get(leagueContext).league?.id ?? null;
}

export function getLeagueSlug() {
  return get(leagueContext).league?.slug ?? null;
}
