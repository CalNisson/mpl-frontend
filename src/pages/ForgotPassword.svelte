<script>
  import { push } from "svelte-spa-router";
  import { passwordResetRequest } from "../lib/api.js";

  let emailOrUsername = "";
  let loading = false;
  let error = "";
  let done = false;

  async function submit() {
    error = "";
    done = false;
    loading = true;
    try {
      await passwordResetRequest({ emailOrUsername });
      done = true;
    } catch (e) {
      // Still don't leak existence; show generic error
      error = e?.message ?? "Request failed";
    } finally {
      loading = false;
    }
  }
</script>

<div class="card">
  <h2>Forgot Password</h2>
  <p class="muted">Enter your email (or username) and we’ll send a reset link if an account exists.</p>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if done}
    <div class="ok">
      If an account matches, a password reset email has been sent.
    </div>
    <button class="btn" on:click={() => push("/login")}>Back to Login</button>
  {:else}
    <label class="label">Email or Username</label>
    <input class="input" bind:value={emailOrUsername} placeholder="you@example.com" />

    <div class="row">
      <button class="btn primary" disabled={loading || !emailOrUsername.trim()} on:click={submit}>
        {loading ? "Sending…" : "Send reset link"}
      </button>
      <button class="btn" disabled={loading} on:click={() => push("/login")}>Cancel</button>
    </div>
  {/if}
</div>

<style>
  .card{
    max-width: 520px;
    margin: 24px auto;
    padding: 16px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(255,255,255,0.04);
  }
  .muted{ opacity: 0.75; }
  .label{ display:block; font-weight: 800; margin-top: 12px; margin-bottom: 6px; }
  .input{
    width: 100%;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.18);
    color: rgba(255,255,255,0.92);
    outline: none;
    box-sizing: border-box;
  }
  .row{ display:flex; gap:10px; margin-top: 14px; flex-wrap: wrap; }
  .btn{
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.92);
    font-weight: 900;
    cursor: pointer;
  }
  .btn:disabled{ opacity: 0.6; cursor: not-allowed; }
  .btn.primary{
    border-color: rgba(255,107,107,0.35);
    background: rgba(255,107,107,0.18);
  }
  .error{
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(231,76,60,0.45);
    color: rgba(255,200,200,0.95);
    background: rgba(231,76,60,0.10);
  }
  .ok{
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(187,247,208,0.35);
    color: rgba(187,247,208,0.95);
    background: rgba(187,247,208,0.10);
    font-weight: 800;
  }
</style>
