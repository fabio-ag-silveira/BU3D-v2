// Constantes de gameplay. Coordenadas em "unidades do legado": as mesmas do BU3D em C++/OpenGL
// (x/z no plano da cidade, y para cima, chao em y = 0, predios de 16x16 com 20/30/50 de altura).

export const GRAVITY = 9.81;
export const TIME_SCALE = 2.4;
export const PROJECTILE_SUBSTEP = 0.01;

// Grade de voxels que forma os predios destrutiveis.
export const VOXEL_SIZE = 2;
export const GRID = { originX: -152, originZ: -9, sizeX: 102, sizeY: 26, sizeZ: 90 };

// Limites jogaveis (as antigas paredes do "universo" do legado).
export const ARENA = { minX: -150, maxX: 50, minZ: -7, maxZ: 168 };
export const OUT_OF_BOUNDS_MARGIN = 30;

export const GAME_MODES = {
  local: "local",
  ai: "ai",
};

export const AI_DIFFICULTIES = {
  easy: "easy",
  medium: "medium",
  hard: "hard",
};

export const DEFAULT_GAME_MODE = GAME_MODES.ai;
export const DEFAULT_AI_DIFFICULTY = AI_DIFFICULTIES.medium;
export const AI_THINK_DELAY_MS = 800;
// Todas as dificuldades calculam o tiro certo com a mesma busca; o que muda e o "erro humano":
// desvio (desvio-padrao) no giro, na elevacao e na forca, que diminui a cada erro contra o mesmo
// alvo (learning) ate um minimo (minError), e quanto a IA considera o vento.
export const AI_PLANNER = {
  yawSpan: 14,
  yawStep: 3,
  elevationStep: 5,
  velocityStep: 3,
  simulationStep: 0.06,
};
export const AI_PRESETS = {
  [AI_DIFFICULTIES.easy]: {
    label: "IA fácil",
    aimError: { yaw: 6, elevation: 6, power: 12 },
    learning: 0.76,
    minError: 0.4,
    windKnowledge: 0.35,
    specialChance: 0.25,
  },
  [AI_DIFFICULTIES.medium]: {
    label: "IA média",
    aimError: { yaw: 4.6, elevation: 4.6, power: 9.5 },
    learning: 0.6,
    minError: 0.3,
    windKnowledge: 0.6,
    specialChance: 0.45,
  },
  [AI_DIFFICULTIES.hard]: {
    label: "IA difícil",
    aimError: { yaw: 3.4, elevation: 3.4, power: 7 },
    learning: 0.4,
    minError: 0.1,
    windKnowledge: 0.85,
    specialChance: 0.7,
  },
};

// Armas: o canhao e infinito; as especiais tem municao por rodada.
export const WEAPONS = {
  standard: {
    id: "standard", label: "Canhão", short: "CANHÃO", ammo: null,
    radius: 13, damage: 40, directBonus: 10, crater: 6.5, color: "#fff7e6", size: 0.75,
  },
  cluster: {
    id: "cluster", label: "Fragmentação", short: "FRAG", ammo: 2,
    radius: 10, damage: 20, directBonus: 6, crater: 5, split: 4, color: "#ffb347", size: 0.9,
  },
  bounce: {
    id: "bounce", label: "Quicante", short: "QUIC", ammo: 2,
    radius: 12, damage: 34, directBonus: 10, crater: 6, bounces: 2, color: "#86efac", size: 0.75,
  },
  heavy: {
    id: "heavy", label: "Pesado", short: "PESADO", ammo: 1,
    radius: 20, damage: 55, directBonus: 10, crater: 10.5, color: "#fca5a5", size: 1.15,
  },
  bomblet: {
    id: "bomblet", label: "Fragmento", short: "", ammo: null,
    radius: 8, damage: 16, directBonus: 4, crater: 4, color: "#ffd166", size: 0.5,
  },
};
export const WEAPON_ORDER = ["standard", "cluster", "bounce", "heavy"];

// Condicoes sorteadas a cada rodada (a primeira e sempre normal).
export const ROUND_MODIFIERS = {
  normal: { id: "normal", label: "Normal", weight: 4, description: "" },
  storm: { id: "storm", label: "Tempestade", weight: 1.5, windScale: 2, description: "Vento em dobro e chuva" },
  lowGravity: { id: "lowGravity", label: "Gravidade baixa", weight: 1.5, gravityScale: 0.6, description: "Tiros vão mais longe" },
  fog: { id: "fog", label: "Neblina", weight: 1.5, hideWind: true, aiWindScale: 0.5, description: "Visão curta e vento escondido" },
  arsenal: { id: "arsenal", label: "Arsenal", weight: 1.5, ammoScale: 2, description: "Munição especial em dobro" },
};

// Caixas de suprimento que caem de paraquedas a partir do 3o turno da rodada.
export const CRATES = {
  dropChance: 0.4,
  firstTurn: 3,
  max: 2,
  fallSpeed: 11,
  pickupRadius: 6.5,
  types: {
    hp: { id: "hp", label: "Vida", amount: 30, color: "#4ade80", weight: 1.2 },
    fuel: { id: "fuel", label: "Combustível", amount: 25, color: "#ffd166", weight: 1 },
    ammo: { id: "ammo", label: "Munição", amount: 1, color: "#ffb347", weight: 1 },
  },
};

export const MAX_HP = 100;
export const ROUNDS_TO_WIN = 3;
export const EXPLOSION_RADIUS = 13;
export const EXPLOSION_DAMAGE = 40;
export const DIRECT_HIT_BONUS = 10;
export const CRATER_RADIUS = 6.5;
export const MAX_CRATERS = 400;
export const WIND_MAX = 1.4;
export const POWER_MIN_VELOCITY = 12;
export const POWER_MAX_VELOCITY = 62;
export const CHARGE_SECONDS = 1.3;
export const AIM_SPEED = 32;
export const YAW_SPEED = 70;
export const ELEVATION_LIMITS = { min: -10, max: 85 };
export const MOVE_SPEED = 14;
export const FUEL_PER_TURN = 30;
export const TURN_TIME_MS = 25000;
export const CART_GRAVITY = 70;
export const SAFE_FALL = 8;
// Empurrao: distancia maxima (no centro da explosao) = raio da arma * KNOCKBACK_SCALE.
export const KNOCKBACK_SCALE = 0.9;
export const KNOCKBACK_SECONDS = 0.45;
export const PHASE_DELAYS = {
  roundStart: 1800,
  settle: 900,
  timeout: 400,
  roundOver: 6000,
  matchOver: 11000,
};

// Geometria do carrinho (tanque). A posicao do jogador e o centro da base, no chao.
export const TANK = {
  halfWidth: 4.5,
  halfLength: 6,
  height: 5.5,
  pivotHeight: 4.6,
  barrelLength: 7,
  supportInset: { x: 3, z: 4.5 },
};

export const BUILDING_TYPES = {
  small: { height: 20 },  // desenha_predio_menor
  medium: { height: 30 }, // desenha_predio_maior
  tall: { height: 50 },   // desenha_predio_alto
};
export const BUILDING_HALF = 8;

// Mesma planta de desenha_cidade() do legado (posicoes ja multiplicadas por 1.5).
export const CITY_LAYOUT = [
  { type: "small", x: 0, z: 45 },
  { type: "medium", x: 0, z: 75 },
  { type: "small", x: 0, z: 105 },
  { type: "medium", x: 0, z: 135 },
  { type: "medium", x: 30, z: 45 },
  { type: "tall", x: 30, z: 75 },
  { type: "medium", x: 30, z: 105 },
  { type: "medium", x: 30, z: 135 },
  { type: "medium", x: -30, z: 15 },
  { type: "medium", x: -30, z: 45 },
  { type: "small", x: -30, z: 75 },
  { type: "medium", x: -30, z: 105 },
  { type: "small", x: -30, z: 135 },
  { type: "small", x: -60, z: 135 },
  { type: "medium", x: -60, z: 45 },
  { type: "small", x: -60, z: 75 },
  { type: "medium", x: -120, z: 15 },
  { type: "medium", x: -120, z: 45 },
  { type: "small", x: -120, z: 75 },
  { type: "small", x: -120, z: 105 },
  { type: "tall", x: -120, z: 135 },
];

// Spawns do legado (spawn_carrinho_1/2) mais algumas posicoes de rua para variar.
export const PLAYER_DEFAULTS = [
  {
    id: 1,
    label: "Player 1",
    color: "#00c8d7",
    shade: "#0d6f78",
    spawns: [
      { x: -30, y: 20, z: 75 },
      { x: -60, y: 20, z: 75 },
      { x: -120, y: 20, z: 105 },
      { x: -60, y: 20, z: 135 },
      { x: -90, y: 0, z: 30 },
    ],
  },
  {
    id: 2,
    label: "Player 2",
    color: "#ff4a4a",
    shade: "#8c2424",
    spawns: [
      { x: 0, y: 20, z: 45 },
      { x: 0, y: 20, z: 105 },
      { x: -120, y: 30, z: 15 },
      { x: 30, y: 30, z: 135 },
      { x: 15, y: 0, z: 160 },
    ],
  },
  {
    id: 3,
    label: "Player 3",
    color: "#4ade80",
    shade: "#167a3c",
    spawns: [],
  },
  {
    id: 4,
    label: "Player 4",
    color: "#fbbf24",
    shade: "#9a6b0b",
    spawns: [],
  },
];
export const PLAYER_COUNTS = [2, 3, 4];
export const MIN_SPAWN_DISTANCE = 55;

// Os tres fundos do legado (verde, roxo e amarelo) viraram temas completos.
export const SKY_THEMES = {
  day: {
    id: "day",
    label: "Dia",
    sky: ["#2f7fc8", "#8cc6e6", "#e4f1f2"],
    fog: "#b9d6e3",
    fogDensity: 0.0032,
    sun: { color: "#fff4d6", intensity: 2.6, position: [-120, 160, -60] },
    ambient: { sky: "#cfe8ff", ground: "#5b5348", intensity: 1.1 },
    body: { kind: "sun", color: "#fff6cf" },
    cloud: "#ffffff",
    cloudOpacity: 0.85,
    distant: "#7d9db0",
    buildings: { small: "#8b8f96", medium: "#6b7079", tall: "#4a4f58" },
    roof: "#5c6068",
    windowLit: "#ffe58a",
    windowDark: "#9fb6c6",
    litChance: 0.12,
    street: "#3b3d42",
    sidewalk: "#9a9ca2",
    lane: "#e9e4cf",
    stars: false,
    exposure: 1.0,
  },
  dusk: {
    id: "dusk",
    label: "Entardecer",
    sky: ["#2d2457", "#b4587a", "#f6ad6c"],
    fog: "#c67f78",
    fogDensity: 0.0042,
    sun: { color: "#ffb37a", intensity: 2.1, position: [-160, 45, 120] },
    ambient: { sky: "#f0a0a8", ground: "#3a2c40", intensity: 1.25 },
    body: { kind: "sun", color: "#ffcf86" },
    cloud: "#ffc0a8",
    cloudOpacity: 0.7,
    distant: "#6e4a6c",
    buildings: { small: "#6e6470", medium: "#575061", tall: "#3d3646" },
    roof: "#4a4352",
    windowLit: "#ffd36b",
    windowDark: "#3a3242",
    litChance: 0.45,
    street: "#2b2830",
    sidewalk: "#7a6f7e",
    lane: "#e8c9a0",
    stars: false,
    exposure: 1.0,
  },
  night: {
    id: "night",
    label: "Noite",
    sky: ["#04071a", "#0f1a3d", "#26365f"],
    fog: "#111a33",
    fogDensity: 0.0048,
    sun: { color: "#a9b8ff", intensity: 1.4, position: [100, 140, 160] },
    ambient: { sky: "#5a6cb0", ground: "#1c1826", intensity: 1.7 },
    body: { kind: "moon", color: "#f2efdc" },
    cloud: "#6a76a8",
    cloudOpacity: 0.35,
    distant: "#1a2442",
    buildings: { small: "#4c5574", medium: "#3e4662", tall: "#30364c" },
    roof: "#343a50",
    windowLit: "#ffd977",
    windowDark: "#161a28",
    litChance: 0.6,
    street: "#1d2029",
    sidewalk: "#454c63",
    lane: "#8a8f9e",
    stars: true,
    exposure: 1.15,
  },
};
