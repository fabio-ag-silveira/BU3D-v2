import {
  AI_DIFFICULTIES,
  AI_PRESETS,
  AI_THINK_DELAY_MS,
  AIM_SPEED,
  ARENA,
  CART_GRAVITY,
  CRATES,
  CHARGE_SECONDS,
  DEFAULT_AI_DIFFICULTY,
  DEFAULT_GAME_MODE,
  FUEL_PER_TURN,
  KNOCKBACK_SCALE,
  KNOCKBACK_SECONDS,
  GAME_MODES,
  GRAVITY,
  MAX_CRATERS,
  MAX_HP,
  MIN_SPAWN_DISTANCE,
  MOVE_SPEED,
  PHASE_DELAYS,
  PLAYER_COUNTS,
  PLAYER_DEFAULTS,
  PROJECTILE_SUBSTEP,
  ROUND_MODIFIERS,
  ROUNDS_TO_WIN,
  SAFE_FALL,
  SKY_THEMES,
  TIME_SCALE,
  TURN_TIME_MS,
  VOXEL_SIZE,
  WEAPON_ORDER,
  WEAPONS,
  WIND_MAX,
  YAW_SPEED,
} from "./config.js";
import { clamp, distance2d, distance3d, randomItem, randomRange, wrapDegrees } from "./math.js";
import {
  bearingTo,
  clampElevation,
  forwardVector,
  getLaunchVelocity,
  getMuzzle,
  getTankCenter,
  isInsideTankHitbox,
  isOutOfBounds,
  isTankBlocked,
  isTankSpaceFree,
  isTankSupported,
  powerToVelocity,
  projectileAt,
  velocityAt,
} from "./physics.js";
import { VoxelWorld } from "./world.js";
import { getLayout, MAP_KINDS } from "./map.js";
import { planAiShot } from "./ai.js";

export const CONTROLS = ["up", "down", "left", "right", "forward", "back", "fire", "weapon", "target"];
const MAX_EVENTS = 40;

function createInputState() {
  return Object.fromEntries(CONTROLS.map((control) => [control, false]));
}

// Pontos altos sao a regra; nascer na rua (um "canion" entre predios) fica raro.
const SPAWN_WEIGHTS = { island: 0.35, roof: 0.45, bridge: 0.2, park: 0.1, street: 0.06 };
// Chance de exigir que o adversario comece a vista (o resto continua podendo comecar escondido).
const SIGHT_PREFERENCE = 0.4;

function weightedSpawn(candidates) {
  const kinds = [...new Set(candidates.map((spawn) => spawn.kind))];
  let roll = Math.random() * kinds.reduce((sum, kind) => sum + (SPAWN_WEIGHTS[kind] ?? 0.2), 0);
  const kind = kinds.find((entry) => (roll -= SPAWN_WEIGHTS[entry] ?? 0.2) <= 0) ?? kinds[0];
  return randomItem(candidates.filter((spawn) => spawn.kind === kind));
}

// Linha reta do canhao de um ate o centro do outro, sem voxel no meio.
export function hasLineOfSight(world, a, b) {
  const from = { x: a.x, y: a.y + 4.6, z: a.z };
  const to = { x: b.x, y: b.y + 2.5, z: b.z };
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z));
  for (let index = 3; index < steps - 3; index += 1) {
    const t = index / steps;
    if (world.isBuildingSolid({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t })) {
      return false;
    }
  }
  return true;
}

// Escolhe pontos afastados entre si; na maioria das rodadas, com o adversario a vista.
function spreadSpawns(candidates, count, first, world) {
  const chosen = [first];
  const wantSight = world && Math.random() < SIGHT_PREFERENCE;
  while (chosen.length < count) {
    const scored = candidates
      .filter((spawn) => !chosen.includes(spawn))
      .map((spawn) => ({ spawn, distance: Math.min(...chosen.map((other) => distance2d(other, spawn))) }))
      .sort((a, b) => b.distance - a.distance);
    if (!scored.length) {
      chosen.push(first);
      continue;
    }
    const far = scored.filter((entry) => entry.distance >= MIN_SPAWN_DISTANCE);
    let pool = far.length ? far : scored.slice(0, 5);
    if (wantSight) {
      const inSight = pool.filter((entry) => chosen.some((other) => hasLineOfSight(world, other, entry.spawn)));
      if (inSight.length) {
        pool = inSight;
      }
    }
    chosen.push(weightedSpawn(pool.map((entry) => entry.spawn)));
  }
  return chosen;
}

// Classico: listas fixas do legado. Dinamico: telhados, ilhas, passarelas e ruas validos.
function pickSpawns(layout, world, count) {
  if (layout.playerSpawns) {
    if (count === 2) {
      const first = randomItem(layout.playerSpawns[0]);
      const options = layout.playerSpawns[1].filter((spawn) => distance2d(spawn, first) >= MIN_SPAWN_DISTANCE);
      return [first, randomItem(options.length ? options : layout.playerSpawns[1])];
    }
    const all = layout.playerSpawns.flat();
    return spreadSpawns(all, count, randomItem(all));
  }
  const valid = layout.spawns.filter((spawn) =>
    [0, 90].some((yaw) => isTankSpaceFree(world, spawn, yaw)) && isTankSupported(world, spawn, 0));
  return spreadSpawns(valid, count, weightedSpawn(valid), world);
}

function pickModifier(round) {
  if (round === 0) {
    return "normal";
  }
  const entries = Object.values(ROUND_MODIFIERS);
  let roll = Math.random() * entries.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.id;
    }
  }
  return "normal";
}

function createPlayers(layout, world, count, ammoScale = 1) {
  const spawns = pickSpawns(layout, world, count);
  return PLAYER_DEFAULTS.slice(0, count).map((template, index) => {
    const position = { ...spawns[index] };
    const other = spawns
      .filter((_, otherIndex) => otherIndex !== index)
      .sort((a, b) => distance2d(a, position) - distance2d(b, position))[0];
    return {
      id: template.id,
      label: template.label,
      color: template.color,
      shade: template.shade,
      position: { x: position.x, y: position.y, z: position.z },
      yaw: Math.round(bearingTo(position, other)),
      elevation: 35,
      hp: MAX_HP,
      fuel: FUEL_PER_TURN,
      lastPower: null,
      lastImpact: null,
      feedback: null,
      lockedTargetId: null,
      autoYaw: null,
      fall: null,
      weapon: "standard",
      ammo: createAmmo(ammoScale),
    };
  });
}

function createAmmo(scale = 1) {
  return Object.fromEntries(WEAPON_ORDER
    .filter((id) => WEAPONS[id].ammo !== null)
    .map((id) => [id, WEAPONS[id].ammo * scale]));
}

function randomWind(strength) {
  const angle = Math.random() * Math.PI * 2;
  const magnitude = Math.round(strength * 10) / 10;
  return {
    x: Math.round(Math.sin(angle) * magnitude * 100) / 100,
    z: Math.round(Math.cos(angle) * magnitude * 100) / 100,
  };
}

export class Game {
  constructor() {
    this.instanceId = Math.random().toString(36).slice(2, 10);
    this.mode = DEFAULT_GAME_MODE;
    this.aiDifficulty = DEFAULT_AI_DIFFICULTY;
    this.mapKind = MAP_KINDS.dynamic.id;
    this.events = [];
    this.eventSeq = 0;
    this.inputs = Object.fromEntries(PLAYER_DEFAULTS.map((template) => [template.id, createInputState()]));
    this.playerCount = 2;
    this.aiMissMemory = new Map();
    this.projectileSeq = 0;
    this.crateSeq = 0;
    this.world = new VoxelWorld();
    this.resetGame();
  }

  get currentPlayer() {
    return this.players[this.turnIndex];
  }

  // Alvo principal do jogador da vez: o inimigo vivo mais proximo.
  get opponent() {
    const current = this.currentPlayer;
    return this.players
      .filter((player) => player !== current && player.hp > 0)
      .sort((a, b) => distance3d(a.position, current.position) - distance3d(b.position, current.position))[0]
      ?? this.players.find((player) => player !== current);
  }

  get isAiTurn() {
    return this.mode === GAME_MODES.ai && this.currentPlayer.id !== 1;
  }

  // A IA mira no mais proximo, ou as vezes no mais fraco.
  pickAiTarget() {
    const current = this.currentPlayer;
    const enemies = this.players.filter((player) => player !== current && player.hp > 0);
    if (enemies.length > 1 && Math.random() < 0.35) {
      return enemies.sort((a, b) => a.hp - b.hp)[0];
    }
    return this.opponent;
  }

  setPlayerCount(count) {
    if (!PLAYER_COUNTS.includes(count) || count === this.playerCount) {
      return;
    }
    this.playerCount = count;
    this.resetGame();
    this.status = `Nova partida com ${count} jogadores.`;
  }

  emit(type, data = {}) {
    this.eventSeq += 1;
    this.events.push({ id: this.eventSeq, type, ...data });
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  setPhase(phase, durationMs = 0) {
    this.phase = phase;
    this.phaseMs = durationMs;
  }

  resetGame() {
    this.round = -1;
    this.totalScore = Array(this.playerCount).fill(0);
    this.matchWinner = null;
    this.resetRound();
    this.status = "Nova partida. Primeiro a vencer 3 rodadas leva!";
  }

  resetRound() {
    this.round += 1;
    this.turnIndex = this.round % this.playerCount;
    this.turnsInRound = 0;
    this.theme = randomItem(Object.keys(SKY_THEMES));
    this.modifier = pickModifier(this.round);
    const modifier = ROUND_MODIFIERS[this.modifier];
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.craters = [];
    this.roundMapKind = this.mapKind;
    this.layout = getLayout(this.roundMapKind, this.seed);
    this.world.setLayout(this.layout);
    this.projectiles = [];
    this.crates = [];
    this.turnReport = null;
    this.gravity = GRAVITY * (modifier.gravityScale ?? 1);
    this.impact = null;
    this.charge = { active: false, power: 0, direction: 1 };
    this.wind = { x: 0, z: 0 };
    this.turnTimeMs = TURN_TIME_MS;
    this.players = createPlayers(this.layout, this.world, this.playerCount, modifier.ammoScale ?? 1);
    this.aiPlan = null;
    this.aiThinkMs = 0;
    this.aiMissMemory.clear();
    this.setPhase("roundStart", PHASE_DELAYS.roundStart);
    this.status = `Rodada ${this.round + 1}. Preparem-se!`;
    this.emit("roundStart", {
      round: this.round + 1,
      theme: this.theme,
      modifier: this.modifier,
      mapKind: this.roundMapKind,
      density: this.layout.density,
      label: modifier.id === "normal" ? "" : modifier.label,
      description: modifier.description,
      density: this.layout.density,
    });
  }

  setMode(mode) {
    if (!Object.values(GAME_MODES).includes(mode) || this.mode === mode) {
      return;
    }

    this.mode = mode;
    this.aiPlan = null;
    this.aiThinkMs = AI_THINK_DELAY_MS;
    this.status = this.mode === GAME_MODES.ai ? "Modo versus IA ativado." : "Modo versus local ativado.";
  }

  setMapKind(kind) {
    if (!MAP_KINDS[kind] || this.mapKind === kind) {
      return;
    }
    this.mapKind = kind;
    this.status = `Mapa ${MAP_KINDS[kind].label.toLowerCase()} a partir da próxima rodada.`;
  }

  setAiDifficulty(difficulty) {
    if (!Object.values(AI_DIFFICULTIES).includes(difficulty) || this.aiDifficulty === difficulty) {
      return;
    }

    this.aiDifficulty = difficulty;
    this.status = `Dificuldade alterada para ${AI_PRESETS[this.aiDifficulty].label}.`;
  }

  cycleAiDifficulty() {
    const order = [AI_DIFFICULTIES.easy, AI_DIFFICULTIES.medium, AI_DIFFICULTIES.hard];
    const currentIndex = order.indexOf(this.aiDifficulty);
    this.setAiDifficulty(order[(currentIndex + 1) % order.length]);
  }

  setInput(playerId, control, pressed, { cancel = false } = {}) {
    const input = this.inputs[playerId];
    if (!input || !CONTROLS.includes(control)) {
      return false;
    }
    if (this.mode === GAME_MODES.ai && playerId === 2) {
      return false;
    }

    const wasPressed = input[control];
    input[control] = pressed;

    const isTurnOwner = this.phase === "aiming" && this.currentPlayer.id === playerId;
    if (control === "weapon" && pressed && !wasPressed && isTurnOwner && !this.charge.active) {
      this.cycleWeapon(this.currentPlayer);
    }
    if (control === "target" && pressed && !wasPressed && isTurnOwner && !this.charge.active) {
      this.faceNextTarget(this.currentPlayer);
    }
    if (control === "fire" && pressed !== wasPressed && isTurnOwner) {
      if (pressed) {
        this.startCharge();
      } else if (this.charge.active) {
        if (cancel) {
          this.charge.active = false;
        } else {
          this.fire();
        }
      }
    }
    return true;
  }

  update(deltaMs) {
    const dt = Math.min(deltaMs, 50);
    this.phaseMs -= dt;

    switch (this.phase) {
      case "roundStart":
        if (this.phaseMs <= 0) {
          this.beginTurn();
        }
        break;
      case "aiming":
        this.updatePush(dt);
        this.updateFalling(dt);
        this.updateCrates(dt);
        this.updateAiming(dt);
        break;
      case "flying":
        this.updatePush(dt);
        this.updateFalling(dt);
        this.updateCrates(dt);
        this.updateProjectiles(dt);
        break;
      case "settling": {
        const pushing = this.updatePush(dt);
        this.updateCrates(dt);
        if (!this.updateFalling(dt) && !pushing && this.phaseMs <= 0) {
          this.resolveTurn();
        }
        break;
      }
      case "roundOver":
        this.updatePush(dt);
        this.updateFalling(dt);
        if (this.phaseMs <= 0) {
          this.resetRound();
        }
        break;
      case "matchOver":
        if (this.phaseMs <= 0) {
          this.resetGame();
        }
        break;
      default:
        break;
    }
  }

  beginTurn() {
    this.turnsInRound += 1;
    const growth = 0.5 + 0.5 * Math.min(1, this.turnsInRound / 6);
    const windScale = ROUND_MODIFIERS[this.modifier].windScale ?? 1;
    this.wind = randomWind(randomRange(0, WIND_MAX) * growth * windScale);
    this.turnTimeMs = TURN_TIME_MS;
    this.charge = { active: false, power: 0, direction: 1 };
    this.impact = null;
    this.aiPlan = null;
    this.aiThinkMs = AI_THINK_DELAY_MS;

    const player = this.currentPlayer;
    player.fuel = FUEL_PER_TURN;
    if (this.turnsInRound >= CRATES.firstTurn && this.crates.length < CRATES.max && Math.random() < CRATES.dropChance) {
      this.dropCrate();
    }
    this.setPhase("aiming");
    this.status = `Vez de ${player.label}. Gire, mire, ajuste a força e atire!`;
    this.emit("turn", { playerId: player.id, label: player.label, wind: { ...this.wind } });
  }

  updateAiming(dt) {
    this.turnTimeMs -= dt;
    const player = this.currentPlayer;
    const seconds = dt / 1000;

    if (this.isAiTurn) {
      this.updateAi(dt);
    } else if (!player.fall) {
      const input = this.inputs[player.id];
      const aim = (input.up ? 1 : 0) - (input.down ? 1 : 0);
      if (aim) {
        player.elevation = clampElevation(player.elevation + aim * AIM_SPEED * seconds);
      }
      const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      if (turn && !this.charge.active) {
        player.autoYaw = null;
        this.rotateCart(player, turn * YAW_SPEED * seconds);
      } else if (player.autoYaw !== null) {
        // "Mirar no inimigo": gira sozinho ate ficar de frente para o alvo.
        const difference = wrapDegrees(player.autoYaw - player.yaw);
        const step = YAW_SPEED * 2 * seconds;
        this.rotateCart(player, clamp(difference, -step, step));
        if (Math.abs(difference) <= step) {
          player.autoYaw = null;
        }
      }
      const move = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
      if (move && !this.charge.active) {
        this.moveCart(player, move, seconds);
      }
    }

    if (this.phase !== "aiming") {
      return;
    }

    if (this.charge.active) {
      let power = this.charge.power + (this.charge.direction * seconds) / CHARGE_SECONDS;
      if (power >= 1) {
        power = 1;
        this.charge.direction = -1;
      } else if (power <= 0) {
        power = 0;
        this.charge.direction = 1;
      }
      this.charge.power = power;
    }

    if (this.turnTimeMs <= 0) {
      this.turnTimeMs = 0;
      if (this.charge.active) {
        this.fire("Tempo esgotado! O disparo saiu com a força atual.");
      } else {
        this.status = `Tempo esgotado! ${player.label} perdeu a vez.`;
        this.emit("timeout", { playerId: player.id });
        this.setPhase("settling", PHASE_DELAYS.timeout);
      }
    }
  }

  rotateCart(player, deltaYaw) {
    player.yaw = wrapDegrees(player.yaw + deltaYaw);
  }

  moveCart(player, direction, seconds) {
    if (player.fuel <= 0) {
      return;
    }

    const distance = Math.min(MOVE_SPEED * seconds, player.fuel);
    const forward = forwardVector(player.yaw);
    const next = {
      x: player.position.x + forward.x * direction * distance,
      y: player.position.y,
      z: player.position.z + forward.z * direction * distance,
    };
    const other = this.players.filter((entry) => entry !== player);
    if (isTankBlocked(this.world, next, player.yaw, direction, other)) {
      // Sobe degraus de um voxel (morros, escombros, telhado vizinho), avancando ate apoiar no degrau.
      const step = [0, 1, 2]
        .map((extra) => ({
          x: next.x + forward.x * direction * extra,
          y: next.y + VOXEL_SIZE,
          z: next.z + forward.z * direction * extra,
        }))
        .find((candidate) => !isTankBlocked(this.world, candidate, player.yaw, direction, other) &&
          isTankSupported(this.world, candidate, player.yaw));
      if (!step) {
        return;
      }
      next.x = step.x;
      next.y = step.y;
      next.z = step.z;
    }
    player.fuel = Math.max(0, player.fuel - distance);
    player.position = next;
  }

  startCharge() {
    this.charge = { active: true, power: 0, direction: 1 };
  }

  // Gira para o inimigo vivo mais proximo; apertar de novo passa para o proximo.
  faceNextTarget(player) {
    const enemies = this.players
      .filter((entry) => entry !== player && entry.hp > 0)
      .sort((a, b) => distance3d(a.position, player.position) - distance3d(b.position, player.position));
    if (!enemies.length) {
      return;
    }
    const current = enemies.findIndex((entry) => entry.id === player.lockedTargetId);
    const facing = current >= 0 &&
      Math.abs(wrapDegrees(bearingTo(player.position, enemies[current].position) - player.yaw)) < 3;
    const target = enemies[facing ? (current + 1) % enemies.length : Math.max(0, current)];
    player.lockedTargetId = target.id;
    player.autoYaw = wrapDegrees(bearingTo(player.position, target.position));
    this.emit("target", { playerId: player.id, targetId: target.id, label: target.label });
  }

  cycleWeapon(player) {
    const available = WEAPON_ORDER.filter((id) => WEAPONS[id].ammo === null || player.ammo[id] > 0);
    const index = available.indexOf(player.weapon);
    this.selectWeapon(player, available[(index + 1) % available.length]);
  }

  selectWeapon(player, weaponId) {
    const weapon = WEAPONS[weaponId];
    if (!weapon || (weapon.ammo !== null && !(player.ammo[weaponId] > 0)) || player.weapon === weaponId) {
      return;
    }
    player.weapon = weaponId;
    this.emit("weapon", { playerId: player.id, weapon: weaponId, label: weapon.label });
  }

  fire(message) {
    const player = this.currentPlayer;
    const power = this.charge.power;
    this.charge = { active: false, power, direction: 1 };
    player.lastPower = power;

    const weapon = WEAPONS[player.weapon];
    if (weapon.ammo !== null) {
      player.ammo[weapon.id] = Math.max(0, player.ammo[weapon.id] - 1);
    }
    const origin = getMuzzle(player.position, player.yaw, player.elevation);
    this.emit("shot", { playerId: player.id, ...origin, power, yaw: player.yaw, elevation: player.elevation, weapon: weapon.id });
    this.projectiles = [];
    this.turnReport = { attackerId: player.id, dealt: 0, selfDamage: 0, direct: null, explosions: 0, weapon: weapon.id };
    this.launch({
      ownerId: player.id,
      weapon: weapon.id,
      origin,
      velocity: getLaunchVelocity(player.yaw, player.elevation, powerToVelocity(power)),
      bounces: weapon.bounces ?? 0,
      split: weapon.split ?? 0,
      age: 0,
    });
    if (weapon.ammo !== null && player.ammo[weapon.id] <= 0) {
      player.weapon = "standard";
    }
    this.setPhase("flying");
    const name = weapon.id === "standard" ? "" : ` (${weapon.label})`;
    this.status = message ?? `${player.label} disparou${name} com ${Math.round(power * 100)}% de força.`;
  }

  launch({ ownerId, weapon, origin, velocity, bounces = 0, split = 0, age = 0 }) {
    this.projectileSeq += 1;
    this.projectiles.push({
      id: this.projectileSeq,
      ownerId,
      weapon,
      origin: { ...origin },
      velocity: { ...velocity },
      wind: { ...this.wind },
      gravity: this.gravity,
      elapsed: 0,
      age,
      position: { ...origin },
      bounces,
      split,
    });
  }

  removeProjectile(projectile) {
    this.projectiles = this.projectiles.filter((entry) => entry !== projectile);
  }

  updateProjectiles(dt) {
    let remaining = (dt / 1000) * TIME_SCALE;

    while (remaining > 0 && this.projectiles.length) {
      const step = Math.min(PROJECTILE_SUBSTEP, remaining);
      remaining -= step;
      [...this.projectiles].forEach((projectile) => this.stepProjectile(projectile, step));
    }

    if (!this.projectiles.length && this.phase === "flying") {
      this.finishShot();
    }
  }

  stepProjectile(projectile, step) {
    const previous = projectile.position;
    projectile.elapsed += step;
    projectile.age += step;
    projectile.position = projectileAt(
      projectile.origin, projectile.velocity, projectile.wind, projectile.elapsed, projectile.gravity,
    );

    // Fragmentacao: abre no ponto mais alto da trajetoria.
    if (projectile.split && velocityAt(projectile.velocity, projectile.wind, projectile.elapsed, projectile.gravity).y <= 0) {
      this.splitProjectile(projectile);
      return;
    }

    const target = this.players.find((player) =>
      isInsideTankHitbox(projectile.position, player) &&
      (player.id !== projectile.ownerId || projectile.age > 0.5));
    if (target) {
      this.explode(projectile, target);
      return;
    }

    if (this.world.isSolid(projectile.position)) {
      if (projectile.bounces > 0) {
        this.bounceProjectile(projectile, previous);
      } else {
        this.explode(projectile, null);
      }
      return;
    }

    if (isOutOfBounds(projectile.position)) {
      this.removeProjectile(projectile);
      // So visual: o cliente continua o voo ate cair no mar ou nos bairros em volta.
      this.emit("offmap", {
        playerId: projectile.ownerId,
        weapon: projectile.weapon,
        origin: { ...projectile.origin },
        velocity: { ...projectile.velocity },
        wind: { ...projectile.wind },
        gravity: projectile.gravity,
        elapsed: projectile.elapsed,
      });
    }
  }

  splitProjectile(projectile) {
    this.removeProjectile(projectile);
    const velocity = velocityAt(projectile.velocity, projectile.wind, projectile.elapsed, projectile.gravity);
    const heading = Math.atan2(velocity.x, velocity.z);
    this.emit("split", { ...projectile.position, playerId: projectile.ownerId });
    for (let index = 0; index < projectile.split; index += 1) {
      const angle = heading + Math.PI / 4 + (index / projectile.split) * Math.PI * 2;
      this.launch({
        ownerId: projectile.ownerId,
        weapon: "bomblet",
        origin: projectile.position,
        velocity: {
          x: velocity.x + Math.sin(angle) * 5,
          y: velocity.y + 1.5,
          z: velocity.z + Math.cos(angle) * 5,
        },
        age: projectile.age,
      });
    }
  }

  // Quicante: reflete a velocidade na face do voxel (ou do chao) que foi atingida.
  bounceProjectile(projectile, previous) {
    const velocity = velocityAt(projectile.velocity, projectile.wind, projectile.elapsed, projectile.gravity);
    const axis = this.world.hitAxis(previous, projectile.position);
    velocity[axis] = -velocity[axis];
    projectile.origin = { ...previous };
    projectile.position = { ...previous };
    projectile.velocity = { x: velocity.x * 0.62, y: velocity.y * 0.62, z: velocity.z * 0.62 };
    projectile.elapsed = 0;
    projectile.bounces -= 1;
    this.emit("bounce", { ...previous, playerId: projectile.ownerId });
  }

  explode(projectile, directTarget) {
    const point = projectile.position;
    const weapon = WEAPONS[projectile.weapon];
    const report = this.turnReport;
    const attacker = this.players.find((player) => player.id === projectile.ownerId) ?? this.currentPlayer;
    this.removeProjectile(projectile);

    const crater = { id: this.eventSeq + 1, x: point.x, y: point.y, z: point.z, r: weapon.crater };
    this.craters.push(crater);
    if (this.craters.length > MAX_CRATERS) {
      this.craters.shift();
    }
    this.world.sync(this.craters);
    this.world.collapses.forEach((collapse) => {
      this.emit("collapse", { ...collapse.center, size: collapse.cells.length, drop: collapse.drop * VOXEL_SIZE });
    });
    this.impact = { x: point.x, y: point.y, z: point.z };
    report.explosions += 1;
    if (!report.firstImpact) {
      report.firstImpact = { x: point.x, y: point.y, z: point.z };
    }
    this.destroyCrates(point, weapon.radius);
    this.emit("explosion", {
      ...this.impact, radius: weapon.radius, weapon: weapon.id, playerId: attacker.id, craterId: crater.id,
    });

    this.players.forEach((player) => {
      const distance = distance3d(getTankCenter(player), point);
      this.applyKnockback(player, point, distance, weapon, attacker);
      let damage = distance < weapon.radius ? weapon.damage * (1 - distance / weapon.radius) : 0;
      if (player === directTarget) {
        damage += weapon.directBonus;
      }
      damage = Math.round(damage);
      if (damage <= 0 || player.hp <= 0) {
        return;
      }
      this.applyDamage(player, damage);
      if (player === attacker) {
        report.selfDamage += damage;
      } else {
        report.dealt += damage;
        if (player === directTarget) {
          report.direct = player.label;
        }
      }
    });
  }

  // Onde o tiro caiu em relacao ao alvo, no referencial de quem atirou (curto/longo, esquerda/direita).
  buildShotFeedback(attacker, report) {
    const impact = report.firstImpact;
    if (!impact) {
      return { text: "Último tiro saiu do mapa.", impact: null };
    }
    const enemies = this.players.filter((player) => player !== attacker);
    const target = enemies.find((player) => player.id === attacker.lockedTargetId && player.hp > 0) ??
      enemies.sort((a, b) => distance3d(a.position, impact) - distance3d(b.position, impact))[0];
    if (!target) {
      return { text: "", impact };
    }
    if (report.direct === target.label) {
      return { text: `Acerto direto em ${target.label}!`, impact, targetId: target.id };
    }
    const dx = target.position.x - attacker.position.x;
    const dz = target.position.z - attacker.position.z;
    const length = Math.hypot(dx, dz) || 1;
    const forward = { x: dx / length, z: dz / length };
    const right = { x: -forward.z, z: forward.x };
    const delta = { x: impact.x - target.position.x, z: impact.z - target.position.z };
    const along = delta.x * forward.x + delta.z * forward.z;
    const side = delta.x * right.x + delta.z * right.z;
    const parts = [];
    if (Math.abs(along) >= 2) {
      parts.push(`${Math.round(Math.abs(along))} m ${along < 0 ? "antes" : "depois"}`);
    }
    if (Math.abs(side) >= 2) {
      parts.push(`${Math.round(Math.abs(side))} m à ${side > 0 ? "direita" : "esquerda"}`);
    }
    const text = parts.length
      ? `Último tiro: ${parts.join(" e ")} de ${target.label}`
      : `Último tiro: em cima de ${target.label}!`;
    return { text, impact, targetId: target.id, along, side };
  }

  finishShot() {
    const report = this.turnReport;
    const attacker = this.players.find((player) => player.id === report.attackerId);
    const feedback = this.buildShotFeedback(attacker, report);
    attacker.lastImpact = feedback.impact;
    attacker.feedback = feedback.text;
    this.emit("shotFeedback", { playerId: attacker.id, text: feedback.text, impact: feedback.impact });
    if (!report.explosions) {
      this.status = "O tiro saiu do mapa.";
      this.emit("miss", { playerId: attacker.id });
    } else if (report.direct) {
      this.status = `Acerto direto! ${report.direct} perdeu ${report.dealt} de HP.`;
    } else if (report.dealt > 0) {
      this.status = `${attacker.label} causou ${report.dealt} de dano.`;
    } else if (report.selfDamage > 0) {
      this.status = `Fogo amigo! ${attacker.label} se feriu (${report.selfDamage}).`;
    } else {
      this.status = "Errou! O tiro atingiu o cenário.";
    }
    // Todo tiro serve de referencia para a IA corrigir a mira (nao so os que erram por completo).
    this.rememberAiMiss();
    this.setPhase("settling", PHASE_DELAYS.settle);
  }

  dropCrate(type = null) {
    const types = Object.values(CRATES.types);
    let kind = type;
    if (!kind) {
      let roll = Math.random() * types.reduce((sum, entry) => sum + entry.weight, 0);
      kind = types.find((entry) => (roll -= entry.weight) <= 0)?.id ?? "hp";
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = randomRange(ARENA.minX + 12, ARENA.maxX - 12);
      const z = randomRange(ARENA.minZ + 12, ARENA.maxZ - 12);
      const top = this.world.topAt(x, z);
      const nearTank = this.players.some((player) => Math.hypot(player.position.x - x, player.position.z - z) < 22);
      const nearCrate = this.crates.some((crate) => Math.hypot(crate.x - x, crate.z - z) < 20);
      // Evita a borda de predios: as quatro quinas precisam ter a mesma altura.
      const flat = [[-2, -2], [2, -2], [-2, 2], [2, 2]].every(([dx, dz]) => this.world.topAt(x + dx, z + dz) === top);
      if (nearTank || nearCrate || !flat) {
        continue;
      }
      this.crateSeq += 1;
      const crate = { id: this.crateSeq, type: kind, x, y: 95, z, falling: true };
      this.crates.push(crate);
      this.emit("crateDrop", { crateId: crate.id, type: kind, x, y: top, z });
      return crate;
    }
    return null;
  }

  updateCrates(dt) {
    const seconds = dt / 1000;
    this.crates = this.crates.filter((crate) => {
      const below = { x: crate.x, y: crate.y - 0.05, z: crate.z };
      if (this.world.isSolid(below)) {
        crate.falling = false;
      } else {
        crate.falling = true;
        crate.y = Math.max(0, crate.y - CRATES.fallSpeed * seconds * (crate.y > 60 ? 2.5 : 1));
      }

      const collector = this.players.find((player) => player.hp > 0 &&
        Math.hypot(player.position.x - crate.x, player.position.z - crate.z) < CRATES.pickupRadius &&
        crate.y - player.position.y > -2 && crate.y - player.position.y < 5);
      if (collector) {
        this.collectCrate(collector, crate);
        return false;
      }
      return true;
    });
  }

  collectCrate(player, crate) {
    const kind = CRATES.types[crate.type];
    let text = "";
    if (crate.type === "hp") {
      const before = player.hp;
      player.hp = Math.min(MAX_HP, player.hp + kind.amount);
      text = `+${player.hp - before} HP`;
    } else if (crate.type === "fuel") {
      player.fuel += kind.amount;
      text = `+${kind.amount} combustível`;
    } else {
      const weapon = randomItem(WEAPON_ORDER.filter((id) => WEAPONS[id].ammo !== null));
      player.ammo[weapon] = (player.ammo[weapon] ?? 0) + kind.amount;
      text = `+1 ${WEAPONS[weapon].label}`;
    }
    this.status = `${player.label} pegou a caixa de ${kind.label.toLowerCase()} (${text}).`;
    this.emit("cratePickup", { crateId: crate.id, playerId: player.id, type: crate.type, text, x: crate.x, y: crate.y, z: crate.z });
  }

  // Explosoes destroem caixas proximas.
  destroyCrates(point, radius) {
    this.crates = this.crates.filter((crate) => {
      if (Math.hypot(crate.x - point.x, crate.y + 1 - point.y, crate.z - point.z) > radius * 0.7) {
        return true;
      }
      this.emit("crateDestroyed", { crateId: crate.id, x: crate.x, y: crate.y, z: crate.z, type: crate.type });
      return false;
    });
  }

  // Explosoes empurram o carrinho para longe do centro (no plano), como um deslize curto.
  applyKnockback(player, point, distance, weapon, attacker) {
    const reach = weapon.radius * 1.25;
    if (distance >= reach) {
      return;
    }
    let dx = player.position.x - point.x;
    let dz = player.position.z - point.z;
    let length = Math.hypot(dx, dz);
    if (length < 0.5) {
      dx = player.position.x - attacker.position.x;
      dz = player.position.z - attacker.position.z;
      length = Math.hypot(dx, dz) || 1;
    }
    const strength = weapon.radius * KNOCKBACK_SCALE * (1 - distance / reach);
    if (strength < 0.6) {
      return;
    }
    const speed = strength / KNOCKBACK_SECONDS;
    player.push = { vx: (dx / length) * speed, vz: (dz / length) * speed, time: KNOCKBACK_SECONDS };
    this.emit("pushed", { playerId: player.id, ...player.position, strength });
  }

  updatePush(dt) {
    const seconds = dt / 1000;
    let anyPushed = false;
    this.players.forEach((player) => {
      const push = player.push;
      if (!push) {
        return;
      }
      const step = Math.min(seconds, push.time);
      push.time -= step;
      const fade = Math.max(0.2, push.time / KNOCKBACK_SECONDS);
      const next = {
        x: player.position.x + push.vx * step * fade * 1.6,
        y: player.position.y,
        z: player.position.z + push.vz * step * fade * 1.6,
      };
      if (isTankSpaceFree(this.world, next, player.yaw)) {
        player.position = next;
      } else {
        push.time = 0;
      }
      if (push.time <= 0) {
        player.push = null;
      } else {
        anyPushed = true;
      }
    });
    return anyPushed;
  }

  applyDamage(player, amount) {
    player.hp = Math.max(0, player.hp - amount);
    this.emit("damage", { playerId: player.id, amount, ...player.position });
  }

  updateFalling(dt) {
    const seconds = dt / 1000;
    let anyFalling = false;

    this.players.forEach((player) => {
      if (isTankSupported(this.world, player.position, player.yaw)) {
        if (player.fall) {
          this.land(player);
        }
        return;
      }

      if (!player.fall) {
        player.fall = { velocity: 0, startY: player.position.y };
      }
      player.fall.velocity = Math.min(player.fall.velocity + CART_GRAVITY * seconds, 120);
      let remaining = player.fall.velocity * seconds;
      while (remaining > 0) {
        const step = Math.min(0.25, remaining);
        remaining -= step;
        player.position.y = Math.max(0, player.position.y - step);
        if (isTankSupported(this.world, player.position, player.yaw)) {
          break;
        }
      }

      if (isTankSupported(this.world, player.position, player.yaw)) {
        this.land(player);
      } else {
        anyFalling = true;
      }
    });

    return anyFalling;
  }

  land(player) {
    const distance = player.fall.startY - player.position.y;
    player.fall = null;
    const damage = distance > SAFE_FALL ? Math.min(30, Math.round((distance - SAFE_FALL) * 1.2)) : 0;
    this.emit("land", { playerId: player.id, ...player.position, distance });
    if (damage > 0) {
      this.applyDamage(player, damage);
    }
  }

  resolveTurn() {
    // Quem acabou de ser destruido vira sucata e sai da vez.
    this.players.forEach((player) => {
      if (player.hp <= 0 && !player.destroyed) {
        player.destroyed = true;
        this.emit("destroyed", { playerId: player.id, label: player.label, ...player.position });
      }
    });
    const alive = this.players.filter((player) => player.hp > 0);
    if (alive.length <= 1) {
      this.finishRound(alive[0] ?? null);
      return;
    }
    for (let step = 1; step <= this.players.length; step += 1) {
      const index = (this.turnIndex + step) % this.players.length;
      if (this.players[index].hp > 0) {
        this.turnIndex = index;
        break;
      }
    }
    this.beginTurn();
  }

  finishRound(winner) {
    if (!winner) {
      this.status = "Empate! Ninguém sobrou de pé.";
      this.emit("roundEnd", { winnerId: null, label: null });
      this.setPhase("roundOver", PHASE_DELAYS.roundOver);
      return;
    }

    this.totalScore[winner.id - 1] += 1;

    if (this.totalScore[winner.id - 1] >= ROUNDS_TO_WIN) {
      this.matchWinner = winner.id;
      this.status = `${winner.label} venceu a partida! Nova partida em instantes (B reinicia).`;
      this.emit("matchEnd", { winnerId: winner.id, label: winner.label });
      this.setPhase("matchOver", PHASE_DELAYS.matchOver);
      return;
    }

    this.status = `${winner.label} venceu a rodada.`;
    this.emit("roundEnd", { winnerId: winner.id, label: winner.label });
    this.setPhase("roundOver", PHASE_DELAYS.roundOver);
  }

  // A IA gira a torre, ajusta a elevacao e segura o disparo como um jogador faria.
  updateAi(dt) {
    const player = this.currentPlayer;
    if (!this.aiPlan && this.aiDriveToCrate(player, dt)) {
      return;
    }
    if (!this.aiPlan) {
      this.aiThinkMs -= dt;
      if (this.aiThinkMs <= 0) {
        this.aiPlan = planAiShot(this);
        this.status = `${player.label} está mirando...`;
      }
      return;
    }

    const plan = this.aiPlan;
    if (plan.weapon && player.weapon !== plan.weapon) {
      this.selectWeapon(player, plan.weapon);
    }
    const yawDifference = wrapDegrees(plan.yaw - player.yaw);
    if (Math.abs(yawDifference) > 0.01) {
      const step = (YAW_SPEED * dt) / 1000;
      this.rotateCart(player, clamp(yawDifference, -step, step));
      return;
    }

    const difference = plan.elevation - player.elevation;
    if (Math.abs(difference) > 0.01) {
      const step = (AIM_SPEED * 1.4 * dt) / 1000;
      player.elevation = clampElevation(player.elevation + clamp(difference, -step, step));
      return;
    }

    if (!this.charge.active) {
      this.startCharge();
      return;
    }

    if (this.charge.power >= plan.power || this.charge.direction < 0) {
      this.charge.power = plan.power;
      this.fire();
    }
  }

  // IA busca caixas no mesmo nivel e ao alcance do combustivel antes de mirar.
  aiDriveToCrate(player, dt) {
    if (this.aiCrateGiveUp === this.turnsInRound) {
      return false;
    }
    const crate = this.crates
      .filter((entry) => !entry.falling && Math.abs(entry.y - player.position.y) < 1.5)
      .map((entry) => ({ entry, distance: Math.hypot(entry.x - player.position.x, entry.z - player.position.z) }))
      .filter(({ distance }) => distance < player.fuel + CRATES.pickupRadius)
      .sort((a, b) => a.distance - b.distance)[0]?.entry;
    if (!crate || player.fuel <= 0) {
      return false;
    }
    const target = wrapDegrees(Math.atan2(crate.x - player.position.x, crate.z - player.position.z) * 180 / Math.PI);
    const difference = wrapDegrees(target - player.yaw);
    if (Math.abs(difference) > 0.5) {
      const step = (YAW_SPEED * dt) / 1000;
      this.rotateCart(player, clamp(difference, -step, step));
      return true;
    }
    const before = { ...player.position };
    this.moveCart(player, 1, dt / 1000);
    if (before.x === player.position.x && before.z === player.position.z) {
      this.aiCrateGiveUp = this.turnsInRound;
      return false;
    }
    this.aiThinkMs = AI_THINK_DELAY_MS;
    this.status = `${player.label} vai buscar a caixa.`;
    return true;
  }

  rememberAiMiss() {
    if (!this.isAiTurn || !this.aiPlan) {
      return;
    }
    const { stateKey, source } = this.aiPlan;
    const misses = this.aiMissMemory.get(stateKey) ?? [];
    misses.push(source);
    this.aiMissMemory.set(stateKey, misses.slice(-8));
  }

  getSnapshot() {
    return {
      instanceId: this.instanceId,
      mode: this.mode,
      aiDifficulty: this.aiDifficulty,
      phase: this.phase,
      phaseMs: this.phaseMs,
      round: this.round,
      turnIndex: this.turnIndex,
      totalScore: [...this.totalScore],
      playerCount: this.playerCount,
      matchWinner: this.matchWinner,
      status: this.status,
      theme: this.theme,
      modifier: this.modifier,
      mapKind: this.roundMapKind,
      density: this.layout.density,
      seed: this.seed,
      wind: { ...this.wind },
      turnTimeMs: this.turnTimeMs,
      craters: this.craters.map((crater) => ({ ...crater })),
      crates: this.crates.map((crate) => ({ ...crate })),
      impact: this.impact ? { ...this.impact } : null,
      projectiles: this.projectiles.map((projectile) => ({
        id: projectile.id,
        ownerId: projectile.ownerId,
        weapon: projectile.weapon,
        origin: { ...projectile.origin },
        velocity: { ...projectile.velocity },
        wind: { ...projectile.wind },
        gravity: projectile.gravity,
        elapsed: projectile.elapsed,
        position: { ...projectile.position },
      })),
      gravity: this.gravity,
      charge: { active: this.charge.active, power: this.charge.power },
      events: this.events.map((event) => ({ ...event })),
      players: this.players.map((player) => ({
        id: player.id,
        label: player.label,
        color: player.color,
        shade: player.shade,
        position: { ...player.position },
        yaw: player.yaw,
        elevation: player.elevation,
        hp: player.hp,
        fuel: player.fuel,
        lastPower: player.lastPower,
        lastImpact: player.lastImpact ? { ...player.lastImpact } : null,
        feedback: player.feedback,
        lockedTargetId: player.lockedTargetId,
        falling: Boolean(player.fall),
        pushed: Boolean(player.push),
        weapon: player.weapon,
        ammo: { ...player.ammo },
      })),
    };
  }
}
