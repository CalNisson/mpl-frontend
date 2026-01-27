<script>
  import { onMount } from "svelte";
  import { acceptOrgInvite } from "../lib/api.js";
  import { clearLeagueContext } from "../lib/leagueStore.js";
  import { clearApiCache } from "../lib/api.js";
  import { push } from "svelte-spa-router";

  let token = "";
  let loading = false;
  let error = "";
  let done = false;

  function getHashQueryParam(key) {
    const hash = window.location.hash || "";
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return null;
    const qs = hash.slice(qIndex + 1);
    return new URLSearchParams(qs).get(key);
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

      // Send them to the organizations page (or home) after a short tick
      push("/organizations");
    } catch (e) {
      error = e?.message || "Failed to accept invite.";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    token = getHashQueryParam("token") ?? "";
    if (token) accept();
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
    <label>
      Invite token
      <input type="text" bind:value={token} placeholder="paste token" />
    </label>

    <button class="btn" on:click={accept} disabled={loading}>
      {loading ? "Accepting…" : "Accept"}
    </button>
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
  .error {
    margin-top: 10px;
    padding: 10px;
    border-radius: 10px;
    background: rgba(255,0,0,0.12);
    border: 1px solid rgba(255,0,0,0.25);
  }
</style>
