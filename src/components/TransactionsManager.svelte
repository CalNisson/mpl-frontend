<script>
  import { onMount } from "svelte";
  import {
    getSeasonTransactions,
    getTransactionsMeta,
    createTradeTransaction,
    createFreeAgencyTransaction
  } from "../lib/api.js";
  import { leagueContext } from "../lib/leagueStore.js";

  export let seasonId;
  export let leagueId;
  export let canEdit = false;

  let loading = false;
  let error = "";

  let data = { trades: [], free_agency: [] };

  // ----------------------------
  // Sprites (name -> dex fallback)
  // ----------------------------
  const spriteCache = new Map();

  async function getSprite(pokemonName, dexNumber = null) {
    const nameKey = (pokemonName ?? "").trim().toLowerCase();
    const dexKey = dexNumber != null ? String(dexNumber) : "";

    // Prefer caching by name if we have it, otherwise by dex
    const cacheKey = nameKey || (dexKey ? `dex:${dexKey}` : "");
    if (!cacheKey) return "";
    if (spriteCache.has(cacheKey)) return spriteCache.get(cacheKey);

    const tryFetch = async (path) => {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${path}`);
      if (!res.ok) throw new Error("pokeapi fetch failed");
      const j = await res.json();
      return (
        j?.sprites?.other?.["official-artwork"]?.front_default ||
        j?.sprites?.front_default ||
        ""
      );
    };

    // 1) Try by normalized slug from name
    if (nameKey) {
      const slug = nameKey
        .replace(/♀/g, "-f")
        .replace(/♂/g, "-m")
        .replace(/[.'"]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      try {
        const url = await tryFetch(slug);
        spriteCache.set(cacheKey, url);
        return url;
      } catch {
        // fall through to dex
      }
    }

    // 2) Fallback: try by dex number
    if (dexNumber != null) {
      try {
        const url = await tryFetch(String(dexNumber));
        spriteCache.set(cacheKey, url);
        if (nameKey) spriteCache.set(nameKey, url);
        spriteCache.set(`dex:${dexKey}`, url);
        return url;
      } catch {
        // ignore
      }
    }

    spriteCache.set(cacheKey, "");
    return "";
  }

  async function refresh() {
    if (!seasonId) return;
    loading = true;
    error = "";
    try {
      data = await getSeasonTransactions(seasonId);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  onMount(refresh);
  $: if (seasonId) refresh();

  // ----------------------------
  // Trades grouped by week (collapsible)
  // ----------------------------
  $: tradesByWeek = (data?.trades ?? []).reduce((acc, t) => {
    const w = t.week ?? 0;
    if (!acc[w]) acc[w] = [];
    acc[w].push(t);
    return acc;
  }, {});

  $: tradeWeeks = Object.keys(tradesByWeek)
    .map((n) => parseInt(n, 10))
    .sort((a, b) => a - b);

  let openTradeWeeks = new Set();
  function toggleTradeWeek(w) {
    const next = new Set(openTradeWeeks);
    if (next.has(w)) next.delete(w);
    else next.add(w);
    openTradeWeeks = next;
  }

  // ----------------------------
  // Team color helpers (chip background tint)
  // ----------------------------
  function colorOrDefault(c) {
    const s = (c ?? "").trim();
    return s ? s : "#000000";
  }

  function hexToRgba(hex, alpha = 0.18) {
    const h = (hex ?? "").trim().replace("#", "");
    if (!h) return `rgba(0,0,0,${alpha})`;

    const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
    if (full.length !== 6) return `rgba(0,0,0,${alpha})`;

    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);

    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return `rgba(0,0,0,${alpha})`;
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function chipStyle(color) {
    const c = colorOrDefault(color);
    return `--team-color:${c}; --team-bg:${hexToRgba(c, 0.18)};`;
  }

  // ----------------------------
  // Free Agency grouped by week (collapsible) ✅
  // ----------------------------
  $: faByWeek = (data?.free_agency ?? []).reduce((acc, f) => {
    const w = f.week ?? 0;
    if (!acc[w]) acc[w] = [];
    acc[w].push(f);
    return acc;
  }, {});

  $: faWeeks = Object.keys(faByWeek)
    .map((n) => parseInt(n, 10))
    .sort((a, b) => a - b);

  let openFaWeeks = new Set();
  function toggleFaWeek(w) {
    const next = new Set(openFaWeeks);
    if (next.has(w)) next.delete(w);
    else next.add(w);
    openFaWeeks = next;
  }

  // ----------------------------
  // Create modal state
  // ----------------------------
  let showCreate = false;
  let createKind = "trade"; // "trade" | "fa"
  let metaLoading = false;
  let metaError = "";
  let meta = null;

  let week = 1;

  // trade state
  let tradeTeamA = null;
  let tradeTeamB = null;
  let tradeASends = new Set(); // pokemon_id
  let tradeBSends = new Set();

  // free agency state
  let faTeam = null;
  let faDrops = new Set();
  let faPickups = new Set();
  let faSearch = "";

  let showConfirm = false;
  let confirmError = "";
  let submitting = false;

  function openCreate() {
    showCreate = true;
    createKind = "trade";
    week = 1;
    tradeTeamA = null;
    tradeTeamB = null;
    tradeASends = new Set();
    tradeBSends = new Set();
    faTeam = null;
    faDrops = new Set();
    faPickups = new Set();
    faSearch = "";
    showConfirm = false;
    confirmError = "";
    loadMeta();
  }

  async function loadMeta() {
    metaLoading = true;
    metaError = "";
    meta = null;
    try {
      meta = await getTransactionsMeta(seasonId);
    } catch (e) {
      metaError = e?.message ?? String(e);
    } finally {
      metaLoading = false;
    }
  }

  function teamById(id) {
    return meta?.teams?.find((t) => t.team_id === id) ?? null;
  }

  function pointsForPokemon(id) {
    return meta?.pokemon?.find((p) => p.pokemon_id === id)?.points ?? 0;
  }

  function ownedForPokemon(id) {
    return meta?.pokemon?.find((p) => p.pokemon_id === id)?.is_owned ?? false;
  }

  function toggleSet(set, value) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  // ---- Derived: Free Agency budget/roster checks ----
  $: faCurrentTeam = meta ? teamById(faTeam) : null;
  $: faCurrentRosterIds = new Set((faCurrentTeam?.roster ?? []).map((p) => p.pokemon_id));
  $: faCurrentPoints = faCurrentTeam?.roster_points ?? 0;
  $: faCurrentSize = faCurrentTeam?.roster_size ?? 0;

  $: faDropPoints = Array.from(faDrops).reduce(
    (acc, pid) => acc + pointsForPokemon(pid),
    0
  );
  $: faPickupPoints = Array.from(faPickups).reduce(
    (acc, pid) => acc + pointsForPokemon(pid),
    0
  );

  $: faNewPoints = faCurrentPoints - faDropPoints + faPickupPoints;
  $: faNewSize = faCurrentSize - faDrops.size + faPickups.size;

  $: faWithinBudget = meta ? faNewPoints <= meta.team_point_total : true;
  $: faWithinRosterMin = meta ? faNewSize >= meta.min_pokemon : true;
  $: faWithinRosterMax =
    meta && meta.max_pokemon != null ? faNewSize <= meta.max_pokemon : true;

  $: faOk = faWithinBudget && faWithinRosterMin && faWithinRosterMax;

  $: faMaxAffordable = meta
    ? meta.team_point_total - (faCurrentPoints - faDropPoints)
    : 0;

  $: faAvailablePokemon = (meta?.pokemon ?? [])
    .filter((p) => !p.is_owned)
    .filter((p) => p.points <= faMaxAffordable)
    .filter((p) => {
      if (!faSearch.trim()) return true;
      return p.pokemon_name.toLowerCase().includes(faSearch.trim().toLowerCase());
    })
    .slice(0, 250); // safety cap for rendering

  // ---- Derived: Trade checks (UI-level; backend enforces real validation) ----
  $: tradeA = meta ? teamById(tradeTeamA) : null;
  $: tradeB = meta ? teamById(tradeTeamB) : null;

  function tradeRosterList(team, selectedSet) {
    const roster = team?.roster ?? [];
    return roster.map((p) => ({
      ...p,
      selected: selectedSet.has(p.pokemon_id),
    }));
  }

  $: tradeARoster = tradeRosterList(tradeA, tradeASends);
  $: tradeBRoster = tradeRosterList(tradeB, tradeBSends);

  $: tradeAOutPoints = Array.from(tradeASends).reduce(
    (acc, pid) => acc + pointsForPokemon(pid),
    0
  );
  $: tradeBOutPoints = Array.from(tradeBSends).reduce(
    (acc, pid) => acc + pointsForPokemon(pid),
    0
  );

  $: tradeAInPoints = tradeBOutPoints;
  $: tradeBInPoints = tradeAOutPoints;

  $: tradeANewPoints =
    (tradeA?.roster_points ?? 0) - tradeAOutPoints + tradeAInPoints;
  $: tradeBNewPoints =
    (tradeB?.roster_points ?? 0) - tradeBOutPoints + tradeBInPoints;

  $: tradeOk =
    meta &&
    tradeTeamA &&
    tradeTeamB &&
    tradeTeamA !== tradeTeamB &&
    tradeANewPoints <= meta.team_point_total &&
    tradeBNewPoints <= meta.team_point_total;

  function openConfirm() {
    confirmError = "";
    showConfirm = true;
  }

  async function submitConfirmed() {
    submitting = true;
    confirmError = "";
    try {
      if (createKind === "trade") {
        const body = {
          week,
          team_a_id: tradeTeamA,
          team_b_id: tradeTeamB,
          team_a_sends: Array.from(tradeASends),
          team_b_sends: Array.from(tradeBSends),
        };
        await createTradeTransaction(seasonId, body);
      } else {
        const body = {
          week,
          team_id: faTeam,
          pickups: Array.from(faPickups),
          drops: Array.from(faDrops),
        };
        await createFreeAgencyTransaction(seasonId, body);
      }

      showConfirm = false;
      showCreate = false;
      await refresh();
    } catch (e) {
      confirmError = e?.message ?? String(e);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="tx-wrap">
  <div class="tx-header">
    <h2>Transactions</h2>
    {#if canEdit}
      <button class="btn" on:click={openCreate}>New Transaction</button>
    {/if}
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="muted">Loading…</div>
  {:else}
    <div class="tx-sections">
      <div class="tx-section">
        <h3>Trades</h3>

        {#if (data.trades ?? []).length === 0}
          <div class="muted">No trades yet.</div>
        {:else}
          {#each tradeWeeks as w (w)}
            <div class="card">
              <button
                class="collapse-head"
                type="button"
                on:click={() => toggleTradeWeek(w)}
                aria-expanded={openTradeWeeks.has(w)}
              >
                <div class="collapse-title">Week {w}</div>
                <div class="muted">
                  {tradesByWeek[w].length} trade{tradesByWeek[w].length === 1 ? "" : "s"}
                </div>
                <div class="chev">{openTradeWeeks.has(w) ? "▾" : "▸"}</div>
              </button>

              {#if openTradeWeeks.has(w)}
                <div class="collapse-body">
                  {#each tradesByWeek[w] as t (t.team_a_id + ":" + t.team_b_id)}
                    <div class="trade-card">
                      <div class="card-title">
                        <div class="trade-title">
                          <span class="team-chip" style={chipStyle(t.team_a_color_primary)}>
                            {t.team_a_name}
                          </span>
                          <span class="muted">↔</span>
                          <span class="team-chip" style={chipStyle(t.team_b_color_primary)}>
                            {t.team_b_name}
                          </span>
                        </div>
                      </div>

                      <div class="trade-grid">
                        <div class="trade-side">
                          <div class="trade-side-title team-accent" style={`--team-color:${colorOrDefault(t.team_a_color_primary)}`}>
                            {t.team_a_name} sends
                          </div>
                          {#each t.team_a_sends as p (p.pokemon_id)}
                            <div class="poke-row">
                              {#await getSprite(p.pokemon_name, p.dex_number)}
                                <div class="sprite placeholder"></div>
                              {:then url}
                                {#if url}
                                  <img class="sprite" alt={p.pokemon_name} src={url} />
                                {:else}
                                  <div class="sprite placeholder"></div>
                                {/if}
                              {/await}
                              <div class="poke-name">{p.pokemon_name}</div>
                              <div class="poke-points">{p.points} pts</div>
                            </div>
                          {/each}
                        </div>

                        <div class="trade-side">
                          <div class="trade-side-title team-accent" style={`--team-color:${colorOrDefault(t.team_b_color_primary)}`}>
                            {t.team_b_name} sends
                          </div>
                          {#each t.team_b_sends as p (p.pokemon_id)}
                            <div class="poke-row">
                              {#await getSprite(p.pokemon_name, p.dex_number)}
                                <div class="sprite placeholder"></div>
                              {:then url}
                                {#if url}
                                  <img class="sprite" alt={p.pokemon_name} src={url} />
                                {:else}
                                  <div class="sprite placeholder"></div>
                                {/if}
                              {/await}
                              <div class="poke-name">{p.pokemon_name}</div>
                              <div class="poke-points">{p.points} pts</div>
                            </div>
                          {/each}
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <!-- ---------------------------- -->
      <!-- Free Agency (grouped by week) ✅ -->
      <!-- ---------------------------- -->
      <div class="tx-section">
        <h3>Free Agency</h3>

        {#if (data.free_agency ?? []).length === 0}
          <div class="muted">No free agency transactions yet.</div>
        {:else}
          {#each faWeeks as w (w)}
            <div class="card">
              <button
                class="collapse-head"
                type="button"
                on:click={() => toggleFaWeek(w)}
                aria-expanded={openFaWeeks.has(w)}
              >
                <div class="collapse-title">Week {w}</div>
                <div class="muted">
                  {faByWeek[w].length} team{faByWeek[w].length === 1 ? "" : "s"}
                </div>
                <div class="chev">{openFaWeeks.has(w) ? "▾" : "▸"}</div>
              </button>

              {#if openFaWeeks.has(w)}
                <div class="collapse-body">
                  {#each faByWeek[w] as f (f.team_id)}
                    <div class="trade-card">
                      <div class="card-title">
                        <div class="team-chip" style={chipStyle(f.team_color_primary)}>
                          {f.team_name}
                        </div>
                      </div>

                      <div class="fa-grid">
                        <div>
                          <div class="trade-side-title">Pickups</div>
                          {#if (f.pickups ?? []).length === 0}
                            <div class="muted">None</div>
                          {:else}
                            {#each f.pickups as p (p.pokemon_id)}
                              <div class="poke-row">
                                {#await getSprite(p.pokemon_name, p.dex_number)}
                                  <div class="sprite placeholder"></div>
                                {:then url}
                                  {#if url}
                                    <img class="sprite" alt={p.pokemon_name} src={url} />
                                  {:else}
                                    <div class="sprite placeholder"></div>
                                  {/if}
                                {/await}
                                <div class="poke-name">{p.pokemon_name}</div>
                                <div class="poke-points">{p.points} pts</div>
                              </div>
                            {/each}
                          {/if}
                        </div>

                        <div>
                          <div class="trade-side-title">Drops</div>
                          {#if (f.drops ?? []).length === 0}
                            <div class="muted">None</div>
                          {:else}
                            {#each f.drops as p (p.pokemon_id)}
                              <div class="poke-row">
                                {#await getSprite(p.pokemon_name, p.dex_number)}
                                  <div class="sprite placeholder"></div>
                                {:then url}
                                  {#if url}
                                    <img class="sprite" alt={p.pokemon_name} src={url} />
                                  {:else}
                                    <div class="sprite placeholder"></div>
                                  {/if}
                                {/await}
                                <div class="poke-name">{p.pokemon_name}</div>
                                <div class="poke-points">{p.points} pts</div>
                              </div>
                            {/each}
                          {/if}
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if showCreate}
  <div class="modal-backdrop" on:click={() => (showCreate = false)}></div>

  <div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head">
      <h3>New Transaction</h3>
      <button class="icon-btn" on:click={() => (showCreate = false)}>✕</button>
    </div>

    {#if metaLoading}
      <div class="muted">Loading form…</div>
    {:else if metaError}
      <div class="error">{metaError}</div>
    {:else if meta}
      <div class="form-grid">
        <label>
          Type
          <select class="select" bind:value={createKind}>
            <option value="trade">Trade</option>
            <option value="fa">Free Agency</option>
          </select>
        </label>

        <label>
          Week
          <input type="number" min="0" step="1" bind:value={week} />
        </label>
      </div>

      {#if createKind === "trade"}
        <div class="form-grid">
          <label>
            Team A
            <select class="select" bind:value={tradeTeamA}>
              <option value={null} disabled selected>— Select —</option>
              {#each meta.teams as t (t.team_id)}
                <option value={t.team_id}>{t.team_name}</option>
              {/each}
            </select>
          </label>

          <label>
            Team B
            <select class="select" bind:value={tradeTeamB}>
              <option value={null} disabled selected>— Select —</option>
              {#each meta.teams as t (t.team_id)}
                <option value={t.team_id}>{t.team_name}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="trade-grid form-trade">
          <div class="trade-side">
            <div class="trade-side-title">
              {tradeA?.team_name ?? "Team A"} roster
              {#if tradeA}
                <span class="muted">({tradeA.roster_points} / {meta.team_point_total} pts)</span>
              {/if}
            </div>

            {#if tradeA}
              {#each tradeARoster as p (p.pokemon_id)}
                <label class="check-row">
                  <input
                    type="checkbox"
                    checked={p.selected}
                    on:change={() => (tradeASends = toggleSet(tradeASends, p.pokemon_id))}
                  />
                  <span>{p.pokemon_name}</span>
                  <span class="muted">{p.points} pts</span>
                </label>
              {/each}
            {:else}
              <div class="muted">Select Team A</div>
            {/if}
          </div>

          <div class="trade-side">
            <div class="trade-side-title">
              {tradeB?.team_name ?? "Team B"} roster
              {#if tradeB}
                <span class="muted">({tradeB.roster_points} / {meta.team_point_total} pts)</span>
              {/if}
            </div>

            {#if tradeB}
              {#each tradeBRoster as p (p.pokemon_id)}
                <label class="check-row">
                  <input
                    type="checkbox"
                    checked={p.selected}
                    on:change={() => (tradeBSends = toggleSet(tradeBSends, p.pokemon_id))}
                  />
                  <span>{p.pokemon_name}</span>
                  <span class="muted">{p.points} pts</span>
                </label>
              {/each}
            {:else}
              <div class="muted">Select Team B</div>
            {/if}
          </div>
        </div>

        <div class="summary">
          <div class="muted">
            After trade:
            {#if tradeA && tradeB}
              {tradeA.team_name} → {tradeANewPoints} / {meta.team_point_total} pts,
              {tradeB.team_name} → {tradeBNewPoints} / {meta.team_point_total} pts
            {/if}
          </div>
          <button class="btn" disabled={!tradeOk} on:click={openConfirm}>Preview</button>
        </div>
      {:else}
        <div class="form-grid">
          <label>
            Team
            <select class="select" bind:value={faTeam}>
              <option value={null} disabled selected>— Select —</option>
              {#each meta.teams as t (t.team_id)}
                <option value={t.team_id}>{t.team_name}</option>
              {/each}
            </select>
          </label>

          <label>
            Search pickups
            <input placeholder="e.g. Rotom" bind:value={faSearch} />
          </label>
        </div>

        {#if !faTeam}
          <div class="muted">Select a team to manage free agency.</div>
        {:else}
          <div class="trade-grid form-trade">
            <div class="trade-side">
              <div class="trade-side-title">
                Drops (current roster)
                <span class="muted">({faCurrentPoints} / {meta.team_point_total} pts)</span>
              </div>

              {#each (faCurrentTeam?.roster ?? []) as p (p.pokemon_id)}
                <label class="check-row">
                  <input
                    type="checkbox"
                    checked={faDrops.has(p.pokemon_id)}
                    on:change={() => (faDrops = toggleSet(faDrops, p.pokemon_id))}
                  />
                  <span>{p.pokemon_name}</span>
                  <span class="muted">{p.points} pts</span>
                </label>
              {/each}
            </div>

            <div class="trade-side">
              <div class="trade-side-title">
                Pickups (≤ {faMaxAffordable} pts)
                <span class="muted">({faPickups.size} selected)</span>
              </div>

              <div class="pickupsScroll">
                {#each faAvailablePokemon as p (p.pokemon_id)}
                  <label class="check-row">
                    <input
                      type="checkbox"
                      disabled={p.points > faMaxAffordable && !faPickups.has(p.pokemon_id)}
                      checked={faPickups.has(p.pokemon_id)}
                      on:change={() => (faPickups = toggleSet(faPickups, p.pokemon_id))}
                    />
                    <span>{p.pokemon_name}</span>
                    <span class="muted">{p.points} pts</span>
                  </label>
                {/each}
              </div>

              {#if (meta.pokemon ?? []).length > faAvailablePokemon.length}
                <div class="muted small">Showing first {faAvailablePokemon.length} matches.</div>
              {/if}
            </div>
          </div>

          <div class="summary">
            <div class="muted">
              After: {faNewPoints} / {meta.team_point_total} pts · size {faNewSize}
              {#if !faWithinBudget} · over budget{/if}
              {#if !faWithinRosterMin} · below min{/if}
              {#if !faWithinRosterMax} · above max{/if}
            </div>
            <button class="btn" disabled={!faOk} on:click={openConfirm}>Preview</button>
          </div>
        {/if}
      {/if}
    {/if}

    {#if showConfirm}
      <div class="confirm">
        <h4>Confirm</h4>

        {#if createKind === "trade"}
          <div class="confirm-grid">
            <div>
              <div class="muted">{tradeA?.team_name} sends</div>
              <ul>
                {#each Array.from(tradeASends) as pid (pid)}
                  <li>{meta?.pokemon?.find((p) => p.pokemon_id === pid)?.pokemon_name ?? pid}</li>
                {/each}
              </ul>
            </div>
            <div>
              <div class="muted">{tradeB?.team_name} sends</div>
              <ul>
                {#each Array.from(tradeBSends) as pid (pid)}
                  <li>{meta?.pokemon?.find((p) => p.pokemon_id === pid)?.pokemon_name ?? pid}</li>
                {/each}
              </ul>
            </div>
          </div>
        {:else}
          <div class="confirm-grid">
            <div>
              <div class="muted">Pickups</div>
              <ul>
                {#each Array.from(faPickups) as pid (pid)}
                  <li>{meta?.pokemon?.find((p) => p.pokemon_id === pid)?.pokemon_name ?? pid}</li>
                {/each}
              </ul>
            </div>
            <div>
              <div class="muted">Drops</div>
              <ul>
                {#each Array.from(faDrops) as pid (pid)}
                  <li>{meta?.pokemon?.find((p) => p.pokemon_id === pid)?.pokemon_name ?? pid}</li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}

        {#if confirmError}
          <div class="error">{confirmError}</div>
        {/if}

        <div class="confirm-actions">
          <button class="btn ghost" disabled={submitting} on:click={() => (showConfirm = false)}>
            Cancel
          </button>
          <button class="btn" disabled={submitting} on:click={submitConfirmed}>
            {submitting ? "Submitting…" : "Confirm"}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tx-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .tx-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .tx-sections {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }

  @media (min-width: 900px) {
    .tx-sections {
      grid-template-columns: 1fr 1fr;
    }
  }

  .tx-section h3 {
    margin: 0 0 8px 0;
  }

  .card {
    background: #0f1115;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 12px;
    margin-bottom: 10px;
  }

  .card-title {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
    font-weight: 600;
  }

  .trade-grid,
  .fa-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 650px) {
    .trade-grid,
    .fa-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  .trade-side-title {
    font-weight: 600;
    margin-bottom: 6px;
  }

  .poke-row {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .poke-row:last-child {
    border-bottom: none;
  }

  .sprite {
    width: 36px;
    height: 36px;
    object-fit: contain;
  }
  .placeholder {
    background: rgba(255, 255, 255, 0.06);
    border-radius: 8px;
  }

  .poke-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .poke-points {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }

  .muted {
    opacity: 0.75;
  }
  .small {
    font-size: 12px;
  }

  .btn {
    background: #ff6b6b;
    color: #101114;
    border: none;
    border-radius: 10px;
    padding: 8px 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.ghost {
    background: transparent;
    color: #eaeaea;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }

  .error {
    color: #ff9aa0;
    background: rgba(255, 107, 107, 0.12);
    border: 1px solid rgba(255, 107, 107, 0.25);
    padding: 8px 10px;
    border-radius: 10px;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 50;
  }

  .modal {
    position: fixed;
    z-index: 51;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(980px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow: auto;
    background: #0f1115;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    padding: 14px;
  }

  .modal-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: #eaeaea;
    font-size: 18px;
    cursor: pointer;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }

  @media (min-width: 650px) {
    .form-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 600;
  }

  input {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #eaeaea;
    border-radius: 10px;
    padding: 8px 10px;
  }

  .form-trade {
    margin-top: 6px;
  }

  .check-row {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-weight: 500;
  }
  .check-row:last-child {
    border-bottom: none;
  }

  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
  }

  .confirm {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  .confirm-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  @media (min-width: 650px) {
    .confirm-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 12px;
  }

  .pickupsScroll {
    max-height: 420px;
    overflow: auto;
    padding-right: 6px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
    padding: 6px 10px;
  }

  /* Week collapse header */
  .collapse-head {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 10px;
    align-items: center;
    text-align: left;
    background: transparent;
    border: none;
    color: inherit;
    padding: 0;
    cursor: pointer;
  }

  .collapse-title {
    font-weight: 700;
  }

  .chev {
    opacity: 0.8;
    font-size: 16px;
  }

  .collapse-body {
    margin-top: 10px;
  }

  /* Inner cards within a week group */
  .trade-card {
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .trade-card:first-child {
    padding-top: 0;
    border-top: none;
  }

  /* Colored team chips (tinted background) */
  .team-chip {
    --team-color: #000000;
    --team-bg: rgba(0, 0, 0, 0.18);

    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;

    background: var(--team-bg);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    position: relative;
  }

  .team-chip::before {
    content: "";
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--team-color);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
  }

  .trade-title {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .team-accent {
    --team-color: #000000;
    padding-left: 10px;
    border-left: 4px solid var(--team-color);
    border-radius: 4px;
  }
</style>
