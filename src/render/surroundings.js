import * as THREE from "three";
import { ARENA } from "../config.js";
import { createRng } from "../math.js";
import { ARENA_CENTER } from "./sky.js";

// Cenario em volta da arena (so visual, sem colisao): baia ao norte, orla e bairros.
export const SHORE_Z = 224;
export const WATER_LEVEL = -0.9;

export function isWater(x, z) {
  return z > SHORE_Z;
}

const GRID = 30;
const ROAD = 10;
const SUBURB_RADIUS = 330;
const PROMENADE_Z = 201;
const RING = { minX: ARENA.minX - 18, maxX: ARENA.maxX + 18, minZ: ARENA.minZ - 18, maxZ: ARENA.maxZ + 18 };

const WALLS = ["#e8d8c3", "#d9c7a7", "#c9d6df", "#e3c4b8", "#bfc9b5", "#f0e2c8", "#d4d0c8"];
const ROOFS = ["#a4553c", "#8a4b3a", "#5f6b78", "#7a5c45", "#b0643f", "#6b4a3a"];
const CROWNS = ["#4f7d3a", "#5c8a3f", "#3f6b33", "#6b8f45", "#7a9a4a"];

const THEME_TINT = {
  day: { grass: "#6f9a4a", park: "#7aa653", water: "#2b6f9e", deep: "#1c4f78", sand: "#d9c9a0", light: 1, lamps: false, glow: 0 },
  dusk: { grass: "#6e7a4c", park: "#7a8452", water: "#5a5a86", deep: "#3a3a66", sand: "#c9a98a", light: 0.82, lamps: true, glow: 0.7 },
  night: { grass: "#24331f", park: "#2b3d24", water: "#0f2238", deep: "#0a1626", sand: "#4a4a52", light: 0.42, lamps: true, glow: 1 },
};

function insideRect(x, z, rect, margin = 0) {
  return x > rect.minX - margin && x < rect.maxX + margin && z > rect.minZ - margin && z < rect.maxZ + margin;
}

// Normal map de ondas (soma de senos com frequencias inteiras: o padrao repete sem emenda).
function waveNormalTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const image = context.createImageData(size, size);
  const waves = [[1, 2, 0.3], [3, -1, 1.7], [-2, 3, 2.9], [5, 2, 0.8], [-4, -5, 4.1], [7, -3, 5.3]];
  const height = (x, y) => waves.reduce((sum, [kx, ky, phase], index) =>
    sum + Math.sin(((kx * x + ky * y) / size) * Math.PI * 2 + phase) / (1 + index * 0.6), 0);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = height(x + 1, y) - height(x - 1, y);
      const dy = height(x, y + 1) - height(x, y - 1);
      const normal = new THREE.Vector3(-dx * 3, -dy * 3, 1).normalize();
      const offset = (y * size + x) * 4;
      image.data[offset] = (normal.x * 0.5 + 0.5) * 255;
      image.data[offset + 1] = (normal.y * 0.5 + 0.5) * 255;
      image.data[offset + 2] = (normal.z * 0.5 + 0.5) * 255;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Fachada com janelas: "wall" (parede clara, janelas escuras) e "lit" (so as janelas acesas, para a noite).
function windowTextures() {
  const make = (draw) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    draw(canvas.getContext("2d"));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const rng = createRng(5);
  const windows = [];
  for (let y = 4; y < 64; y += 10) {
    for (let x = 4; x < 64; x += 12) {
      windows.push({ x, y, lit: rng() < 0.55 });
    }
  }
  return {
    wall: make((context) => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = "#3a404c";
      windows.forEach((w) => context.fillRect(w.x, w.y, 6, 5));
    }),
    lit: make((context) => {
      context.fillStyle = "#000000";
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = "#ffd977";
      windows.filter((w) => w.lit).forEach((w) => context.fillRect(w.x, w.y, 6, 5));
    }),
  };
}

// Caixa de predio com janelas so nas fachadas: o topo e a base apontam para um canto liso
// da textura (sem janela), para o telhado nao ficar com janelas.
function facadeBoxGeometry() {
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const uv = geometry.getAttribute("uv");
  const plain = [2 / 64, 62 / 64];
  // Ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices cada).
  for (let vertex = 8; vertex < 16; vertex += 1) {
    uv.setXY(vertex, plain[0], plain[1]);
  }
  uv.needsUpdate = true;
  return geometry;
}

// Telhado de duas aguas: base 1x1 em y=0 e cumeeira em y=1 ao longo de x.
function gableGeometry() {
  const a = [-0.5, 0, -0.5];
  const b = [0.5, 0, -0.5];
  const c = [0.5, 0, 0.5];
  const d = [-0.5, 0, 0.5];
  const e = [-0.5, 1, 0];
  const f = [0.5, 1, 0];
  const triangles = [a, e, f, a, f, b, d, c, f, d, f, e, a, d, e, b, f, c];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(triangles.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

class InstanceBatch {
  constructor(geometry, material, capacity) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.items = [];
    this.capacity = capacity;
  }

  add(position, scale, color, rotation = 0) {
    if (this.items.length < this.capacity) {
      this.items.push({ position, scale, color: new THREE.Color(color), rotation });
    }
  }

  // Grava as instancias com a cor base multiplicada pelo brilho do tema.
  commit(light = 1) {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    this.items.forEach((item, index) => {
      quaternion.setFromAxisAngle(axis, item.rotation);
      matrix.compose(item.position, quaternion, item.scale);
      this.mesh.setMatrixAt(index, matrix);
      this.mesh.setColorAt(index, color.copy(item.color).multiplyScalar(light));
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Surroundings {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rng = createRng(31);
    this.time = 0;
    this.boats = [];
    this.build();
  }

  build() {
    const rng = this.rng;
    const v = (x, y, z) => new THREE.Vector3(x, y, z);

    // Terra firme ate a orla e o mar daqui ate o horizonte.
    this.landMaterial = new THREE.MeshStandardMaterial({ roughness: 1 });
    const landDepth = SHORE_Z + 900;
    const land = new THREE.Mesh(new THREE.PlaneGeometry(2000, landDepth).rotateX(-Math.PI / 2), this.landMaterial);
    land.position.set(ARENA_CENTER.x, -0.6, SHORE_Z - landDepth / 2);
    land.receiveShadow = true;
    this.group.add(land);

    this.waterTexture = waveNormalTexture();
    this.waterTexture.repeat.set(70, 35);
    this.waterMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.16,
      metalness: 0.1,
      normalMap: this.waterTexture,
      normalScale: new THREE.Vector2(0.55, 0.55),
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2000, 1100).rotateX(-Math.PI / 2), this.waterMaterial);
    water.position.set(ARENA_CENTER.x, WATER_LEVEL, SHORE_Z + 550);
    this.group.add(water);

    // Cais de concreto na beira d'agua e a outra margem da baia.
    this.concreteMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const seawall = new THREE.Mesh(new THREE.BoxGeometry(2000, 3.4, 4), this.concreteMaterial);
    seawall.position.set(ARENA_CENTER.x, -1.3, SHORE_Z);
    this.group.add(seawall);
    this.farShoreMaterial = new THREE.MeshStandardMaterial({ roughness: 1 });
    const farShore = new THREE.Mesh(new THREE.BoxGeometry(2000, 4, 260), this.farShoreMaterial);
    farShore.position.set(ARENA_CENTER.x, -0.5, 700);
    this.group.add(farShore);

    // Ruas: anel em volta da arena, continuacao da malha da cidade e a avenida da orla.
    this.asphaltMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    this.laneMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 });
    const roads = new InstanceBatch(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.asphaltMaterial, 400);
    const dashes = new InstanceBatch(new THREE.PlaneGeometry(0.45, 3.4).rotateX(-Math.PI / 2), this.laneMaterial, 9000);
    const road = (x1, z1, x2, z2, width = ROAD) => {
      const horizontal = Math.abs(x2 - x1) > Math.abs(z2 - z1);
      const length = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
      roads.add(v((x1 + x2) / 2, -0.55, (z1 + z2) / 2), horizontal ? v(length, 1, width) : v(width, 1, length), "#ffffff");
      for (let t = 4; t < length - 2; t += 8) {
        const x = horizontal ? Math.min(x1, x2) + t : x1;
        const z = horizontal ? z1 : Math.min(z1, z2) + t;
        dashes.add(v(x, -0.52, z), v(1, 1, 1), "#ffffff", horizontal ? Math.PI / 2 : 0);
      }
    };
    road(RING.minX, RING.minZ + 7, RING.maxX, RING.minZ + 7, 14);
    road(RING.minX, RING.maxZ - 7, RING.maxX, RING.maxZ - 7, 14);
    road(RING.minX + 7, RING.minZ, RING.minX + 7, RING.maxZ, 14);
    road(RING.maxX - 7, RING.minZ, RING.maxX - 7, RING.maxZ, 14);
    road(-900, PROMENADE_Z, 800, PROMENADE_Z, 14);
    const minX = ARENA_CENTER.x - SUBURB_RADIUS;
    const maxX = ARENA_CENTER.x + SUBURB_RADIUS;
    const minZ = ARENA_CENTER.z - SUBURB_RADIUS;
    for (let x = -135 - GRID * 8; x <= maxX; x += GRID) {
      if (x < minX) {
        continue;
      }
      const inside = x > RING.minX && x < RING.maxX;
      if (inside) {
        road(x, minZ, x, RING.minZ);
        road(x, RING.maxZ, x, PROMENADE_Z);
      } else {
        road(x, minZ, x, PROMENADE_Z);
      }
    }
    for (let z = 0 - GRID * 8; z <= 150; z += GRID) {
      if (z < minZ) {
        continue;
      }
      const inside = z > RING.minZ && z < RING.maxZ;
      if (inside) {
        road(minX, z, RING.minX, z);
        road(RING.maxX, z, maxX, z);
      } else {
        road(minX, z, maxX, z);
      }
    }
    this.roads = roads;
    this.dashes = dashes;
    this.group.add(roads.mesh, dashes.mesh);

    // Lotes entre as ruas: casinhas, predios baixos ou pracas arborizadas.
    this.houseMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.roofMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });
    const facade = windowTextures();
    this.towerMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      map: facade.wall,
      emissiveMap: facade.lit,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0,
    });
    this.trunkMaterial = new THREE.MeshStandardMaterial({ roughness: 1 });
    this.crownMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    this.parkMaterial = new THREE.MeshStandardMaterial({ roughness: 1 });
    const houses = new InstanceBatch(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.houseMaterial, 1400);
    const roofs = new InstanceBatch(gableGeometry(), this.roofMaterial, 1400);
    const towers = new InstanceBatch(facadeBoxGeometry(), this.towerMaterial, 160);
    const trunks = new InstanceBatch(new THREE.CylinderGeometry(0.35, 0.45, 1, 6).translate(0, 0.5, 0), this.trunkMaterial, 1600);
    const crowns = new InstanceBatch(new THREE.IcosahedronGeometry(1, 0), this.crownMaterial, 1600);
    const parks = new InstanceBatch(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.parkMaterial, 300);

    const tree = (x, z, size = 1) => {
      const height = (2.6 + rng() * 1.8) * size;
      trunks.add(v(x, -0.6, z), v(size, height, size), "#6b4b32");
      const radius = (2 + rng() * 1.3) * size;
      crowns.add(v(x, -0.6 + height + radius * 0.6, z), v(radius, radius * (0.9 + rng() * 0.4), radius), CROWNS[Math.floor(rng() * CROWNS.length)], rng() * 3);
    };

    const lot = GRID - ROAD;
    for (let x = -135 - GRID * 8; x < maxX; x += GRID) {
      for (let z = 0 - GRID * 8; z < 150; z += GRID) {
        const cx = x + GRID / 2;
        const cz = z + GRID / 2;
        if (insideRect(cx, cz, RING, 8) || cz > PROMENADE_Z - 12) {
          continue;
        }
        const distance = Math.hypot(cx - ARENA_CENTER.x, cz - ARENA_CENTER.z);
        if (distance > SUBURB_RADIUS) {
          continue;
        }
        const roll = rng();
        if (roll < 0.17 || (distance > 280 && roll < 0.45)) {
          parks.add(v(cx, -0.57, cz), v(lot, 1, lot), "#ffffff");
          const count = 3 + Math.floor(rng() * 4);
          for (let index = 0; index < count; index += 1) {
            tree(cx + (rng() - 0.5) * (lot - 5), cz + (rng() - 0.5) * (lot - 5), 0.9 + rng() * 0.5);
          }
          continue;
        }
        if (roll < 0.29 && distance < 300) {
          const width = 10 + rng() * 6;
          const depth = 10 + rng() * 6;
          const height = 14 + rng() * 22;
          towers.add(v(cx, -0.6, cz), v(width, height, depth), WALLS[Math.floor(rng() * WALLS.length)]);
          continue;
        }
        // 2 a 4 casinhas por lote, viradas para a rua mais proxima.
        const slots = [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]].sort(() => rng() - 0.5);
        const count = 2 + Math.floor(rng() * 3);
        slots.slice(0, count).forEach(([ox, oz]) => {
          const width = 5.5 + rng() * 2.5;
          const depth = 5.5 + rng() * 2.5;
          const height = 3.5 + rng() * (rng() < 0.3 ? 4 : 1.5);
          const rotation = rng() < 0.5 ? 0 : Math.PI / 2;
          const hx = cx + ox + (rng() - 0.5);
          const hz = cz + oz + (rng() - 0.5);
          houses.add(v(hx, -0.6, hz), v(width, height, depth), WALLS[Math.floor(rng() * WALLS.length)], rotation);
          roofs.add(v(hx, -0.6 + height, hz), v(width + 0.6, 2 + rng() * 1.2, depth + 0.6), ROOFS[Math.floor(rng() * ROOFS.length)], rotation);
        });
        if (count < 4 && rng() < 0.7) {
          tree(cx + slots[3][0], cz + slots[3][1], 0.8);
        }
      }
    }

    // Orla: arvores e postes no calcadao entre a avenida e o mar.
    this.lampPoleMaterial = new THREE.MeshStandardMaterial({ color: "#3a3f48", roughness: 0.6, metalness: 0.4 });
    this.lampHeadMaterial = new THREE.MeshBasicMaterial({ color: "#fff1c4", toneMapped: false });
    const poles = new InstanceBatch(new THREE.CylinderGeometry(0.18, 0.24, 1, 6).translate(0, 0.5, 0), this.lampPoleMaterial, 400);
    const heads = new InstanceBatch(new THREE.BoxGeometry(1.2, 0.5, 1.2), this.lampHeadMaterial, 400);
    const glowPositions = [];
    const lamp = (x, z) => {
      poles.add(v(x, -0.6, z), v(1, 7, 1), "#ffffff");
      heads.add(v(x, 6.6, z), v(1, 1, 1), "#ffffff");
      glowPositions.push(x, 6.4, z);
    };
    for (let x = -880; x <= 780; x += 18) {
      lamp(x, PROMENADE_Z + 10);
      if (Math.abs(x - ARENA_CENTER.x) < 520) {
        tree(x + 9, PROMENADE_Z + 17, 0.9);
      }
    }
    for (let x = RING.minX; x <= RING.maxX; x += 22) {
      lamp(x, RING.minZ - 1.5);
      lamp(x, RING.maxZ + 1.5);
    }
    for (let z = RING.minZ + 11; z <= RING.maxZ; z += 22) {
      lamp(RING.minX - 1.5, z);
      lamp(RING.maxX + 1.5, z);
    }
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute("position", new THREE.Float32BufferAttribute(glowPositions, 3));
    this.glowMaterial = new THREE.PointsMaterial({
      size: 7,
      map: this.glowSprite(),
      color: "#ffd88a",
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.lampGlow = new THREE.Points(glowGeometry, this.glowMaterial);

    // Skyline da outra margem da baia.
    this.farTowerMaterial = this.towerMaterial.clone();
    const farTowers = new InstanceBatch(facadeBoxGeometry(), this.farTowerMaterial, 90);
    for (let x = -650; x <= 560; x += 13 + rng() * 14) {
      const width = 10 + rng() * 16;
      farTowers.add(v(x, 1.5, 590 + rng() * 60), v(width, 18 + rng() * (Math.abs(x - ARENA_CENTER.x) < 260 ? 110 : 60), width * (0.7 + rng() * 0.6)), "#ffffff");
    }

    this.batches = { roads, dashes, houses, roofs, towers, trunks, crowns, parks, poles, heads, farTowers };
    this.group.add(houses.mesh, roofs.mesh, towers.mesh, trunks.mesh, crowns.mesh, parks.mesh, poles.mesh, heads.mesh, farTowers.mesh, this.lampGlow);
    [houses, roofs, towers].forEach((batch) => {
      batch.mesh.castShadow = false;
      batch.mesh.receiveShadow = true;
    });

    this.createBoats();
  }

  glowSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.5)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  createBoats() {
    const rng = this.rng;
    const hullMaterial = new THREE.MeshStandardMaterial({ color: "#f2f2f2", roughness: 0.6 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: "#2f5d8a", roughness: 0.6 });
    const cabinMaterial = new THREE.MeshStandardMaterial({ color: "#d9d4c8", roughness: 0.7 });
    this.boatLightMaterial = new THREE.MeshBasicMaterial({ color: "#ffe9a8", toneMapped: false });
    for (let index = 0; index < 7; index += 1) {
      const boat = new THREE.Group();
      const length = 9 + rng() * 9;
      const hull = new THREE.Mesh(new THREE.BoxGeometry(length, 2, length * 0.36), hullMaterial);
      hull.position.y = 0.6;
      boat.add(hull);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(length * 1.01, 0.5, length * 0.37), trimMaterial);
      trim.position.y = -0.1;
      boat.add(trim);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(length * 0.35, 1.8, length * 0.26), cabinMaterial);
      cabin.position.set(-length * 0.1, 2.4, 0);
      boat.add(cabin);
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), this.boatLightMaterial);
      light.position.set(-length * 0.1, 3.6, 0);
      boat.add(light);
      boat.userData = {
        x: ARENA_CENTER.x + (rng() * 2 - 1) * 420,
        z: SHORE_Z + 45 + rng() * 260,
        speed: (3 + rng() * 5) * (rng() < 0.5 ? -1 : 1),
        phase: rng() * Math.PI * 2,
      };
      boat.rotation.y = boat.userData.speed > 0 ? 0 : Math.PI;
      this.boats.push(boat);
      this.group.add(boat);
    }
  }

  applyTheme(theme) {
    const tint = THEME_TINT[theme.id] ?? THEME_TINT.day;
    this.landMaterial.color.set(tint.grass);
    this.parkMaterial.color.set(tint.park);
    this.waterMaterial.color.set(tint.water);
    this.concreteMaterial.color.set(theme.sidewalk);
    this.farShoreMaterial.color.set(tint.grass).lerp(new THREE.Color(theme.fog), 0.4);
    this.farTowerMaterial.color.set(theme.distant);
    this.farTowerMaterial.emissiveIntensity = this.towerMaterial.emissiveIntensity;
    this.asphaltMaterial.color.set(theme.street);
    this.laneMaterial.color.set(theme.lane);
    this.trunkMaterial.color.set("#ffffff");
    this.crownMaterial.color.set("#ffffff");
    this.towerMaterial.emissiveIntensity = theme.id === "night" ? 0.9 : theme.id === "dusk" ? 0.35 : 0;
    this.lampHeadMaterial.color.set(tint.lamps ? "#fff1c4" : "#9a9a9a");
    this.boatLightMaterial.color.set(tint.lamps ? "#ffe9a8" : "#bdbdbd");
    this.lampGlow.visible = tint.lamps;
    this.glowMaterial.opacity = tint.glow;
    const { roads, dashes, houses, roofs, towers, trunks, crowns, parks, poles, heads, farTowers } = this.batches;
    [roads, dashes, parks, poles, heads, farTowers].forEach((batch) => batch.commit(1));
    [houses, roofs, towers, trunks, crowns].forEach((batch) => batch.commit(tint.light));
  }

  update(dt) {
    this.time += dt;
    this.waterTexture.offset.set(this.time * 0.006, this.time * 0.004);
    this.boats.forEach((boat) => {
      const data = boat.userData;
      data.x += data.speed * dt;
      if (data.x > ARENA_CENTER.x + 520) {
        data.x = ARENA_CENTER.x - 520;
      } else if (data.x < ARENA_CENTER.x - 520) {
        data.x = ARENA_CENTER.x + 520;
      }
      boat.position.set(data.x, WATER_LEVEL + Math.sin(this.time * 1.3 + data.phase) * 0.25, data.z);
      boat.rotation.z = Math.sin(this.time * 1.1 + data.phase) * 0.04;
      boat.rotation.x = Math.sin(this.time * 0.9 + data.phase * 2) * 0.03;
    });
  }
}
