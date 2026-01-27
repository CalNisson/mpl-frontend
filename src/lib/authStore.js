// src/lib/authStore.js
import { writable, get } from "svelte/store";
import { clearApiCache } from "./api.js";
import { clearLeagueContext } from "./leagueStore.js";

const TOKEN_KEY = "mpl_token";

function createAuthStore() {
  const token = writable(localStorage.getItem(TOKEN_KEY) || "");
  const me = writable(null);

  function setToken(t) {
    const next = t || "";
    const prev = get(token) || "";
    const changed = prev !== next;

    token.set(next);
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);

    if (changed) {
      clearApiCache();
      clearLeagueContext();
    }
  }

  function clear() {
    setToken("");
    me.set(null);
  }

  return {
    token,
    me,
    setToken,
    clear,
    getToken: () => get(token),
  };
}

export const auth = createAuthStore();
