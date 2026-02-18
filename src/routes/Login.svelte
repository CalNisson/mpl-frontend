<script>
  import { push } from "svelte-spa-router";
  import { login, getMe } from "../lib/api.js";

  let emailOrUsername = "";
  let password = "";
  let loading = false;
  let error = "";

  async function submit() {
    error = "";
    loading = true;
    try {
      await login({ emailOrUsername, password });
      await getMe(); // populate auth.me
      push("/");     // go home
    } catch (e) {
      error = e?.message ?? "Login failed";
    } finally {
      loading = false;
    }
  }

  function goResetPassword() {
    push("/forgot-password");
  }
</script>

<div class="card">
  <h2>Login</h2>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <form on:submit|preventDefault={submit}>
    <label>
      Email or Username
      <input bind:value={emailOrUsername} autocomplete="username" />
    </label>

    <label>
      Password
      <input type="password" bind:value={password} autocomplete="current-password" />
    </label>

    <div class="actions">
      <button disabled={loading}>
        {loading ? "Logging in..." : "Login"}
      </button>

      <button type="button" class="btn-secondary" disabled={loading} on:click={goResetPassword}>
        Reset Password
      </button>
    </div>
  </form>
</div>

<style>
  .card { max-width: 420px; margin: 24px auto; padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,.12); }
  label { display:block; margin: 10px 0; }
  input { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(0,0,0,.2); color: white; }
  .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
  button { padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255,107,107,.35); background: rgba(255,107,107,.22); color: white; font-weight: 700; cursor: pointer; }
  .btn-secondary { border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.06); }
  button:disabled { opacity: .6; cursor: not-allowed; }
  .error { margin: 10px 0; padding: 10px; border-radius: 12px; background: rgba(255,0,0,.15); border: 1px solid rgba(255,0,0,.25); }
</style>
