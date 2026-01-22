<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { push } from "svelte-spa-router";

  import { auth } from "../lib/authStore.js";
  import {
    getMe,
    getAllCoaches,
    createOrganization,
    getAllOrganizationsWithLeagues,
    adminListUsers,
    adminUpdateUser,
  } from "../lib/api.js";

  const meStore = auth.me;
  const tokenStore = auth.token;

  $: me = $meStore;
  $: token = $tokenStore;

  $: isAdmin = Array.isArray(me?.global_roles) && me.global_roles.includes("admin");

  let tab = "users"; // users | orgs
  let loading = false;
  let error = "";

  // ---- Users ----
  let users = [];
  let coaches = [];
  let savingUserId = null;

  // Actions menu state (floating overlay)
  let openMenuUserId = null;
  let menuPos = { top: 0, left: 0 };

  // Name Player modal state
  let showNameModal = false;
  let namingUser = null; // user being edited
  let coachFilter = "";
  let selectedCoachId = null; // selected coach id for naming

  // ---- Orgs/Leagues ----
  let orgs = [];
  let newOrg = { name: "", slug: "", description: "" };
  let creatingOrg = false;

  function resetMsg() {
    error = "";
  }

  function statusLabel(s) {
    const v = (s ?? "").toString().toLowerCase();
    if (!v) return "unknown";
    return v;
  }

  function coachNameById(id) {
    if (id == null) return "";
    const cid = Number(id);
    const c = coaches.find((x) => Number(x.id) === cid);
    return c ? c.name : "";
  }

  async function loadUsersTab() {
    loading = true;
    resetMsg();
    openMenuUserId = null;

    try {
      const [u, c] = await Promise.all([adminListUsers(), getAllCoaches()]);

      users = Array.isArray(u) ? u : [];

      // Normalize coach payloads so we always have { id, name }
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
    } catch (e) {
      error = e?.message || String(e);
      users = [];
      coaches = [];
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
    // toggle off
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

    const width = 180;
    const margin = 8;

    let left = r.right - width; // right aligned
    let top = r.bottom + 6; // below button

    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    const estimatedHeight = 96; // enough for 2 items
    if (top + estimatedHeight > window.innerHeight - margin) {
      top = r.top - estimatedHeight - 6; // open upward if near bottom
      top = Math.max(margin, top);
    }

    menuPos = { top, left };
    openMenuUserId = userId;
  }

  function closeMenu() {
    openMenuUserId = null;
  }

  function onGlobalClick(e) {
    const el = e?.target;
    if (!el) return;
    // clicks inside the kebab button or floating menu should not close
    if (el.closest?.(".kebab")) return;
    if (el.closest?.(".menu-float")) return;
    // clicks inside modal should not close menu implicitly (optional)
    if (el.closest?.(".modal")) return;

    openMenuUserId = null;
  }

  function onGlobalKeydown(e) {
    if (e.key === "Escape") {
      if (openMenuUserId != null) openMenuUserId = null;
      if (showNameModal) closeNamePlayer();
    }
  }

  // ------------------------
  // Name Player modal
  // ------------------------
  function openNamePlayer(user) {
    namingUser = user;
    coachFilter = "";
    selectedCoachId = user?.coach_id ?? null;
    showNameModal = true;
    closeMenu();
    tick();
  }

  function closeNamePlayer() {
    showNameModal = false;
    namingUser = null;
    coachFilter = "";
    selectedCoachId = null;
  }

  $: filteredCoaches = (coaches ?? []).filter((c) => {
    const q = coachFilter.trim().toLowerCase();
    if (!q) return true;
    const label = `#${c.id} - ${c.name}`.toLowerCase();
    return label.includes(q);
  });

  async function submitNamePlayer() {
    if (!namingUser) return;
    await saveUser(namingUser, { coach_id: selectedCoachId ?? null });
    closeNamePlayer();
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
    closeMenu();
  }

  async function unbanUser(user) {
    const label = user.username || user.email || `User #${user.id}`;

    const ok = window.confirm(
      `Are you sure you want to unban ${label}?\n\nThey will be able to log in again.`
    );
    if (!ok) return;

    await saveUser(user, { status: "active" });
    closeMenu();
  }

  // ------------------------
  // Create org (unchanged)
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

    // Ensure /auth/me loaded (and roles)
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
        <div class="muted">Manage users, organizations, and league data.</div>
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
            <th style="min-width:220px;">Coach Link</th>
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
                  {#if u.coach_id == null}
                    <span class="muted">(NULL)</span>
                  {:else}
                    <span style="font-weight:800;">
                      {coachNameById(u.coach_id) || `(Unknown #${u.coach_id})`}
                    </span>
                    <span class="muted"> (#{u.coach_id})</span>
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
        Tip: “Name Player” links an account to a coach_id so they can see the leagues they belong to.
      </div>
    </div>

    <!-- Floating actions menu (true overlay; does not affect layout/scroll) -->
    {#if openMenuUserId != null}
      <div
        class="menu-float"
        style={`top:${menuPos.top}px; left:${menuPos.left}px;`}
        on:click|stopPropagation
      >
        {#each users as u (u.id)}
          {#if u.id === openMenuUserId}
            {#if statusLabel(u.status) !== "banned"}
              <button class="menu-item" on:click={() => openNamePlayer(u)}>
                Name Player
              </button>
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

    {#if showNameModal}
      <div class="modal-backdrop" role="dialog" aria-modal="true" on:click={closeNamePlayer}>
        <div class="modal" on:click|stopPropagation>
          <div class="modal-title">Name Player</div>
          <div class="muted" style="margin-bottom:.75rem;">
            Select a coach to link to <span style="font-weight:900;">{namingUser?.username ?? namingUser?.email}</span>.
          </div>

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
            <button class="btn ghost" on:click={closeNamePlayer}>Cancel</button>
            <button
              class="btn"
              on:click={submitNamePlayer}
              disabled={!namingUser || savingUserId === namingUser?.id || selectedCoachId == null}
            >
              {savingUserId === namingUser?.id ? "Saving…" : "Submit"}
            </button>
          </div>

          <div class="muted" style="margin-top:.5rem;">
            Note: Submit is required to apply the link.
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
  .pill.active { border-color: rgba(34,197,94,.35); background: rgba(34,197,94,.10); }

  .grid-2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 980px) { .grid-2 { grid-template-columns: 1fr; } }

  .label { display:block; font-weight: 800; margin-bottom: .25rem; }
  .input, .textarea {
    width: 100%;
    padding: .55rem .6rem;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.92);
  }
  .textarea { resize: vertical; }

  .org-list { display:flex; flex-direction: column; gap: .75rem; }
  .org-item { padding: .65rem .7rem; border-radius: 12px; border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.04); }
  .org-leagues { margin: .55rem 0 0; padding-left: 1.1rem; }

  /* Kebab button */
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

  /* Floating menu: true overlay; avoids scroll container layout */
  .menu-float {
    position: fixed;
    z-index: 9999;
    width: 180px;
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

  /* Modal */
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
