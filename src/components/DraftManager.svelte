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
    getSeasonTierList,
    patchSeasonTierListSettings,
  } from "../lib/api.js";

  export let seasonId;
  export let canEdit = false; // league master UI controls (from parent)

  let loading = true;
  let error = "";
  let msg = "";

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
  let autoTick = null;
  let pollHandle = null;
  let localSeconds = 0;

  // -----------------------------
  // NEW: one-pick mock mode
  // -----------------------------
  let mockPickEnabled = false;

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

    try {
      const [snap, board] = await Promise.all([
        getDraftSnapshot(seasonId),
        getSeasonTierList(seasonId),
      ]);

      snapshot = snap;
      tierBoard = board;

      // hydrate settings
      minPokemon = snap.settings.min_pokemon;
      noMax = snap.settings.max_pokemon == null;
      maxPokemon = snap.settings.max_pokemon ?? 0;
      pickSeconds = snap.settings.pick_seconds;
      draftType = (snap.settings.draft_type ?? "snake").toLowerCase();
      teamPointTotal = snap.team_point_total ?? 0;

      localSeconds = snap.state.seconds_remaining ?? 0;
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      if (!silent) loading = false;
    }
  }

  function startLocalTimer() {
    if (autoTick) return;
    autoTick = setInterval(() => {
      if (!snapshot) return;
      if (snapshot.state.status !== "running") return;
      localSeconds = Math.max(0, (localSeconds ?? 0) - 1);
    }, 1000);
  }

  function stopLocalTimer() {
    if (autoTick) clearInterval(autoTick);
    autoTick = null;
  }

  function startPolling() {
    if (pollHandle) return;
    pollHandle = setInterval(async () => {
      try {
        const snap = await getDraftSnapshot(seasonId);
        snapshot = snap;
        localSeconds = snap.state.seconds_remaining ?? 0;

        // If draft stops running, also disable mock mode to avoid “sticky” state.
        if (snap?.state?.status !== "running") mockPickEnabled = false;
      } catch (e) {}
    }, 2500);
  }

  function stopPolling() {
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = null;
  }

  $: if (snapshot?.state?.status === "running") {
    startLocalTimer();
    startPolling();
  } else {
    stopLocalTimer();
    stopPolling();
  }

  onMount(loadAll);
  onDestroy(() => {
    stopLocalTimer();
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
    if (!canEdit) return;
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
    if (!canEdit) return;
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
    if (!canEdit) return;
    overTeamId = target?.team_id ?? null;
    swapOrderWith(target);
  }

  async function saveOrder() {
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

  // undo last pick/turn (league master only, while paused)
  async function doUndo() {
    if (!confirm("Undo the last turn? This will remove the last pick/skip.")) return;
    try {
      const res = await fetch(`/api/seasons/${seasonId}/draft/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Undo failed");
      }
      mockPickEnabled = false;
      await loadAll({ silent: true });
      setFlash("Undid last turn.");
    } catch (e) {
      setFlash(e?.message ?? String(e), true);
    }
  }

  async function doPick() {
    try {
      const teamId = snapshot?.state?.current_team_id;
      if (!teamId) throw new Error("No current team.");
      const pid = Number(selectedPokemonId);
      if (!pid) throw new Error("Choose a Pokémon to draft.");

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

  // Only show mock button while running (your original “is it only visible after start?” question)
  // If you want it visible even before start, change this to: `canMockPick && !!currentTeam`
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

  // selection should be blocked for non-drafters
  function selectPokemon(pid) {
    if (!pickEnabled) return;
    selectedPokemonId = pid;
  }
</script>

{#if loading}
  <div class="card muted">Loading draft…</div>
{:else}
  {#if error}
    <div class="card err">{error}</div>
  {/if}
  {#if msg}
    <div class="card ok">{msg}</div>
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
            <span class="hint muted">Stored in tier_lists.team_point_total</span>
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
          <div class="muted">Draft order (drag to reorder)</div>
          {#if canEdit}
            <div class="orderBtns">
              <button type="button" class="btn" on:click|preventDefault|stopPropagation={randomizeOrder} disabled={(snapshot.order ?? []).length < 2}>
                Randomize
              </button>
              <button type="button" class="btn coral" on:click|preventDefault|stopPropagation={saveOrder} disabled={(snapshot.order ?? []).length < 2}>
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
                draggable={canEdit}
                animate:flip={{ duration: dragDuration }}
                on:dragstart={(e) => onOrderDragStart(o, e)}
                on:dragend={onOrderDragEnd}
                on:dragenter={() => onOrderDragEnter(o)}
                on:dragover|preventDefault
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

            <!-- NEW: Mock Pick toggle (admins + league masters only) -->
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
              disabled={snapshot.state.status === "ended"}
            >
              Skip turn
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
            <button type="button"
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

              <button type="button"
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

  .err {
    border-color: rgba(255, 80, 80, 0.35);
  }
  .ok {
    border-color: rgba(80, 255, 160, 0.35);
  }

  .divider {
    margin: 0.85rem 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
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

  /* NEW: mock button styling */
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
</style>
