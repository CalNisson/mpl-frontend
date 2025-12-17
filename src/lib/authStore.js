// src/lib/authStore.js
import { writable, get } from "svelte/store";

const TOKEN_KEY = "mpl_token";

function createAuthStore() {
  const token = writable(localStorage.getItem(TOKEN_KEY) || "");
  const me = writable(null); // will hold user profile from /auth/me when logged in

  function setToken(t) {
    const next = t || "";
    token.set(next);
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
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
