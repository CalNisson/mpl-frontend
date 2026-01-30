<script>
  import { onMount } from "svelte";
  import { auth } from "../lib/authStore.js";
  import { leagueContext, setOrganization, setLeague } from "../lib/leagueStore.js";
  import {
    getMyOrganizations,
    getOrganizationLeagues,
    createLeague,
    adminListOrgInvites,
    adminCreateOrgInvite,
    adminRevokeOrgInvite
  } from "../lib/api.js";

  const tokenStore = auth.token;

  // ✅ reactive token
  $: token = $tokenStore;

  // ✅ store shape: { organization, league }
  $: ctx = $leagueContext;
  $: selectedOrgSlug = ctx?.organization?.slug ?? "";
  $: selectedLeagueSlug = ctx?.league?.slug ?? "";

  let orgs = [];
  let leagues = [];
  let loadingOrgs = false;
  let loadingLeagues = false;
  let error = "";

  // ----------------------------
  // Org Admin (probe permissions via /org_invites)
  // ----------------------------
  let orgAdminReady = false;
  let isOrgAdmin = false;
  let showOrgAdmin = false;

  let orgInvites = [];
  let loadingOrgAdmin = false;
  let orgAdminError = "";
  let orgAdminMsg = "";

  // Invite form (org-scoped)
  let inviteEmail = "";
  let inviteRole = "coach"; // org_role: 'coach' | 'org_admin'
  let inviting = false;

  // Create league form (org-scoped)
  let newLeagueName = "";
  let newLeagueSlug = "";
  let newLeagueDesc = "";
  let creatingLeague = false;

  // ----------------------------
  // Pending invite filtering
  // ----------------------------
  function isPendingInvite(inv) {
    if (inv?.accepted_at) return false;

    // Treat missing expires_at as still pending (defensive)
    if (!inv?.expires_at) return true;

    const exp = new Date(inv.expires_at);
    if (Number.isNaN(exp.getTime())) return true;

    return exp.getTime() > Date.now();
  }

  $: pendingOrgInvites = (orgInvites ?? []).filter(isPendingInvite);

  function resetOrgAdminMessages() {
    orgAdminError = "";
    orgAdminMsg = "";
  }

  async function loadOrgs() {
    loadingOrgs = true;
    error = "";
    try {
      orgs = await getMyOrganizations();
    } catch (e) {
      error = e?.message || String(e);
      orgs = [];
    } finally {
      loadingOrgs = false;
    }
  }

  async function loadLeaguesForOrg(orgSlug) {
    loadingLeagues = true;
    error = "";
    try {
      leagues = await getOrganizationLeagues(orgSlug);
      leagues = [...leagues].sort((a, b) => a.id - b.id);
    } catch (e) {
      error = e?.message || String(e);
      leagues = [];
    } finally {
      loadingLeagues = false;
    }
  }

  async function refreshOrgAdminState() {
    resetOrgAdminMessages();
    orgAdminReady = false;
    isOrgAdmin = false;
    orgInvites = [];

    const orgId = ctx?.organization?.id ?? null;
    if (!token || !orgId) return;

    loadingOrgAdmin = true;
    try {
      // If this succeeds, the user is org_admin for this org (or global admin).
      orgInvites = await adminListOrgInvites(orgId);
      isOrgAdmin = true;
    } catch {
      // 403 is expected for non-org-admin users.
      isOrgAdmin = false;
      orgInvites = [];
    } finally {
      loadingOrgAdmin = false;
      orgAdminReady = true;
    }
  }

  async function onOrgChange() {
    const org = orgs.find((o) => o.slug === selectedOrgSlug) || null;

    setOrganization(org);
    setLeague(null);
    leagues = [];

    showOrgAdmin = false;
    orgAdminReady = false;
    isOrgAdmin = false;
    orgInvites = [];

    if (!org) return;
    await loadLeaguesForOrg(org.slug);
    await refreshOrgAdminState();
  }

  function onLeagueChange(e) {
    const slug = e.target.value;
    const league = leagues.find((l) => l.slug === slug) || null;
    setLeague(league);
  }

  async function submitOrgInvite() {
    resetOrgAdminMessages();
    const orgId = ctx?.organization?.id ?? null;
    if (!orgId) {
      orgAdminError = "Pick an organization first.";
      return;
    }

    const email = (inviteEmail ?? "").trim();
    if (!email) {
      orgAdminError = "Email is required.";
      return;
    }

    inviting = true;
    try {
      await adminCreateOrgInvite({
        org_id: orgId,
        email,
        role: inviteRole
      });
      inviteEmail = "";
      inviteRole = "coach";
      orgAdminMsg = "Invite created.";
      await refreshOrgAdminState();
    } catch (e) {
      orgAdminError = e?.message || String(e);
    } finally {
      inviting = false;
    }
  }

  async function deleteOrgInvite(inviteId) {
    resetOrgAdminMessages();
    const id = Number(inviteId);
    if (!Number.isFinite(id)) return;

    try {
      await adminRevokeOrgInvite(id);
      orgAdminMsg = "Invite deleted.";
      await refreshOrgAdminState();
    } catch (e) {
      orgAdminError = e?.message || String(e);
    }
  }

  async function submitCreateLeague() {
    resetOrgAdminMessages();
    const orgSlug = ctx?.organization?.slug ?? "";
    if (!orgSlug) {
      orgAdminError = "Pick an organization first.";
      return;
    }

    const name = (newLeagueName ?? "").trim();
    if (!name) {
      orgAdminError = "League name is required.";
      return;
    }

    creatingLeague = true;
    try {
      await createLeague({
        organization_slug: orgSlug,
        name,
        slug: (newLeagueSlug ?? "").trim() || undefined,
        description: (newLeagueDesc ?? "").trim() || undefined
      });

      newLeagueName = "";
      newLeagueSlug = "";
      newLeagueDesc = "";
      orgAdminMsg = "League created.";

      await loadLeaguesForOrg(orgSlug);
    } catch (e) {
      orgAdminError = e?.message || String(e);
    } finally {
      creatingLeague = false;
    }
  }

  onMount(async () => {
    if (!token) return;
    await loadOrgs();

    // ✅ if org already selected (persisted), refresh leagues list + org-admin state
    if (ctx?.organization?.slug) {
      await loadLeaguesForOrg(ctx.organization.slug);
      await refreshOrgAdminState();
    }
  });

  // If org changes via persisted store (outside of onOrgChange), keep org admin state in sync.
  let lastOrgId = null;
  $: {
    const oid = ctx?.organization?.id ?? null;
    if (oid !== lastOrgId) {
      lastOrgId = oid;
      showOrgAdmin = false;
      refreshOrgAdminState();
    }
  }
</script>

<div class="bar">
  <div class="bar-title">Select Organization & League</div>

  {#if !token}
    <div class="muted">Log in to select an organization and league.</div>
  {:else if !loadingOrgs && orgs.length === 0}
    <div class="empty">
      <div class="empty-title">You are not currently part of any Organizations/Leagues.</div>
      <div class="muted">Please reach out to your League Master to get added.</div>
    </div>
  {:else}
    <div class="row">
      <div class="field">
        <label>Organization</label>
        <select class="select" bind:value={selectedOrgSlug} on:change={onOrgChange}>
          <option value="">-- Pick an organization --</option>
          {#each orgs as o}
            <option value={o.slug}>{o.name}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label>League</label>
        <select
          class="select"
          bind:value={selectedLeagueSlug}
          on:change={onLeagueChange}
          disabled={!selectedOrgSlug || loadingLeagues}
        >
          <option value="">
            {#if !selectedOrgSlug}
              -- Pick an organization first --
            {:else if loadingLeagues}
              Loading leagues…
            {:else}
              -- Pick a league --
            {/if}
          </option>
          {#each leagues as l}
            <option value={l.slug}>{l.name}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if selectedOrgSlug && orgAdminReady && isOrgAdmin}
      <div class="admin-row">
        <button class="btn" on:click={() => (showOrgAdmin = !showOrgAdmin)}>
          {showOrgAdmin ? "Hide Org Admin" : "Org Admin"}
        </button>
        <div class="muted" style="font-size:.9rem;">
          Manage organization-scoped invites and league creation.
        </div>
      </div>
    {/if}

    {#if selectedOrgSlug && showOrgAdmin}
      <div class="admin-card">
        <div class="admin-title">Organization Admin</div>
        <div class="muted" style="margin-top: 2px;">
          Note: invites here add a user to the organization. League access/roles can be managed after they join.
        </div>

        {#if loadingOrgAdmin}
          <div class="muted" style="margin-top:.6rem;">Loading org admin tools…</div>
        {:else if orgAdminError}
          <div class="msg err" style="margin-top:.6rem;">{orgAdminError}</div>
        {:else if orgAdminMsg}
          <div class="msg ok" style="margin-top:.6rem;">{orgAdminMsg}</div>
        {/if}

        <div class="admin-grid">
          <section class="panel">
            <div class="panel-title">Invite member</div>
            <form class="form" on:submit|preventDefault={submitOrgInvite}>
              <label class="label">Email</label>
              <input class="input" type="email" bind:value={inviteEmail} placeholder="name@example.com" />

              <label class="label">Org role</label>
              <select class="select" bind:value={inviteRole}>
                <option value="coach">Coach</option>
                <option value="org_admin">Org Admin</option>
              </select>

              <button class="btn primary" type="submit" disabled={inviting}>
                {inviting ? "Inviting…" : "Create invite"}
              </button>
            </form>
          </section>

          <section class="panel">
            <div class="panel-title">Create league</div>
            <form class="form" on:submit|preventDefault={submitCreateLeague}>
              <label class="label">League name</label>
              <input class="input" bind:value={newLeagueName} placeholder="e.g. Major League" />

              <label class="label">Slug (optional)</label>
              <input class="input" bind:value={newLeagueSlug} placeholder="e.g. major" />

              <label class="label">Description (optional)</label>
              <input class="input" bind:value={newLeagueDesc} placeholder="Short description" />

              <button class="btn primary" type="submit" disabled={creatingLeague}>
                {creatingLeague ? "Creating…" : "Create league"}
              </button>
            </form>
          </section>
        </div>

        <section class="panel" style="margin-top: 12px;">
          <div class="panel-title">Pending org invites</div>

          <div class="muted" style="margin-top: 6px; font-size:.9rem;">
            Showing invites that are not accepted and not expired.
          </div>

          {#if (pendingOrgInvites ?? []).length === 0}
            <div class="muted" style="margin-top: 6px;">No pending invites.</div>
          {:else}
            <div class="invite-list">
              {#each pendingOrgInvites as inv (inv.id)}
                <div class="invite-row">
                  <div class="invite-left">
                    <div class="invite-email">{inv.email}</div>
                    <div class="muted" style="font-size:.85rem;">
                      Role: {inv.role}
                      {#if inv.created_at}
                        • Created: {inv.created_at}
                      {/if}
                      {#if inv.expires_at}
                        • Expires: {inv.expires_at}
                      {/if}
                    </div>
                  </div>
                  <button class="btn" on:click={() => deleteOrgInvite(inv.id)}>Delete</button>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      </div>
    {/if}
  {/if}

  {#if error}
    <div class="error">⚠ {error}</div>
  {/if}
</div>

<style>
  .bar {
    margin-top: 0.75rem;
    padding: 0.9rem 1rem;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .bar-title {
    font-weight: 800;
    margin-bottom: 0.5rem;
    opacity: 0.95;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    align-items: end;
  }
  @media (max-width: 900px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
  .field label {
    display: block;
    font-size: 0.85rem;
    opacity: 0.8;
    margin-bottom: 0.3rem;
  }
  .select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .muted {
    opacity: 0.75;
  }
  .empty {
    padding: 0.75rem;
    border-radius: 14px;
    border: 1px dashed rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.03);
  }
  .empty-title {
    font-weight: 800;
    margin-bottom: 0.25rem;
  }
  .error {
    margin-top: 0.6rem;
    color: #fecaca;
  }

  .admin-row {
    margin-top: 0.75rem;
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .btn {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.92);
    padding: 0.55rem 0.9rem;
    border-radius: 12px;
    cursor: pointer;
    font-weight: 900;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .primary {
    background: rgba(255, 107, 107, 0.18);
    border-color: rgba(255, 107, 107, 0.35);
  }
  .primary:hover {
    background: rgba(255, 107, 107, 0.24);
  }

  .admin-card {
    margin-top: 0.75rem;
    border-radius: 16px;
    padding: 0.9rem 1rem;
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .admin-title {
    font-weight: 900;
    font-size: 1.05rem;
  }
  .admin-grid {
    margin-top: 12px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 900px) {
    .admin-grid {
      grid-template-columns: 1fr;
    }
  }

  .panel {
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    padding: 12px;
  }
  .panel-title {
    font-weight: 900;
    margin-bottom: 8px;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .label {
    font-weight: 900;
    font-size: 0.85rem;
    opacity: 0.9;
  }
  .input {
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.18);
    color: rgba(255, 255, 255, 0.92);
    padding: 0.55rem 0.75rem;
    outline: none;
  }
  .input:focus {
    border-color: rgba(255, 107, 107, 0.35);
    box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.12);
  }

  .msg {
    padding: 0.55rem 0.75rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
  }
  .msg.ok {
    border-color: rgba(34, 197, 94, 0.45);
    color: rgba(187, 247, 208, 0.95);
  }
  .msg.err {
    border-color: rgba(248, 113, 113, 0.55);
    color: #fecaca;
  }

  .invite-list {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .invite-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.14);
  }
  .invite-email {
    font-weight: 900;
  }
</style>
