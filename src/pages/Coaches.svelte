<script>
  import { onMount, onDestroy } from "svelte";
  import { getCoaches } from "../lib/api.js";

  const BASE = import.meta.env.BASE_URL;

  const badgeOrder = [
    ["Legend", "Rising", "Trio"],
    ["Earth", "Rumble", "Soul"],
    ["Beacon", "Voltage", "Dynamo"],
    ["Grand Slam", "Quake", "Triple Crown"]
  ];

  // backend keys
  const badgeKey = {
    "Legend": "legend",
    "Rising": "rising",
    "Trio": "trio",
    "Earth": "earth",
    "Rumble": "rumble",
    "Soul": "soul",
    "Beacon": "beacon",
    "Voltage": "voltage",
    "Dynamo": "dynamo",
    "Grand Slam": "grand_slam",
    "Quake": "quake",
    "Triple Crown": "triple_crown"
  };

  // IMPORTANT: keep these as "/images/..." and prepend BASE at render-time
  const badgeImg = {
    "Legend": "/images/Legend_Badge.png",
    "Rising": "/images/Rising_Badge.png",
    "Trio": "/images/Trio_Badge.png",
    "Earth": "/images/Earth_Badge.png",
    "Rumble": "/images/Rumble_Badge.png",
    "Soul": "/images/Soul_Badge.png",
    "Beacon": "/images/Beacon_Badge.png",
    "Voltage": "/images/Voltage_Badge.png",
    "Dynamo": "/images/Dynamo_Badge.png",
    "Grand Slam": "/images/Grand_Slam.png",
    "Quake": "/images/Quake_Badge.png",
    "Triple Crown": "/images/Triple_Crown.png"
  };

  // Medal images (in /public/images)
  const medalImg = {
    gold: "/images/major_gold.png",
    silver: "/images/major_silver.png",
    bronze: "/images/major_bronze.png"
  };

  let coaches = [];
  let loading = false;
  let error = "";

  // Tier tabs
  let tier = "Major"; // "Major" | "Intermediate" | "Minor"

  // Sorting (Alphabetical default)
  let sortKey = "alpha"; // alpha | medals | badges | elo | peak_elo | win_rate | joined
  let sortDir = "asc";   // asc | desc

  // Badge filtering (display names, e.g. "Legend")
  let selectedBadges = [];
  let showFilters = false; // pop-out toggle

  // click-outside refs
  let filterButtonEl;
  let filterPopoverEl;

  const pct = (x) => `${Math.round((x ?? 0) * 1000) / 10}%`;

  function badgeCount(coach, displayName) {
    const key = badgeKey[displayName];
    return key ? (coach?.badges?.[key] ?? 0) : 0;
  }

  function medalStackStyle(count, size = 28, overlap = 10) {
    const n = Math.max(0, Math.min(50, Number(count) || 0));
    const width = n > 0 ? size + (n - 1) * overlap : size;
    return { n, size, overlap, width };
  }

  // backend league_type enum values
  function tierToLeagueType(t) {
    if (t === "Major") return "major";
    if (t === "Intermediate") return "intermediate";
    return "minor";
  }

  function toggleBadgeFilter(b) {
    if (selectedBadges.includes(b)) {
      selectedBadges = selectedBadges.filter((x) => x !== b);
    } else {
      selectedBadges = [...selectedBadges, b];
    }
  }

  function clearBadgeFilters() {
    selectedBadges = [];
  }

  function enrichCoach(c) {
    const gold = c?.medals?.gold ?? 0;
    const silver = c?.medals?.silver ?? 0;
    const bronze = c?.medals?.bronze ?? 0;

    const medal_total = Number(gold) + Number(silver) + Number(bronze);

    let badge_total = 0;
    for (const k of Object.values(badgeKey)) {
      badge_total += Number(c?.badges?.[k] ?? 0);
    }

    const joined = c?.joined_season == null ? null : Number(c.joined_season);

    return {
      ...c,
      _stats: {
        medal_total,
        badge_total,
        elo: Number(c?.elo ?? 0),
        peak_elo: Number(c?.peak_elo ?? 0),
        win_rate: Number(c?.win_rate ?? 0),
        joined
      },
      _medal: {
        gold: medalStackStyle(gold, 28, 10),
        silver: medalStackStyle(silver, 28, 10),
        bronze: medalStackStyle(bronze, 28, 10)
      }
    };
  }

  function compareNullableNumber(a, b, nullsLast = true) {
    const aNull = a == null || Number.isNaN(a);
    const bNull = b == null || Number.isNaN(b);
    if (aNull && bNull) return 0;
    if (aNull) return nullsLast ? 1 : -1;
    if (bNull) return nullsLast ? -1 : 1;
    return a - b;
  }

  function nameKey(c) {
    return (c?.coach_name ?? "").trim().toLowerCase();
  }

  function getSortValue(c, key) {
    switch (key) {
      case "alpha":
        return nameKey(c);
      case "medals":
        return c?._stats?.medal_total ?? 0;
      case "badges":
        return c?._stats?.badge_total ?? 0;
      case "elo":
        return c?._stats?.elo ?? 0;
      case "peak_elo":
        return c?._stats?.peak_elo ?? 0;
      case "win_rate":
        return c?._stats?.win_rate ?? 0;
      case "joined":
        return c?._stats?.joined ?? null;
      default:
        return nameKey(c);
    }
  }

  function sortCoaches(list, key, dirStr) {
    const arr = list.slice(); // never mutate original
    const dir = dirStr === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      const av = getSortValue(a, key);
      const bv = getSortValue(b, key);

      if (key === "alpha") {
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      }

      if (key === "joined") {
        const cmp = compareNullableNumber(av, bv, true);
        if (cmp !== 0) return cmp * dir;
      } else {
        const cmp = Number(av) - Number(bv);
        if (cmp !== 0) return cmp * dir;
      }

      // tie-breaker: alphabetical ascending
      const an = nameKey(a);
      const bn = nameKey(b);
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    return arr;
  }

  // Badge filter (AND across all selected badges)
  $: badgeFiltered = coaches.filter((c) => {
    if (selectedBadges.length === 0) return true;
    return selectedBadges.every((b) => badgeCount(c, b) > 0);
  });

  // Final display list (sorted)
  $: displayedCoaches = sortCoaches(badgeFiltered, sortKey, sortDir);

  // ---- click outside to close filter popout ----
  function onDocumentClick(e) {
    if (!showFilters) return;

    const t = e.target;
    const clickedButton = filterButtonEl && filterButtonEl.contains(t);
    const clickedPopover = filterPopoverEl && filterPopoverEl.contains(t);

    if (!clickedButton && !clickedPopover) {
      showFilters = false;
    }
  }

  $: {
    if (showFilters) {
      document.addEventListener("click", onDocumentClick, true);
    } else {
      document.removeEventListener("click", onDocumentClick, true);
    }
  }

  onDestroy(() => {
    document.removeEventListener("click", onDocumentClick, true);
  });
  // ---------------------------------------------

  async function loadCoaches() {
    loading = true;
    error = "";
    try {
      const leagueType = tierToLeagueType(tier);
      const raw = await getCoaches(leagueType);
      coaches = (raw ?? []).map(enrichCoach);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadCoaches);

  // refetch whenever tier changes
  $: tier, loadCoaches();
</script>

<div class="app-shell">
  <header class="app-header">
    <div>
      <div class="app-title">Coaches</div>
      <div class="muted">Profiles, badges, medal counts, MVPs, and ELO.</div>

      <!-- Tier tabs -->
      <div class="tier-tabs" role="tablist" aria-label="Coach tiers">
        <button type="button" class="tier-tab" class:is-active={tier === "Major"} on:click={() => (tier = "Major")}>
          Major
        </button>
        <button type="button" class="tier-tab" class:is-active={tier === "Intermediate"} on:click={() => (tier = "Intermediate")}>
          Intermediate
        </button>
        <button type="button" class="tier-tab" class:is-active={tier === "Minor"} on:click={() => (tier = "Minor")}>
          Minor
        </button>
      </div>

      <!-- Controls row: Sort (left) + Filter (right) -->
      <div class="controls-row">
        <div class="control">
          <div class="control-label">Sort by</div>
          <select class="select" bind:value={sortKey}>
            <option value="alpha">Alphabetical</option>
            <option value="medals">Medal Count</option>
            <option value="badges">Badge Count</option>
            <option value="elo">ELO</option>
            <option value="peak_elo">Peak ELO</option>
            <option value="win_rate">Win Rate</option>
            <option value="joined">Join Season</option>
          </select>
        </div>

        <div class="control">
          <div class="control-label">Order</div>
          <button
            type="button"
            class="dir-btn"
            on:click={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
            title="Toggle ascending/descending">
            {sortDir === "asc" ? "Ascending ↑" : "Descending ↓"}
          </button>
        </div>

        <div class="control summary">
          <div class="control-label">Showing</div>
          <div class="muted">
            <strong>{tier}</strong>
            · Coaches: <strong>{displayedCoaches.length}</strong>
            {#if selectedBadges.length > 0}
              · Badge filter: <strong>{selectedBadges.length}</strong>
            {/if}
          </div>
        </div>

        <!-- Filter popout (right side) -->
        <div class="control filter-control">
          <div class="control-label">Filter</div>
          <div class="filter-popout">
            <button
              type="button"
              class="filter-btn"
              class:is-open={showFilters}
              bind:this={filterButtonEl}
              on:click={() => (showFilters = !showFilters)}>
              Badges {selectedBadges.length ? `(${selectedBadges.length})` : ""}
            </button>

            {#if showFilters}
              <div class="filter-panel" bind:this={filterPopoverEl}>
                <div class="filter-head">
                  <div class="filter-title">Filter by Badges (must own all selected)</div>
                  <button type="button" class="clear-btn" on:click={clearBadgeFilters} disabled={selectedBadges.length === 0}>
                    Clear
                  </button>
                </div>

                <div class="filter-grid">
                  {#each badgeOrder as row}
                    {#each row as b}
                      <button
                        type="button"
                        class="filter-badge"
                        class:is-selected={selectedBadges.includes(b)}
                        on:click={() => toggleBadgeFilter(b)}
                        title={selectedBadges.includes(b) ? `Filtering: ${b}` : `Filter by: ${b}`}>
                        <img class="filter-badge-img" src={BASE + badgeImg[b]} alt={b} />
                        <div class="filter-badge-name">{b}</div>
                      </button>
                    {/each}
                  {/each}
                </div>

                <div class="filter-foot muted">
                  Tip: select multiple badges to require coaches to own <strong>all</strong> of them.
                </div>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </header>

  {#if error}
    <div class="card" style="border-color:#f97373;color:#fecaca;">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="card">Loading coaches…</div>
  {:else}
    {#if displayedCoaches.length === 0}
      <div class="card muted">No coaches match the current filters.</div>
    {:else}
      <div class="coach-grid">
        {#each displayedCoaches as c}
          <div class="card coach-card">
            <div class="coach-top">
              <div class="coach-left">
                <div class="coach-name">{c.coach_name}</div>

                <div class="stat">
                  <div class="label">Joined</div>
                  <div class="value">Season {c.joined_season ?? "-"}</div>
                </div>

                <div class="stat">
                  <div class="label">Win Rate</div>
                  <div class="value">{pct(c.win_rate)}</div>
                </div>

                <div class="stat">
                  <div class="label">ELO</div>
                  <div class="value">{Math.round(c.elo ?? 0)}</div>
                </div>

                <div class="stat">
                  <div class="label">Peak ELO</div>
                  <div class="value">{Math.round(c.peak_elo ?? 0)}</div>
                </div>

                <div class="stat">
                  <div class="label">MVPs</div>
                  <div class="value">{c.mvps ?? 0}</div>
                </div>
              </div>

              <div class="coach-right">
                <div class="subhead">Badges</div>
                <table class="badge-table">
                  <tbody>
                    {#each badgeOrder as row}
                      <tr>
                        {#each row as b}
                          <td class:badge-on={badgeCount(c, b) > 0} class:badge-off={badgeCount(c, b) === 0}>
                            <img
                              class="badge-img"
                              src={BASE + badgeImg[b]}
                              alt={b}
                              title={`${b}${badgeCount(c, b) ? ` (${badgeCount(c, b)})` : ""}`}
                            />
                          </td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>

            <div class="coach-bottom">
              <div class="subhead">Medals</div>
              <table class="medal-table">
                <thead>
                  <tr>
                    <th>Gold</th>
                    <th>Silver</th>
                    <th>Bronze</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div class="medal-stack" style={`width:${c._medal.gold.width}px;height:${c._medal.gold.size}px;`}>
                        {#each Array(c._medal.gold.n) as _, i}
                          <img
                            class="medal-img"
                            src={BASE + medalImg.gold}
                            alt="Gold medal"
                            title={`Gold: ${c.medals?.gold ?? 0}`}
                            style={`left:${i * c._medal.gold.overlap}px;width:${c._medal.gold.size}px;height:${c._medal.gold.size}px;z-index:${i};`}
                            draggable="false"
                          />
                        {/each}
                        <span class="medal-count">{c.medals?.gold ?? 0}</span>
                      </div>
                    </td>

                    <td>
                      <div class="medal-stack" style={`width:${c._medal.silver.width}px;height:${c._medal.silver.size}px;`}>
                        {#each Array(c._medal.silver.n) as _, i}
                          <img
                            class="medal-img"
                            src={BASE + medalImg.silver}
                            alt="Silver medal"
                            title={`Silver: ${c.medals?.silver ?? 0}`}
                            style={`left:${i * c._medal.silver.overlap}px;width:${c._medal.silver.size}px;height:${c._medal.silver.size}px;z-index:${i};`}
                            draggable="false"
                          />
                        {/each}
                        <span class="medal-count">{c.medals?.silver ?? 0}</span>
                      </div>
                    </td>

                    <td>
                      <div class="medal-stack" style={`width:${c._medal.bronze.width}px;height:${c._medal.bronze.size}px;`}>
                        {#each Array(c._medal.bronze.n) as _, i}
                          <img
                            class="medal-img"
                            src={BASE + medalImg.bronze}
                            alt="Bronze medal"
                            title={`Bronze: ${c.medals?.bronze ?? 0}`}
                            style={`left:${i * c._medal.bronze.overlap}px;width:${c._medal.bronze.size}px;height:${c._medal.bronze.size}px;z-index:${i};`}
                            draggable="false"
                          />
                        {/each}
                        <span class="medal-count">{c.medals?.bronze ?? 0}</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .controls-row{
    display:flex;
    flex-wrap:wrap;
    gap:.75rem;
    margin-top:.75rem;
    align-items:flex-end;
  }
  .control{
    display:flex;
    flex-direction:column;
    gap:.25rem;
  }
  .control-label{
    font-weight:700;
    font-size:.85rem;
    color:rgba(255,255,255,.8);
  }

  .dir-btn{
    appearance:none;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    color:rgba(255,255,255,.9);
    padding:.45rem .75rem;
    border-radius:10px;
    cursor:pointer;
    font-weight:700;
  }
  .dir-btn:hover{ background:rgba(255,255,255,.09); }

  .summary{
    margin-left:auto;
    min-width:240px;
  }

  .filter-control{
    margin-left:auto;
  }

  .filter-popout{
    position:relative;
    display:inline-block;
  }
  .filter-btn{
    appearance:none;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    color:rgba(255,255,255,.9);
    padding:.45rem .75rem;
    border-radius:10px;
    cursor:pointer;
    font-weight:800;
    white-space:nowrap;
  }
  .filter-btn:hover{ background:rgba(255,255,255,.09); }
  .filter-btn.is-open{
    outline: 1px solid rgba(255,107,107,.35);
    background: rgba(255,107,107,.14);
  }

  .filter-panel{
    position:absolute;
    right:0;
    top: calc(100% + 8px);
    z-index: 50;
    width: min(720px, 92vw);
    padding:.75rem;
    border-radius:14px;
    background: rgba(10,12,20,.98);
    border: 1px solid rgba(255,255,255,.10);
    box-shadow: 0 12px 30px rgba(0,0,0,.45);
  }

  .filter-head{
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:.75rem;
    margin-bottom:.65rem;
  }
  .filter-title{
    font-weight:900;
    color: rgba(255,255,255,.92);
  }
  .clear-btn{
    appearance:none;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    color:rgba(255,255,255,.9);
    padding:.35rem .6rem;
    border-radius:10px;
    cursor:pointer;
    font-weight:800;
  }
  .clear-btn:disabled{ opacity:.4; cursor:default; }

  .filter-grid{
    display:grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap:.6rem;
  }
  .filter-badge{
    appearance:none;
    border:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.05);
    border-radius:14px;
    padding:.55rem;
    cursor:pointer;
    display:flex;
    gap:.6rem;
    align-items:center;
    text-align:left;
  }
  .filter-badge:hover{ background:rgba(255,255,255,.08); }
  .filter-badge.is-selected{
    background: rgba(255,107,107,.16);
    outline: 1px solid rgba(255,107,107,.35);
    border-color: rgba(255,107,107,.25);
  }
  .filter-badge-img{
    width:36px;
    height:36px;
    image-rendering:pixelated;
    flex:0 0 auto;
  }
  .filter-badge-name{
    font-weight:900;
    color:rgba(255,255,255,.92);
    font-size:.95rem;
    line-height:1.1;
  }
  .filter-foot{
    margin-top:.6rem;
    color: rgba(255,255,255,.65);
    font-size:.85rem;
  }

  .tier-tabs{
    display:inline-flex;
    gap:.5rem;
    margin-top:.75rem;
    padding:.25rem;
    border-radius:999px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.08);
  }
  .tier-tab{
    appearance:none;
    border:0;
    background:transparent;
    color:rgba(255,255,255,.78);
    padding:.4rem .85rem;
    border-radius:999px;
    font-weight:800;
    cursor:pointer;
  }
  .tier-tab:hover{
    background:rgba(255,255,255,.08);
    color:rgba(255,255,255,.92);
  }
  .tier-tab.is-active{
    background:rgba(255,107,107,.22);
    outline:1px solid rgba(255,107,107,.35);
    color:rgba(255,255,255,.95);
  }

  .coach-grid{
    display:grid;
    grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
    gap:1rem;
    width:100%;
  }
  .coach-card{ padding:1rem; }
  .coach-top{
    display:grid;
    grid-template-columns: 1fr 1.2fr;
    gap:1rem;
    align-items:start;
  }
  .coach-name{
    font-size:1.1rem;
    font-weight:900;
    margin-bottom:.5rem;
  }
  .stat{
    display:flex;
    justify-content:space-between;
    padding:.35rem 0;
    border-bottom:1px solid rgba(255,255,255,.06);
  }
  .label{ color:rgba(255,255,255,.7); }
  .value{ font-weight:700; }

  .subhead{
    font-weight:900;
    margin-bottom:.5rem;
  }

  .badge-table{ width:100%; border-collapse:separate; border-spacing:.4rem; }
  .badge-table td{
    width:64px;
    height:64px;
    border-radius:12px;
    text-align:center;
    vertical-align:middle;
    background:rgba(255,255,255,.06);
  }
  .badge-img{
    width:48px;
    height:48px;
    image-rendering:pixelated;
    display:block;
    margin:0 auto;
  }
  .badge-off{ filter:grayscale(1); opacity:.45; }
  .badge-on{
    opacity:1;
    filter:none;
    background:rgba(255,107,107,.22);
    outline:1px solid rgba(255,107,107,.35);
  }

  .coach-bottom{
    margin-top:1rem;
    padding-top:.75rem;
    border-top:1px solid rgba(255,255,255,.08);
  }

  .medal-table{ width:100%; border-collapse:collapse; }
  .medal-table th, .medal-table td{
    text-align:center;
    padding:.55rem .4rem;
    border-bottom:1px solid rgba(255,255,255,.06);
    vertical-align:middle;
  }

  .medal-stack{
    position:relative;
    display:inline-block;
    height:28px;
  }
  .medal-img{
    position:absolute;
    top:0;
    image-rendering:pixelated;
    user-select:none;
    pointer-events:none;
  }
  .medal-count{
    position:absolute;
    right:-18px;
    top:50%;
    transform:translateY(-50%);
    font-weight:900;
    font-size:.85rem;
    color:rgba(255,255,255,.85);
  }
</style>
