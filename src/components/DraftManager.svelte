<script>
  import { onMount, onDestroy } from "svelte";
  import { flip } from "svelte/animate";
  import {
    getDraftSnapshot,
    putDraftSettings,
    addDraftTeamToSeason,
    putDraftOrder,
    randomizeDraftOrder,
    startDraft,
    pauseDraft,
    endDraft,
    skipDraftTurn,
    makeDraftPick,
    undoDraftTurn,
    listDraftMakeupPicks,
    startDraftMakeupPick,
    cancelDraftMakeupPick,
    getSeasonTierList,
    patchSeasonTierListSettings,
  } from "../lib/api.js";

  export let seasonId;
  export let canEdit = false; // league master UI controls (from parent)

  let loading = true;
  let error = "";
  let msg = "";

  // Make-up picks
  let makeupOpen = false;
  let makeupLoading = false;
  let makeupError = "";
  let makeupRows = [];

  // draft data
  let snapshot = null; // includes snapshot.viewer
  let tierBoard = null; // from getSeasonTierList

  // settings form
  let minPokemon = 10;
  let maxPokemon = 0;
  let noMax = true;
  let pickSeconds = 90;
  let draftType = "snake";
  let teamPointTotal = 0;

  // adding teams (from season teams)
  let selectedSeasonTeamId = "";

  // order drag (upgraded)
  const dragDuration = 180;
  let draggingOrderItem = null; // the actual snapshot.order entry being dragged
  let overTeamId = null; // team_id we’re currently hovering
  let lastSwapAt = 0;

  // pick UI
  let pokemonQuery = "";
  let selectedPokemonId = null;
  let pollHandle = null;
  // Timer syncing:
  // - Poll the server for authoritative state (including status changes) even while paused.
  // - Locally animate the countdown while running (without mutating server state).
  let uiTick = null;
  let nowMs = Date.now();
  let serverSeconds = 0;
  let serverAtMs = Date.now();

  $: localSeconds = (() => {
    const st = snapshot?.state;
    if (!st) return 0;
    const base = Number(serverSeconds ?? 0);
    if (st.status === "running") {
      const elapsed = Math.floor((nowMs - serverAtMs) / 1000);
      return Math.max(0, base - elapsed);
    }
    // paused / ended / not_started
    return Math.max(0, base);
  })();

  // -----------------------------
  // NEW: one-pick mock mode
  // -----------------------------
  let mockPickEnabled = false;

  // -----------------------------
  // NEW: can't-afford modal
  // -----------------------------
  let cantAffordOpen = false;
  let cantAffordTitle = "Player can't afford this pick";
  let cantAffordBody = "";
  let cantAffordPauseError = "";

  function openCantAffordModal({ coachName, pokemonName, cost, remaining }) {
    cantAffordTitle = "Player can't afford this pick";
    cantAffordBody = `${coachName} can't afford this pick. ${pokemonName} costs ${cost} points, player only has ${remaining} points remaining.`;
    cantAffordPauseError = "";
    cantAffordOpen = true;
  }

  function closeCantAffordModal() {
    cantAffordOpen = false;
    cantAffordPauseError = "";
  }

  function setFlash(text, isErr = false) {
    msg = isErr ? "" : text;
    error = isErr ? text : "";
    if (text)
      setTimeout(() => {
        if (isErr) error = "";
        else msg = "";
      }, 4000);
  }

  function teamById(id) {
    return snapshot?.teams?.find((t) => t.team_id === id) ?? null;
  }

  function budgetByTeamId(id) {
    return snapshot?.budgets?.find((b) => b.team_id === id) ?? null;
  }

  // -----------------------------
  // NEW: lock draft order once draft has started (or ended)
  // -----------------------------
  $: draftStatus = snapshot?.state?.status ?? null;
  $: orderLocked = draftStatus === "running" || draftStatus === "paused" || draftStatus === "ended";
  $: canEditOrder = !!canEdit && !orderLocked;
  $: overrideActive = snapshot?.state?.override_active ?? false;

  // ---- drafted pokemon helpers ----
  $: draftedSet = new Set(
    (snapshot?.picks ?? []).map((p) => p.pokemon_id).filter(Boolean)
  );

  // pokemon_id -> pick (so we can show drafted-by team)
  $: draftedByPokemonId = new Map(
    (snapshot?.picks ?? [])
      .filter((p) => p.pokemon_id)
      .map((p) => [p.pokemon_id, p])
  );

  function normalizeHex(c) {
    if (!c) return null;
    const s = String(c).trim();
    return s.startsWith("#") ? s : `#${s}`;
  }

  function teamPrimaryColor(team) {
    return normalizeHex(
      team?.primary_color || team?.primaryColor || team?.color_primary
    );
  }

  function teamSecondaryColor(team) {
    return normalizeHex(
      team?.secondary_color || team?.secondaryColor || team?.color_secondary
    );
  }

  function draftedBgForTeam(team) {
    return (
      teamPrimaryColor(team) ||
      teamSecondaryColor(team) ||
      "rgba(255, 255, 255, 0.10)"
    );
  }

  // ---- IMPORTANT: tier flags come from the TIERS table, not from assignments ----
  $: tierColumns =
    tierBoard?.tiers ??
    tierBoard?.tier_columns ??
    tierBoard?.columns ??
    [];

  $: undraftableTierIds = new Set(
    tierColumns
      .filter((t) => !!(t.is_undraftable || t.undraftable))
      .map((t) => t.id)
      .filter(Boolean)
  );

  $: bannedTierIds = new Set(
    tierColumns
      .filter((t) => !!(t.is_banned || t.banned))
      .map((t) => t.id)
      .filter(Boolean)
  );

  // Build a flat pool from the tier board
  $: pool = (() => {
    if (!tierBoard?.assignments) return [];
    return tierBoard.assignments.map((a) => {
      const tierId = a.tier_id;

      const is_banned = bannedTierIds.has(tierId);
      const is_undraftable = undraftableTierIds.has(tierId);

      return {
        pokemon_id: a.pokemon_id,
        pokemon_name: a.pokemon_name,
        tier_id: tierId,
        tier_name: a.tier_name,
        points: a.points,
        is_banned,
        is_undraftable,
      };
    });
  })();

  // hide undraftable + banned mons entirely
  $: filteredPool = pool
    .filter((p) => !p.is_undraftable && !p.is_banned)
    .filter((p) => {
      const q = pokemonQuery.trim().toLowerCase();
      if (!q) return true;
      return (p.pokemon_name ?? "").toLowerCase().includes(q);
    })
    .sort(
      (a, b) =>
        (a.points ?? 9999) - (b.points ?? 9999) ||
        (a.pokemon_name ?? "").localeCompare(b.pokemon_name ?? "")
    );

  async function loadAll({ silent = false } = {}) {
    if (!silent) loading = true;
    error = "";
    // keep msg as-is on silent refresh so flashes don't disappear mid-action
    if (!silent) msg = "";

    const httpStatusFromError = (e) => {
      const msg = e?.message ?? "";
      const m = /^HTTP\s+(\d{3})\s*:/i.exec(msg);
      return m ? Number(m[1]) : null;
    };

    try {
      const snap = await getDraftSnapshot(seasonId);
      snapshot = snap;

      // Tier list might not exist yet at the very start of a season.
      try {
        tierBoard = await getSeasonTierList(seasonId);
      } catch (e2) {
        if (httpStatusFromError(e2) === 404) {
          tierBoard = null;
          // Don't treat as a hard error for the draft tab; league masters can create one in the Tier List tab.
          if (!silent) msg = "No tier list has been created for this season yet.";
        } else {
          throw e2;
        }
      }

      // hydrate settings
      minPokemon = snap.settings.min_pokemon;
      noMax = snap.settings.max_pokemon == null;
      maxPokemon = snap.settings.max_pokemon ?? 0;
      pickSeconds = snap.settings.pick_seconds;
      draftType = (snap.settings.draft_type ?? "snake").toLowerCase();
      teamPointTotal = snap.team_point_total ?? 0;

      // seed timer sync
      serverSeconds = snap.state.seconds_remaining ?? 0;
      serverAtMs = Date.now();
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      if (!silent) loading = false;
    }
  }

  function startUiTick() {
    if (uiTick) return;
    uiTick = setInterval(() => {
      nowMs = Date.now();
    }, 250);
  }

  function stopUiTick() {
    if (uiTick) clearInterval(uiTick);
    uiTick = null;
  }

  function startPolling() {
    if (pollHandle) return;
    pollHandle = setInterval(async () => {
      try {
        const snap = await getDraftSnapshot(seasonId);
        snapshot = snap;
        // Update authoritative timer baseline each poll.
        // This keeps all users in sync without requiring a refresh,
        // and prevents "resetting" behavior on pause/resume as long as the backend preserves seconds_remaining.
        serverSeconds = snap.state.seconds_remaining ?? 0;
        serverAtMs = Date.now();

        // If draft stops running, also disable mock mode to avoid “sticky” state.
        if (snap?.state?.status !== "running") mockPickEnabled = false;
      } catch (e) {}
    }, 2500);
  }

  function stopPolling() {
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = null;
  }

  // Always poll so users see start/pause/resume/turn changes without refreshing.
  // The UI tick handles smooth countdown while running.
  onMount(() => {
    startUiTick();
    startPolling();
    loadAll();
  });
  onDestroy(() => {
    stopUiTick();
    stopPolling();
  });

  async function saveSettings() {
    try {
      await putDraftSettings(seasonId, {
        min_pokemon: Number(minPokemon),
        max_pokemon: noMax ? null : Number(maxPokemon),
        no_max: noMax,
        pick_seconds: Number(pickSeconds),
        draft_type: draftType,
      });

      const wanted = Number(teamPointTotal);
      if (!Number.isNaN(wanted)) {
        await patchSeasonTierListSettings(seasonId, { team_point_total: wanted });
      }

      await loadAll({ silent: true });
      setFlash("Saved draft settings.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  // ----- Adding teams to draft: pick from season teams -----
  $: draftedTeamIds = new Set((snapshot?.order ?? []).map((o) => o.team_id));

  $: seasonTeams = (snapshot?.teams ?? []).slice().sort((a, b) => {
    const ca = (a.coach_name ?? "").toLowerCase();
    const cb = (b.coach_name ?? "").toLowerCase();
    if (ca !== cb) return ca.localeCompare(cb);
    return (a.team_name ?? "")
      .toLowerCase()
      .localeCompare((b.team_name ?? "").toLowerCase());
  });

  $: availableSeasonTeams = seasonTeams.filter((t) => !draftedTeamIds.has(t.team_id));

  function seasonTeamLabel(t) {
    const coach = t.coach_name ?? "—";
    const team = t.team_name ?? "";
    const ab = t.abbrev ? ` (${t.abbrev})` : "";
    return team ? `${coach} — ${team}${ab}` : `${coach}${ab}`;
  }

  async function addTeam() {
    try {
      const teamId = Number(selectedSeasonTeamId);
      if (!teamId) throw new Error("Choose a team first.");

      await addDraftTeamToSeason(seasonId, { team_id: teamId });

      selectedSeasonTeamId = "";
      await loadAll({ silent: true });
      setFlash("Added team to draft.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  // ---- upgraded drag reorder (flip + hover-swap + indicator) ----
  function onOrderDragStart(item, e) {
    if (!canEditOrder) return;
    draggingOrderItem = item;
    overTeamId = item?.team_id ?? null;

    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(item?.team_id ?? ""));
    } catch {}
  }

  function onOrderDragEnd() {
    draggingOrderItem = null;
    overTeamId = null;
    lastSwapAt = 0;
  }

  function swapOrderWith(target) {
    if (!canEditOrder) return;
    if (!snapshot?.order) return;
    if (!draggingOrderItem) return;
    if (!target) return;
    if (draggingOrderItem === target) return;

    const now = performance.now();
    if (now - lastSwapAt < 45) return;
    lastSwapAt = now;

    const order = [...snapshot.order];
    const a = order.indexOf(draggingOrderItem);
    const b = order.indexOf(target);
    if (a === -1 || b === -1) return;

    order[a] = target;
    order[b] = draggingOrderItem;
    snapshot = { ...snapshot, order };
  }

  function onOrderDragEnter(target) {
    if (!canEditOrder) return;
    overTeamId = target?.team_id ?? null;
    swapOrderWith(target);
  }

  async function saveOrder() {
    if (!canEditOrder) {
      setFlash("Draft order is locked once the draft starts.", true);
      return;
    }
    try {
      const ids = (snapshot?.order ?? []).map((o) => o.team_id);
      await putDraftOrder(seasonId, ids);
      await loadAll({ silent: true });
      setFlash("Saved draft order.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  async function randomizeOrder() {
    if (!canEditOrder) {
      setFlash("Draft order is locked once the draft starts.", true);
      return;
    }
    try {
      await randomizeDraftOrder(seasonId);
      await loadAll({ silent: true });
      setFlash("Randomized draft order.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  async function doStart() {
    try {
      await startDraft(seasonId);
      await loadAll({ silent: true });
      setFlash("Draft started.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  async function doPause() {
    try {
      await pauseDraft(seasonId);
      mockPickEnabled = false;
      await loadAll({ silent: true });
      setFlash("Draft paused.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  async function doEnd() {
    if (!confirm("End the draft now? This cannot be undone.")) return;
    try {
      await endDraft(seasonId);
      mockPickEnabled = false;
      await loadAll({ silent: true });
      setFlash("Draft ended.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  async function doSkip() {
    try {
      await skipDraftTurn(seasonId);
      mockPickEnabled = false;
      await loadAll({ silent: true });
      setFlash("Skipped turn.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  async function openMakeup() {
    makeupOpen = true;
    makeupError = "";
    makeupLoading = true;
    try {
      makeupRows = await listDraftMakeupPicks(seasonId);
    } catch (e) {
      makeupError = e?.message ?? String(e);
      makeupRows = [];
    } finally {
      makeupLoading = false;
    }
  }

  async function chooseMakeupPick(row) {
    if (!row?.id) return;
    try {
      await startDraftMakeupPick(seasonId, row.id);
      makeupOpen = false;
      await loadAll({ silent: true });
      setFlash(`Make-up pick: ${row.coach_name ?? "Coach"} · R${row.round_number ?? "—"}`);
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  async function cancelMakeup() {
    try {
      await cancelDraftMakeupPick(seasonId);
      makeupOpen = false;
      await loadAll({ silent: true });
      setFlash("Canceled make-up pick override.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  // undo last pick/turn (league master only, while paused)
  async function doUndo() {
    if (!confirm("Undo the last turn? This will remove the last pick/skip.")) return;
    try {
      await undoDraftTurn(seasonId);
      mockPickEnabled = false;
      await loadAll({ silent: true });
      setFlash("Undid last turn.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }


  function fmtTime(sec) {
    const s = Math.max(0, sec ?? 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function isDraftable(p) {
    if (p.is_banned || p.is_undraftable) return false;
    if (draftedSet.has(p.pokemon_id)) return false;
    return true;
  }

  $: currentTeam = snapshot?.state?.current_team_id
    ? teamById(snapshot.state.current_team_id)
    : null;

  // -----------------------------
  // Permissions + pick gating
  // -----------------------------
  $: viewerCoachId = snapshot?.viewer?.coach_id ?? null;

  // Prefer snapshot.viewer if present, otherwise fall back to canEdit
  $: viewerRoles = snapshot?.viewer?.global_roles ?? [];
  $: viewerLeagueRoles = snapshot?.viewer?.league_roles ?? [];

  $: viewerIsAdmin = Array.isArray(viewerRoles) && viewerRoles.includes("admin");
  $: viewerIsLeagueMaster =
    !!snapshot?.viewer?.is_league_master ||
    (Array.isArray(viewerLeagueRoles) && viewerLeagueRoles.includes("league_master")) ||
    canEdit;

  // Only admins/league masters get mock button
  $: canMockPick = viewerIsAdmin || viewerIsLeagueMaster;

  // Only show mock button while running
  $: showMockButton = canMockPick;

  $: isMyTurn =
    !!currentTeam && !!viewerCoachId && currentTeam.coach_id === viewerCoachId;

  // Coach-on-clock can always pick.
  // Admin/LM can only pick if mockPickEnabled is ON (one pick).
  $: canPickNow = isMyTurn || (canMockPick && mockPickEnabled);

  $: pickEnabled = snapshot?.state?.status === "running" && canPickNow;

  function toggleMockPick() {
    if (!canMockPick) return;
    if (snapshot?.state?.status !== "running") return;
    mockPickEnabled = !mockPickEnabled;
    if (mockPickEnabled) setFlash("Mock Pick enabled for ONE pick.");
    else setFlash("Mock Pick disabled.");
  }

  // -----------------------------
  // NEW: points helpers + affordability (used only for blocking the action)
  // -----------------------------
  $: currentBudget = currentTeam ? budgetByTeamId(currentTeam.team_id) : null;
  $: remainingPoints = currentBudget?.remaining ?? null;

  function pokemonById(pid) {
    const id = Number(pid);
    if (!id) return null;
    return pool.find((x) => x.pokemon_id === id) ?? null;
  }

  // selection should be blocked for non-drafters
  function selectPokemon(pid) {
    if (!pickEnabled) return;
    selectedPokemonId = pid;
  }

  async function doPick() {
    try {
      const teamId = snapshot?.state?.current_team_id;
      if (!teamId) throw new Error("No current team.");

      const pid = Number(selectedPokemonId);
      if (!pid) throw new Error("Choose a Pokémon to draft.");

      // NEW: prevent pick if points are insufficient (modal popup + pause)
      const mon = pokemonById(pid);
      const team = currentTeam;
      const budget = currentBudget;

      const cost = Number(mon?.points ?? 0);
      const remaining = Number(budget?.remaining ?? 0);

      // Only enforce if we actually have a budget + mon cost data
      if (team && budget && mon && Number.isFinite(cost) && cost > remaining) {
        openCantAffordModal({
          coachName: team.coach_name ?? "Player",
          pokemonName: mon.pokemon_name ?? "that Pokémon",
          cost,
          remaining,
        });

        // Pause the draft right away if possible
        try {
          await pauseDraft(seasonId);
          mockPickEnabled = false;
          await loadAll({ silent: true });
        } catch (pauseErr) {
          cantAffordPauseError = pauseErr?.message ?? String(pauseErr);
          setFlash(
            "Pick blocked (insufficient points). Could not pause draft (missing permissions?).",
            true
          );
        }

        return;
      }

      await makeDraftPick(seasonId, { team_id: teamId, pokemon_id: pid });

      // one-pick-only: automatically disable after successful pick
      if (mockPickEnabled) mockPickEnabled = false;

      selectedPokemonId = null;
      pokemonQuery = "";
      await loadAll({ silent: true });
      setFlash("Pick recorded.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }
</script>

{#if loading}
  <div class="card muted">Loading draft…</div>
{:else}
  <!-- Toast popups -->
  {#if error}
    <div class="toast toastErr">{error}</div>
  {/if}
  {#if msg}
    <div class="toast toastOk">{msg}</div>
  {/if}

  {#if cantAffordOpen}
    <div
      class="modalOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={cantAffordTitle}
      on:click|self|preventDefault|stopPropagation={closeCantAffordModal}
    >
      <div class="modalCard">
        <div class="modalTitle">{cantAffordTitle}</div>
        <div class="modalBody">{cantAffordBody}</div>

        {#if cantAffordPauseError}
          <div class="modalNote">
            Could not pause the draft: {cantAffordPauseError}
          </div>
        {/if}

        <div class="modalActions">
          <button
            class="btn"
            type="button"
            on:click|preventDefault|stopPropagation={closeCantAffordModal}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if !snapshot}
    <div class="card muted">No data.</div>
  {:else}
    <div class="grid">
      <section class="card">
        <div class="h">Draft setup</div>
        <div class="sub muted">Configure roster limits, clock, points, and draft type.</div>

        <div class="form">
          <label>
            <span class="lab">Min Pokémon</span>
            <input type="number" min="0" bind:value={minPokemon} disabled={!canEdit} />
          </label>

          <label class="row">
            <span class="lab">No maximum</span>
            <input type="checkbox" bind:checked={noMax} disabled={!canEdit} />
          </label>

          {#if !noMax}
            <label>
              <span class="lab">Max Pokémon</span>
              <input type="number" min="0" bind:value={maxPokemon} disabled={!canEdit} />
            </label>
          {/if}

          <label>
            <span class="lab">Pick timer (seconds)</span>
            <input type="number" min="1" bind:value={pickSeconds} disabled={!canEdit} />
          </label>

          <label>
            <span class="lab">Team points</span>
            <input type="number" min="0" bind:value={teamPointTotal} disabled={!canEdit} />
          </label>

          <label>
            <span class="lab">Draft type</span>
            <select class="select" bind:value={draftType} disabled={!canEdit}>
              <option value="snake">Snake</option>
              <option value="rotation">Rotation</option>
            </select>
          </label>
        </div>

        {#if canEdit}
          <div class="actions">
            <button type="button" class="btn coral" on:click|preventDefault|stopPropagation={saveSettings}>Save settings</button>
          </div>
        {/if}
      </section>

      <section class="card">
        <div class="h">Teams in draft</div>
        <div class="sub muted">Add existing season teams, then build the draft order.</div>

        {#if canEdit}
          <div class="addTeam">
            <select class="select" bind:value={selectedSeasonTeamId}>
              <option value="">Select a season team…</option>
              {#each availableSeasonTeams as t (t.team_id)}
                <option value={t.team_id}>{seasonTeamLabel(t)}</option>
              {/each}
            </select>

            <button type="button"
              class="btn"
              on:click|preventDefault|stopPropagation={addTeam}
              disabled={!selectedSeasonTeamId}
              title={!selectedSeasonTeamId ? "Select a team first" : ""}
            >
              Add
            </button>
          </div>

          {#if (snapshot?.teams ?? []).length === 0}
            <div class="muted" style="margin-top:0.6rem;">
              No teams exist for this season yet. Add teams on the season page first.
            </div>
          {:else if availableSeasonTeams.length === 0}
            <div class="muted" style="margin-top:0.6rem;">
              All season teams are already in the draft.
            </div>
          {/if}
        {/if}

        <div class="divider"></div>

        <div class="orderTop">
          <div class="muted">
            Draft order
            {#if orderLocked}
              <span class="muted">· (locked after draft starts)</span>
            {:else}
              <span class="muted">· (drag to reorder)</span>
            {/if}
          </div>
          {#if canEdit}
            <div class="orderBtns">
              <button
                type="button"
                class="btn"
                on:click|preventDefault|stopPropagation={randomizeOrder}
                disabled={(snapshot.order ?? []).length < 2 || !canEditOrder}
                title={!canEditOrder ? "Draft order is locked once the draft starts" : ""}
              >
                Randomize
              </button>
              <button
                type="button"
                class="btn coral"
                on:click|preventDefault|stopPropagation={saveOrder}
                disabled={(snapshot.order ?? []).length < 2 || !canEditOrder}
                title={!canEditOrder ? "Draft order is locked once the draft starts" : ""}
              >
                Save order
              </button>
            </div>
          {/if}
        </div>

        {#if (snapshot.order ?? []).length === 0}
          <div class="muted">No teams added yet.</div>
        {:else}
          <ol class="order orderFancy" class:isDragging={!!draggingOrderItem}>
            {#each snapshot.order as o, i (o.team_id)}
              {@const isActive = snapshot.state.current_team_id === o.team_id}
              {@const isDrag = draggingOrderItem && draggingOrderItem.team_id === o.team_id}
              {@const isOver =
                !!overTeamId && overTeamId === o.team_id && !(draggingOrderItem && draggingOrderItem.team_id === o.team_id)}
              <li
                class="orderItem fancy {isActive ? 'active' : ''} {isDrag ? 'dragging' : ''} {isOver ? 'over' : ''}"
                draggable={canEditOrder}
                animate:flip={{ duration: dragDuration }}
                on:dragstart={(e) => onOrderDragStart(o, e)}
                on:dragend={onOrderDragEnd}
                on:dragenter={() => onOrderDragEnter(o)}
                on:dragover|preventDefault
                title={!canEditOrder ? "Draft order is locked once the draft starts" : ""}
              >
                <span class="grab" aria-hidden="true">⋮⋮</span>
                <span class="slot">#{o.slot ?? i + 1}</span>
                <span class="name">{teamById(o.team_id)?.coach_name ?? "—"}</span>
                <span class="team muted">{teamById(o.team_id)?.team_name ?? ""}</span>

                {#if isOver}
                  <span class="dropLine" aria-hidden="true"></span>
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      </section>

      <section class="card">
        <div class="h">Draft controls</div>
        <div class="sub muted">Start/pause/end, and record picks.</div>

        <div class="status">
          <div><span class="pill">{snapshot.state.status}</span></div>
          <div class="muted">Round {snapshot.state.round_number}</div>
          <div class="timer">{fmtTime(localSeconds)}</div>
        </div>

        <div class="current">
          <div class="muted">On the clock</div>
          {#if currentTeam}
            <div class="curName">{currentTeam.coach_name}</div>
            <div class="curTeam muted">{currentTeam.team_name}</div>

            {#if budgetByTeamId(currentTeam.team_id)}
              <div class="curBudget">
                <span class="muted">Points:</span>
                <span>{budgetByTeamId(currentTeam.team_id).remaining} / {teamPointTotal}</span>
                <span class="muted">Roster:</span>
                <span>{budgetByTeamId(currentTeam.team_id).roster_count}</span>
              </div>
            {/if}

            <!-- Mock Pick toggle (admins + league masters only) -->
            {#if showMockButton}
              <div class="mockRow">
                <button
                  class="btn mockBtn {mockPickEnabled ? 'mockOn' : ''}"
                  type="button"
                  on:click|preventDefault|stopPropagation={toggleMockPick}
                  disabled={snapshot.state.status !== "running"}
                  title={mockPickEnabled ? "Mock pick enabled for one pick" : "Enable mock pick for one pick"}
                >
                  {mockPickEnabled ? "Mock Pick ENABLED" : "Enable Mock Pick"}
                </button>

                {#if mockPickEnabled}
                  <span class="mockHint muted">
                    You will submit the next pick for {currentTeam.coach_name}. This disables after you draft.
                  </span>
                {/if}
              </div>
            {/if}

            {#if !pickEnabled}
              <div class="muted" style="margin-top:0.4rem;">
                {#if snapshot.state.status !== "running"}
                  Draft is not running.
                {:else}
                  {#if isMyTurn}
                    (Ready)
                  {:else if canMockPick}
                    Mock Pick is off — enable it to draft for the current team.
                  {:else}
                    Only the coach on the clock can draft right now.
                  {/if}
                {/if}
              </div>
            {/if}
          {:else}
            <div class="muted">—</div>

            {#if showMockButton}
              <div class="mockWrap" style="margin-top:0.5rem;">
                <button type="button"
                  class="btn mockBtn {mockPickEnabled ? 'on' : ''}"
                  on:click|preventDefault|stopPropagation={toggleMockPick}
                  disabled={true}
                  title="Start the draft to enable mock picks."
                >
                  Enable Mock Pick (1)
                </button>
              </div>
            {/if}
          {/if}
        </div>

        {#if canEdit}
          <div class="actions">
            <button
              type="button"
              class="btn coral"
              on:click|preventDefault|stopPropagation={doStart}
              disabled={snapshot.state.status === "running" || snapshot.state.status === "ended"}
            >
              Start
            </button>

            <button
              type="button"
              class="btn"
              on:click|preventDefault|stopPropagation={doPause}
              disabled={snapshot.state.status !== "running"}
            >
              Pause
            </button>

            <button
              type="button"
              class="btn danger"
              on:click|preventDefault|stopPropagation={doEnd}
              disabled={snapshot.state.status === "ended"}
            >
              End
            </button>

            <button
              type="button"
              class="btn"
              on:click|preventDefault|stopPropagation={doSkip}
              disabled={snapshot.state.status === "ended" || overrideActive}
              title={overrideActive ? "Can't skip while a make-up pick is active" : ""}
            >
              Skip turn
            </button>

            <button
              type="button"
              class="btn"
              on:click|preventDefault|stopPropagation={overrideActive ? cancelMakeup : openMakeup}
              disabled={snapshot.state.status === "ended"}
              title={overrideActive ? "Return to the current pick" : "Fill a previously skipped pick"}
            >
              {overrideActive ? "Cancel make-up" : "Make-up pick"}
            </button>

            <button
              type="button"
              class="btn"
              on:click|preventDefault|stopPropagation={doUndo}
              disabled={snapshot.state.status !== "paused" || (snapshot.picks ?? []).length === 0}
              title={snapshot.state.status !== "paused" ? "Pause the draft to undo" : ""}
            >
              Undo last turn
            </button>
          </div>
        {/if}

        <div class="pick">
          <div class="pickTop">
            <input class="search" placeholder="Search Pokémon…" bind:value={pokemonQuery} />
            <button
              type="button"
              class="btn coral"
              on:click|preventDefault|stopPropagation={doPick}
              disabled={!pickEnabled || !selectedPokemonId || snapshot.state.status === "ended"}
              title={!pickEnabled ? "You can't draft right now" : ""}
            >
              Draft
            </button>
          </div>

          <div class="pool">
            {#each filteredPool as p (p.pokemon_id)}
              {@const pick = draftedByPokemonId.get(p.pokemon_id)}
              {@const draftedTeam = pick?.team_id ? teamById(pick.team_id) : null}
              {@const draftedBg = draftedTeam ? draftedBgForTeam(draftedTeam) : null}
              {@const isDrafted = !!pick}
              {@const selectable = pickEnabled && isDraftable(p) && !isDrafted}

              <button
                type="button"
                class="poke {selectedPokemonId === p.pokemon_id ? 'sel' : ''} {isDrafted ? 'drafted' : ''} {selectable ? '' : 'disabled'}"
                on:click|preventDefault|stopPropagation={() => selectPokemon(p.pokemon_id)}
                disabled={!selectable}
                style={isDrafted && draftedBg ? `background: ${draftedBg};` : ""}
                title={
                  p.is_banned
                    ? "Banned"
                    : isDrafted
                      ? `Drafted by ${draftedTeam?.coach_name ?? "a team"}`
                      : !pickEnabled
                        ? "Not your turn"
                        : draftedSet.has(p.pokemon_id)
                          ? "Already drafted"
                          : ""
                }
              >
                <span class="pokeName">{p.pokemon_name}</span>
                <span class="pokeMeta muted">
                  {p.points ?? "—"} pts · {p.tier_name}
                  {#if isDrafted}
                    · Drafted by {draftedTeam?.coach_name ?? `Team #${pick.team_id}`}
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="h">Pick history</div>
        {#if (snapshot.picks ?? []).length === 0}
          <div class="muted">No picks yet.</div>
        {:else}
          <div class="history">
            {#each snapshot.picks as p (p.id)}
              <div class="pickRow">
                <div class="pickNo">#{p.pick_number ?? "—"}</div>
                <div class="pickMain">
                  <div class="pickCoach">{teamById(p.team_id)?.coach_name ?? "—"}</div>
                  <div class="pickPoke muted">
                    {#if p.pokemon_id}
                      {pool.find((x) => x.pokemon_id === p.pokemon_id)?.pokemon_name ?? `#${p.pokemon_id}`}
                      · {p.points_at_pick ?? "—"} pts
                    {:else}
                      (skipped)
                    {/if}
                  </div>
                </div>
                <div class="pickRound muted">R{p.round_number ?? "—"}</div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
{/if}

{#if makeupOpen}
  <div class="modalBackdrop" on:click={() => (makeupOpen = false)}>
    <div class="modalCard" on:click|stopPropagation>
      <div class="modalHeader">
        <div class="modalTitle">Make-up pick</div>
        <button class="btn" type="button" on:click={() => (makeupOpen = false)}>Close</button>
      </div>

      {#if makeupLoading}
        <div class="muted">Loading…</div>
      {:else if makeupError}
        <div class="err">{makeupError}</div>
      {:else}
        <div class="muted" style="margin-bottom: 8px;">
          Select a skipped pick to fill. After the pick is made, the draft will return to the current pick.
        </div>

        {#if (makeupRows?.length ?? 0) === 0}
          <div class="muted">No skipped picks found for this draft.</div>
        {:else}
          <div class="makeupList">
            {#each makeupRows as r (r.id)}
              <button class="makeupItem" type="button" on:click={() => chooseMakeupPick(r)}>
                <div class="makeupMain">
                  <div class="makeupCoach">{r.coach_name ?? "(unknown coach)"}</div>
                  <div class="makeupSub">
                    Pick #{r.pick_number ?? "—"} · Round {r.round_number ?? "—"}
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.9rem;
  }

  @media (min-width: 1100px) {
    .grid {
      grid-template-columns: 1fr 1fr;
    }
    .grid section:nth-child(3) {
      grid-column: 1 / -1;
    }
    .grid section:nth-child(4) {
      grid-column: 1 / -1;
    }
  }

  .card {
    border-radius: 16px;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .h {
    font-weight: 900;
    font-size: 1.05rem;
    margin-bottom: 0.25rem;
  }
  .sub {
    margin-bottom: 0.75rem;
  }
  .muted {
    opacity: 0.75;
  }

  .divider {
    margin: 0.85rem 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
  }

  /* Toast popups */
  .toast {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 9999;
    max-width: min(560px, calc(100vw - 36px));
    padding: 0.8rem 0.95rem;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(18, 18, 18, 0.92);
    box-shadow: 0 20px 55px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(8px);
  }
  .toastErr {
    border-color: rgba(255, 80, 80, 0.45);
  }
  .toastOk {
    border-color: rgba(80, 255, 160, 0.45);
  }

  /* NEW: modal */
  .modalOverlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    padding: 18px;
  }
  .modalCard {
    width: min(560px, calc(100vw - 36px));
    border-radius: 16px;
    padding: 1rem 1rem 0.9rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(18, 18, 18, 0.96);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(10px);
  }
  .modalTitle {
    font-weight: 900;
    font-size: 1.05rem;
    margin-bottom: 0.55rem;
  }
  .modalBody {
    opacity: 0.92;
    line-height: 1.35;
  }
  .modalNote {
    margin-top: 0.65rem;
    padding: 0.6rem 0.7rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 80, 80, 0.35);
    background: rgba(255, 80, 80, 0.10);
    opacity: 0.95;
    font-size: 0.9rem;
  }
  .modalActions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.9rem;
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
  .coral {
    background: rgba(255, 107, 107, 0.18);
    border-color: rgba(255, 107, 107, 0.35);
  }
  .danger {
    background: rgba(255, 80, 80, 0.15);
    border-color: rgba(255, 80, 80, 0.35);
  }

  .form {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.55rem;
  }

  label {
    display: grid;
    gap: 0.35rem;
  }
  .row {
    grid-auto-flow: column;
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  input {
    padding: 0.55rem 0.65rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(255, 255, 255, 0.92);
  }

  .lab {
    font-size: 0.85rem;
    opacity: 0.9;
  }
  .hint {
    font-size: 0.8rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .addTeam {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
  }

  @media (max-width: 780px) {
    .addTeam {
      grid-template-columns: 1fr;
    }
  }

  .orderTop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .orderBtns {
    display: flex;
    gap: 0.5rem;
  }

  .order {
    margin: 0;
    padding-left: 1.25rem;
    display: grid;
    gap: 0.45rem;
  }

  .orderItem {
    list-style: decimal;
    display: grid;
    grid-template-columns: 58px 1fr 1fr;
    gap: 0.65rem;
    align-items: center;
    padding: 0.55rem 0.65rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
  }
  .orderItem.active {
    border-color: rgba(255, 107, 107, 0.5);
    background: rgba(255, 107, 107, 0.06);
  }
  .slot {
    opacity: 0.85;
  }
  .name {
    font-weight: 700;
  }
  .team {
    text-align: right;
  }

  .orderFancy {
    padding-left: 0;
  }
  .orderItem.fancy {
    list-style: none;
    grid-template-columns: 26px 58px 1fr 1fr;
    cursor: grab;
    user-select: none;
    transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background 120ms ease;
    position: relative;
  }
  .orderItem.fancy:active {
    cursor: grabbing;
  }
  .grab {
    width: 20px;
    text-align: center;
    opacity: 0.55;
    font-size: 18px;
    line-height: 1;
  }
  .orderItem.fancy.dragging {
    transform: scale(1.03);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.22);
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
    opacity: 0.95;
  }
  .orderItem.fancy.over {
    border-color: rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.05);
  }
  .dropLine {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -6px;
    height: 3px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.38);
    pointer-events: none;
  }

  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin: 0.6rem 0 0.9rem;
  }
  .pill {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    font-size: 0.85rem;
  }
  .timer {
    font-weight: 900;
    font-size: 1.15rem;
  }

  .current {
    padding: 0.75rem;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    margin-bottom: 0.8rem;
  }
  .curName {
    font-weight: 900;
    font-size: 1.05rem;
  }
  .curBudget {
    margin-top: 0.35rem;
    display: flex;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  /* mock button styling */
  .mockRow {
    margin-top: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .mockBtn.mockOn {
    border-color: rgba(255, 107, 107, 0.5);
    background: rgba(255, 107, 107, 0.10);
  }
  .mockHint {
    font-size: 0.85rem;
  }

  .pickTop {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.6rem;
  }
  .search {
    flex: 1;
  }

  .pool {
    max-height: 420px;
    overflow: auto;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 0.5rem;
    display: grid;
    gap: 0.45rem;
  }

  .poke {
    text-align: left;
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    padding: 0.55rem 0.65rem;
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
  }
  .poke.sel {
    border-color: rgba(255, 107, 107, 0.5);
    background: rgba(255, 107, 107, 0.08);
  }
  .poke.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .poke.drafted {
    cursor: not-allowed;
    border-color: rgba(0, 0, 0, 0.18);
  }
  .poke.drafted .pokeMeta {
    opacity: 0.95;
  }

  .pokeName {
    font-weight: 800;
  }
  .pokeMeta {
    font-size: 0.85rem;
  }

  .history {
    max-height: 520px;
    overflow: auto;
    display: grid;
    gap: 0.45rem;
  }
  .pickRow {
    display: grid;
    grid-template-columns: 80px 1fr 70px;
    gap: 0.6rem;
    align-items: center;
    padding: 0.55rem 0.65rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
  }
  .pickNo {
    font-weight: 900;
  }
  .pickCoach {
    font-weight: 800;
  }
  .pickRound {
    text-align: right;
  }

  /* modal */
  .modalBackdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: grid;
    place-items: center;
    padding: 16px;
    z-index: 50;
  }
  .modalCard {
    width: min(720px, 100%);
    background: rgba(12, 18, 38, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    padding: 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .modalHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .modalTitle {
    font-weight: 900;
    font-size: 1.1rem;
  }
  .makeupList {
    display: grid;
    gap: 10px;
    max-height: 55vh;
    overflow: auto;
    padding-right: 4px;
  }
  .makeupItem {
    text-align: left;
    width: 100%;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    cursor: pointer;
  }
  .makeupItem:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  .makeupCoach {
    font-weight: 900;
  }
  .makeupSub {
    opacity: 0.9;
    font-size: 0.9rem;
    margin-top: 2px;
  }
</style>
