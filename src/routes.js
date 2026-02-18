import Home from "./pages/Home.svelte";
import PokemonCareerStats from "./pages/PokemonCareerStats.svelte";
import CoachCrosstable from "./pages/CoachCrosstable.svelte";
import CoachProfile from "./pages/CoachProfile.svelte";
import LeagueSelect from "./pages/LeagueSelect.svelte";
import CreateOrg from "./pages/CreateOrg.svelte";
import CreateLeague from "./pages/CreateLeague.svelte";
import Login from "./routes/Login.svelte";
import Register from "./routes/Register.svelte";
import Leagues from "./routes/Leagues.svelte";
import HallOfFame from "./routes/HallOfFame.svelte";
import Admin from "./pages/Admin.svelte";
import InviteAccept from "./pages/InviteAccept.svelte";
import ForgotPassword from "./pages/ForgotPassword.svelte";
import ResetPassword from "./pages/ResetPassword.svelte";

export default {
  "/": Home,
  "/pokemon": PokemonCareerStats,
  "/crosstable": CoachCrosstable,
  "/coach": CoachProfile,
  "/league": LeagueSelect,
  "/orgs/new": CreateOrg,
  "/leagues/new": CreateLeague,
  "/login": Login,
  "/forgot-password": ForgotPassword,
  "/reset-password": ResetPassword,
  "/invite": InviteAccept,
  "/register": Register,
  "/leagues": Leagues,
  "/hall-of-fame": HallOfFame,
  "/admin": Admin,
};
