<script>
  import { onMount } from "svelte";
  import {
    adminListOrgsWithLeagues,
    adminListOrgInvites,
    adminCreateOrgInvite,
    adminRevokeOrgInvite
  } from "../lib/api.js";

  let loadingOrgs = true;
  let loadingInvites = false;
  let error = "";

  let orgs = [];
  let selectedOrgId = "";

  // form
  let inviteEmail = "";
  // Backend currently validates org roles as: "coach" | "org_admin"
  let inviteRole = "coach";

  let invites = [];

  async function loadOrgs() {
    loadingOrgs = true;
    error = "";
    try {
      orgs = await adminListOrgsWithLeagues();
      if (!selectedOrgId && orgs.length) selectedOrgId = String(orgs[0].id);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loadingOrgs = false;
    }
  }

  async function loadInvites() {
    if (!selectedOrgId) return;
    loadingInvites = true;
    error = "";
    try {
      invites = await adminListOrgInvites(Number(selectedOrgId));
    } catch (e) {
      error = e?.message ?? String(e);
      invites = [];
    } finally {
      loadingInvites = false;
    }
  }

  $: if (selectedOrgId) {
    // refresh invites when org changes
    loadInvites();
  }

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email) return;

    error = "";
    try {
      await adminCreateOrgInvite({
        org_id: Number(selectedOrgId),
        email,
        role: inviteRole
      });
      inviteEmail = "";
      await loadInvites();
    } catch (e) {
      error = e?.message ?? String(e);
    }
  }

  async function revoke(inv) {
    error = "";
    try {
      if (inv?.id == null) throw new Error("Invite is missing id");
      await adminRevokeOrgInvite(inv.id);
      await loadInvites();
    } catch (e) {
      error = e?.message ?? String(e);
    }
  }

  function fmt(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  }

  onMount(loadOrgs);
</script>

<div class="card">
  <h3>Organization Invites</h3>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="row">
    <label>
      Organization
      <select bind:value={selectedOrgId} disabled={loadingOrgs}>
        {#each orgs as o}
          <option value={String(o.id)}>{o.name} (#{o.id})</option>
        {/each}
      </select>
    </label>

    <label>
      Role
      <select bind:value={inviteRole}>
        <option value="coach">coach</option>
        <option value="org_admin">org_admin</option>
      </select>
    </label>

    <label style="flex: 2 1 340px;">
      Email
      <input
        type="email"
        placeholder="someone@example.com"
        bind:value={inviteEmail}
        on:keydown={(e) => e.key === "Enter" && sendInvite()}
      />
    </label>

    <div style="display:flex; align-items:flex-end;">
      <button class="primary" on:click={sendInvite} disabled={!selectedOrgId || !inviteEmail.trim()}>
        Send invite
      </button>
    </div>
  </div>

  <div style="margin-top: 10px;">
    {#if loadingInvites}
      <div class="muted">Loading invites…</div>
    {:else if invites.length === 0}
      <div class="muted">No pending invites for this organization.</div>
    {:else}
      <table class="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            <th>Expires</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each invites as inv}
            <tr>
              <td>{inv.email}</td>
              <td>{inv.role ?? ""}</td>
              <td>{inv.status ?? (inv.accepted_at ? "accepted" : "pending")}</td>
              <td>{fmt(inv.created_at)}</td>
              <td>{fmt(inv.expires_at)}</td>
              <td style="text-align:right;">
                <button class="danger" on:click={() => revoke(inv)}>Revoke</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      {#if invites.some((i) => i.token)}
        <div class="muted" style="margin-top:8px;">
          Tip: if your backend returns <code>token</code>, you can add a “Copy link” button here easily.
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .card {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    padding: 12px;
    margin-top: 12px;
  }
  h3 { margin: 0 0 10px 0; }
  .row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  label { display:flex; flex-direction:column; gap:6px; min-width: 180px; }
  input, select, button { font: inherit; }
  input, select {
    padding: 10px 10px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(0,0,0,0.2);
    color: inherit;
  }
  button {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.08);
    color: inherit;
    cursor: pointer;
  }
  button.primary { background: rgba(255,107,107,0.9); border-color: rgba(255,107,107,0.9); }
  button.danger { background: rgba(239,68,68,0.75); border-color: rgba(239,68,68,0.8); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .muted { opacity: 0.75; }
  .error {
    margin: 8px 0 10px 0;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid rgba(239,68,68,0.55);
    background: rgba(239,68,68,0.12);
  }
  .table { width: 100%; border-collapse: collapse; }
  .table th, .table td { padding: 8px 8px; border-bottom: 1px solid rgba(255,255,255,0.10); }
  .table th { text-align: left; opacity: 0.85; font-weight: 600; }
</style>
