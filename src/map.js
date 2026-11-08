import { BUILDING_HALF, BUILDING_TYPES, CITY_LAYOUT, GRID, PLAYER_DEFAULTS, VOXEL_SIZE } from "./config.js";
import { createRng } from "./math.js";

const { originX, originZ, sizeX, sizeY, sizeZ } = GRID;
const CELL_COUNT = sizeX * sizeY * sizeZ;

// Materiais que nao sao predios (predios usam ids 1..200).
export const MATERIALS = {
  wood: 248,
  leaves: 249,
  earth: 250,
  rock: 251,
  grass: 252,
  concrete: 253,
  bridge: 254,
};

export const MAP_KINDS = {
  dynamic: { id: "dynamic", label: "Dinâmico" },
  classic: { id: "classic", label: "Clássico" },
};

// Malha de quarteiroes do legado: colunas e linhas espacadas de 30.
const COLUMNS = [-120, -90, -60, -30, 0, 30];
const ROWS = [15, 45, 75, 105, 135];
const LANES_X_DYNAMIC = [-135, -105, -75, -45, -15, 15];
const LANES_Z = [0, 30, 60, 90, 120, 152];
const LANES_X_CLASSIC = [-90, -45, -15, 15];

// Mais lotes vazios (viram pracas): a cidade cheia demais escondia o adversario.
const DENSITIES = [
  { id: "sparse", label: "espaçada", empty: 0.4, weight: 1 },
  { id: "normal", label: "normal", empty: 0.3, weight: 2 },
  { id: "dense", label: "densa", empty: 0.18, weight: 1 },
];

export function cellIndex(ix, iy, iz) {
  return (iy * sizeZ + iz) * sizeX + ix;
}

function inside(ix, iy, iz) {
  return ix >= 0 && iy >= 0 && iz >= 0 && ix < sizeX && iy < sizeY && iz < sizeZ;
}

function toCellX(x) {
  return Math.round((x - originX) / VOXEL_SIZE);
}

function toCellZ(z) {
  return Math.round((z - originZ) / VOXEL_SIZE);
}

function typeForLayers(layers) {
  return layers < 12 ? "small" : layers < 17 ? "medium" : "tall";
}

function addBuilding(layout, { x, z, halfX, halfZ, layers, type }) {
  const id = layout.buildings.length + 1;
  const building = {
    id,
    type: type ?? typeForLayers(layers),
    x,
    z,
    minIx: toCellX(x) - halfX,
    maxIx: toCellX(x) + halfX - 1,
    minIz: toCellZ(z) - halfZ,
    maxIz: toCellZ(z) + halfZ - 1,
    layers,
    height: layers * VOXEL_SIZE,
  };
  layout.buildings.push(building);
  for (let iy = 0; iy < layers; iy += 1) {
    for (let iz = building.minIz; iz <= building.maxIz; iz += 1) {
      for (let ix = building.minIx; ix <= building.maxIx; ix += 1) {
        if (inside(ix, iy, iz)) {
          layout.cells[cellIndex(ix, iy, iz)] = id;
        }
      }
    }
  }
  return building;
}

function columnTop(layout, ix, iz) {
  for (let iy = sizeY - 1; iy >= 0; iy -= 1) {
    if (layout.cells[cellIndex(ix, iy, iz)]) {
      return iy;
    }
  }
  return -1;
}

function createLayout(kind, seed) {
  return {
    kind,
    seed,
    cells: new Uint8Array(CELL_COUNT),
    buildings: [],
    islands: [],
    parks: [],
    bridges: [],
    parkAreas: [],
    style: "city",
    anchors: [],
    spawns: [],
    lanesX: kind === "classic" ? LANES_X_CLASSIC : LANES_X_DYNAMIC,
    lanesZ: LANES_Z,
    density: null,
  };
}

// Mapa original do BU3D (desenha_cidade + spawn_carrinho_1/2).
function generateClassic() {
  const layout = createLayout("classic", 0);
  CITY_LAYOUT.forEach((entry) => {
    addBuilding(layout, {
      x: entry.x,
      z: entry.z,
      halfX: BUILDING_HALF / VOXEL_SIZE,
      halfZ: BUILDING_HALF / VOXEL_SIZE,
      layers: Math.round(BUILDING_TYPES[entry.type].height / VOXEL_SIZE),
      type: entry.type,
    });
  });
  layout.playerSpawns = PLAYER_DEFAULTS.map((template) => template.spawns.map((spawn) => ({ ...spawn, kind: "classic" })));
  return layout;
}

function addMound(layout, rng, x, z) {
  const radius = 8 + rng() * 4;
  const peak = 1 + Math.floor(rng() * 3);
  const cx = x + (rng() * 2 - 1) * 3;
  const cz = z + (rng() * 2 - 1) * 3;
  const reach = Math.ceil(radius / VOXEL_SIZE) + 1;
  for (let iz = toCellZ(cz) - reach; iz <= toCellZ(cz) + reach; iz += 1) {
    for (let ix = toCellX(cx) - reach; ix <= toCellX(cx) + reach; ix += 1) {
      const px = originX + (ix + 0.5) * VOXEL_SIZE;
      const pz = originZ + (iz + 0.5) * VOXEL_SIZE;
      const distance = Math.hypot(px - cx, pz - cz) / radius;
      if (distance > 1) {
        continue;
      }
      const height = Math.ceil(peak * (1 - distance * distance) - 0.15);
      for (let iy = 0; iy < height; iy += 1) {
        if (inside(ix, iy, iz) && !layout.cells[cellIndex(ix, iy, iz)]) {
          layout.cells[cellIndex(ix, iy, iz)] = iy === height - 1 ? MATERIALS.grass : MATERIALS.earth;
        }
      }
    }
  }
  layout.parks.push({ x, z, radius: radius + 3, peak });
}

// Passarela entre dois predios vizinhos de altura parecida, rente ao telhado mais baixo.
function addBridge(layout, a, b, axis) {
  const deckWidth = 6;
  const along = axis === "x" ? ["minIx", "maxIx"] : ["minIz", "maxIz"];
  const across = axis === "x" ? ["minIz", "maxIz"] : ["minIx", "maxIx"];
  const [first, second] = a[along[0]] < b[along[0]] ? [a, b] : [b, a];
  const start = first[along[1]] + 1;
  const end = second[along[0]] - 1;
  const overlapMin = Math.max(a[across[0]], b[across[0]]);
  const overlapMax = Math.min(a[across[1]], b[across[1]]);
  if (end < start || overlapMax - overlapMin + 1 < deckWidth) {
    return false;
  }
  const middle = Math.floor((overlapMin + overlapMax + 1) / 2);
  const deckMin = middle - deckWidth / 2;
  const deckMax = deckMin + deckWidth - 1;
  const deckY = Math.min(a.layers, b.layers) - 1;
  for (let step = start; step <= end; step += 1) {
    for (let side = deckMin - 1; side <= deckMax + 1; side += 1) {
      const rail = side < deckMin || side > deckMax;
      const ix = axis === "x" ? step : side;
      const iz = axis === "x" ? side : step;
      const levels = rail ? [deckY, deckY + 1] : [deckY];
      levels.forEach((iy) => {
        if (inside(ix, iy, iz) && !layout.cells[cellIndex(ix, iy, iz)]) {
          layout.cells[cellIndex(ix, iy, iz)] = MATERIALS.bridge;
        }
      });
    }
  }
  const mid = (start + end + 1) / 2;
  const cross = (deckMin + deckMax + 1) / 2;
  const x = originX + (axis === "x" ? mid : cross) * VOXEL_SIZE;
  const z = originZ + (axis === "x" ? cross : mid) * VOXEL_SIZE;
  layout.bridges.push({ x, z, y: (deckY + 1) * VOXEL_SIZE, axis });
  layout.spawns.push({ x, y: (deckY + 1) * VOXEL_SIZE, z, kind: "bridge" });
  return true;
}

function addBridges(layout, rng, lattice) {
  const pairs = [];
  lattice.forEach((column, ci) => {
    column.forEach((building, ri) => {
      const right = lattice[ci + 1]?.[ri];
      const down = column[ri + 1];
      [[right, "x"], [down, "z"]].forEach(([other, axis]) => {
        if (building && other && building.layers >= 8 && Math.abs(building.layers - other.layers) <= 1) {
          pairs.push([building, other, axis]);
        }
      });
    });
  });
  const wanted = 1 + Math.floor(rng() * 3);
  while (pairs.length && layout.bridges.length < wanted) {
    const [a, b, axis] = pairs.splice(Math.floor(rng() * pairs.length), 1)[0];
    addBridge(layout, a, b, axis);
  }
}

function addIsland(layout, rng) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const radius = 6 + Math.floor(rng() * 3);
    const top = 15 + Math.floor(rng() * 7);
    const depth = 3 + Math.floor(rng() * 3);
    const cx = toCellX(-135 + rng() * 170);
    const cz = toCellZ(8 + rng() * 145);
    if (cx - radius < 2 || cx + radius > sizeX - 3 || cz - radius < 2 || cz + radius > sizeZ - 3) {
      continue;
    }
    const far = layout.islands.every((island) => Math.hypot(island.cx - cx, island.cz - cz) > island.radius + radius + 5);
    if (!far) {
      continue;
    }
    // Precisa de folga sobre o que estiver embaixo (predios, morros).
    let clear = true;
    for (let iz = cz - radius; iz <= cz + radius && clear; iz += 1) {
      for (let ix = cx - radius; ix <= cx + radius && clear; ix += 1) {
        if (Math.hypot(ix - cx, iz - cz) <= radius + 1 && columnTop(layout, ix, iz) > top - depth - 4) {
          clear = false;
        }
      }
    }
    if (!clear) {
      continue;
    }

    const island = { cx, cz, radius, top, x: originX + (cx + 0.5) * VOXEL_SIZE, z: originZ + (cz + 0.5) * VOXEL_SIZE };
    for (let iz = cz - radius - 1; iz <= cz + radius + 1; iz += 1) {
      for (let ix = cx - radius - 1; ix <= cx + radius + 1; ix += 1) {
        const distance = Math.hypot(ix - cx, iz - cz) / (radius + (rng() - 0.5) * 0.8);
        if (distance > 1) {
          continue;
        }
        const thickness = Math.max(1, Math.round(depth * (1 - distance * distance) + rng() * 0.8)) + 1;
        for (let layer = 0; layer < thickness; layer += 1) {
          const iy = top - layer;
          layout.cells[cellIndex(ix, iy, iz)] = layer === 0 ? MATERIALS.grass : MATERIALS.rock;
        }
      }
    }
    // Casinha de concreto num canto da ilha (cobertura e alvo destrutivel).
    if (rng() < 0.6) {
      const angle = rng() * Math.PI * 2;
      const hx = Math.round(cx + Math.cos(angle) * (radius - 2.5));
      const hz = Math.round(cz + Math.sin(angle) * (radius - 2.5));
      for (let iy = top + 1; iy <= top + 2; iy += 1) {
        for (let iz = hz - 1; iz <= hz; iz += 1) {
          for (let ix = hx - 1; ix <= hx; ix += 1) {
            if (inside(ix, iy, iz)) {
              layout.cells[cellIndex(ix, iy, iz)] = MATERIALS.concrete;
            }
          }
        }
      }
    }
    // Nucleo da ilha: o que a mantem no ar. Se for destruido, a ilha cai.
    for (let iz = cz - 1; iz <= cz + 1; iz += 1) {
      for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
        for (let iy = top - 2; iy <= top; iy += 1) {
          if (layout.cells[cellIndex(ix, iy, iz)]) {
            layout.anchors.push(cellIndex(ix, iy, iz));
          }
        }
      }
    }
    layout.islands.push(island);
    layout.spawns.push({ x: island.x, y: (top + 1) * VOXEL_SIZE, z: island.z, kind: "island" });
    return island;
  }
  return null;
}

// Arvore de voxel: tronco de 2-3 camadas e copa 3x3 (destrutivel; a copa cai se o tronco for cortado).
function addTree(layout, rng, x, z) {
  const ix = toCellX(x);
  const iz = toCellZ(z);
  let base = 0;
  while (base < sizeY - 6 && layout.cells[cellIndex(ix, base, iz)]) {
    base += 1;
  }
  const trunk = 2 + Math.floor(rng() * 2);
  for (let iy = base; iy < base + trunk; iy += 1) {
    layout.cells[cellIndex(ix, iy, iz)] = MATERIALS.wood;
  }
  const crownBase = base + trunk;
  for (let iy = crownBase; iy < crownBase + 2; iy += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const corner = Math.abs(dx) + Math.abs(dz) === 2;
        if (corner && (iy === crownBase + 1 || rng() < 0.5)) {
          continue;
        }
        if (inside(ix + dx, iy, iz + dz) && !layout.cells[cellIndex(ix + dx, iy, iz + dz)]) {
          layout.cells[cellIndex(ix + dx, iy, iz + dz)] = MATERIALS.leaves;
        }
      }
    }
  }
}

// Fase "Parque": um bloco de 2x2 quarteiroes perto do centro vira gramado aberto,
// com morrinhos e arvores baixas; os predios ficam em volta.
function planPark(rng) {
  const column = 1 + Math.floor(rng() * 3);
  const row = 1 + Math.floor(rng() * 2);
  return { columns: [column, column + 1], rows: [row, row + 1] };
}

function fillPark(layout, rng, park) {
  const minX = COLUMNS[park.columns[0]] - 11;
  const maxX = COLUMNS[park.columns[1]] + 11;
  const minZ = ROWS[park.rows[0]] - 11;
  const maxZ = ROWS[park.rows[1]] + 11;
  layout.parkAreas.push({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX + 6, d: maxZ - minZ + 6 });
  const mounds = 2 + Math.floor(rng() * 2);
  for (let index = 0; index < mounds; index += 1) {
    addMound(layout, rng, minX + 8 + rng() * (maxX - minX - 16), minZ + 8 + rng() * (maxZ - minZ - 16));
  }
  const trees = 7 + Math.floor(rng() * 5);
  const placed = [];
  for (let attempt = 0; attempt < 60 && placed.length < trees; attempt += 1) {
    const x = minX + 3 + rng() * (maxX - minX - 6);
    const z = minZ + 3 + rng() * (maxZ - minZ - 6);
    if (placed.some((tree) => Math.hypot(tree.x - x, tree.z - z) < 9)) {
      continue;
    }
    placed.push({ x, z });
    addTree(layout, rng, x, z);
  }
  // Pontos de nascimento no gramado aberto (longe das arvores).
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const x = minX + 8 + rng() * (maxX - minX - 16);
    const z = minZ + 8 + rng() * (maxZ - minZ - 16);
    if (placed.every((tree) => Math.hypot(tree.x - x, tree.z - z) > 9)) {
      layout.spawns.push({ x, y: 0, z, kind: "park" });
    }
  }
}

// Cidade nova a cada rodada: mesma malha de ruas, prédios e terrenos sorteados.
function generateDynamic(seed) {
  const rng = createRng(seed);
  const layout = createLayout("dynamic", seed);
  let roll = rng() * DENSITIES.reduce((sum, entry) => sum + entry.weight, 0);
  const density = DENSITIES.find((entry) => (roll -= entry.weight) <= 0) ?? DENSITIES[1];
  layout.density = density.label;
  const park = rng() < 0.25 ? planPark(rng) : null;
  layout.style = park ? "park" : "city";

  const empties = [];
  const lattice = COLUMNS.map(() => ROWS.map(() => null));
  COLUMNS.forEach((x, column) => {
    ROWS.forEach((z, row) => {
      if (park && park.columns.includes(column) && park.rows.includes(row)) {
        return;
      }
      if (rng() < density.empty) {
        empties.push({ x, z });
        return;
      }
      // Torres altas sao raras (8%) e um pouco mais baixas: sao elas que mais tapam a visao.
      const sizeRoll = rng();
      const layers = sizeRoll < 0.55 ? 8 + Math.floor(rng() * 4)
        : sizeRoll < 0.92 ? 12 + Math.floor(rng() * 5)
          : 17 + Math.floor(rng() * 4);
      const building = addBuilding(layout, {
        x: x + (rng() < 0.5 ? 0 : (rng() < 0.5 ? -2 : 2)),
        z: z + (rng() < 0.5 ? 0 : (rng() < 0.5 ? -2 : 2)),
        halfX: 3 + Math.floor(rng() * 3),
        halfZ: 3 + Math.floor(rng() * 3),
        layers,
      });
      lattice[column][row] = building;
      const halfX = (building.maxIx - building.minIx + 1) / 2;
      const halfZ = (building.maxIz - building.minIz + 1) / 2;
      if (Math.min(halfX, halfZ) >= 4 || rng() < 0.5) {
        layout.spawns.push({ x: building.x, y: building.height, z: building.z, kind: "roof" });
      }
    });
  });

  // Terrenos vazios viram pracas com morros (relevo).
  empties.forEach((slot) => {
    if (rng() < 0.75) {
      addMound(layout, rng, slot.x, slot.z);
    }
  });

  if (park) {
    fillPark(layout, rng, park);
  }
  addBridges(layout, rng, lattice);

  const islandCount = 2 + Math.floor(rng() * 3);
  for (let index = 0; index < islandCount; index += 1) {
    addIsland(layout, rng);
  }

  // Pontos de rua (no meio das avenidas).
  LANES_X_DYNAMIC.forEach((x) => {
    LANES_Z.forEach((z) => {
      layout.spawns.push({ x, y: 0, z, kind: "street" });
    });
  });
  return layout;
}

const cache = new Map();

export function getLayout(kind, seed) {
  const key = kind === "classic" ? "classic" : `dynamic:${seed}`;
  if (!cache.has(key)) {
    if (cache.size > 6) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, kind === "classic" ? generateClassic() : generateDynamic(seed));
  }
  return cache.get(key);
}
