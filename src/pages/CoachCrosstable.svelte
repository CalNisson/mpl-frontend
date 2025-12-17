<script>
  import { onMount } from "svelte";
  import { getCoachCrosstable } from "../lib/api.js";
  import { leagueContext } from "../lib/leagueStore";
  import { push } from "svelte-spa-router";
  import { get } from "svelte/store";

  // Cache settings (default/full table only)
  const CACHE_KEY = "coach_crosstable_v1";
  const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

  let namesInput = "";
  let loading = true;
  let error = null;

  // Expected response:
  // {
  //   coaches: [{ coach_id, coach_name }],
  //   matrix: { [coach_id]: { [opponent_id]: { wins, losses } } },
  //   totals: { [coach_id]: { wins, losses } } // optional but nice
  // }
  let data = null;

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ts || !parsed?.data) return null;
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  function writeCache(d) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: d }));
    } catch {
      // ignore cache failures
    }
  }

  function cellLabel(cell) {
    const w = Number(cell?.wins ?? 0);
    const l = Number(cell?.losses ?? 0);
    return `${w}-${l}`;
  }

  // color class based on (wins - losses)
  function cellClass(cell) {
    if (!cell) return "cell cell-empty";
    const w = Number(cell?.wins ?? 0);
    const l = Number(cell?.losses ?? 0);
    const diff = w - l;

    if (diff >= 3) return "cell cell-win-strong";
    if (diff >= 1) return "cell cell-win";
    if (diff === 0) return "cell cell-even";
    if (diff <= -3) return "cell cell-loss-strong";
    return "cell cell-loss";
  }

  function rowTotalNums(coachId) {
    // prefer backend totals if present
    const t = data?.totals?.[coachId];
    if (t) {
      return {
        w: Number(t.wins ?? 0),
        l: Number(t.losses ?? 0),
      };
    }

    // compute from matrix
    const row = data?.matrix?.[coachId] ?? {};
    let w = 0, l = 0;
    for (const oppId of Object.keys(row)) {
      w += Number(row[oppId]?.wins ?? 0);
      l += Number(row[oppId]?.losses ?? 0);
    }
    return { w, l };
  }

  function rowTotal(coachId) {
    const { w, l } = rowTotalNums(coachId);
    return `${w}-${l}`;
  }

  // NEW: drop coaches who have no matches at all (wins+losses == 0)
  function hasAnyMatches(coachId) {
    const { w, l } = rowTotalNums(coachId);
    return (w + l) > 0;
  }

  // NEW: coaches actually shown in the table
  $: displayCoaches = (data?.coaches ?? []).filter((c) => hasAnyMatches(c.coach_id));

  async function loadDefault({ force = false } = {}) {
    loading = true;
    error = null;

    try {
      if (!force) {
        const cached = readCache();
        if (cached) {
          data = cached;
          loading = false;
          return;
        }
      }

      const fresh = await getCoachCrosstable("");
      data = fresh;
      writeCache(fresh);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  async function loadFiltered() {
    loading = true;
    error = null;

    try {
      // pass the raw comma-delimited string to backend
      const fresh = await getCoachCrosstable(namesInput);
      data = fresh;
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  function clearFilter() {
    namesInput = "";
    loadDefault({ force: false });
  }

  onMount(() => loadDefault({ force: false }));
</script>

<div class="card">
  <div class="card-header header-row">
    <div>
      <div class="card-title">Coach Crosstable</div>
      <div class="muted">
        Default view is cached. Enter comma-delimited coach names to generate a filtered crosstable.
      </div>
    </div>

    <div class="actions">
      <input
        class="search"
        type="text"
        placeholder="e.g., Calvin Nisson, Tristan McGuire"
        bind:value={namesInput}
      />

      <button class="btn" on:click={loadFiltered} disabled={loading || !namesInput.trim()}>
        Generate
      </button>

      <button class="btn ghost" on:click={clearFilter} disabled={loading && !data}>
        Reset
      </button>

      <button class="btn ghost" on:click={() => loadDefault({ force: true })} disabled={loading}>
        Refresh Cache
      </button>
    </div>
  </div>

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if !data || !data.coaches?.length}
    <div class="muted">No data.</div>
  {:else if !displayCoaches.length}
    <div class="muted">No coaches with matches.</div>
  {:else}
    <div class="table-wrap">
      <table class="table sticky">
        <thead>
          <tr>
            <th class="corner">Coach</th>
            {#each displayCoaches as c (c.coach_id)}
              <th class="colhead">{c.coach_name}</th>
            {/each}
            <th class="colhead">Total</th>
          </tr>
        </thead>

        <tbody>
          {#each displayCoaches as r (r.coach_id)}
            <tr>
              <th class="rowhead">{r.coach_name}</th>

              {#each displayCoaches as c (c.coach_id)}
                {#if r.coach_id === c.coach_id}
                  <td class="diag">—</td>
                {:else}
                  <td class={cellClass(data.matrix?.[r.coach_id]?.[c.coach_id])}>
                    {cellLabel(data.matrix?.[r.coach_id]?.[c.coach_id])}
                  </td>
                {/if}
              {/each}

              <td class="total">{rowTotal(r.coach_id)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .header-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .search {
    width: 420px;
    max-width: 60vw;
    padding: 0.55rem 0.7rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
    outline: none;
  }

  .search::placeholder {
    color: rgba(255, 255, 255, 0.45);
  }

  .btn {
    padding: 0.55rem 0.75rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.9);
    font-weight: 700;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn.ghost {
    background: transparent;
  }

  .error {
    color: #ff6b6b;
    font-weight: 700;
  }

  .table-wrap {
    overflow: auto;
    max-height: 72vh;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .sticky thead th {
    position: sticky;
    top: 0;
    background: rgba(14, 16, 20, 0.92);
    backdrop-filter: blur(6px);
    z-index: 2;
  }

  th.corner {
    position: sticky;
    left: 0;
    z-index: 3;
    background: rgba(14, 16, 20, 0.96);
  }

  th.rowhead {
    position: sticky;
    left: 0;
    z-index: 1;
    background: rgba(14, 16, 20, 0.96);
    text-align: left;
    white-space: nowrap;
  }

  th.colhead {
    white-space: nowrap;
  }

  td,
  th {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* base cell styling */
  td.cell {
    text-align: center;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    border-radius: 10px;
  }

  td.diag {
    text-align: center;
    opacity: 0.6;
  }

  td.total {
    text-align: center;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* heatmap colors */
  td.cell-empty {
    background: transparent;
    color: rgba(255, 255, 255, 0.35);
  }

  td.cell-even {
    background: rgba(255, 255, 255, 0.10);
    color: rgba(255, 255, 255, 0.85);
  }

  td.cell-win {
    background: rgba(34, 197, 94, 0.22); /* light green */
    color: rgba(220, 252, 231, 0.95);
    border: 1px solid rgba(34, 197, 94, 0.22);
  }

  td.cell-win-strong {
    background: rgba(22, 101, 52, 0.70); /* deep green */
    color: rgba(236, 253, 245, 0.98);
    border: 1px solid rgba(34, 197, 94, 0.35);
  }

  td.cell-loss {
    background: rgba(239, 68, 68, 0.22); /* light red */
    color: rgba(254, 226, 226, 0.95);
    border: 1px solid rgba(239, 68, 68, 0.22);
  }

  td.cell-loss-strong {
    background: rgba(127, 29, 29, 0.72); /* deep red */
    color: rgba(255, 241, 242, 0.98);
    border: 1px solid rgba(239, 68, 68, 0.30);
  }
</style>
