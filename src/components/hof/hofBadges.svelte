<script>
  import { onMount } from "svelte";
  import { getBadges } from "../../lib/api.js";
  import { leagueContext } from "../../lib/leagueStore.js";

  const BASE = import.meta.env.BASE_URL;

  // ✅ league scope
  $: leagueId = $leagueContext?.league?.id ?? null;

  let loading = false; // ✅ don't start "true" or you can get stuck
  let error = null;
  let badges = [];

  let loadedForLeagueId = null;

  const badgeMeta = [
    { badge: "Grand Slam", img: "/images/Grand_Slam.png",
      desc: "Goes to a player that has managed all of the following in one season:\n- MPL Playoffs Champion\n- Best Differential in an MPL Season\n- Best Record in an MPL Season\n- Coach of MPL Season MVP"
    },
    { badge: "Triple Crown", img: "/images/Triple_Crown.png",
      desc: "Goes to a player that has managed to attain all of the following in one season: \n- MPL Playoffs Champion\n- Best Differential in an MPL Season\n- Best Record in an MPL Season"
    },
    { badge: "Legend", img: "/images/Legend_Badge.png", desc: "Goes to a player that has managed to become the MPL Playoffs Champion" },
    { badge: "Rising", img: "/images/Rising_Badge.png", desc: "Goes to a player that has managed to become the MPL Playoffs Runner-Up or Higher" },
    { badge: "Trio", img: "/images/Trio_Badge.png", desc: "Goes to a player that has managed to achieve MPL Playoffs 3rd Place or Higher" },
    { badge: "Earth", img: "/images/Earth_Badge.png", desc: "Goes to a player that has managed to achieve the best differential in an MPL Season" },
    { badge: "Rumble", img: "/images/Rumble_Badge.png", desc: "Goes to a player that has managed to achieve the most KOs in an MPL Season" },
    { badge: "Soul", img: "/images/Soul_Badge.png", desc: "Goes to a player that has managed to achieve the least Faints in an MPL Season" },
    { badge: "Quake", img: "/images/Quake_Badge.png", desc: "Goes to a player that has managed to coach the MVP of an MPL Season" },
    { badge: "Beacon", img: "/images/Beacon_Badge.png", desc: "Goes to a player that has managed to achieve the best league record in an MPL Season" },
    { badge: "Voltage", img: "/images/Voltage_Badge.png", desc: "Goes to a player that has managed to achieve the best conference record in an MPL Season" },
    { badge: "Dynamo", img: "/images/Dynamo_Badge.png", desc: "Goes to a player that has managed to achieve the best division record in an MPL Season" }
  ];

  async function load() {
    // ✅ if no league selected, don't spin forever
    if (!leagueId) {
      loading = false;
      error = null;
      badges = [];
      return;
    }

    loading = true;
    error = null;

    try {
      // ✅ pass league_id to API
      badges = (await getBadges(leagueId)) ?? [];
    } catch (e) {
      error = e?.message ?? String(e);
      badges = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // ✅ reload when league changes
  $: if (leagueId && leagueId !== loadedForLeagueId) {
    loadedForLeagueId = leagueId;
    load();
  }

  $: items = badgeMeta.map((meta) => {
    const rows = (badges ?? []).filter((b) => b?.badge === meta.badge);

    rows.sort((a, b) => {
      if (a.first_season_id !== b.first_season_id) return a.first_season_id - b.first_season_id;
      return (a.coach_name ?? "").localeCompare(b.coach_name ?? "");
    });

    const names = rows.map((r) => r.coach_name).filter(Boolean);
    return { ...meta, names: names.length ? names : [""] };
  });
</script>

<div class="card">
  <div class="card-header">
    <div>
      <div class="card-title">Badges</div>
      <div class="muted">All-time badge holders for the selected league.</div>
    </div>
  </div>

  {#if !leagueId}
    <div class="muted" style="margin-top:.75rem;">Select a league to view badges.</div>
  {:else if loading}
    <div class="muted" style="margin-top:.75rem;">Loading…</div>
  {:else if error}
    <div class="error" style="margin-top:.75rem;">{error}</div>
  {:else}
    <div class="badges-table-wrap">
      <table class="image-name-table">
        <tbody>
          <tr>
            {#each items as item}
              <td class="image-cell tooltip-container">
                <img src={BASE + item.img} alt={item.badge} class="badge-img" loading="lazy" />
                <div class="tooltip">{item.desc}</div>
              </td>
            {/each}
          </tr>
          <tr>
            {#each items as item}
              <td class="title-cell"><strong>{item.badge}</strong></td>
            {/each}
          </tr>
          <tr>
            {#each items as item}
              <td class="name-cell">
                {#each item.names as n}
                  <div>{n}</div>
                {/each}
              </td>
            {/each}
          </tr>
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .error { color: #ff6b6b; font-weight: 700; }
  .badges-table-wrap { width: 100%; overflow: visible; margin-top: 1rem; border-radius: 14px; border: 1px solid rgba(255,255,255,.08); }
  .image-name-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0; }
  td { padding: 6px 4px; text-align: center; vertical-align: top; border: 1px solid rgba(255, 255, 255, 0.1); position: relative; overflow-wrap: anywhere; }
  .badge-img { width: 64px; height: 64px; object-fit: contain; cursor: pointer; }
  .tooltip-container { position: relative; }
  .tooltip {
    visibility: hidden; opacity: 0; position: absolute; top: 100%; left: 50%;
    transform: translateX(-50%); background-color: rgba(20, 20, 20, 0.95); color: #fff;
    padding: 6px 8px; border-radius: 4px; font-size: 0.75rem; border: 1px solid rgba(255,255,255,0.2);
    transition: opacity 0.2s; z-index: 50; min-width: 260px; max-width: 320px; white-space: pre-line;
  }
  .tooltip-container:hover .tooltip { visibility: visible; opacity: 1; }
  .title-cell { font-size: 0.9rem; font-weight: bold; }
  .name-cell { font-size: 0.85rem; line-height: 1.1; }
  .name-cell div + div { margin-top: 2px; }
</style>
