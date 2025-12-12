<script>
  export let src;
  export let count = 0;
  export let size = 28;
  export let overlap = 8;
  export let alt = "Medal";

  const BASE = import.meta.env.BASE_URL;
  $: safeCount = Math.max(0, Math.min(50, Number(count) || 0)); // cap just in case
  $: width = safeCount > 0 ? size + (safeCount - 1) * overlap : size;
</script>

<div class="stack" style="width:{width}px;height:{size}px;" aria-label={`${alt}: ${safeCount}`}>
  {#each Array(safeCount) as _, i}
    <img
      class="medal"
      src={BASE + src}
      alt={alt}
      style="width:{size}px;height:{size}px;left:{i * overlap}px;z-index:{i};"
      draggable="false"
    />
  {/each}
</div>

<style>
  .stack{
    position: relative;
    display: inline-block;
  }
  .medal{
    position: absolute;
    top: 0;
    image-rendering: pixelated;
    user-select: none;
    pointer-events: none;
  }
</style>
