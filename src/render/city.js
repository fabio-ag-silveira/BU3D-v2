import * as THREE from "three";
import { ARENA, GRID, VOXEL_SIZE } from "../config.js";
import { cellCenter } from "../world.js";
import { MATERIALS } from "../map.js";

const MATERIAL_COLORS = {
  [MATERIALS.wood]: "#6b4b32",
  [MATERIALS.leaves]: "#4f8a3a",
  [MATERIALS.earth]: "#7a5a3c",
  [MATERIALS.rock]: "#6f6a62",
  [MATERIALS.grass]: "#5d8f3b",
  [MATERIALS.concrete]: "#a3a3a0",
  [MATERIALS.bridge]: "#b9875a",
};

function hash(index, seed) {
  let value = (index + 1) * 2654435761 ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

const WALL_CAPACITY = 70000;
const LIT_CAPACITY = 14000;

// Predios renderizados como voxels instanciados. So as celulas com face exposta viram instancias.
export class CityMesh {
  constructor(scene) {
    const geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    this.walls = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.05 }),
      WALL_CAPACITY,
    );
    this.walls.castShadow = true;
    this.walls.receiveShadow = true;
    this.lit = new THREE.InstancedMesh(
      new THREE.BoxGeometry(VOXEL_SIZE * 1.002, VOXEL_SIZE * 0.82, VOXEL_SIZE * 1.002),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      LIT_CAPACITY,
    );
    [this.walls, this.lit].forEach((mesh) => {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
    });
    this.version = -1;
    this.themeId = null;
    this.matrix = new THREE.Matrix4();
    this.color = new THREE.Color();
    this.scorch = new THREE.Color("#1a1512");
  }

  // hidden: celulas que estao sendo animadas caindo (nao desenha ainda no destino).
  rebuild(world, theme, seed, craters, hidden = null) {
    const walls = this.walls;
    const lit = this.lit;
    const matrix = this.matrix;
    const color = this.color;
    const baseColors = {
      small: new THREE.Color(theme.buildings.small),
      medium: new THREE.Color(theme.buildings.medium),
      tall: new THREE.Color(theme.buildings.tall),
    };
    const roof = new THREE.Color(theme.roof);
    const windowDark = new THREE.Color(theme.windowDark);
    const windowLit = new THREE.Color(theme.windowLit);
    const door = new THREE.Color("#2a2420");
    let wallCount = 0;
    let litCount = 0;

    const materials = Object.fromEntries(Object.entries(MATERIAL_COLORS).map(([id, value]) => [
      id,
      new THREE.Color(value).multiplyScalar(theme.id === "night" ? 0.55 : theme.id === "dusk" ? 0.85 : 1),
    ]));
    const buildings = world.layout.buildings;
    const cells = world.cells;
    const { sizeX, sizeY, sizeZ } = GRID;
    const solid = (ix, iy, iz) => world.buildingAtCell(ix, iy, iz) !== 0;

    for (let iy = 0; iy < sizeY; iy += 1) {
      for (let iz = 0; iz < sizeZ; iz += 1) {
        for (let ix = 0; ix < sizeX; ix += 1) {
          const material = cells[(iy * sizeZ + iz) * sizeX + ix];
          if (!material || hidden?.has((iy * sizeZ + iz) * sizeX + ix)) {
            continue;
          }
          const exposed =
            !solid(ix + 1, iy, iz) || !solid(ix - 1, iy, iz) ||
            !solid(ix, iy + 1, iz) || (iy > 0 && !solid(ix, iy - 1, iz)) ||
            !solid(ix, iy, iz + 1) || !solid(ix, iy, iz - 1);
          if (!exposed || wallCount >= WALL_CAPACITY) {
            continue;
          }

          const center = cellCenter(ix, iy, iz);
          const cellId = ix + iz * sizeX + iy * sizeX * sizeZ;
          const noise = hash(cellId, seed);

          if (material > 200) {
            color.copy(materials[material] ?? materials[MATERIALS.rock]).multiplyScalar(0.88 + noise * 0.2);
          } else {
            const building = buildings[material - 1];
            const onX = ix === building.minIx || ix === building.maxIx;
            const onZ = iz === building.minIz || iz === building.maxIz;
            const slot = onX && !onZ ? iz - building.minIz : onZ && !onX ? ix - building.minIx : -1;
            const span = onX ? building.maxIz - building.minIz : building.maxIx - building.minIx;
            const isRoof = iy === building.layers - 1;
            const isWindow = slot > 0 && slot < span && !isRoof && iy > 0 && iy % 2 === 1 && slot % 3 !== 0;
            const isDoor = slot >= 0 && iy === 0 && Math.abs(slot - span / 2) < 1;

            if (isWindow && noise < theme.litChance && litCount < LIT_CAPACITY) {
              color.copy(windowLit).multiplyScalar(0.85 + 0.15 * hash(cellId, seed + 17));
              matrix.makeTranslation(center.x, center.y, center.z);
              lit.setMatrixAt(litCount, matrix);
              lit.setColorAt(litCount, color);
              litCount += 1;
              continue;
            }

            if (isWindow) {
              color.copy(windowDark);
            } else if (isDoor) {
              color.copy(door);
            } else if (isRoof) {
              color.copy(roof).multiplyScalar(0.92 + noise * 0.12);
            } else {
              color.copy(baseColors[building.type]).multiplyScalar(0.9 + noise * 0.16);
            }
          }

          for (const crater of craters) {
            const distance = Math.hypot(center.x - crater.x, center.y - crater.y, center.z - crater.z);
            if (distance < crater.r + 2.8) {
              color.lerp(this.scorch, 0.75 * (1 - Math.max(0, distance - crater.r) / 2.8));
            }
          }

          matrix.makeTranslation(center.x, center.y, center.z);
          walls.setMatrixAt(wallCount, matrix);
          walls.setColorAt(wallCount, color);
          wallCount += 1;
        }
      }
    }

    walls.count = wallCount;
    lit.count = litCount;
    walls.instanceMatrix.needsUpdate = true;
    lit.instanceMatrix.needsUpdate = true;
    walls.instanceColor.needsUpdate = true;
    lit.instanceColor.needsUpdate = true;
    this.version = world.version;
  }
}

// Chao: asfalto, calcadas em volta de cada quarteirao, faixas e a mureta da arena.
export class Ground {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const width = ARENA.maxX - ARENA.minX;
    const depth = ARENA.maxZ - ARENA.minZ;
    const centerX = (ARENA.minX + ARENA.maxX) / 2;
    const centerZ = (ARENA.minZ + ARENA.maxZ) / 2;

    this.streetMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const street = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), this.streetMaterial);
    street.position.set(centerX, 0, centerZ);
    street.receiveShadow = true;
    this.group.add(street);

    this.sidewalkMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.laneMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7 });
    this.parkMaterial = new THREE.MeshStandardMaterial({ roughness: 1 });
    this.layoutGroup = new THREE.Group();
    this.group.add(this.layoutGroup);
    this.layoutKey = null;

    this.wallMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const wallHeight = 1.6;
    const thickness = 1.2;
    [
      { x: centerX, z: ARENA.minZ - thickness / 2, w: width + thickness * 2, d: thickness },
      { x: centerX, z: ARENA.maxZ + thickness / 2, w: width + thickness * 2, d: thickness },
      { x: ARENA.minX - thickness / 2, z: centerZ, w: thickness, d: depth },
      { x: ARENA.maxX + thickness / 2, z: centerZ, w: thickness, d: depth },
    ].forEach((segment) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(segment.w, wallHeight, segment.d), this.wallMaterial);
      wall.position.set(segment.x, wallHeight / 2 - 0.3, segment.z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
    });
  }

  // Calcadas, pracas e faixas dependem do mapa da rodada.
  setLayout(layout) {
    const key = `${layout.kind}:${layout.seed}`;
    if (key === this.layoutKey) {
      return;
    }
    this.layoutKey = key;
    this.layoutGroup.children.forEach((child) => child.geometry.dispose());
    this.layoutGroup.clear();
    const matrix = new THREE.Matrix4();

    const sidewalks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.3, 1), this.sidewalkMaterial, Math.max(1, layout.buildings.length));
    layout.buildings.forEach((building, index) => {
      const width = (building.maxIx - building.minIx + 1) * VOXEL_SIZE + 4;
      const depth = (building.maxIz - building.minIz + 1) * VOXEL_SIZE + 4;
      const x = GRID.originX + ((building.minIx + building.maxIx + 1) / 2) * VOXEL_SIZE;
      const z = GRID.originZ + ((building.minIz + building.maxIz + 1) / 2) * VOXEL_SIZE;
      matrix.compose(new THREE.Vector3(x, 0.15, z), new THREE.Quaternion(), new THREE.Vector3(width, 1, depth));
      sidewalks.setMatrixAt(index, matrix);
    });
    sidewalks.count = layout.buildings.length;
    sidewalks.receiveShadow = true;
    this.layoutGroup.add(sidewalks);

    // Gramado retangular da fase Parque (cobre as faixas da rua que passariam por ali).
    if (layout.parkAreas?.length) {
      const lawns = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.parkMaterial, layout.parkAreas.length);
      layout.parkAreas.forEach((area, index) => {
        matrix.compose(new THREE.Vector3(area.x, 0.07, area.z), new THREE.Quaternion(), new THREE.Vector3(area.w, 1, area.d));
        lawns.setMatrixAt(index, matrix);
      });
      lawns.receiveShadow = true;
      this.layoutGroup.add(lawns);
    }

    if (layout.parks.length) {
      const parks = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), this.parkMaterial, layout.parks.length);
      layout.parks.forEach((park, index) => {
        matrix.compose(new THREE.Vector3(park.x, 0.06, park.z), new THREE.Quaternion(), new THREE.Vector3(park.radius, 1, park.radius));
        parks.setMatrixAt(index, matrix);
      });
      parks.receiveShadow = true;
      this.layoutGroup.add(parks);
    }

    const dashes = [];
    layout.lanesX.forEach((x) => {
      for (let z = ARENA.minZ + 4; z < ARENA.maxZ - 4; z += 8) {
        dashes.push({ x, z, rotate: false });
      }
    });
    layout.lanesZ.forEach((z) => {
      for (let x = ARENA.minX + 4; x < ARENA.maxX - 4; x += 8) {
        dashes.push({ x, z, rotate: true });
      }
    });
    const lanes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 3.6).rotateX(-Math.PI / 2), this.laneMaterial, dashes.length);
    const rotation = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    dashes.forEach((dash, index) => {
      matrix.makeTranslation(dash.x, 0.04, dash.z);
      if (dash.rotate) {
        matrix.multiply(rotation);
      }
      lanes.setMatrixAt(index, matrix);
    });
    this.layoutGroup.add(lanes);
  }

  applyTheme(theme) {
    this.parkMaterial.color.set("#4d7a33").multiplyScalar(theme.id === "night" ? 0.5 : theme.id === "dusk" ? 0.8 : 1);
    this.streetMaterial.color.set(theme.street);
    this.sidewalkMaterial.color.set(theme.sidewalk);
    this.laneMaterial.color.set(theme.lane);
    this.wallMaterial.color.set(theme.sidewalk);
  }
}
