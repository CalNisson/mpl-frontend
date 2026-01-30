<script>
  import { onMount } from "svelte";
  import {
    getSeasonSchedule,
    generateSeasonSchedule,
    createSeasonScheduleMatch,
    deleteSeasonScheduleMatch,
    patchSeasonScheduleMatch,
    clearApiCache,
  } from "../lib/api.js";

  export let seasonId;
  export let teams = []; // [{ id, team_name, color_primary, ... }]
  export let canEdit = false;

  let editMode = false;

  let loading = true;
  let error = "";
  let schedule = [];

  // generation
  let weeks = 10;
  let generating = false;

  // add match
  let addWeek = 1;
  let addTeam1 = "";
  let addTeam2 = "";
  let adding = false;

  // edit existing match
  let editingId = null;
  let editWeek = 1;
  let editTeam1 = "";
  let editTeam2 = "";
  let editDoubleLoss = false;
  let savingEdit = false;

  let lastLoadedSeasonId = null;

  $: teamById = (teams ?? []).reduce((acc, t) => {
    acc[t.id] = t;
    return acc;
  }, {});

  $: maxWeek = schedule.reduce((m, row) => Math.max(m, row.week ?? 0), 0);
  $: displayWeeks = maxWeek > 0 ? maxWeek : weeks;

  $: scheduleByWeek = schedule.reduce((acc, m) => {
    const w = m.week ?? 0;
    if (!acc[w]) acc[w] = [];
    acc[w].push(m);
    return acc;
  }, {});

  function normColor(c) {
    if (!c) return null;
    const s = String(c).trim();
    if (!s) return null;
    if (s.startsWith("#")) return s;
    if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
    return s;
  }

  function textColor(bg) {
    const c = normColor(bg);
    if (!c || !c.startsWith("#") || c.length !== 7) return "#fff";
    const r = parseInt(c.slice(1, 3), 16) / 255;
    const g = parseInt(c.slice(3, 5), 16) / 255;
    const b = parseInt(c.slice(5, 7), 16) / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0.6 ? "#111" : "#fff";
  }

  function pillStyle(teamId) {
    const t = teamById[teamId];
    const bg = normColor(t?.color_primary) ?? "#444";
    const fg = textColor(bg);
    return `background:${bg}; color:${fg};`;
  }

  function setErr(e) {
    error = e?.message ?? String(e);
  }

  async function load() {
    if (!seasonId) return;
    loading = true;
    error = "";

    try {
      const rows = await getSeasonSchedule(seasonId);
      schedule = Array.isArray(rows) ? rows : [];

      // Default the add-week input to the first empty week (or 1).
      const existingWeeks = new Set(schedule.map((m) => m.week ?? 0));
      let w = 1;
      while (existingWeeks.has(w)) w += 1;
      addWeek = Math.max(1, w);
    } catch (e) {
      setErr(e);
      schedule = [];
    } finally {
      loading = false;
    }
  }

  async function refresh() {
    if (!seasonId) return;
    clearApiCache(`season-schedule:${seasonId}`);
    await load();
  }

  onMount(load);
  $: if (seasonId && seasonId !== lastLoadedSeasonId) {
    lastLoadedSeasonId = seasonId;
    load();
  }

  function toggleEditMode() {
    if (!canEdit) return;
    editMode = !editMode;
    if (!editMode) cancelEdit();
  }

  async function onGenerate() {
    if (!seasonId) return;
    generating = true;
    error = "";
    try {
      await generateSeasonSchedule(seasonId, { weeks, overwrite: true });
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      generating = false;
    }
  }

  async function onAddMatch() {
    if (!seasonId) return;
    const team1_id = parseInt(addTeam1, 10);
    const team2_id = parseInt(addTeam2, 10);
    const week = Number(addWeek);

    if (!week || !team1_id || !team2_id) return;
    if (team1_id === team2_id) {
      error = "Team 1 and Team 2 cannot be the same.";
      return;
    }

    adding = true;
    error = "";
    try {
      await createSeasonScheduleMatch(seasonId, { week, team1_id, team2_id });
      addTeam1 = "";
      addTeam2 = "";
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      adding = false;
    }
  }

  function startEdit(m) {
    if (!canEdit || !editMode) return;
    editingId = m.id;
    editWeek = Number(m.week ?? 1);
    editTeam1 = String(m.team1_id ?? "");
    editTeam2 = String(m.team2_id ?? "");
    editDoubleLoss = !!(m.is_double_loss ?? m.double_loss ?? m.isDoubleLoss);
  }

  function cancelEdit() {
    editingId = null;
    savingEdit = false;
    editDoubleLoss = false;
  }

  async function onSaveEdit() {
    if (!seasonId || !editingId) return;
    const week = Number(editWeek);
    const team1_id = Number(editTeam1);
    const team2_id = Number(editTeam2);

    if (!week || !team1_id || !team2_id) return;
    if (team1_id === team2_id) {
      error = "Team 1 and Team 2 cannot be the same.";
      return;
    }

    savingEdit = true;
    error = "";
    try {
      await patchSeasonScheduleMatch(seasonId, editingId, {
        week,
        team1_id,
        team2_id,
        is_double_loss: !!editDoubleLoss,
      });
      await refresh();
      cancelEdit();
    } catch (e) {
      setErr(e);
    } finally {
      savingEdit = false;
    }
  }

  async function onDeleteMatch(matchId) {
    if (!seasonId || !matchId) return;
    if (!confirm("Delete this match?")) return;

    error = "";
    try {
      await deleteSeasonScheduleMatch(seasonId, matchId);
      clearApiCache(`season-schedule:${seasonId}`);
      schedule = schedule.filter((m) => m.id !== matchId);
    } catch (e) {
      setErr(e);
    }
  }

  function isDoubleLoss(m) {
    return !!(m?.is_double_loss ?? m?.double_loss ?? m?.isDoubleLoss);
  }

  function scoreText(m) {
    if (isDoubleLoss(m)) return "DL";
    const a = m.team1_score;
    const b = m.team2_score;
    if (a == null || b == null) return "—";
    return `${a}-${b}`;
  }

  function winnerLabel(m) {
    if (isDoubleLoss(m)) return "N/A";
    if (!m.winner_id) return "—";
    if (m.winner_id === m.team1_id) return `${m.team1_name}`;
    if (m.winner_id === m.team2_id) return `${m.team2_name}`;
    return "—";
  }
</script>

<div class="card" style="margin-top:.75rem;">
  <div class="card-header">
    <div class="card-title">Schedule</div>
    {#if canEdit}
      <div class="header-actions">
        <button class="btn {editMode ? 'coral' : ''}" on:click={toggleEditMode}>
          {editMode ? "Done editing" : "Edit schedule"}
        </button>
      </div>
    {/if}
  </div>

  {#if error}
    <div class="card muted" style="margin:.5rem 0;">{error}</div>
  {/if}

  {#if canEdit && editMode}
    <div class="schedule-admin">
      <div class="admin-row">
        <label class="label" style="margin:0;">Regular season weeks</label>
        <input
          class="select"
          type="number"
          min="1"
          step="1"
          bind:value={weeks}
          style="max-width: 140px;"
        />
        <button class="btn coral" on:click={onGenerate} disabled={generating}>
          {generating ? "Generating…" : "Randomize schedule"}
        </button>
      </div>

      <div class="admin-row" style="margin-top:.5rem;">
        <label class="label" style="margin:0;">Add match</label>
        <input class="select" type="number" min="1" step="1" bind:value={addWeek} style="max-width: 100px;" />

        <select class="select" bind:value={addTeam1}>
          <option value="">Team 1…</option>
          {#each teams as t (t.id)}
            <option value={t.id}>{t.team_name}</option>
          {/each}
        </select>

        <select class="select" bind:value={addTeam2}>
          <option value="">Team 2…</option>
          {#each teams as t (t.id)}
            <option value={t.id}>{t.team_name}</option>
          {/each}
        </select>

        <button class="btn" on:click={onAddMatch} disabled={adding || !addWeek || !addTeam1 || !addTeam2}>
          {adding ? "Adding…" : "Add"}
        </button>
      </div>

      <div class="muted" style="margin-top:.25rem;">
        Notes: Randomize will overwrite existing regular-season matches. Manual Add prevents duplicate matchups.
      </div>

      <div class="divider" style="margin:.75rem 0;"></div>
    </div>
  {/if}

  {#if loading}
    <div class="muted">Loading schedule…</div>
  {:else if schedule.length === 0}
    <div class="muted">No regular-season matches scheduled yet.</div>
  {:else}
    {#each Object.keys(scheduleByWeek)
      .map((k) => Number(k))
      .filter((n) => n > 0)
      .sort((a, b) => a - b) as wk (wk)}
      <div class="week-block">
        <div class="section-title">Week {wk}</div>

        <table class="table schedule-table">
          <thead>
            <tr>
              <th>Match</th>
              <th>Score</th>
              <th>Winner</th>
              <th>Replay</th>
              {#if canEdit && editMode}
                <th style="width: 240px;"></th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each scheduleByWeek[wk] as m (m.id)}
              <tr class:is-double-loss={isDoubleLoss(m)}>
                <td>
                  {#if editingId === m.id}
                    <div class="editTeams">
                      <label class="editField">
                        <span class="weekLab">Week</span>
                        <input class="select" type="number" min="1" step="1" bind:value={editWeek} />
                      </label>

                      <label class="editField">
                        <span class="weekLab">Team 1</span>
                        <select class="select" bind:value={editTeam1}>
                          <option value="">Team 1…</option>
                          {#each teams as t (t.id)}
                            <option value={t.id}>{t.team_name}</option>
                          {/each}
                        </select>
                      </label>

                      <label class="editField">
                        <span class="weekLab">Team 2</span>
                        <select class="select" bind:value={editTeam2}>
                          <option value="">Team 2…</option>
                          {#each teams as t (t.id)}
                            <option value={t.id}>{t.team_name}</option>
                          {/each}
                        </select>
                      </label>

                      <label class="dlToggle">
                        <input type="checkbox" bind:checked={editDoubleLoss} />
                        <span>Double loss</span>
                      </label>
                    </div>
                  {:else}
                    <span class="team-pill" style={pillStyle(m.team1_id)}>{m.team1_name}</span>
                    <span class="muted" style="margin:0 .5rem;">vs</span>
                    <span class="team-pill" style={pillStyle(m.team2_id)}>{m.team2_name}</span>
                  {/if}
                </td>

                <td>
                  <div class="scoreCell">
                    {#if isDoubleLoss(m)}
                      <span class="dlPill" title="Double loss">DL</span>
                    {:else}
                      <span>{scoreText(m)}</span>
                    {/if}
                  </div>
                </td>

                <td>{winnerLabel(m)}</td>

                <td>
                  {#if isDoubleLoss(m)}
                    <span class="dlReplay">DOUBLE LOSS</span>
                  {:else if m.replay && String(m.replay).trim().length > 0}
                    <a href={m.replay} target="_blank" rel="noopener noreferrer" class="replay-link">
                      REPLAY
                    </a>
                  {:else}
                    <span class="muted">NO REPLAY AVAILABLE</span>
                  {/if}
                </td>

                {#if canEdit && editMode}
                  <td>
                    {#if editingId === m.id}
                      <div class="btnRow">
                        <button class="btn coral" on:click={onSaveEdit} disabled={savingEdit}>
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                        <button class="btn" on:click={cancelEdit} disabled={savingEdit}>Cancel</button>
                      </div>
                    {:else}
                      <div class="btnRow">
                        <button class="btn" on:click={() => startEdit(m)}>Edit</button>
                        <button class="btn danger" on:click={() => onDeleteMatch(m.id)}>Delete</button>
                      </div>
                    {/if}
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}
  {/if}
</div>

<style>
  .card {
    border-radius: 16px;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .card-title {
    font-weight: 900;
    font-size: 1.05rem;
  }

  .header-actions {
    display: flex;
    justify-content: flex-end;
  }

  .schedule-admin {
    margin-bottom: 0.5rem;
  }

  .admin-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .muted {
    opacity: 0.75;
  }

  .divider {
    margin: 0.85rem 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
  }

  .team-pill {
    display: inline-block;
    padding: 0.2rem 0.45rem;
    border-radius: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .week-block {
    margin-bottom: 1rem;
  }

  .schedule-table {
    width: 100%;
    border-collapse: collapse;
  }

  .schedule-table th,
  .schedule-table td {
    white-space: normal;
  }

  .btn {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.92);
    padding: 0.55rem 0.85rem;
    border-radius: 12px;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
  }

  .coral {
    background: rgba(255, 107, 107, 0.18);
    border-color: rgba(255, 107, 107, 0.35);
  }

  .btn.coral:hover:not(:disabled) {
    border-color: rgba(255, 107, 107, 0.55);
    background: rgba(255, 107, 107, 0.24);
  }

  .danger {
    background: rgba(255, 80, 80, 0.15);
    border-color: rgba(255, 80, 80, 0.35);
  }

  .btn.danger:hover:not(:disabled) {
    border-color: rgba(255, 80, 80, 0.55);
    background: rgba(255, 80, 80, 0.22);
  }

  .select {
    padding: 0.55rem 0.65rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(255, 255, 255, 0.92);
  }

  select.select {
    appearance: none;
  }

  .weekLab {
    font-size: 0.85rem;
    opacity: 0.9;
  }

  .btnRow {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .editTeams {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    gap: 0.6rem;
    align-items: end;
  }

  .editField {
    display: grid;
    gap: 0.25rem;
  }

  .dlToggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-weight: 800;
    opacity: 0.95;
    user-select: none;
  }

  .dlToggle input {
    transform: translateY(1px);
  }

  .scoreCell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .dlPill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 900;
    font-size: 0.78rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.08);
  }

  /* ✅ NEW: replay “DOUBLE LOSS” label */
  .dlReplay {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 10px;
    border-radius: 999px;
    font-weight: 950;
    font-size: 0.78rem;
    letter-spacing: 0.03em;
    border: 1px solid rgba(255, 160, 160, 0.35);
    background: rgba(255, 107, 107, 0.16);
    color: rgba(255, 220, 220, 0.98);
  }

  tr.is-double-loss td {
    opacity: 0.92;
  }

  @media (max-width: 820px) {
    .editTeams {
      grid-template-columns: 1fr;
    }
    .btnRow {
      justify-content: flex-start;
    }
  }

  .replay-link {
    color: rgba(255, 170, 170, 0.95); /* soft coral */
    font-weight: 700;
    text-decoration: none;
    transition: color 120ms ease, text-decoration-color 120ms ease;
  }

  .replay-link:hover {
    color: rgba(255, 200, 200, 1);
    text-decoration: underline;
    text-decoration-color: rgba(255, 200, 200, 0.6);
  }
</style>
