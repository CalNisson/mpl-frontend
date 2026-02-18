<script>
  import { push } from "svelte-spa-router";
  import { passwordResetConfirm } from "../lib/api.js";

  function getTokenFromHash() {
    // hash looks like "#/reset-password?token=XYZ"
    const h = window.location.hash || "";
    const qIndex = h.indexOf("?");
    if (qIndex < 0) return "";
    const qs = h.slice(qIndex + 1);
    const params = new URLSearchParams(qs);
    return params.get("token") || "";
  }

  let token = getTokenFromHash();
  let newPassword = "";
  let confirmPassword = "";
  let loading = false;
  let error = "";
  let done = false;

  async function submit() {
    error = "";
    done = false;

    if (!token) {
      error = "Missing reset token.";
      return;
    }
    if (newPassword.length < 8) {
      error = "Password must be at least 8 characters.";
      return;
    }
    if (newPassword !== confirmPassword) {
      error = "Passwords do not match.";
      return;
    }

    loading = true;
    try {
      await passwordResetConfirm({ token, newPassword });
      done = true;
    } catch (e) {
      error = e?.message ?? "Reset failed";
    } finally {
      loading = false;
    }
  }
</script>

<div class="card">
  <h2>Reset Password</h2>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if done}
    <div class="ok">Password updated. You can now log in.</div>
    <button class="btn primary" on:click={() => push("/login")}>Go to Login</button>
  {:else}
    <label class="label">New password</label>
    <input class="input" type="password" bind:value={newPassword} placeholder="New password" />

    <label class="label">Confirm password</label>
    <input class="input" type="password" bind:value={confirmPassword} placeholder="Confirm password" />

    <div class="row">
      <button class="btn primary" disabled={loading} on:click={submit}>
        {loading ? "Saving…" : "Set new password"}
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
