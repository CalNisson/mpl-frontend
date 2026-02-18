<script>
  import { onMount } from "svelte";
  import { acceptOrgInvite, acceptOrgInviteRegister, getInvitePublic } from "../lib/api.js";
  import { auth } from "../lib/authStore.js";
  import { clearLeagueContext } from "../lib/leagueStore.js";
  import { clearApiCache } from "../lib/api.js";
  import { push } from "svelte-spa-router";

  let token = "";
  let loading = false;
  let error = "";
  let done = false;

  let inviteInfo = null;
  let username = "";
  let password = "";
  let confirm = "";
  let needsRegister = false;

  function getHashQueryParam(key) {
    const hash = window.location.hash || "";
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return null;
    const qs = hash.slice(qIndex + 1);
    return new URLSearchParams(qs).get(key);
  }

  async function registerAndAccept() {
    error = "";
    done = false;

    const t = (token || "").trim();
    if (!t) {
      error = "Missing invite token.";
      return;
    }
    if (!username.trim()) {
      error = "Username is required.";
      return;
    }
    if (!password || password.length < 8) {
      error = "Password must be at least 8 characters.";
      return;
    }
    if (password !== confirm) {
      error = "Passwords do not match.";
      return;
    }

    loading = true;
    try {
      const out = await acceptOrgInviteRegister(t, { username: username.trim(), password });
      if (out?.token) auth.setToken(out.token);

      clearApiCache();
      clearLeagueContext();

      done = true;
      try {
        localStorage.setItem(
          "mpl.flash",
          JSON.stringify({ kind: "ok", text: "Invite accepted" })
        );
      } catch {}
      push("/");
    } catch (e) {
      error = e?.message || "Failed to register from invite.";
    } finally {
      loading = false;
    }
  }

  async function accept() {
    error = "";
    done = false;

    const t = (token || "").trim();
    if (!t) {
      error = "Missing invite token.";
      return;
    }

    loading = true;
    try {
      await acceptOrgInvite(t);

      // Membership changed: clear cached org/league data and context so UI refreshes immediately
      clearApiCache();
      clearLeagueContext();

      done = true;
      try {
        localStorage.setItem(
          "mpl.flash",
          JSON.stringify({ kind: "ok", text: "Invite accepted" })
        );
      } catch {}
      push("/");
    } catch (e) {
      const msg = e?.message || "";
      // If they're not logged in yet, show a register-from-invite form
      if (msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("401")) {
        needsRegister = true;
      } else {
        error = msg || "Failed to accept invite.";
      }
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    token = getHashQueryParam("token") ?? "";
    if (!token) return;

    try {
      inviteInfo = await getInvitePublic(token);
    } catch {
      // ignore; accept() will show the actual error
    }

    // If already logged in, attempt accept immediately.
    if (auth.getToken()) accept();
    else needsRegister = true;
  });
</script>

<div class="card">
  <h2>Accept invite</h2>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if done}
    <p>Invite accepted. Redirecting…</p>
  {:else}
    {#if inviteInfo}
      <p class="muted">
        Invited email: <b>{inviteInfo.email}</b>
        &nbsp;•&nbsp; Role: <b>{inviteInfo.role}</b>
      </p>
    {/if}

    <label>
      Invite token
      <input type="text" bind:value={token} placeholder="paste token" />
    </label>

    {#if needsRegister}
      <div class="sep"></div>
      <h3>Create account</h3>
      <label>
        Username
        <input type="text" bind:value={username} placeholder="choose a username" />
      </label>
      <label>
        Password
        <input type="password" bind:value={password} placeholder="at least 8 characters" />
      </label>
      <label>
        Confirm password
        <input type="password" bind:value={confirm} placeholder="repeat password" />
      </label>

      <button class="btn" on:click={registerAndAccept} disabled={loading}>
        {loading ? "Creating…" : "Create account & accept"}
      </button>

      <p class="muted">
        Already have an account? Log in first, then come back to this link.
      </p>
    {:else}
      <button class="btn" on:click={accept} disabled={loading}>
        {loading ? "Accepting…" : "Accept"}
      </button>
    {/if}
  {/if}
</div>

<style>
  .card {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    padding: 12px;
    max-width: 720px;
    margin: 0 auto;
  }
  label { display: grid; gap: 6px; margin-top: 10px; }
  input {
    font: inherit;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(0,0,0,0.15);
    color: inherit;
  }
  .btn {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.12);
    background: #ff6b6b;
    color: #0b1020;
    font-weight: 600;
    cursor: pointer;
  }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .muted { opacity: 0.8; font-size: 0.95rem; }
  .sep { height: 1px; background: rgba(255,255,255,0.12); margin: 14px 0; }
  h3 { margin: 10px 0 6px; font-size: 1.05rem; }

  .error {
    margin-top: 10px;
    padding: 10px;
    border-radius: 10px;
    background: rgba(255,0,0,0.12);
    border: 1px solid rgba(255,0,0,0.25);
  }
</style>
