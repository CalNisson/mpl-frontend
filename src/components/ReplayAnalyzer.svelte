<script>
  import { createEventDispatcher } from "svelte";
  import { Generations, toID } from "@pkmn/data";
  import { Dex } from "@pkmn/dex";

  const dispatch = createEventDispatcher();

  // -----------------------------
  // Component state
  // -----------------------------
  let replayUrl = "";
  let loading = false;

  let statusText = "";
  let statusKind = "muted"; // "muted" | "ok" | "err"

  let resultsVisible = false;

  let gametype = "—";
  let gen = "—";
  let turns = "—";
  let gameTime = "—";
  let logOut = "";

  let p1Label = "Player 1";
  let p2Label = "Player 2";

  // team cards
  let teamA = null;
  let teamB = null;

  // pokemon tables
  let monRowsP1 = [];
  let monRowsP2 = [];

  // chart
  let chartSvg = "";

  // Optional: if you embed this component in an iframe and want postMessage parity with your HTML
  export let postMessageToParent = false;

  // -----------------------------
  // Analyzer logic (ported 1:1 from your file)
  // -----------------------------
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) =>
    key in obj
      ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value })
      : (obj[key] = value);
  var __publicField = (obj, key, value) =>
    __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  var Replay;
  ((Replay2) => {
    const critChances = [0, 0.041667, 0.125, 0.5, 1, 1];
    const gens = new Generations(Dex);

    class Analysis {
      constructor(log) {
        __publicField(this, "field");
        __publicField(this, "playerData");
        __publicField(this, "lastMove");
        __publicField(this, "tempMons", {});
        __publicField(this, "events", []);
        __publicField(this, "killStrings", []);
        __publicField(this, "gametype");
        __publicField(this, "genNum", 9);
        __publicField(this, "gameTime");
        __publicField(this, "preview", 6);
        __publicField(this, "t0");
        __publicField(this, "tf");
        __publicField(this, "matchData", { pre: [] });

        const replayLines = log.split("\n|").reduce((lines, log2) => {
          const line = new Line(log2);
          if (line.isChild()) lines[lines.length - 1].addChildLine(line);
          else lines.push(line);
          return lines;
        }, []);

        this.playerData = [];
        this.field = new Field();
        this.t0 = 0;
        this.tf = 0;

        replayLines.forEach((line) => {
          switch (line.data[0]) {
            case "start":
              this.matchData.turns = [];
              this.matchData.turns.push(new Turn(0));
              return;
            case "turn":
              this.matchData.turns?.push(new Turn(+line.data[1]));
              return;
          }
          if (this.matchData.turns) this.matchData.turns[this.matchData.turns.length - 1].addLine(line);
          else this.matchData.pre.push(line);
        });

        this.matchData.pre.forEach((line) => {
          this.executeLine(line);
        });

        this.matchData.turns?.forEach((turn) => {
          this.updateChart(turn.number);
          turn.lines.forEach((line) => {
            this.executeLine(line);
          });
        });

        this.gameTime = this.tf - this.t0;
      }

      executeLine(line) {
        switch (line.data[0]) {
          case "":
            break;

          case "-damage": {
            let damageTarget = this.getMonByString(line.data[1]);
            if (damageTarget) {
              this.damage(damageTarget, this.getHPP(line.data[2]), line.data.slice(3), line);
            }
            break;
          }

          case "t:":
            if (this.t0) this.tf = +line.data[1];
            else this.t0 = +line.data[1];
            break;

          case "move": {
            let moveAttacker = this.getMonByString(line.data[1]);
            if (moveAttacker) {
              let move = [...moveAttacker.moveset].find((move2) => move2.name === line.data[2]);
              if (!move) {
                move = gens.dex.moves.get(line.data[2]);
                moveAttacker.moveset.add(move);
              }
              if (move.exists === true) {
                this.lastMove = { data: line.data, move };
                if (move.target && move.target !== "self") {
                  moveAttacker.player.luck.moves.expected += move.accuracy === true ? 1 : move.accuracy / 100;
                  moveAttacker.player.luck.moves.total++;
                  moveAttacker.player.luck.moves.hits++;
                  if (move.critRatio && (move.category === "Physical" || move.category === "Special")) {
                    let critChance = move.critRatio;
                    moveAttacker.player.luck.crits.expected += critChance > 6 ? 1 : critChances[critChance];
                    moveAttacker.player.luck.crits.total++;
                  }
                }
                if (moveAttacker.status.status === "par") {
                  moveAttacker.player.luck.status.total++;
                  moveAttacker.player.luck.status.expected += 0.25;
                }
              }
            }
            break;
          }

          case "win": {
            this.upkeep(line.turn);
            this.updateChart(line.turn);
            let winPlayer = this.playerData.findIndex((player) => player.username == line.data[1]);
            if (winPlayer >= 0) {
              this.playerData[winPlayer].win = true;
              this.events.push({
                turn: line.turn?.number ?? 0,
                player: winPlayer + 1,
                message: `${line.data[1]} wins.`,
              });
            }
            break;
          }

          case "upkeep":
            this.upkeep(line.turn);
            break;

          case "-anim":
            break;

          case "replace": {
            let replaceMon = this.getMonByString(line.data[1]);
            if (!replaceMon) break;

            let illusionPlayer = +line.data[1].charAt(1) - 1;
            let illusionMon = this.playerData[illusionPlayer].team.find((pokemon) => {
              if (!pokemon.brought) {
                return new RegExp(String.raw`^${pokemon.formes[0].detail.replace("-*", ".*")}`).test(line.data[2]);
              } else {
                let detailSet = new Set(line.data[2].split(", "));
                return pokemon.formes.some((forme) => forme.detail.split(", ").every((e) => detailSet.has(e)));
              }
            });

            let tempReplaceMon = this.tempMons[line.data[1].substring(0, 3)];

            if (!illusionMon) {
              illusionMon = {
                formes: [
                  {
                    detail: line.data[2],
                    id: gens.dex.species.get(line.data[2].split(",")[0])?.id,
                  },
                ],
                nickname: line.data[1].split(" ")[1],
                hpp: 100,
                moveset: /* @__PURE__ */ new Set(),
                hpRestored: 0,
                lastDamage: void 0,
                damageDealt: [0, 0],
                calcLog: { damageTaken: [], damageDealt: [] },
                damageTaken: [0, 0],
                kills: [0, 0],
                player: this.playerData[illusionPlayer],
                status: { status: "healthy" },
                statuses: [],
                fainted: false,
                brought: true,
              };
            }

            illusionMon.brought = replaceMon.brought;
            illusionMon.hpp = replaceMon.hpp;
            illusionMon.moveset = /* @__PURE__ */ new Set([...illusionMon.moveset, ...replaceMon.moveset]);
            illusionMon.hpRestored += replaceMon.hpRestored - tempReplaceMon.hpRestored;
            illusionMon.damageDealt = [
              replaceMon.damageDealt[0] - tempReplaceMon.damageDealt[0],
              replaceMon.damageDealt[1] - tempReplaceMon.damageDealt[1],
            ];
            illusionMon.lastDamage = replaceMon.lastDamage;
            illusionMon.damageTaken = [
              replaceMon.damageTaken[0] - tempReplaceMon.damageTaken[0],
              replaceMon.damageTaken[1] - tempReplaceMon.damageTaken[1],
            ];
            illusionMon.status = replaceMon.status;
            illusionMon.statuses = replaceMon.statuses.filter(
              (status) => !tempReplaceMon.statuses.find((s) => s.name === status.name)
            );
            illusionMon.kills = [
              replaceMon.kills[0] - tempReplaceMon.kills[0],
              replaceMon.kills[1] - tempReplaceMon.kills[1],
            ];
            illusionMon.fainted = replaceMon.fainted;

            this.killStrings.forEach((ks) => {
              if (ks.attacker === replaceMon) ks.attacker = illusionMon;
              if (ks.target === replaceMon) ks.target = illusionMon;
            });

            this.field.sides[illusionPlayer][line.data[1].charAt(2)].pokemon = illusionMon;
            replaceMon = tempReplaceMon;
            break;
          }

          case "switch":
            this.playerData[+line.data[1].charAt(1) - 1].stats.switches++;
          // fallthrough
          case "drag": {
            const switchPlayer = +line.data[1].charAt(1) - 1;
            const switchedMon = this.playerData[switchPlayer].team.find((pokemon) => {
              if (!pokemon.brought) {
                return new RegExp(String.raw`^${pokemon.formes[0].detail.replace("-*", ".*")}`).test(line.data[2]);
              } else {
                let detailSet = new Set(line.data[2].split(", "));
                return pokemon.formes.some((forme) => forme.detail.split(", ").every((e) => detailSet.has(e)));
              }
            });

            if (switchedMon) {
              if (!switchedMon.brought) {
                switchedMon.brought = true;
                switchedMon.formes[0] = {
                  detail: line.data[2],
                  id: gens.dex.species.get(line.data[2].split(",")[0])?.id,
                };
                switchedMon.nickname = line.data[1].split(" ")[1];
              }
            } else {
              this.playerData[switchPlayer].team.push(
                new Pokemon(line.data[2], this.playerData[switchPlayer], line.data[1], { brought: true })
              );
            }

            const switchInMon = this.playerData[switchPlayer].team.find((pokemon) =>
              pokemon.formes.some((forme) => line.data[2].startsWith(forme.detail))
            );

            this.field.sides[switchPlayer][line.data[1].charAt(2)].pokemon = switchInMon;
            if (switchInMon) this.tempMons[line.data[1].substring(0, 3)] = structuredClone(switchInMon);
            break;
          }

          case "c:":
          case "c":
          case "debug":
          case "inactive":
          case "-boost":
          case "-resisted":
            break;

          case "poke": {
            const pokePlayer = this.playerData[this.getPlayer(line.data[1])];
            pokePlayer.team.push(new Pokemon(line.data[2], pokePlayer));
            break;
          }

          case "-heal": {
            let healPosition = this.getMonByString(line.data[1]);
            if (healPosition) {
              let newHp = this.getHPP(line.data[2]);
              this.heal(healPosition, newHp, line.data[3]);
            }
            break;
          }

          case "rule":
            break;

          case "faint": {
            let faintMon = this.getMonByString(line.data[1]);
            if (faintMon) {
              faintMon.fainted = true;
              let killString = { target: faintMon };

              if (faintMon.lastDamage) {
                let destinyBondMonList = this.field.sides
                  .map((side) =>
                    [side.a.pokemon, side.b.pokemon, side.c.pokemon].find(
                      (pokemon) => pokemon && this.searchStatuses(pokemon, "move: Destiny Bond")
                    )
                  )
                  .filter((pokemon) => pokemon);

                if (destinyBondMonList.filter((mon) => mon !== faintMon).length > 0) {
                  let destinyBondMon = destinyBondMonList.find(
                    (pokemon) => pokemon?.fainted && pokemon.lastDamage?.damager === faintMon
                  );
                  if (destinyBondMon) {
                    destinyBondMon.kills[1]++;
                    killString.reason = "Destiny Bond";
                    killString.indirect = true;
                    killString.attacker = destinyBondMon;
                  }
                } else {
                  if (faintMon.lastDamage.type === "direct") {
                    if (this.lastMove) {
                      if (this.lastMove.data === faintMon.lastDamage.line.parent?.data) {
                        let faintAttacker = this.getMonByString(this.lastMove.data[1]);
                        killString.reason = this.lastMove.data[2];
                        if (faintAttacker) {
                          let faintOwnKill = this.checkOwnKill(faintAttacker, faintMon);
                          killString.attacker = faintAttacker;
                          // NOTE: leaving this exact assignment for parity with your file.
                          if ((faintOwnKill === "opp")) {
                            faintAttacker.kills[0]++;
                          }
                        } else {
                          console.log("ks error", line.data);
                        }
                      } else if (faintMon.lastDamage.status) {
                        killString.reason = faintMon.lastDamage.status.status.replace("move: ", "");
                        killString.indirect = true;
                        if (faintMon.lastDamage.status.setter) {
                          faintMon.lastDamage.status.setter.kills[0]++;
                        }
                      } else {
                      }
                    }
                  } else if (faintMon.lastDamage.type === "indirect") {
                    killString.indirect = true;
                    if (faintMon.lastDamage.damager) {
                      let faintFromOwnKill = this.checkOwnKill(faintMon.lastDamage.damager, faintMon);
                      killString.attacker = faintMon.lastDamage.damager;
                      killString.reason = faintMon.lastDamage.from;
                      if (faintFromOwnKill === "opp") {
                        faintMon.lastDamage.damager.kills[1]++;
                      }
                    }
                  }
                }
              } else {
                if (this.lastMove) {
                  let faintMove = gens.dex.moves.get(this.lastMove.data[2]);
                  if ("selfdestruct" in faintMove) {
                    killString.attacker = faintMon;
                    killString.reason = faintMove.name;
                  }
                }
              }

              this.killStrings.push(killString);
            }
            break;
          }

          case "j":
          case "-ability":
          case "-unboost":
          case "-immune":
          case "-supereffective":
            break;

          case "player":
            if (line.data[2] && !this.playerData.find((player) => player.username === line.data[2])) {
              const side = new Side();
              this.playerData.push(new Player(side, line.data[2]));
              this.field.sides.push(side);
            }
            break;

          case "teamsize":
            this.playerData[this.getPlayer(line.data[1])].teamSize = +line.data[2];
            break;

          case "-formechange":
          case "detailschange": {
            let detailMon = this.getMonByString(line.data[1]);
            if (detailMon) {
              detailMon.formes.push({
                detail: line.data[2],
                id: gens.dex.species.get(line.data[2].split(",")[0])?.id,
              });
            }
            break;
          }

          case "-activate": {
            let activateMon = this.getMonByString(line.data[1]);
            if (activateMon) {
              let activateSetter = void 0;
              if (line.data[3] && line.data[3].startsWith("[of] ")) {
                activateSetter = this.getMonByString(this.ofP2P(line.data[3]));
              }
              activateMon.statuses.push({
                status: line.data[2],
                setter: activateSetter,
                name: line.data[2].split(": ").at(-1),
              });
            }
            break;
          }

          case "-status": {
            let statusPosition = this.getMonByString(line.data[1]);
            if (statusPosition) {
              let statusStart = { status: line.data[2] };
              switch (line.data[2]) {
                case "tox":
                  statusStart = { status: "psn", name: "Toxic" };
                  break;
                case "psn":
                  statusStart = { status: "psn", name: "Poison" };
                  break;
                case "brn":
                  statusStart = { status: "brn", name: "Burn" };
                  break;
                case "par":
                  statusStart = { status: "par", name: "Paralysis" };
                  break;
                case "frz":
                  statusStart = { status: "frz", name: "Freeze" };
                  break;
              }

              if (line.data[3]) {
                if (line.data[3].startsWith("[from] item: ")) {
                  statusStart.setter = statusPosition;
                } else if (this.lastMove && this.lastMove.data[3] === line.data[1]) {
                  statusStart.setter = this.getMonByString(this.lastMove.data[1]);
                } else if (line.data[4] && line.data[4].startsWith("[of] ")) {
                  statusStart.setter = this.getMonByString(this.ofP2P(line.data[4]));
                }
              } else if (line.parent) {
                if (
                  (line.parent.data[0] === "switch" ||
                    line.parent.data[0] === "drag" ||
                    line.parent.data[0] === "replace") &&
                  statusStart.status === "psn"
                ) {
                  statusStart.setter = this.field.sides[+line.data[1].charAt(1) - 1].statuses.find(
                    (status) => status.status === "move: Toxic Spikes" || status.status === "Toxic Spikes"
                  )?.setter;
                } else if (line.parent.data[0] === "move") {
                  let statusOnProtect = line.parent.children.find(
                    (child) => child.data[0] === "-activate" && child.data[2] === "move: Protect"
                  );
                  if (statusOnProtect && statusOnProtect.data[0] === "-activate") {
                    statusStart.setter = this.getMonByString(statusOnProtect.data[1]);
                  } else {
                    statusStart.setter = this.getMonByString(line.parent.data[1]);
                  }
                }
              }

              statusPosition.status = statusStart;
            }
            break;
          }

          case "-weather":
            if (line.data[1] !== this.field.weather.status) {
              let weatherStatus = { status: line.data[1] };
              if (line.data.length > 3 && line.data[3].startsWith("[of] ")) {
                let weatherPosition = this.getMonByString(this.ofP2P(line.data[3]));
                weatherStatus.setter = weatherPosition;
              } else {
                if (this.lastMove) {
                  let weatherPosition = this.getMonByString(this.lastMove.data[1]);
                  weatherStatus.setter = weatherPosition;
                }
              }
              this.field.weather = weatherStatus;
            }
            break;

          case "-crit":
            if (line.parent?.data[0] === "move") {
              let critAttacker = this.getMonByString(line.parent.data[1]);
              if (critAttacker) {
                critAttacker.player.luck.crits.hits++;
              }
            }
            break;

          case "-miss": {
            let missAttacker = this.getMonByString(line.data[1]);
            if (missAttacker) {
              if (line.data[1]) {
                missAttacker.player.luck.moves.hits--;
              }
            }
            break;
          }

          case "cant": {
            let cantMon = this.getMonByString(line.data[1]);
            if (cantMon) {
              if (line.data[2] === "par") {
                cantMon.player.luck.status.full++;
                cantMon.player.luck.status.total++;
                cantMon.player.luck.status.expected += 0.25;
              }
            }
            break;
          }

          case "l":
            break;

          case "raw":
          case "html":
          case "uhtml":
            break;

          case "-item":
          case "-enditem":
            break;

          case "gametype":
            this.gametype = line.data[1];
            break;

          case "gen":
            this.genNum = +line.data[1];
            break;

          case "tier":
          case "clearpoke":
            break;

          case "teampreview":
            if (line.data[1]) this.preview = +line.data[1];
            break;

          case "-singlemove": {
            let singleMoveMon = this.getMonByString(line.data[1]);
            if (singleMoveMon) {
              singleMoveMon.statuses.push({
                status: `move: ${line.data[2]}`,
                setter: singleMoveMon,
                name: line.data[2],
              });
            }
            break;
          }

          case "-singleturn":
          case "-transform":
          case "-block":
          case "-burst":
          case "-center":
          case "-clearallboost":
          case "-clearboost":
          case "-clearnegativeboost":
          case "-clearpositiveboost":
          case "-combine":
          case "-swapsideconditions":
          case "error":
          case "tie":
          case "-copyboost":
            break;

          case "-curestatus": {
            let curePosition = this.getMonByString(line.data[1]);
            if (curePosition) curePosition.status = { status: "healthy" };
            break;
          }

          case "-cureteam":
          case "-endability":
          case "-fail":
            break;

          case "-hitcount":
            if (this.lastMove) {
              let hitAttacker = this.getMonByString(this.lastMove.data[1]);
              if (hitAttacker) {
                let hitMove = gens.dex.moves.get(this.lastMove.data[2]);
                if (hitMove.exists === true) {
                  if (hitMove.target && hitMove.target !== "self") {
                    let hitCount = +line.data[2];
                    for (let h = 1; h < hitCount; h++) {
                      hitAttacker.player.luck.moves.expected += hitMove.accuracy === true ? 1 : hitMove.accuracy / 100;
                      hitAttacker.player.luck.moves.total++;
                      hitAttacker.player.luck.moves.hits++;
                      if (hitMove.critRatio && (hitMove.category === "Physical" || hitMove.category === "Special")) {
                        let critChance = hitMove.critRatio;
                        hitAttacker.player.luck.crits.expected += critChance > 6 ? 1 : critChances[critChance];
                        hitAttacker.player.luck.crits.total++;
                      }
                    }
                  }
                }
              }
            }
            break;

          case "-invertboost":
          case "-mustrecharge":
          case "-notarget":
          case "-prepare":
          case "-primal":
          case "-setboost":
            break;

          case "-sethp": {
            let hpTarget = this.getMonByString(line.data[1]);
            if (hpTarget) {
              let newHpp = this.getHPP(line.data[2]);
              let hpDiff = hpTarget.hpp - newHpp;
              if (hpDiff > 0) {
                this.damage(hpTarget, newHpp, line.data.slice(3), line);
              } else if (hpDiff < 0) {
                this.heal(hpTarget, newHpp, line.data[3]);
              }
            }
            break;
          }

          case "-swapboost":
          case "-waiting":
          case "-zbroken":
          case "-zpower":
          case "inactiveoff":
          case "request":
            break;

          case "swap": {
            let swapSide = this.field.sides[+line.data[1].charAt(1) - 1];
            [swapSide[line.data[1].charAt(2)], swapSide[["a", "b", "c"][+line.data[2]]]] = [
              swapSide[["a", "b", "c"][+line.data[2]]],
              swapSide[line.data[1].charAt(2)],
            ];
            break;
          }

          case "-mega":
            break;

          case "-terastallize": {
            let teraMon = this.getMonByString(line.data[1]);
            if (teraMon) {
              teraMon.formes.map((forme) => ({
                detail: `${forme.detail}, tera:${line.data[2]}`,
                base: forme.id,
              }));
            }
            break;
          }

          case "-fieldactivate":
            break;

          case "-hint":
          case "message":
            break;

          case "-message":
            this.events.push({
              player: 0,
              turn: line.turn?.number ?? 0,
              message: `${line.data[1]}`,
            });
            break;

          case "-end": {
            let endMon = this.getMonByString(line.data[1]);
            if (endMon) {
              let endStatus = endMon.statuses.find(
                (status) =>
                  status.status === line.data[2] ||
                  status.status.startsWith(line.data[2].toLowerCase().replace(" ", ""))
              );
              if (endStatus) endStatus.ended = true;
            }
            break;
          }

          case "-sidestart":
            if (line.parent?.data[0] == "move") {
              let sideMon = this.getMonByString(line.parent.data[1]);
              if (sideMon) {
                let sideStartStatus = line.data[2].split(": ");
                this.field.sides[+line.data[1].charAt(1) - 1].statuses.push({
                  status: sideStartStatus.length === 2 ? sideStartStatus[1] : sideStartStatus[0],
                  setter: sideMon,
                });
              }
            }
            break;

          case "-sideend":
            this.field.sides[+line.data[1].charAt(1) - 1].statuses.splice(
              this.field.sides[+line.data[1].charAt(1) - 1].statuses.findIndex((s) => s.status === line.data[2]),
              1
            );
            break;

          case "-start": {
            let startMon = this.getMonByString(line.data[1]);
            if (startMon) {
              if (line.parent) {
                let startMonTarget = void 0;
                if (line.parent.data[0] === "move") {
                  startMonTarget = this.getMonByString(line.parent.data[3]);
                } else {
                  startMonTarget = startMon;
                }
                if (startMonTarget) {
                  startMonTarget.statuses.push({
                    status: line.data[2],
                    setter: startMon,
                  });
                }
              }
            }
            break;
          }

          case "-fieldstart": {
            let fieldStartStatus = { status: line.data[1] };
            if (line.data[3] && line.data[3].startsWith("[of] ")) {
              let fieldStartSetter = this.getMonByString(this.ofP2P(line.data[3]));
              if (fieldStartSetter) fieldStartStatus.setter = fieldStartSetter;
            }
            this.field.statuses.push(fieldStartStatus);
            break;
          }

          case "-fieldend":
            this.field.statuses.splice(
              this.field.statuses.findIndex((status) => status.status === line.data[1]),
              1
            );
            break;

          case "n":
          case "rated":
            break;

          default:
            console.log(line.data);
        }

        line.children.forEach((child) => {
          this.executeLine(child);
        });
      }

      toJson() {
        let stats = [];
        this.playerData.forEach((player) => {
          let playerStat = {
            username: player.username,
            win: player.win,
            stats: player.stats,
            total: {
              kills: player.team.reduce((sum, pokemon) => sum + pokemon.kills[0] + pokemon.kills[1], 0),
              deaths: player.team.reduce((sum, pokemon) => sum + (pokemon.fainted ? 1 : 0), 0),
              damageDealt: player.team.reduce((sum, pokemon) => sum + pokemon.damageDealt[0] + pokemon.damageDealt[1], 0),
              damageTaken: player.team.reduce((sum, pokemon) => sum + pokemon.damageTaken[0] + pokemon.damageTaken[1], 0),
            },
            turnChart: player.turnChart,
            luck: {
              moves: { total: player.luck.moves.total, hits: player.luck.moves.hits, expected: player.luck.moves.expected, actual: 0 },
              crits: { total: player.luck.crits.total, hits: player.luck.crits.hits, expected: player.luck.crits.expected, actual: 0 },
              status: { total: player.luck.status.total, full: player.luck.status.full, expected: player.luck.status.expected, actual: 0 },
            },
            team: [],
          };

          player.team.forEach((pokemon) => {
            playerStat.team.push({
              kills: pokemon.kills,
              brought: pokemon.brought || this.preview >= player.team.length,
              fainted: pokemon.fainted,
              moveset: [...pokemon.moveset].map((move) => move.name),
              damageDealt: pokemon.damageDealt,
              damageTaken: pokemon.damageTaken,
              calcLog: {
                damageDealt: pokemon.calcLog.damageDealt.map((log) => ({
                  target: log.target.formes[0].detail,
                  hpDiff: log.hpDiff,
                  move: log.move.name,
                })),
                damageTaken: pokemon.calcLog.damageTaken.map((log) => ({
                  attacker: log.attacker.formes[0].detail,
                  hpDiff: log.hpDiff,
                  move: log.move.name,
                })),
              },
              hpRestored: pokemon.hpRestored,
              formes: pokemon.formes,
            });
          });

          playerStat.luck.moves.expected /= playerStat.luck.moves.total;
          playerStat.luck.moves.actual = playerStat.luck.moves.hits / playerStat.luck.moves.total;

          playerStat.luck.crits.expected /= playerStat.luck.crits.total;
          playerStat.luck.crits.actual = playerStat.luck.crits.hits / playerStat.luck.crits.total;

          playerStat.luck.status.expected /= playerStat.luck.status.total;
          playerStat.luck.status.actual = playerStat.luck.status.full / playerStat.luck.status.total;

          stats.push(playerStat);
        });

        return {
          gametype: this.gametype ? this.gametype.charAt(0).toUpperCase() + this.gametype.slice(1) : "",
          genNum: this.genNum,
          turns: (this.matchData.turns?.length ?? 0) - 1,
          gameTime: this.gameTime,
          stats,
          events: this.events,
        };
      }

      getPlayer(position) {
        return +position.charAt(1) - 1;
      }

      getMonByString(pos) {
        if (pos === void 0) return;
        if (pos.charAt(2) === "a" || pos.charAt(2) === "b" || pos.charAt(2) === "c") {
          return this.field.sides[+pos.charAt(1) - 1][pos.charAt(2)].pokemon;
        } else {
          return this.playerData[+pos.charAt(1) - 1].team.find((pokemon) => pokemon.nickname === pos.substring(4));
        }
      }

      updateChart(turnNumber) {
        this.playerData.forEach((player) =>
          player.turnChart.push({
            turn: turnNumber,
            damage: player.team.reduce((sum, pokemon) => (sum += 100 - pokemon.hpp), 0),
            remaining: player.team.reduce((sum, pokemon) => (sum += pokemon.fainted ? 0 : 1), 0),
          })
        );
      }

      searchStatuses(pokemon, status) {
        if (status === "Recoil") return { status, setter: pokemon, name: "Recoil" };
        if (pokemon.status.status === status) return pokemon.status;
        if (pokemon.lastDamage && pokemon.lastDamage.line.data[1]) {
          let monStatus = pokemon.statuses.find((s) => s.status === status);
          if (monStatus) return monStatus;
        }
        let sideStatus = pokemon.player.side.statuses.find((s) => s.status === status);
        if (sideStatus) return sideStatus;
        if (this.field.weather.status === status) return this.field.weather;
        if (pokemon.lastDamage && pokemon.lastDamage.line.data[1]) {
          let sideStatus2 = this.field.sides[+pokemon.lastDamage.line.data[1].charAt(1) - 1].statuses.find(
            (s) => s.status.split(": ")[1] === status
          );
          if (sideStatus2) return sideStatus2;
        }
        return;
      }

      cleanStatuses() {
        this.field.statuses = this.field.statuses.filter((status) => !status.ended);
        this.field.sides.forEach((side) => {
          side.statuses = side.statuses.filter((status) => !status.ended);
          side.a.statuses = side.a.statuses.filter((status) => !status.ended);
          side.b.statuses = side.b.statuses.filter((status) => !status.ended);
          side.c.statuses = side.c.statuses.filter((status) => !status.ended);
        });
        this.playerData.forEach((player) =>
          player.team.forEach((pokemon) => {
            pokemon.status = pokemon.status.ended ? { status: "healthy" } : pokemon.status;
            pokemon.statuses = pokemon.statuses.filter((status) => !status.ended);
          })
        );
        return;
      }

      checkOwnKill(attacker, fainter) {
        if (attacker === fainter) return "self";
        return this.playerData.find((player) => attacker && player.team.includes(attacker)) ===
          this.playerData.find((player) => fainter && player.team.includes(fainter))
          ? "ff"
          : "opp";
      }

      getHPP(hpString) {
        let hp = hpString.split(" ")[0].split("/");
        let hpp = +hp[0] > 0 ? +hp[0] / (+hp[1] / 100) : 0;
        return hpp;
      }

      heal(healed, newHp, action) {
        let hpDiff = newHp - healed.hpp;
        healed.hpp = newHp;
        healed.fainted = false;
        healed.hpRestored += hpDiff;
      }

      damage(target, newHpp, actions, line) {
        let hppDiff = target.hpp - newHpp;
        target.hpp = newHpp;

        let lastDamage = { line, type: "indirect" };
        let from = void 0;
        let of = void 0;

        for (let action of actions || []) {
          if (action.startsWith("[from] ")) from = this.fromE2S(action);
          else if (action.startsWith("[of] ")) of = this.ofP2P(action);
        }

        if (from && from !== toID(lastDamage.line.parent?.data[2])) {
          if (of) {
            let ofMon = this.getMonByString(of);
            if (ofMon) {
              ofMon.damageDealt[1] += hppDiff;
              lastDamage.damager = ofMon;
            }
          } else if (from.startsWith("item: ")) {
            lastDamage.from = from.replace("item: ", "");
            lastDamage.damager = target;
          } else if (from.startsWith("ability: ")) {
          } else {
            let damageIndirect = this.searchStatuses(target, from);
            if (damageIndirect) {
              lastDamage.status = damageIndirect;
              lastDamage.from = damageIndirect.name;
              if (damageIndirect.setter) {
                if (target != damageIndirect.setter) {
                  damageIndirect.setter.damageDealt[1] += hppDiff;
                }
                lastDamage.damager = damageIndirect.setter;
              }
            }
          }
          target.damageTaken[1] += hppDiff;
        } else {
          lastDamage.type = "direct";
          if (this.lastMove && lastDamage.line.parent?.data === this.lastMove.data) {
            target.damageTaken[0] += hppDiff;
            let moveDamageAttacker = this.getMonByString(this.lastMove.data[1]);
            if (moveDamageAttacker && moveDamageAttacker != target) {
              lastDamage.damager = moveDamageAttacker;
              moveDamageAttacker.damageDealt[0] += hppDiff;

              target.calcLog.damageTaken.push({
                attacker: moveDamageAttacker,
                move: this.lastMove.move,
                hpDiff: hppDiff,
              });
              moveDamageAttacker.calcLog.damageDealt.push({
                target,
                move: this.lastMove.move,
                hpDiff: hppDiff,
              });
            }
          } else {
            target.damageTaken[1] += hppDiff;
            let endSub = lastDamage.line.parent?.children.find((child) => child.data[0] === "-end");
            if (endSub) {
              let endMon = this.getMonByString(endSub.data[1]);
              if (endMon) {
                let endStatus = endMon.statuses.find((status) => status.status === endSub.data[2]);
                if (endStatus) {
                  lastDamage.status = endStatus;
                  if (endStatus.setter) {
                    lastDamage.damager = endStatus.setter;
                    endStatus.setter.damageDealt[0] += hppDiff;
                  }
                }
              }
            }
          }
        }

        target.lastDamage = lastDamage;
      }

      ofP2P(ofPokemon) {
        if (ofPokemon.startsWith("[of] ")) return ofPokemon.substring(5);
        return void 0;
      }

      fromE2S(fromEffect) {
        return fromEffect.substring(7);
      }

      makeKillString(ks) {
        let s = `${ks.target.player.username}'s ${
          ks.target.formes[ks.target.formes.length - 1].detail.split(",")[0]
        } fainted`;
        if (ks.attacker) {
          if (ks.attacker === ks.target) {
            s += ` itself`;
            if (ks.reason) s += ` from ${ks.reason}`;
          } else {
            if (ks.indirect) s += " indirectly";
            if (ks.reason) s += ` from ${ks.reason}`;
            s += ` by ${ks.attacker.player.username}'s ${
              ks.attacker.formes[ks.attacker.formes.length - 1].detail.split(",")[0]
            }`;
          }
        }
        return s;
      }

      upkeep(turn) {
        if (!turn) return;
        this.cleanStatuses();
        this.killStrings.forEach((ks) =>
          this.events.push({
            player: this.field.sides.indexOf(ks.target.player.side) + 1,
            turn: turn.number,
            message: `${this.makeKillString(ks)}.`,
          })
        );
        this.killStrings = [];
      }

      getTest() {
        const analysis = this.toJson();
        return {
          gametype: analysis.gametype,
          genNum: analysis.genNum,
          turns: analysis.turns,
          gameTime: analysis.gameTime,
          stats: analysis.stats.map((stat) => ({
            username: stat.username,
            win: stat.win,
            total: stat.total,
            stats: stat.stats,
            team: stat.team.map((pokemon) => ({
              kills: pokemon.kills,
              brought: pokemon.brought,
              fainted: pokemon.fainted,
              damageDealt: [
                Math.round(pokemon.damageDealt[0] * 10) / 10,
                Math.round(pokemon.damageDealt[1] * 10) / 10,
              ],
              damageTaken: [
                Math.round(pokemon.damageTaken[0] * 10) / 10,
                Math.round(pokemon.damageTaken[1] * 10) / 10,
              ],
              hpRestored: Math.round(pokemon.hpRestored * 10) / 10,
              formes: pokemon.formes.map((forme) => ({ id: forme.id ?? "" })),
            })),
          })),
          events: analysis.events.length,
        };
      }
    }

    Replay2.Analysis = Analysis;

    class Line {
      constructor(lineString) {
        __publicField(this, "parent");
        __publicField(this, "turn");
        __publicField(this, "data");
        __publicField(this, "children", []);
        this.data = lineString.split("|").map((e) => e.trim());
      }
      get id() {
        return this.data[0];
      }
      get parameters() {
        return this.data.slice(1);
      }
      addChildLine(subLine) {
        this.children.push(subLine);
        subLine.parent = this;
      }
      getTurnNumber() {
        if (this.turn) return this.turn.number;
        if (this.parent?.turn) return this.parent.turn.number;
        return void 0;
      }
      isChild() {
        return this.id.startsWith("-") || this.id === "debug";
      }
    }

    class Turn {
      constructor(turnNumber, lines = []) {
        __publicField(this, "number");
        __publicField(this, "lines");
        this.number = turnNumber;
        this.lines = lines;
      }
      addLine(line) {
        this.lines.push(line);
        line.turn = this;
      }
    }

    class Pokemon {
      constructor(dString, player, pString, options = {}) {
        __publicField(this, "formes");
        __publicField(this, "nickname");
        __publicField(this, "hpp");
        __publicField(this, "moveset");
        __publicField(this, "kills", [0, 0]);
        __publicField(this, "damageDealt", [0, 0]);
        __publicField(this, "damageTaken", [0, 0]);
        __publicField(this, "calcLog", { damageTaken: [], damageDealt: [] });
        __publicField(this, "hpRestored", 0);
        __publicField(this, "lastDamage");
        __publicField(this, "fainted", false);
        __publicField(this, "brought");
        __publicField(this, "status", { status: "healthy" });
        __publicField(this, "player");
        __publicField(this, "statuses", []);

        this.formes = [{ detail: dString, id: gens.dex.species.get(dString.split(",")[0])?.id }];
        this.nickname = pString?.split(" ")[1] ?? "";
        this.moveset = /* @__PURE__ */ new Set();
        this.hpp = 100;
        this.player = player;
        this.brought = options.brought ?? false;
      }
    }

    class Player {
      constructor(side, username) {
        __publicField(this, "username");
        __publicField(this, "teamSize", 0);
        __publicField(this, "team", []);
        __publicField(this, "side");
        __publicField(this, "turnChart", []);
        __publicField(this, "win", false);
        __publicField(this, "stats", { switches: 0 });
        __publicField(this, "luck", {
          moves: { total: 0, hits: 0, expected: 0 },
          crits: { total: 0, hits: 0, expected: 0 },
          status: { total: 0, full: 0, expected: 0 },
        });
        this.side = side;
        this.username = username;
      }
    }

    class Side {
      constructor() {
        __publicField(this, "a", { pokemon: void 0, statuses: [] });
        __publicField(this, "b", { pokemon: void 0, statuses: [] });
        __publicField(this, "c", { pokemon: void 0, statuses: [] });
        __publicField(this, "statuses", []);
      }
    }

    class Field {
      constructor() {
        __publicField(this, "sides", []);
        __publicField(this, "statuses", []);
        __publicField(this, "weather", { status: "none" });
      }
    }
  })(Replay || (Replay = {}));

  function validateUrl(url) {
    const pattern = /^(https:\/\/)?replay\.pokemonshowdown\.com\/[a-zA-Z0-9\-._~:/?#[\]\\@!$&'()*+,;=]+$/;
    return pattern.test(url);
  }

  function formatUrl(url) {
    if (!url) return url;
    if (!url.startsWith("https://")) url = `https://${url}`;
    const plainUrl = url.split("?")[0].split("#")[0];
    return plainUrl;
  }

  function normalizeReplayUrl(url) {
    url = (url || "").trim();
    if (!url) return "";
    const m = url.match(/https?:\/\/replay\.pokemonshowdown\.com\/[^\s?#]+/i);
    if (m) return m[0].replace(/\/$/, "");
    return url.replace(/\/$/, "");
  }

  // ---------- name formatting (MPL expectations) ----------
  const GENDERED_FORMS = new Set(["meowstic", "indeedee", "basculegion", "oinkologne"]);

  function parseDetail(detail) {
    const raw = (detail || "").trim();
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    const base = parts[0] || "";
    const baseId = base
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/\./g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    let gender = null;
    for (const p of parts.slice(1)) {
      const u = p.toUpperCase();
      if (u === "M" || u === "MALE") {
        gender = "M";
        break;
      }
      if (u === "F" || u === "FEMALE") {
        gender = "F";
        break;
      }
    }

    const isGenderedForm = GENDERED_FORMS.has(baseId);
    const displayName = isGenderedForm && gender ? `${base} (${gender === "M" ? "Male" : "Female"})` : base;

    const spriteKey = isGenderedForm && gender ? `${baseId}-${gender === "M" ? "male" : "female"}` : baseId;

    return { base, baseId, gender, displayName, spriteKey };
  }

  async function fetchPokemonSpriteByKey(spriteKey) {
    const slug = (spriteKey || "").trim();
    if (!slug) return null;
    const url = `https://pokeapi.co/api/v2/pokemon/${slug}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.sprites?.front_default ?? null;
  }

  function fmtPct1(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toFixed(1) + "%" : "—";
  }

  function fmtTime(sec) {
    const s = Number(sec);
    if (!Number.isFinite(s) || s < 0) return "—";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function buildChart(turnChartA, turnChartB, labelA, labelB) {
    const W = 680,
      H = 320,
      pad = 42;

    const maxTurn = Math.max(
      ...(turnChartA || []).map((p) => p.turn),
      ...(turnChartB || []).map((p) => p.turn),
      1
    );
    const maxDmg = Math.max(
      ...(turnChartA || []).map((p) => p.damage),
      ...(turnChartB || []).map((p) => p.damage),
      1
    );

    const x = (t) => pad + (t - 1) * ((W - pad * 2) / Math.max(1, maxTurn - 1));
    const yD = (v) => H - pad - v * ((H - pad * 2) / maxDmg);

    const pathOf = (series, key) => {
      if (!series?.length) return "";
      return series
        .map((p, i) => (i === 0 ? "M" : "L") + x(p.turn).toFixed(2) + "," + yD(p[key]).toFixed(2))
        .join(" ");
    };

    const gridLines = [];
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const vv = (maxDmg * i) / yTicks;
      const yy = yD(vv);
      gridLines.push(
        `<line x1="${pad}" y1="${yy}" x2="${W - pad}" y2="${yy}" stroke="rgba(255,255,255,0.08)" />`
      );
      gridLines.push(
        `<text x="${pad - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="rgba(232,238,252,0.7)">${vv.toFixed(
          0
        )}%</text>`
      );
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Team chart">
        <rect x="0" y="0" width="${W}" height="${H}" fill="rgba(0,0,0,0.12)" rx="14"></rect>
        ${gridLines.join("")}
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="rgba(255,255,255,0.12)" />
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="rgba(255,255,255,0.12)" />
        <path d="${pathOf(turnChartA, "damage")}" fill="none" stroke="rgba(125,211,252,0.95)" stroke-width="2.5" />
        <path d="${pathOf(turnChartB, "damage")}" fill="none" stroke="rgba(250,204,21,0.95)" stroke-width="2.5" />
        <g transform="translate(${W - pad - 220}, ${pad - 24})">
          <rect x="0" y="0" width="220" height="44" rx="10" fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.12)"></rect>
          <circle cx="18" cy="16" r="5" fill="rgba(125,211,252,0.95)"></circle>
          <text x="32" y="16" dominant-baseline="middle" font-size="12" fill="#e8eefc">${labelA}</text>
          <circle cx="18" cy="30" r="5" fill="rgba(250,204,21,0.95)"></circle>
          <text x="32" y="30" dominant-baseline="middle" font-size="12" fill="#e8eefc">${labelB}</text>
        </g>
      </svg>`;
  }

  async function analyze(url) {
    statusKind = "muted";
    statusText = "Validating URL…";

    const normalized = normalizeReplayUrl(url);
    if (!normalized) throw new Error("Missing URL");

    const formatted = formatUrl(normalized.replace(/^https?:\/\//, ""));
    const full = formatted.startsWith("https://") ? formatted : `https://${formatted}`;
    if (!validateUrl(full)) {
      statusKind = "err";
      statusText = "Invalid URL format (must be a replay.pokemonshowdown.com URL).";
      throw new Error("Invalid URL");
    }

    statusText = "Fetching replay log…";
    const logRes = await fetch(`${full}.log`, { credentials: "omit" });
    if (!logRes.ok) {
      statusKind = "err";
      statusText = "Could not fetch .log (is the replay public?)";
      throw new Error("Fetch failed");
    }
    const logText = await logRes.text();

    statusText = "Running analyzer…";
    const replay = new Replay.Analysis(logText);
    const json = replay.toJson();
    return { json, logText };
  }

  function monSort(a, b) {
    const aT = (a.kills?.[0] || 0) + (a.kills?.[1] || 0);
    const bT = (b.kills?.[0] || 0) + (b.kills?.[1] || 0);
    const aD = a.fainted ? 1 : 0;
    const bD = b.fainted ? 1 : 0;
    return bT - aT || aD - bD || (a.formes?.[0]?.detail || "").localeCompare(b.formes?.[0]?.detail || "");
  }

  async function buildTeamCard(stat) {
    const totalAcc = stat.luck?.moves?.total
      ? `${(stat.luck.moves.actual * 100).toFixed(0)}% (${stat.luck.moves.hits}/${stat.luck.moves.total})`
      : "—";
    const expectedAcc = stat.luck?.moves?.total ? `${(stat.luck.moves.expected * 100).toFixed(0)}%` : "—";

    const totalCrit = stat.luck?.crits?.total
      ? `${(stat.luck.crits.actual * 100).toFixed(0)}% (${stat.luck.crits.hits}/${stat.luck.crits.total})`
      : "—";
    const expectedCrit = stat.luck?.crits?.total ? `${(stat.luck.crits.expected * 100).toFixed(0)}%` : "—";

    const details = (stat.team || []).map((m) => m.formes?.[0]?.detail || "").filter(Boolean);
    const mons = details.map((d) => parseDetail(d)).filter((x) => x.baseId);

    const spritePairs = await Promise.all(
      mons.map(async (m) => ({
        display: m.displayName,
        key: m.spriteKey,
        url: await fetchPokemonSpriteByKey(m.spriteKey),
      }))
    );

    return {
      username: stat.username,
      win: !!stat.win,
      total: stat.total,
      totalAcc,
      expectedAcc,
      totalCrit,
      expectedCrit,
      sprites: spritePairs,
      turnChart: stat.turnChart ?? [],
    };
  }

  async function buildMonRows(stat) {
    const mons = [...(stat.team || [])].sort(monSort);

    const details = mons.map((m) => m.formes?.[0]?.detail || "").filter(Boolean);
    const parsed = details.map((d) => ({ detail: d, ...parseDetail(d) })).filter((x) => x.baseId);

    const spritePairs = await Promise.all(
      parsed.map(async (x) => ({ key: x.spriteKey, url: await fetchPokemonSpriteByKey(x.spriteKey) }))
    );
    const spriteMap = new Map(spritePairs.filter((x) => x.url).map((x) => [x.key, x.url]));

    return mons.map((m) => {
      const detailRaw = m.formes?.[0]?.detail || "Unknown";
      const p = parseDetail(detailRaw);

      const display = p.displayName || detailRaw.split(",")[0].trim() || "Unknown";
      const spriteKey = p.spriteKey || p.baseId || "";
      const sprite = spriteMap.get(spriteKey) || null;

      const kd0 = m.kills?.[0] ?? 0;
      const kd1 = m.kills?.[1] ?? 0;
      const kt = kd0 + kd1;

      const dd0 = m.damageDealt?.[0] ?? 0;
      const dd1 = m.damageDealt?.[1] ?? 0;
      const ddt = dd0 + dd1;

      const dt0 = m.damageTaken?.[0] ?? 0;
      const dt1 = m.damageTaken?.[1] ?? 0;
      const dtt = dt0 + dt1;

      return {
        display,
        sprite,
        brought: !!m.brought,
        fainted: !!m.fainted,
        killsText: `${kd0}/${kd1}/${kt}`,
        deaths: m.fainted ? 1 : 0,
        dmgDealtText: `${fmtPct1(dd0)}/${fmtPct1(dd1)}/${fmtPct1(ddt)}`,
        dmgTakenText: `${fmtPct1(dt0)}/${fmtPct1(dt1)}/${fmtPct1(dtt)}`,
        hpRestored: fmtPct1(m.hpRestored ?? 0),
        moves: (m.moveset || []).map((s) => String(s)),
      };
    });
  }

  async function onAnalyze() {
    loading = true;
    resultsVisible = false;
    statusKind = "muted";
    statusText = "";

    // reset outputs so you don't see stale data
    gametype = "—";
    gen = "—";
    turns = "—";
    gameTime = "—";
    logOut = "";
    p1Label = "Player 1";
    p2Label = "Player 2";
    teamA = null;
    teamB = null;
    monRowsP1 = [];
    monRowsP2 = [];
    chartSvg = "";

    try {
      const { json, logText } = await analyze(replayUrl);

      logOut = logText;
      resultsVisible = true;

      gametype = json.gametype || "—";
      gen = json.genNum ?? "—";
      turns = json.turns ?? "—";
      gameTime = fmtTime(json.gameTime);

      const [p1, p2] = json.stats || [];
      if (!p1 || !p2) {
        statusKind = "err";
        statusText = "Analyzer returned no player stats.";
        loading = false;
        return;
      }

      p1Label = p1.username || "Player 1";
      p2Label = p2.username || "Player 2";

      // build team cards + tables in parallel
      const [tA, tB, r1, r2] = await Promise.all([
        buildTeamCard(p1),
        buildTeamCard(p2),
        buildMonRows(p1),
        buildMonRows(p2),
      ]);

      teamA = tA;
      teamB = tB;
      monRowsP1 = r1;
      monRowsP2 = r2;

      chartSvg = buildChart(teamA.turnChart, teamB.turnChart, teamA.username, teamB.username);

      statusKind = "ok";
      statusText = "Done.";

      // optional postMessage parity if you embed inside iframe
      if (postMessageToParent && typeof window !== "undefined" && window.parent && window.parent !== window) {
        try {
          window.parent.postMessage(
            {
              type: "replay_analyzer_done",
              replayUrl,
              analysis: json,
            },
            "*"
          );
        } catch {
          // ignore
        }
      }

      // svelte event for MPL integration
      dispatch("analyzed", { replayUrl, analysis: json, rawLog: logText });
    } catch (e) {
      statusKind = "err";
      statusText = e?.message ? String(e.message) : "Error";
    } finally {
      loading = false;
    }
  }
</script>

<div class="page">
  <h1 class="title">Replay Analyzer</h1>

  <div class="card">
    <div class="replay-row">
      <div class="replay-left">
        <div class="muted label">Replay URL</div>
        <input
          class="replay-input"
          type="text"
          bind:value={replayUrl}
          placeholder="https://replay.pokemonshowdown.com/gen9ou-1234567890"
          on:keydown={(e) => {
            if (e.key === "Enter") onAnalyze();
          }}
        />
      </div>

      <div class="replay-actions">
        <button class="btn" on:click={onAnalyze} disabled={loading}>
          {loading ? "Analyzing…" : "Analyze"}
        </button>
        <div class={"hint " + (statusKind === "err" ? "err" : statusKind === "ok" ? "ok" : "muted")}>
          {statusText}
        </div>
      </div>
    </div>
  </div>

  {#if resultsVisible}
    <div class="results">
      <div class="card">
        <div class="meta-grid">
          <div class="pill"><b>Game Type:</b> {gametype}</div>
          <div class="pill"><b>Generation:</b> {gen}</div>
          <div class="pill"><b>Turns:</b> {turns}</div>
          <div class="pill"><b>Game Time:</b> {gameTime}</div>
        </div>
      </div>

      <div class="row">
        <div class={"team card " + (teamA?.win ? "winner" : "")}>
          {#if teamA}
            <div class="team-head">
              <div class="team-name">{teamA.username}</div>
              {#if teamA.win}<div class="pill"><b>Winner</b></div>{/if}
            </div>

            <div class="team-stats">
              <div class="stat"><span><b>Kills</b></span><span>{teamA.total?.kills ?? 0}</span></div>
              <div class="stat"><span><b>Deaths</b></span><span>{teamA.total?.deaths ?? 0}</span></div>
              <div class="stat"><span><b>Damage Dealt</b></span><span>{fmtPct1(teamA.total?.damageDealt ?? 0)}</span></div>
              <div class="stat"><span><b>Damage Taken</b></span><span>{fmtPct1(teamA.total?.damageTaken ?? 0)}</span></div>
              <div class="stat"><span><b>Accuracy</b></span><span>{teamA.totalAcc} <span class="muted">exp {teamA.expectedAcc}</span></span></div>
              <div class="stat"><span><b>Crits</b></span><span>{teamA.totalCrit} <span class="muted">exp {teamA.expectedCrit}</span></span></div>
            </div>

            <div class="sprites">
              {#each teamA.sprites ?? [] as s}
                <div class="sprite" title={s.display}>
                  {#if s.url}
                    <img alt={s.display} src={s.url} />
                  {:else}
                    <span class="muted small">{s.display}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class={"team card " + (teamB?.win ? "winner" : "")}>
          {#if teamB}
            <div class="team-head">
              <div class="team-name">{teamB.username}</div>
              {#if teamB.win}<div class="pill"><b>Winner</b></div>{/if}
            </div>

            <div class="team-stats">
              <div class="stat"><span><b>Kills</b></span><span>{teamB.total?.kills ?? 0}</span></div>
              <div class="stat"><span><b>Deaths</b></span><span>{teamB.total?.deaths ?? 0}</span></div>
              <div class="stat"><span><b>Damage Dealt</b></span><span>{fmtPct1(teamB.total?.damageDealt ?? 0)}</span></div>
              <div class="stat"><span><b>Damage Taken</b></span><span>{fmtPct1(teamB.total?.damageTaken ?? 0)}</span></div>
              <div class="stat"><span><b>Accuracy</b></span><span>{teamB.totalAcc} <span class="muted">exp {teamB.expectedAcc}</span></span></div>
              <div class="stat"><span><b>Crits</b></span><span>{teamB.totalCrit} <span class="muted">exp {teamB.expectedCrit}</span></span></div>
            </div>

            <div class="sprites">
              {#each teamB.sprites ?? [] as s}
                <div class="sprite" title={s.display}>
                  {#if s.url}
                    <img alt={s.display} src={s.url} />
                  {:else}
                    <span class="muted small">{s.display}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="card">
        <h2 class="h2">Per Pokémon Performance</h2>

        <div class="row">
          <div class="card inner">
            <div class="table-title">{p1Label}</div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Pokémon</th>
                    <th class="mono">Kills (D/I/T)</th>
                    <th class="mono">Deaths</th>
                    <th class="mono">Dmg Dealt (D/I/T)</th>
                    <th class="mono">Dmg Taken (D/I/T)</th>
                    <th class="mono">HP Restored</th>
                  </tr>
                </thead>
                <tbody>
                  {#each monRowsP1 as r}
                    <tr>
                      <td>
                        <div class="mon-row">
                          <div class="mon-icon">
                            {#if r.sprite}<img alt={r.display} src={r.sprite} />{/if}
                          </div>
                          <div>
                            <div class="mon-name">{r.display}</div>
                            <div class="muted small">
                              {r.brought ? "Brought" : "Hidden"}{r.fainted ? " • Fainted" : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td class="mono">{r.killsText}</td>
                      <td class="mono">{r.deaths}</td>
                      <td class="mono">{r.dmgDealtText}</td>
                      <td class="mono">{r.dmgTakenText}</td>
                      <td class="mono">{r.hpRestored}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card inner">
            <div class="table-title">{p2Label}</div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Pokémon</th>
                    <th class="mono">Kills (D/I/T)</th>
                    <th class="mono">Deaths</th>
                    <th class="mono">Dmg Dealt (D/I/T)</th>
                    <th class="mono">Dmg Taken (D/I/T)</th>
                    <th class="mono">HP Restored</th>
                  </tr>
                </thead>
                <tbody>
                  {#each monRowsP2 as r}
                    <tr>
                      <td>
                        <div class="mon-row">
                          <div class="mon-icon">
                            {#if r.sprite}<img alt={r.display} src={r.sprite} />{/if}
                          </div>
                          <div>
                            <div class="mon-name">{r.display}</div>
                            <div class="muted small">
                              {r.brought ? "Brought" : "Hidden"}{r.fainted ? " • Fainted" : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td class="mono">{r.killsText}</td>
                      <td class="mono">{r.deaths}</td>
                      <td class="mono">{r.dmgDealtText}</td>
                      <td class="mono">{r.dmgTakenText}</td>
                      <td class="mono">{r.hpRestored}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <details class="card">
        <summary>Debug: replay log</summary>
        <textarea bind:value={logOut} spellcheck="false" />
      </details>
    </div>
  {/if}
</div>

<style>
  :global(:root) {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  }

  .page {
    padding: 16px;
    background: #0b1020;
    color: #e8eefc;
  }

  .title {
    margin: 0 0 10px 0;
  }

  .card {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    padding: 12px;
    margin-bottom: 12px;
  }

  .muted {
    color: rgba(232, 238, 252, 0.7);
  }
  .ok {
    color: #bbf7d0;
  }
  .err {
    color: #fecaca;
  }

  .hint {
    font-size: 13px;
    line-height: 1.4;
  }

  .label {
    margin-bottom: 6px;
  }

  input,
  button,
  textarea {
    font: inherit;
  }

  .replay-input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.25);
    color: #e8eefc;
    box-sizing: border-box;
  }

  .btn {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.1);
    color: #e8eefc;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .pill {
    display: inline-block;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .row > * {
    flex: 1 1 320px;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  /* ✅ THE FIX: this layout cannot overlap */
  .replay-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
  }

  .replay-left {
    min-width: 0;
  }

  .replay-actions {
    display: grid;
    grid-template-rows: auto auto;
    gap: 6px;
    align-content: start;
    justify-items: stretch;
    align-self: end;
  }

  @media (max-width: 720px) {
    .replay-row {
      grid-template-columns: 1fr;
    }
    .replay-actions {
      justify-items: start;
    }
  }

  .team {
    border-radius: 14px;
    padding: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .winner {
    box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.35) inset;
  }

  .team-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .team-name {
    font-size: 22px;
    font-weight: 800;
  }

  .team-stats {
    margin-top: 8px;
    display: grid;
    gap: 6px;
  }

  .stat {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.12);
  }
  .stat:last-child {
    border-bottom: 0;
  }

  .sprites {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 10px;
  }

  .sprite {
    width: 56px;
    height: 56px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .sprite img {
    width: 72px;
    height: 72px;
    image-rendering: pixelated;
  }

  .h2 {
    margin: 0 0 8px 0;
    font-size: 18px;
  }

  .chart-wrap {
    width: 100%;
    overflow-x: auto;
  }

  .inner {
    padding: 0;
  }

  .table-title {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-weight: 800;
  }

  .table-wrap {
    max-height: 520px;
    overflow: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border-radius: 12px;
  }

  th,
  td {
    padding: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    text-align: left;
    vertical-align: middle;
  }

  th {
    position: sticky;
    top: 0;
    background: rgba(255, 255, 255, 0.07);
    font-size: 13px;
    z-index: 1;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
  }

  .mon-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .mon-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.12);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .mon-icon img {
    width: 48px;
    height: 48px;
    image-rendering: pixelated;
  }

  .mon-name {
    font-weight: 700;
  }

  .small {
    font-size: 12px;
  }

  details textarea {
    width: 100%;
    min-height: 220px;
    border-radius: 12px;
    padding: 10px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #e8eefc;
    box-sizing: border-box;
  }
</style>
