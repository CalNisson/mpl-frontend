<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { push } from "svelte-spa-router";
  import OrgInvitesManager from "../components/OrgInvitesManager.svelte";
  import { auth } from "../lib/authStore.js";
  import {
    getMe,
    getAllCoaches,
    createOrganization,
    getAllOrganizationsWithLeagues,
    adminListUsers,
    adminUpdateUser,
    adminUpsertCoachAccount,
  } from "../lib/api.js";

  const meStore = auth.me;
  const tokenStore = auth.token;

  $: me = $meStore;
  $: token = $tokenStore;

  $: isAdmin = Array.isArray(me?.global_roles) && me.global_roles.includes("admin");

  let tab = "users"; // users | orgs | invites
  let loading = false;
  let error = "";

  // ---- Users ----
  let users = [];
  let coaches = [];
  let orgs = []; // for coach link modal
  let savingUserId = null;

  // Actions menu state (floating overlay)
  let openMenuUserId = null;
  let menuPos = { top: 0, left: 0 };

  // Link Coach modal state
  let showLinkModal = false;
  let linkingUser = null; // user being edited
  let coachFilter = "";
  let selectedCoachId = null;
  let selectedOrgId = null;

  // ---- Create Org ----
  let newOrg = { name: "", slug: "", description: "" };
  let creatingOrg = false;

  function resetMsg() {
    error = "";
  }

  function statusLabel(s) {
    const v = (s ?? "").toString().toLowerCase();
    return v || "unknown";
  }

  function orgNameById(id) {
    const oid = Number(id);
    const o = (orgs ?? []).find((x) => Number(x.id) === oid);
    return o ? o.name : `Org #${id}`;
  }

  async function loadUsersTab() {
    loading = true;
    resetMsg();
    openMenuUserId = null;

    try {
      const [u, c, o] = await Promise.all([
        adminListUsers(),
        getAllCoaches(),
        getAllOrganizationsWithLeagues(),
      ]);

      users = Array.isArray(u) ? u : [];

      const raw = Array.isArray(c) ? c : [];
      coaches = raw.map((x) => ({
        id: x.id,
        name:
          x.name ??
          x.coach_name ??
          x.coachName ??
          x.display_name ??
          x.displayName ??
          x.username ??
          "",
      }));

      orgs = Array.isArray(o) ? o : [];
    } catch (e) {
      error = e?.message || String(e);
      users = [];
      coaches = [];
      orgs = [];
    } finally {
      loading = false;
    }
  }

  async function loadOrgsTab() {
    loading = true;
    resetMsg();
    openMenuUserId = null;

    try {
      orgs = await getAllOrganizationsWithLeagues();
      if (!Array.isArray(orgs)) orgs = [];
    } catch (e) {
      error = e?.message || String(e);
      orgs = [];
    } finally {
      loading = false;
    }
  }

  async function refreshCurrentTab() {
    if (tab === "users") return loadUsersTab();
    if (tab === "orgs") return loadOrgsTab();
    // invites manager loads itself; nothing to do here
  }

  async function saveUser(user, patch) {
    savingUserId = user.id;
    resetMsg();
    try {
      const updated = await adminUpdateUser(user.id, patch);
      users = users.map((u) => (u.id === user.id ? updated : u));
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      savingUserId = null;
    }
  }

  // ------------------------
  // Actions: floating menu
  // ------------------------
  function toggleMenu(userId, event) {
    if (openMenuUserId === userId) {
      openMenuUserId = null;
      return;
    }

    const btn = event?.currentTarget;
    if (!btn || !btn.getBoundingClientRect) {
      openMenuUserId = userId;
      return;
    }

    const r = btn.getBoundingClientRect();

    const width = 200;
    const margin = 8;

    let left = r.right - width;
    let top = r.bottom + 6;

    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    const estimatedHeight = 120;
    if (top + estimatedHeight > window.innerHeight - margin) {
      top = r.top - estimatedHeight - 6;
      top = Math.max(margin, top);
    }

    menuPos = { top, left };
    openMenuUserId = userId;
  }

  function onGlobalClick(e) {
    const el = e?.target;
    if (!el) return;
    if (el.closest?.(".kebab")) return;
    if (el.closest?.(".menu-float")) return;
    if (el.closest?.(".modal")) return;
    openMenuUserId = null;
  }

  function onGlobalKeydown(e) {
    if (e.key === "Escape") {
      if (openMenuUserId != null) openMenuUserId = null;
      if (showLinkModal) closeLinkCoach();
    }
  }

  // ------------------------
  // Link Coach modal
  // ------------------------
  function openLinkCoach(user) {
    linkingUser = user;
    coachFilter = "";
    selectedCoachId = null;
    selectedOrgId = (orgs?.[0]?.id ?? null);

    // If user already has a coach link, preselect first link (helps edits)
    const first = Array.isArray(user?.coach_accounts) ? user.coach_accounts[0] : null;
    if (first) {
      selectedCoachId = first.coach_id ?? null;
      selectedOrgId = first.org_id ?? selectedOrgId;
    }

    showLinkModal = true;
    openMenuUserId = null;
    tick();
  }

  function closeLinkCoach() {
    showLinkModal = false;
    linkingUser = null;
    coachFilter = "";
    selectedCoachId = null;
    selectedOrgId = null;
  }

  $: filteredCoaches = (coaches ?? []).filter((c) => {
    const q = coachFilter.trim().toLowerCase();
    if (!q) return true;
    const label = `#${c.id} - ${c.name}`.toLowerCase();
    return label.includes(q);
  });

  async function submitLinkCoach() {
    if (!linkingUser) return;
    if (selectedOrgId == null) {
      error = "Please select an organization.";
      return;
    }
    if (selectedCoachId == null) {
      error = "Please select a coach.";
      return;
    }

    savingUserId = linkingUser.id;
    resetMsg();
    try {
      await adminUpsertCoachAccount({
        user_id: linkingUser.id,
        coach_id: selectedCoachId,
        org_id: Number(selectedOrgId),
      });
      // simplest: refresh users
      await loadUsersTab();
      closeLinkCoach();
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      savingUserId = null;
    }
  }

  // ------------------------
  // Ban / Unban with confirm
  // ------------------------
  async function banUser(user) {
    const label = user.username || user.email || `User #${user.id}`;
    const ok = window.confirm(
      `Are you sure you want to ban ${label}?\n\nThey will no longer be able to log in.`
    );
    if (!ok) return;

    await saveUser(user, { status: "banned" });
    openMenuUserId = null;
  }

  async function unbanUser(user) {
    const label = user.username || user.email || `User #${user.id}`;
    const ok = window.confirm(
      `Are you sure you want to unban ${label}?\n\nThey will be able to log in again.`
    );
    if (!ok) return;

    await saveUser(user, { status: "active" });
    openMenuUserId = null;
  }

  // ------------------------
  // Create org
  // ------------------------
  function slugify(s) {
    return (s ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function autoSlug() {
    if (!newOrg.slug.trim()) newOrg.slug = slugify(newOrg.name);
  }

  async function createOrg() {
    creatingOrg = true;
    resetMsg();
    try {
      const payload = {
        name: newOrg.name.trim(),
        slug: newOrg.slug.trim(),
        description: (newOrg.description ?? "").trim() || null,
      };
      if (!payload.name) throw new Error("Organization name is required");
      if (!payload.slug) throw new Error("Organization slug is required");
      await createOrganization(payload);
      newOrg = { name: "", slug: "", description: "" };
      await loadOrgsTab();
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      creatingOrg = false;
    }
  }

  onMount(async () => {
    window.addEventListener("click", onGlobalClick, true);
    window.addEventListener("keydown", onGlobalKeydown, true);

    try {
      if (token && !me) await getMe();
    } catch {}

    await refreshCurrentTab();
  });

  onDestroy(() => {
    window.removeEventListener("click", onGlobalClick, true);
    window.removeEventListener("keydown", onGlobalKeydown, true);
  });
</script>

{#if !token}
  <div class="card gate">
    <div class="gate-title">Admin Panel</div>
    <div class="muted">You must be logged in to access this page.</div>
    <div style="margin-top:.75rem;">
      <button class="btn" on:click={() => push("/login")}>Go to Login</button>
    </div>
  </div>
{:else if !isAdmin}
  <div class="card gate">
    <div class="gate-title">Admin Panel</div>
    <div class="muted">You do not have permission to access this page.</div>
    <div style="margin-top:.75rem;">
      <button class="btn" on:click={() => push("/")}>Back Home</button>
    </div>
  </div>
{:else}
  <div class="card" style="margin-bottom: 1rem;">
    <div style="display:flex; justify-content: space-between; align-items:center; gap: 1rem;">
      <div>
        <div style="font-weight: 900; font-size: 1.05rem;">Admin Panel</div>
        <div class="muted">Manage users, organizations, and invites.</div>
      </div>
      <button class="btn" on:click={refreshCurrentTab} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh"}
      </button>
    </div>

    <div class="tabs" style="margin-top: .75rem;">
      <button
        class:active={tab === "users"}
        class="tab"
        on:click={() => {
          tab = "users";
          loadUsersTab();
        }}
      >
        Users
      </button>
      <button
        class:active={tab === "orgs"}
        class="tab"
        on:click={() => {
          tab = "orgs";
          loadOrgsTab();
        }}
      >
        Organizations
      </button>
      <button
        class:active={tab === "invites"}
        class="tab"
        on:click={() => {
          tab = "invites";
          // OrgInvitesManager loads itself
        }}
      >
        Invites
      </button>
    </div>
  </div>

  {#if error}
    <div class="card" style="border-color:#f97373; color:#fecaca; margin-bottom: 1rem;">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="card">Loading…</div>
  {:else if tab === "users"}
    <div class="card" style="overflow:auto;">
      <table class="table">
        <thead>
          <tr>
            <th style="min-width:70px;">ID</th>
            <th style="min-width:210px;">Email</th>
            <th style="min-width:180px;">Username</th>
            <th style="min-width:120px;">Status</th>
            <th style="min-width:320px;">Coach Accounts</th>
            <th style="min-width:140px;">Created</th>
            <th style="min-width:90px; text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#if users.length === 0}
            <tr><td colspan="7" class="muted">No users found.</td></tr>
          {:else}
            {#each users as u}
              <tr>
                <td>{u.id}</td>
                <td>{u.email}</td>
                <td>{u.username}</td>
                <td>
                  <span class={"pill " + statusLabel(u.status)}>{statusLabel(u.status)}</span>
                </td>
                <td>
                  {#if Array.isArray(u.coach_accounts) && u.coach_accounts.length > 0}
                    <div class="links">
                      {#each u.coach_accounts as ca (ca.coach_id + ":" + ca.org_id)}
                        <span class="link-pill">
                          <span class="muted">{orgNameById(ca.org_id)}:</span>
                          <span style="font-weight:900; margin-left:.25rem;">{ca.coach_name}</span>
                          <span class="muted" style="margin-left:.25rem;">(#{ca.coach_id})</span>
                        </span>
                      {/each}
                    </div>
                  {:else}
                    <span class="muted">(none)</span>
                  {/if}
                </td>
                <td class="muted">{u.created_at ? String(u.created_at).slice(0, 10) : "-"}</td>
                <td style="text-align:right;">
                  <button
                    class="kebab"
                    on:click|stopPropagation={(e) => toggleMenu(u.id, e)}
                    aria-label="User actions"
                    disabled={savingUserId === u.id}
                    title="Actions"
                  >
                    ⋮
                  </button>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>

      <div class="muted" style="margin-top:.75rem;">
        Tip: “Link Coach” creates a coach_accounts mapping for a user within an organization.
      </div>
    </div>

    {#if openMenuUserId != null}
      <div
        class="menu-float"
        style={`top:${menuPos.top}px; left:${menuPos.left}px;`}
        on:click|stopPropagation
      >
        {#each users as u (u.id)}
          {#if u.id === openMenuUserId}
            <button class="menu-item" on:click={() => openLinkCoach(u)}>
              Link Coach…
            </button>

            {#if statusLabel(u.status) !== "banned"}
              <button class="menu-item danger" on:click={() => banUser(u)}>
                Ban
              </button>
            {:else}
              <button class="menu-item" on:click={() => unbanUser(u)}>
                Unban
              </button>
            {/if}
          {/if}
        {/each}
      </div>
    {/if}

    {#if showLinkModal}
      <div class="modal-backdrop" role="dialog" aria-modal="true" on:click={closeLinkCoach}>
        <div class="modal" on:click|stopPropagation>
          <div class="modal-title">Link Coach</div>
          <div class="muted" style="margin-bottom:.75rem;">
            Create/Update a coach_accounts mapping for{" "}
            <span style="font-weight:900;">{linkingUser?.username ?? linkingUser?.email}</span>.
          </div>

          <label class="label">Organization</label>
          <select class="input" bind:value={selectedOrgId}>
            {#if Array.isArray(orgs) && orgs.length > 0}
              {#each orgs as o (o.id)}
                <option value={o.id}>{o.name} (id {o.id})</option>
              {/each}
            {:else}
              <option value="">(no orgs loaded)</option>
            {/if}
          </select>

          <label class="label" style="margin-top:.6rem;">Coach</label>
          <input class="input" type="text" placeholder="Filter coaches…" bind:value={coachFilter} />

          <div class="coach-list" style="margin-top:.6rem;">
            {#if filteredCoaches.length === 0}
              <div class="muted" style="padding:.6rem;">No matches.</div>
            {:else}
              {#each filteredCoaches as c}
                <button
                  type="button"
                  class={"coach-item " + (selectedCoachId === c.id ? "selected" : "")}
                  on:click={() => (selectedCoachId = c.id)}
                >
                  <span class="mono">#{c.id}</span> – <span style="font-weight:800;">{c.name || "(no name)"}</span>
                </button>
              {/each}
            {/if}
          </div>

          <div class="modal-actions">
            <button class="btn ghost" on:click={closeLinkCoach}>Cancel</button>
            <button
              class="btn"
              on:click={submitLinkCoach}
              disabled={!linkingUser || savingUserId === linkingUser?.id || selectedCoachId == null || selectedOrgId == null}
            >
              {savingUserId === linkingUser?.id ? "Saving…" : "Submit"}
            </button>
          </div>

          <div class="muted" style="margin-top:.5rem;">
            Note: this upserts by (user_id, coach_id) and sets org_id.
          </div>
        </div>
      </div>
    {/if}

  {:else if tab === "orgs"}
    <div class="grid-2">
      <div class="card">
        <div style="font-weight: 900; margin-bottom:.5rem;">Create Organization</div>
        <div class="muted" style="margin-bottom:.75rem;">
          Creates a new organization. League creation stays on the existing “Create League” page for now.
        </div>

        <label class="label">Name</label>
        <input
          class="input"
          type="text"
          bind:value={newOrg.name}
          on:input={autoSlug}
          placeholder="Mason Pokémon League"
        />

        <label class="label" style="margin-top:.6rem;">Slug</label>
        <input class="input" type="text" bind:value={newOrg.slug} placeholder="mpl" />

        <label class="label" style="margin-top:.6rem;">Description</label>
        <textarea class="textarea" rows="3" bind:value={newOrg.description} placeholder="Optional"></textarea>

        <div style="margin-top:.75rem; display:flex; gap:.5rem;">
          <button class="btn" on:click={createOrg} disabled={creatingOrg}>
            {creatingOrg ? "Creating…" : "Create Organization"}
          </button>
          <button class="btn ghost" on:click={() => push("/leagues/new")}>Create League…</button>
        </div>
      </div>

      <div class="card">
        <div style="font-weight: 900; margin-bottom:.5rem;">Organizations & Leagues</div>

        {#if orgs.length === 0}
          <div class="muted">No organizations found.</div>
        {:else}
          <div class="org-list">
            {#each orgs as o}
              <div class="org-item">
                <div style="display:flex; justify-content: space-between; align-items:baseline; gap: .75rem;">
                  <div>
                    <div style="font-weight:900;">{o.name}</div>
                    <div class="muted">Slug: {o.slug}</div>
                  </div>
                  <div class="muted">{Array.isArray(o.leagues) ? o.leagues.length : 0} leagues</div>
                </div>

                {#if Array.isArray(o.leagues) && o.leagues.length > 0}
                  <ul class="org-leagues">
                    {#each o.leagues as l}
                      <li>
                        <span style="font-weight:800;">{l.name}</span>
                        <span class="muted">({l.slug}, id {l.id})</span>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <div class="muted" style="margin-top:.5rem;">No leagues in this org yet.</div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

  {:else if tab === "invites"}
    <OrgInvitesManager />
  {/if}
{/if}

<style>
  .tabs { display:flex; gap:.5rem; flex-wrap: wrap; }
  .tab {
    padding:.35rem .75rem;
    border-radius: 999px;
    font-weight: 900;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.88);
  }
  .tab.active {
    background: rgba(255,107,107,.16);
    border-color: rgba(255,107,107,.35);
    color: rgba(255,255,255,.97);
  }

  .table { width: 100%; border-collapse: collapse; }
  th, td { padding: .55rem .5rem; border-bottom: 1px solid rgba(255,255,255,.10); text-align:left; vertical-align: top; }
  th { font-weight: 900; color: rgba(255,255,255,.92); }
  td { color: rgba(255,255,255,.86); }

  .pill {
    display:inline-flex; align-items:center;
    padding:.15rem .5rem; border-radius: 999px;
    font-weight: 900; font-size: .85rem;
    border: 1px solid rgba(255,255,255,.14);
    background: rgba(255,255,255,.06);
  }
  .pill.banned { border-color: rgba(248,113,113,.35); background: rgba(248,113,113,.12); }
  .pill.disabled { border-color: rgba(251,191,36,.35); background: rgba(251,191,36,.12); }
  .pill.active { border-color: rgba(34,197,94,.35); background: rgba(34,197,94,.10); }

  .links { display:flex; flex-wrap: wrap; gap: .35rem; }
  .link-pill {
    display:inline-flex; align-items:center;
    padding: .22rem .45rem;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06);
    font-size: .85rem;
  }

  .grid-2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 980px) { .grid-2 { grid-template-columns: 1fr; } }

  .label { display:block; font-weight: 800; margin-bottom: .25rem; }
  .input, .textarea, select.input {
    width: 100%;
    padding: .55rem .6rem;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.92);
  }
  .textarea { resize: vertical; }

  .org-list { display:flex; flex-direction: column; gap:.75rem; }
  .org-item { padding: .65rem .7rem; border-radius: 12px; border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.04); }
  .org-leagues { margin: .55rem 0 0; padding-left: 1.1rem; }

  .kebab {
    width: 36px;
    height: 34px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.92);
    font-weight: 900;
    cursor: pointer;
    line-height: 1;
  }
  .kebab:hover { background: rgba(255,255,255,.10); }

  .menu-float {
    position: fixed;
    z-index: 9999;
    width: 200px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.14);
    background: rgba(15, 20, 40, 0.98);
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    overflow: hidden;
  }
  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: .55rem .65rem;
    font-weight: 800;
    border: 0;
    cursor: pointer;
    background: transparent;
    color: rgba(255,255,255,.92);
  }
  .menu-item:hover { background: rgba(255,255,255,.08); }
  .menu-item.danger { color: #fecaca; }
  .menu-item.danger:hover { background: rgba(248,113,113,.12); }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0,0,0,.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal {
    width: min(780px, 98vw);
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,.14);
    background: rgba(15, 20, 40, 0.98);
    padding: 1rem;
    box-shadow: 0 14px 40px rgba(0,0,0,.45);
  }
  .modal-title {
    font-weight: 950;
    font-size: 1.05rem;
    margin-bottom: .35rem;
  }
  .coach-list {
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(255,255,255,.04);
    max-height: 360px;
    overflow: auto;
    padding: .35rem;
  }
  .coach-item {
    width: 100%;
    text-align: left;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(255,255,255,.92);
    padding: .45rem .55rem;
    cursor: pointer;
    margin-bottom: .25rem;
  }
  .coach-item:hover { background: rgba(255,255,255,.07); }
  .coach-item.selected {
    border-color: rgba(255,107,107,.35);
    background: rgba(255,107,107,.12);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: .5rem;
    margin-top: .75rem;
  }

  .btn {
    padding:.5rem .75rem;
    border-radius: 12px;
    font-weight: 900;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.92);
  }
  .btn:hover { background: rgba(255,255,255,.10); }
  .btn:disabled { opacity: .6; cursor: not-allowed; }
  .btn.ghost { background: transparent; border-color: rgba(255,255,255,.14); }

  .card {
    padding: 1rem;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
  }
  .gate { max-width: 900px; margin: 0 auto; }
  .gate-title { font-size: 1.1rem; font-weight: 800; margin-bottom: 0.35rem; }
  .muted { opacity: 0.75; }
</style>
