<script>
  import { onMount } from "svelte";
  import { getCoaches } from "../lib/api.js";

  let loading = true;
  let error = null;

    const BASE = import.meta.env.BASE_URL;


  let major = [];
  let intermediate = [];
  let minor = [];

  let tooltipVisible = false;
let tooltipX = 0;
let tooltipY = 0;

function showTip(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  tooltipX = rect.left + rect.width / 2;
  tooltipY = rect.top - 8;
  tooltipVisible = true;
}

function hideTip() {
  tooltipVisible = false;
}

  function medalScore(row) {
    const g = Number(row?.medals?.gold ?? 0);
    const s = Number(row?.medals?.silver ?? 0);
    const b = Number(row?.medals?.bronze ?? 0);
    return 5 * g + 3 * s + b;
  }

    function normalizeRows(rows) {
    return (rows ?? [])
        .map((r) => {
        const gold = Number(r?.medals?.gold ?? 0);
        const silver = Number(r?.medals?.silver ?? 0);
        const bronze = Number(r?.medals?.bronze ?? 0);

        return {
            ...r,
            gold,
            silver,
            bronze,
            medal_score: 5 * gold + 3 * silver + bronze,
        };
        })
        // ✅ HARD FILTER: remove anyone with zero medals in this league
        .filter((r) => (r.gold + r.silver + r.bronze) > 0)
        // sorting is safe AFTER filtering
        .sort((a, b) => {
        if (b.medal_score !== a.medal_score) return b.medal_score - a.medal_score;
        if (b.gold !== a.gold) return b.gold - a.gold;
        return (a.coach_name ?? "").localeCompare(b.coach_name ?? "");
        });
    }

  async function load() {
    loading = true;
    error = null;

    try {
      const [a, b, c] = await Promise.all([
        getCoaches("major"),
        getCoaches("intermediate"),
        getCoaches("minor"),
      ]);

      major = normalizeRows(a);
      intermediate = normalizeRows(b);
      minor = normalizeRows(c);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function medalImg(league, type) {
    return BASE + `/images/${league}_${type}.png`;
  }
</script>

<div class="card">
  <div class="card-header">
    <div class="card-title">Medal Table</div>
  </div>

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <div class="grid">
      {#each [
        { title: "Major", league: "major", rows: major },
        { title: "Intermediate", league: "intermediate", rows: intermediate },
        { title: "Minor", league: "minor", rows: minor }
      ] as block (block.league)}
        <div class="panel">
          <h3 class="panel-title">{block.title}</h3>

          {#if !block.rows.length}
            <div class="muted">No medals yet.</div>
          {:else}
            <div class="table-wrap">
              <table class="table sticky">
                <thead>
                  <tr>
                    <th class="coach-col">Coach</th>
                    <th class="medal-col">
                      <img class="medal" src={medalImg(block.league, "gold")} alt="Gold" />
                    </th>
                    <th class="medal-col">
                      <img class="medal" src={medalImg(block.league, "silver")} alt="Silver" />
                    </th>
                    <th class="medal-col">
                      <img class="medal" src={medalImg(block.league, "bronze")} alt="Bronze" />
                    </th>
                    <th
                        class="score-header"
                        on:mouseenter={showTip}
                        on:mouseleave={hideTip}
                        >
                        Score
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {#each block.rows as r (r.id)}
                    <tr>
                      <td class="coach">{r.coach_name}</td>
                      <td class="num">{r.gold}</td>
                      <td class="num">{r.silver}</td>
                      <td class="num">{r.bronze}</td>
                      <td class="num score">{r.medal_score}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              {#if tooltipVisible}
                <div
                    class="score-tooltip"
                    style="left: {tooltipX}px; top: {tooltipY}px;"
                >
                    Score = 5×Gold + 3×Silver + 1×Bronze
                </div>
            {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .error { color: #ff6b6b; font-weight: 700; }

  .grid{
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 1rem;
    align-items: flex-start;
  }

  .panel{
    flex: 1 1 520px;
    min-width: 520px;
  }

  @media (max-width: 600px) {
    .panel{
      min-width: 0;
      flex-basis: 100%;
    }
  }

  .panel-title { margin: .25rem 0 .75rem; }

  .table{
    width: 100%;
    table-layout: auto;
    border-collapse: separate;
    border-spacing: 0;
  }

  .table-wrap{
    overflow-y: auto;
    overflow-x: hidden;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.08);
  }

  .sticky thead th{
    position: sticky;
    top: 0;
    background: rgba(14,16,20,.92);
    backdrop-filter: blur(6px);
    z-index: 2;
  }

  td, th{
    padding: .5rem .6rem;
    border-bottom: 1px solid rgba(255,255,255,.06);
    border-right: 1px solid rgba(255,255,255,.06);
    vertical-align: middle;
    text-align: center;
    white-space: normal;     /* wrap at spaces */
    word-break: normal;
    overflow-wrap: normal;
    hyphens: none;
  }

  .coach-col { text-align: left; }
  .coach { text-align: left; font-weight: 700; }

  .num{
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .score{
    font-weight: 900;
  }

  .medal-col{
    width: 52px;
  }

  .medal{
    width: 28px;
    height: 28px;
    display: inline-block;
    vertical-align: middle;
    /* if these are pixel-art medals you can switch to pixelated */
    image-rendering: auto;
  }

.score-header {
  cursor: help;
  white-space: nowrap;
}

.score-tooltip {
  position: fixed;
  z-index: 10000;
  transform: translate(-50%, -100%);

  background: rgba(14, 16, 20, 0.96);
  color: rgba(255, 255, 255, 0.95);
  padding: 0.45rem 0.65rem;
  border-radius: 10px;

  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;

  pointer-events: none;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35);
}



</style>
