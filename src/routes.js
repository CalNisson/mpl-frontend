import Home from "./pages/Home.svelte";
import Coaches from "./pages/Coaches.svelte";
import PokemonCareerStats from "./pages/PokemonCareerStats.svelte";
import CoachCrosstable from "./pages/CoachCrosstable.svelte";
import MVPs from "./pages/MVPs.svelte";
import Medals from "./pages/Medals.svelte";


export default {
  "/": Home,
  "/coaches": Coaches,
  "/pokemon": PokemonCareerStats,
  "/crosstable": CoachCrosstable,
  "/mvps": MVPs,
  "/medals": Medals
};
