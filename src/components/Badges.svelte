<script>
  export let badges = []; 

  const BASE = import.meta.env.BASE_URL;

  const badgeMeta = [
    {
        badge: "Grand Slam",
        img: "/images/Grand_Slam.png",
        desc: 
            "Goes to a player that has managed all of the following in one season:\n" +
            "- MPL Playoffs Champion\n" +
            "- Best Differential in an MPL Season\n" +
            "- Best Record in an MPL Season\n" +
            "- Coach of MPL Season MVP"
        },
    { 
        badge: "Triple Crown", 
        img: "/images/Triple_Crown.png", 
        desc: "Goes to a player that has managed to attain all of the following in one season: \n" +
              "- MPL Playoffs Champion\n" +
              "- Best Differential in an MPL Season\n" +
              "- Best Record in an MPL Season" },
    { 
        badge: "Legend", 
        img: "/images/Legend_Badge.png", 
        desc: "Goes to a player that has managed to become the MPL Playoffs Champion" },
    { 
        badge: "Rising", 
        img: "/images/Rising_Badge.png", 
        desc: "Goes to a player that has managed to become the MPL Playoffs Runner-Up or Higher" },
    { 
        badge: "Trio", 
        img: "/images/Trio_Badge.png", 
        desc: "Goes to a player that has managed to achieve MPL Playoffs 3rd Place or Higher" },
    { 
        badge: "Earth", 
        img: "/images/Earth_Badge.png", 
        desc: "Goes to a player that has managed to achieve the best differential in an MPL Season" },
    { 
        badge: "Rumble", 
        img: "/images/Rumble_Badge.png",
        desc: "Goes to a player that has managed to achieve the most KOs in an MPL Season" },
    { 
        badge: "Soul", 
        img: "/images/Soul_Badge.png",
        desc: "Goes to a player that has managed to achieve the least Faints in an MPL Season" },
    { 
        badge: "Quake", 
        img: "/images/Quake_Badge.png", 
        desc: "Goes to a player that has managed to coach the MVP of an MPL Season" },
    { 
        badge: "Beacon", 
        img: "/images/Beacon_Badge.png", 
        desc: "Goes to a player that has managed to achieve the best league record in an MPL Season" },
    { 
        badge: "Voltage", 
        img: "/images/Voltage_Badge.png", 
        desc: "Goes to a player that has managed to achieve the best conference record in an MPL Season" },
    { 
        badge: "Dynamo", 
        img: "/images/Dynamo_Badge.png", 
        desc: "Goes to a player that has managed to achieve the best division record in an MPL Season" }
  ];

  $: items = badgeMeta.map(meta => {
    const coaches = badges
      .filter(b => b.badge === meta.badge)
      .map(b => b.coach_name);

    return {
      badge: meta.badge,
      img: meta.img,
      desc: meta.desc,
      names: coaches.length ? coaches : [""]
    };
  });
</script>

<table class="image-name-table">
  <tbody>

    <!-- Row 1: Images with tooltip -->
    <tr>
      {#each items as item}
        <td class="image-cell tooltip-container">

          <img src={BASE + item.img} alt={item.badge} class="badge-img" />

          <!-- Tooltip -->
          <div class="tooltip">
            {item.desc}
          </div>

        </td>
      {/each}
    </tr>

    <!-- Row 2: Badge Titles -->
    <tr>
      {#each items as item}
        <td class="title-cell">
          <strong>{item.badge}</strong>
        </td>
      {/each}
    </tr>

    <!-- Row 3: Coach Names -->
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

<style>
  .image-name-table {
    border-collapse: collapse;
    margin: 1rem auto;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  td {
    padding: 6px 4px;
    text-align: center;
    vertical-align: top;
    border: 1px solid rgba(255, 255, 255, 0.1);
    position: relative;
  }

  .badge-img {
    width: 64px;
    height: 64px;
    object-fit: contain;
    cursor: pointer;
  }

  /* Tooltip wrapper */
  .tooltip-container {
    position: relative;
  }

  /* Tooltip box (hidden by default) */
    .tooltip {
        visibility: hidden;
        opacity: 0;
        position: absolute;
        bottom: auto;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(20, 20, 20, 0.95);
        color: #fff;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 0.75rem;
        border: 1px solid rgba(255,255,255,0.2);
        transition: opacity 0.2s;
        z-index: 10;
        min-width: 260px;
        max-width: 320px;

        white-space: pre-line;
    }

  /* Tooltip arrow */
  .tooltip::after {
    content: '';
    position: absolute;
    top: -5px; 
    left: 50%;
    transform: translateX(-50%);
    border-width: 5px;
    border-style: solid;
    border-color: transparent transparent rgba(20, 20, 20, 0.95) transparent;
  }

  /* Show on hover */
  .tooltip-container:hover .tooltip {
    visibility: visible;
    opacity: 1;
  }

  .title-cell {
    font-size: 0.9rem;
    font-weight: bold;
  }

  .name-cell {
    font-size: 0.85rem;
    line-height: 1.1;
  }

  .name-cell div + div {
    margin-top: 2px;
  }
</style>
