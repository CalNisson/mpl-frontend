<script>
  import { onMount } from "svelte";
  import {
    adminListOrgsWithLeagues,
    adminListOrgInvites,
    adminCreateOrgInvite,
    adminRevokeOrgInvite,
    adminListOrgCoaches
  } from "../lib/api.js";

  let loadingOrgs = true;
  let loadingInvites = false;
  let loadingCoaches = false;
  let error = "";

  let orgs = [];
  let selectedOrgId = "";

  // form
  let inviteEmail = "";
  let inviteRole = "coach";

  // Existing coach selection
  let existingCoach = false;
  let coaches = [];
  let coachId = "";

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

  async function loadCoaches() {
    if (!selectedOrgId) return;
    loadingCoaches = true;
    error = "";
    try {
      coaches = await adminListOrgCoaches(Number(selectedOrgId));
      // Reset selection if the current coachId isn't in this org’s list
      if (coachId && !coaches.some((c) => String(c.id) === String(coachId))) {
        coachId = "";
      }
    } catch (e) {
      error = e?.message ?? String(e);
      coaches = [];
      coachId = "";
    } finally {
      loadingCoaches = false;
    }
  }

  $: if (selectedOrgId) {
    loadInvites();
    if (existingCoach) loadCoaches();
    else {
      coaches = [];
      coachId = "";
    }
  }

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email) return;

    error = "";
    try {
      const payload = {
        org_id: Number(selectedOrgId),
        email,
        role: inviteRole
      };

      if (existingCoach) {
        const cid = Number(coachId);
        if (!cid || Number.isNaN(cid)) {
          throw new Error("Please select an existing coach.");
        }
        payload.coach_id = cid;
      }

      await adminCreateOrgInvite(payload);

      inviteEmail = "";
      coachId = "";
      existingCoach = false;

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
      <select class="select" bind:value={selectedOrgId} disabled={loadingOrgs}>
        {#each orgs as o}
          <option value={String(o.id)}>{o.name} (#{o.id})</option>
        {/each}
      </select>
    </label>

    <label>
      Role
      <select class="select" bind:value={inviteRole}>
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

    <div class="coachSlot">
      <label class="toggle">
        <input type="checkbox" bind:checked={existingCoach} />
        <span class="labelText">Link existing coach</span>
        <span class="track" aria-hidden="true"></span>
      </label>

      <label class="coachPicker">
        Coach
        <select
          class="select"
          bind:value={coachId}
          disabled={!existingCoach || loadingCoaches}
          class:disabled={!existingCoach}
        >
          <option value="">
            {existingCoach ? (loadingCoaches ? "Loading…" : "Select coach…") : "Disabled"}
          </option>
          {#each coaches as c}
            <option value={String(c.id)}>{c.name} (#{c.id})</option>
          {/each}
        </select>
      </label>
    </div>

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
            <th>Coach</th>
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
              <td>{inv.coach_id ? `#${inv.coach_id}` : ""}</td>
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
  .toggle input[type="checkbox"] {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    margin: 0;
    padding: 0;
    pointer-events: none;
  }
  input {
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
  /* Reserve space so nothing jumps */
  .coachSlot {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    min-width: 440px; /* reserves room for toggle + select */
  }

  /* Nice toggle (text on top, switch below, stays inside pill) */
.toggle {
  position: relative;

  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto;
  justify-items: center;   /* ⬅ centers horizontally */
  align-items: center;     /* ⬅ centers vertically */

  gap: 4px;
  padding: 6px 0px;       /* ⬅ smaller padding = smaller box */
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.04);

  line-height: 1.1;
}


.labelText {
  opacity: 0.9;
  white-space: nowrap;
  font-size: 12px;
  margin: 0;           /* ensure it doesn't push out */
  padding: 0;
}

.toggle .track {
  width: 44px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(0,0,0,0.25);
  position: relative;
  transition: background 140ms ease, border-color 140ms ease;
}

/* keep the knob the same */
.toggle .track::after {
  content: "";
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: rgba(255,255,255,0.82);
  position: absolute;
  top: 50%;
  left: 3px;
  transform: translateY(-50%);
  transition: transform 140ms ease;
}

.toggle input:checked ~ .track {
  background: rgba(255,107,107,0.35);
  border-color: rgba(255,107,107,0.65);
}

.toggle input:checked ~ .track::after {
  transform: translate(20px, -50%);
}


  /* Coach picker stays mounted; just fades/locks */
  .coachPicker {
    min-width: 260px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .coachPicker select.disabled {
    opacity: 0.55;
  }

</style>
