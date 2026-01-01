<script>
  import { onMount, createEventDispatcher } from "svelte";
  import {
    getAllCoaches,
    getSeasonTeams,
    createSeasonTeam,
    updateSeasonTeam,
    deleteSeasonTeam
  } from "../lib/api.js";

  export let seasonId = null;
  export let canEdit = false;

  // when Leagues.svelte sets this, we open edit UI for that team
  export let editRequest = null; // { team } | null

  const dispatch = createEventDispatcher();

  let loading = false;
  let error = "";
  let success = "";

  let coaches = [];
  let loadingCoaches = false;

  // --- add form collapse ---
  let showAdd = false;

  // --- create form ---
  let coachMode = "existing"; // 'existing' | 'new'
  let existingCoachId = "";
  let newCoachName = "";
  let teamName = "";
  let abbrev = "";
  let conference = "";
  let division = "";
  let colorPrimary = "";
  let colorSecondary = "";

  // --- edit state ---
  let editingTeamId = null;
  let edit = {
    coach_id: "",
    team_name: "",
    abbrev: "",
    conference: "",
    division: "",
    color_primary: "",
    color_secondary: ""
  };

  function resetMessages() {
    error = "";
    success = "";
  }

  function coachLabel(c) {
    return (
      c?.name ??
      c?.coach_name ??
      c?.display_name ??
      c?.username ??
      (c?.id != null ? `Coach #${c.id}` : "Coach")
    );
  }

  async function refreshSeasonTeams() {
    if (!seasonId) {
      dispatch("changed", { teams: [] });
      return;
    }

    try {
      const teams = await getSeasonTeams(seasonId);
      dispatch("changed", { teams });
    } catch (e) {
      // still dispatch empty so parent doesn't keep stale data
      dispatch("changed", { teams: [] });
      error = e?.message ?? String(e);
    }
  }

  async function loadCoaches() {
    loadingCoaches = true;
    try {
      coaches = await getAllCoaches();
    } catch {
      coaches = [];
    } finally {
      loadingCoaches = false;
    }
  }

  function startEditFromTeam(t) {
    resetMessages();
    if (!t?.id) return;

    editingTeamId = t.id;
    edit = {
      coach_id: t.coach_id ?? "",
      team_name: t.team_name ?? "",
      abbrev: t.abbrev ?? "",
      conference: t.conference ?? "",
      division: t.division ?? "",
      color_primary: t.color_primary ?? "",
      color_secondary: t.color_secondary ?? ""
    };
  }

  function cancelEdit() {
    editingTeamId = null;
    dispatch("closeEdit");
  }

  // If parent requests edit, open it
  $: if (editRequest?.team?.id && canEdit) {
    startEditFromTeam(editRequest.team);
  }

  async function submitCreate() {
    if (!canEdit) return;
    resetMessages();

    if (!teamName.trim()) {
      error = "Team name is required.";
      return;
    }

    const payload = {
      team_name: teamName.trim(),
      abbrev: abbrev.trim() || null,
      conference: conference.trim() || null,
      division: division.trim() || null,
      color_primary: colorPrimary.trim() || null,
      color_secondary: colorSecondary.trim() || null
    };

    if (coachMode === "existing") {
      if (!existingCoachId) {
        error = "Select a coach.";
        return;
      }
      payload.existing_coach_id = Number(existingCoachId);
    } else {
      if (!newCoachName.trim()) {
        error = "Enter a new coach name.";
        return;
      }
      payload.new_coach_name = newCoachName.trim();
    }

    loading = true;
    try {
      await createSeasonTeam(seasonId, payload);
      success = "Team added.";

      // Reset form
      teamName = "";
      abbrev = "";
      conference = "";
      division = "";
      colorPrimary = "";
      colorSecondary = "";
      if (coachMode === "existing") existingCoachId = "";
      else newCoachName = "";

      await refreshSeasonTeams();
      showAdd = false;
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  async function submitEdit() {
    if (!canEdit || !editingTeamId) return;
    resetMessages();

    const payload = {
      coach_id: edit.coach_id ? Number(edit.coach_id) : null,
      team_name: edit.team_name.trim() || null,
      abbrev: edit.abbrev.trim() || null,
      conference: edit.conference.trim() || null,
      division: edit.division.trim() || null,
      color_primary: edit.color_primary.trim() || null,
      color_secondary: edit.color_secondary.trim() || null
    };

    loading = true;
    try {
      await updateSeasonTeam(seasonId, editingTeamId, payload);
      success = "Team updated.";
      editingTeamId = null;
      dispatch("closeEdit");
      await refreshSeasonTeams();
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  async function submitDelete(team) {
    if (!canEdit || !seasonId || !team?.id) return;
    resetMessages();

    const name = team.team_name || team.coach_name || `Team #${team.id}`;
    const ok = confirm(`Delete "${name}" from this season?\n\nThis cannot be undone.`);
    if (!ok) return;

    loading = true;
    try {
        await deleteSeasonTeam(seasonId, team.id);
        success = "Team deleted.";
        if (editingTeamId === team.id) {
        editingTeamId = null;
        dispatch("closeEdit");
        }
        await refreshSeasonTeams();
    } catch (e) {
        error = e?.message ?? String(e);
    } finally {
        loading = false;
    }
  }


  onMount(async () => {
    if (canEdit) await loadCoaches();
    await refreshSeasonTeams();
  });

  // if season changes, refresh
  $: if (seasonId) {
    Promise.resolve().then(() => refreshSeasonTeams());
  }
</script>

{#if !canEdit}
  <!-- Hidden entirely for non-league-master because Leagues.svelte only renders this when isLeagueMaster -->
{:else}
  <div class="card" style="margin-bottom: .75rem;">
    <div class="row header">
      <div>
        <div class="title">Manage Season Teams</div>
        <div class="muted">Add teams, or edit an existing team from the list below.</div>
      </div>

      <div class="row" style="gap:.5rem;">
        <button class="btn" on:click={() => (showAdd = !showAdd)} disabled={!seasonId}>
          {showAdd ? "Hide Add Team" : "Add Team"}
        </button>
      </div>
    </div>

    {#if error}
      <div class="alert error" style="margin-top: .5rem;">{error}</div>
    {/if}
    {#if success}
      <div class="alert success" style="margin-top: .5rem;">{success}</div>
    {/if}

    {#if showAdd}
      <div class="divider" />

      <div class="subtitle">Add team</div>

      <div class="grid">
        <div class="field">
          <label>Coach</label>
          <div class="coach-row">
            <select class="select" bind:value={coachMode}>
              <option value="existing">Existing coach</option>
              <option value="new">New coach</option>
            </select>

            {#if coachMode === "existing"}
              <select class="select" bind:value={existingCoachId} disabled={loadingCoaches}>
                <option value="">Select coach…</option>
                {#each coaches as c (c.id)}
                  <option value={c.id}>{coachLabel(c)}</option>
                {/each}
              </select>
            {:else}
              <input placeholder="New coach name" bind:value={newCoachName} />
            {/if}
          </div>
        </div>

        <div class="field">
          <label>Team name</label>
          <input placeholder="e.g., Vienna Venusaurs" bind:value={teamName} />
        </div>

        <div class="field">
          <label>Abbrev (optional)</label>
          <input placeholder="e.g., VIE" bind:value={abbrev} />
        </div>

        <div class="field">
          <label>Conference (optional)</label>
          <input placeholder="e.g., East" bind:value={conference} />
        </div>

        <div class="field">
          <label>Division (optional)</label>
          <input placeholder="e.g., Alpha" bind:value={division} />
        </div>

        <div class="field">
          <label>Primary color (optional)</label>
          <input placeholder="#ff6b6b" bind:value={colorPrimary} />
        </div>

        <div class="field">
          <label>Secondary color (optional)</label>
          <input placeholder="#1f2937" bind:value={colorSecondary} />
        </div>
      </div>

      <div class="row" style="justify-content: flex-end; margin-top: .5rem;">
        <button class="btn primary" on:click={submitCreate} disabled={loading || !seasonId}>
          {loading ? "Saving…" : "Add team"}
        </button>
      </div>
    {/if}

    {#if editingTeamId}
      <div class="divider" />

      <div class="edit-card">
        <div class="row" style="justify-content: space-between; align-items:center;">
          <div class="subtitle">Edit team</div>
          <button class="btn" on:click={cancelEdit}>Close</button>
        </div>

        <div class="row" style="justify-content: space-between; margin-top:.5rem;">
        <button
            class="btn danger"
            on:click={() => submitDelete(editRequest?.team && editRequest.team.id === editingTeamId ? editRequest.team : { id: editingTeamId, team_name: edit.team_name })}
            disabled={loading}
        >
            Delete team
        </button>

        <button class="btn primary" on:click={submitEdit} disabled={loading}>
            {loading ? "Saving…" : "Save"}
        </button>
        </div>


        <div class="grid">
          <div class="field">
            <label>Coach</label>
            <select class="select" bind:value={edit.coach_id}>
              <option value="">—</option>
              {#each coaches as c (c.id)}
                <option value={c.id}>{coachLabel(c)}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label>Team name</label>
            <input bind:value={edit.team_name} />
          </div>

          <div class="field">
            <label>Abbrev</label>
            <input bind:value={edit.abbrev} />
          </div>

          <div class="field">
            <label>Conference</label>
            <input bind:value={edit.conference} />
          </div>

          <div class="field">
            <label>Division</label>
            <input bind:value={edit.division} />
          </div>

          <div class="field">
            <label>Primary color</label>
            <input bind:value={edit.color_primary} />
          </div>

          <div class="field">
            <label>Secondary color</label>
            <input bind:value={edit.color_secondary} />
          </div>
        </div>

        <div class="row" style="justify-content:flex-end; margin-top:.5rem;">
          <button class="btn primary" on:click={submitEdit} disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  *, *::before, *::after { box-sizing: border-box; }

  .card {
    padding: 0.75rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .row { display: flex; gap: 0.75rem; }
  .row.header { justify-content: space-between; align-items: center; flex-wrap: wrap; }

  .title { font-size: 1.05rem; font-weight: 700; }
  .subtitle { font-weight: 650; margin-top: 0.25rem; }
  .muted { opacity: 0.75; }

  .divider { height: 1px; background: rgba(255, 255, 255, 0.08); margin: 0.75rem 0; }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  @media (max-width: 780px) { .grid { grid-template-columns: 1fr; } }

  .field label {
    display: block;
    font-size: 0.85rem;
    opacity: 0.85;
    margin-bottom: 0.25rem;
  }

  input {
    width: 100%;
    max-width: 100%;
    padding: 0.55rem 0.6rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.2);
    color: inherit;
  }

  .btn {
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    cursor: pointer;
  }
  .btn.primary {
    background: #ff6b6b;
    border-color: rgba(0, 0, 0, 0.15);
    color: #111;
    font-weight: 700;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .alert {
    padding: 0.6rem 0.7rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    margin-top: 0.5rem;
  }
  .alert.error { border-color: rgba(255, 107, 107, 0.4); background: rgba(255, 107, 107, 0.12); }
  .alert.success { border-color: rgba(34, 197, 94, 0.35); background: rgba(34, 197, 94, 0.12); }

  .coach-row {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 0.5rem;
    align-items: center;
    min-width: 0;
  }
  .coach-row > * { min-width: 0; }
  @media (max-width: 780px) { .coach-row { grid-template-columns: 1fr; } }

  .btn.danger {
    background: rgba(255, 107, 107, 0.16);
    border-color: rgba(255, 107, 107, 0.35);
    color: #ffd6d6;
    font-weight: 650;
  }

</style>
