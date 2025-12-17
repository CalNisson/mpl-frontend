<script>
  import { onMount } from "svelte";
  import { getCoaches } from "../../lib/api.js";
  import { leagueContext } from "../../lib/leagueStore.js";

  const BASE = import.meta.env.BASE_URL;

  $: leagueId = $leagueContext?.league?.id ?? null;
  $: leagueSlug = $leagueContext?.league?.slug ?? null;
  $: leagueTitle = $leagueContext?.league?.name ?? "Medal Table";

  let loading = false;
  let error = null;
  let rows = [];

  let tooltipVisible = false;
  let tooltipX = 0;
  let tooltipY = 0;

  let loadedForLeagueId = null;

  function showTip(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    tooltipX = rect.left + rect.width / 2;
    tooltipY = rect.top - 8;
    tooltipVisible = true;
  }

  function hideTip() {
    tooltipVisible = false;
  }

  function normalizeRows(input) {
    return (input ?? [])
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
      .filter((r) => (r.gold + r.silver + r.bronze) > 0)
      .sort((a, b) => {
        if (b.medal_score !== a.medal_score) return b.medal_score - a.medal_score;
        if (b.gold !== a.gold) return b.gold - a.gold;
        return (a.coach_name ?? "").localeCompare(b.coach_name ?? "");
      });
  }

  async function load() {
    if (!leagueId) {
      loading = false;
      error = null;
      rows = [];
      return;
    }

    loading = true;
    error = null;

    try {
      const raw = await getCoaches();
      rows = normalizeRows(raw);
    } catch (e) {
      error = e?.message ?? String(e);
      rows = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);

  $: if (leagueId && leagueId !== loadedForLeagueId) {
    loadedForLeagueId = leagueId;
    load();
  }

  function medalImg(type) {
    const slug = (leagueSlug || "major").toLowerCase();
    return BASE + `/images/${slug}_${type}.png`;
  }
</script>

<div class="card">
  <div class="card-header">
    <div class="card-title">{leagueTitle}</div>
    <div class="muted">Medals for the selected league.</div>
  </div>

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    {#if !rows.length}
      <div class="muted" style="margin-top:.75rem;">No medals yet.</div>
    {:else}
      <div class="table-wrap">
        <table class="table sticky">
          <thead>
            <tr>
              <th class="coach-col">Coach</th>
              <th class="medal-col">
                <img class="medal" src={medalImg("gold")} alt="Gold" />
              </th>
              <th class="medal-col">
                <img class="medal" src={medalImg("silver")} alt="Silver" />
              </th>
              <th class="medal-col">
                <img class="medal" src={medalImg("bronze")} alt="Bronze" />
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
            {#each rows as r (r.id)}
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
          <div class="score-tooltip" style="left: {tooltipX}px; top: {tooltipY}px;">
            Score = 5×Gold + 3×Silver + 1×Bronze
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .error { color: #ff6b6b; font-weight: 700; }

  .table{
    width: 100%;
    table-layout: auto;
    border-collapse: separate;
    border-spacing: 0;
  }

  .table-wrap{
    margin-top: 1rem;
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
    white-space: normal;
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

  .score{ font-weight: 900; }

  .medal-col{ width: 52px; }
  .medal{
    width: 28px;
    height: 28px;
    display: inline-block;
    vertical-align: middle;
    image-rendering: auto;
  }

  .score-header { cursor: help; white-space: nowrap; }

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
