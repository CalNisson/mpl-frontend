<script>
  import { push } from "svelte-spa-router";
  import { register, login, getMe } from "../lib/api.js";

  let email = "";
  let username = "";
  let password = "";
  let loading = false;
  let error = "";

  async function submit() {
    error = "";
    loading = true;
    try {
      await register({ email, username, password });
      // immediately log in after registering
      await login({ emailOrUsername: email, password });
      await getMe();
      push("/");
    } catch (e) {
      error = e?.message ?? "Registration failed";
    } finally {
      loading = false;
    }
  }
</script>

<div class="card">
  <h2>Register</h2>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <form on:submit|preventDefault={submit}>
    <label>
      Email
      <input type="email" bind:value={email} autocomplete="email" />
    </label>

    <label>
      Username
      <input bind:value={username} autocomplete="username" />
    </label>

    <label>
      Password
      <input type="password" bind:value={password} autocomplete="new-password" />
    </label>

    <button disabled={loading}>
      {loading ? "Creating..." : "Create account"}
    </button>
  </form>
</div>

<style>
  .card { max-width: 420px; margin: 24px auto; padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,.12); }
  label { display:block; margin: 10px 0; }
  input { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(0,0,0,.2); color: white; }
  button { margin-top: 12px; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255,107,107,.35); background: rgba(255,107,107,.22); color: white; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .6; cursor: not-allowed; }
  .error { margin: 10px 0; padding: 10px; border-radius: 12px; background: rgba(255,0,0,.15); border: 1px solid rgba(255,0,0,.25); }
</style>
