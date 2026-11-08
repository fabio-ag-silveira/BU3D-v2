import * as THREE from "three";
import { CRATES, ROUND_MODIFIERS, SKY_THEMES, WEAPONS } from "../config.js";
import { getMuzzle, getLaunchVelocity, isInsideTankHitbox, isOutOfBounds, powerToVelocity, projectileAt } from "../physics.js";
import { VoxelWorld, cellCoords, cellCenter } from "../world.js";
import { getLayout, MATERIALS } from "../map.js";
import { Sky, ARENA_CENTER } from "./sky.js";
import { CityMesh, Ground } from "./city.js";
import { Surroundings } from "./surroundings.js";
import { TankModel } from "./tank.js";
import { Effects } from "./effects.js";
import { CameraRig } from "./camera.js";
import { Replay } from "./replay.js";

const GUIDE_POINTS = 400;
const GUIDE_STEP = 0.05;
// Ajuda de mira: quanto da trajetoria (sem vento) aparece.
export const AIM_ASSIST = {
  short: { id: "short", label: "Curta" },
  long: { id: "long", label: "Longa" },
  full: { id: "full", label: "Completa" },
};
const NO_WIND = { x: 0, z: 0 };

// Cena 3D: monta ceu, cidade de voxels, carrinhos, projetil, guia de mira, efeitos e cameras.
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    // Celulares: menos pixels e sombra menor para manter o FPS.
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2("#b9d6e3", 0.003);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.5, 2200);

    this.hemisphere = new THREE.HemisphereLight("#ffffff", "#444444", 1);
    this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight("#ffffff", 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    Object.assign(this.sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 700 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.target.position.copy(ARENA_CENTER);
    this.scene.add(this.sun, this.sun.target);

    this.sky = new Sky(this.scene);
    this.ground = new Ground(this.scene);
    this.surroundings = new Surroundings(this.scene);
    this.city = new CityMesh(this.scene);
    this.world = new VoxelWorld();
    this.effects = new Effects(this.scene);
    this.rig = new CameraRig(this.camera, canvas);
    this.replay = new Replay(this);
    this.overlayRoot = document.querySelector(".stage-overlay");
    this.tanks = new Map();
    this.cloudOffset = new THREE.Vector3();
    this.themeKey = null;
    this.buildingColors = {};

    this.createProjectileAssets();
    this.createRain();
    this.crateMeshes = new Map();
    this.fallingChunks = [];
    this.voxelGeometry = new THREE.BoxGeometry(2, 2, 2);
    this.crateBox = new THREE.BoxGeometry(3, 3, 3).translate(0, 1.5, 0);
    this.crateStripe = new THREE.BoxGeometry(3.1, 0.6, 3.1).translate(0, 1.5, 0);
    this.canopyGeometry = new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.createGuide();
    this.createAimMarkers();
    this.resize();
  }

  createProjectileAssets() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.3, "rgba(255,255,255,0.6)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    this.glowTexture = new THREE.CanvasTexture(canvas);
    this.shellGeometry = new THREE.SphereGeometry(1, 16, 12);
    this.projectileMeshes = new Map();
    // Uma luz so, que acompanha o primeiro projetil (varias luzes pesam no celular).
    this.projectileLight = new THREE.PointLight("#ffd27a", 0, 45, 1.5);
    this.scene.add(this.projectileLight);
  }

  createProjectileMesh(projectile) {
    const weapon = WEAPONS[projectile.weapon] ?? WEAPONS.standard;
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      this.shellGeometry,
      new THREE.MeshStandardMaterial({ color: "#2b2b2b", emissive: weapon.color, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.8 }),
    );
    shell.scale.setScalar(weapon.size);
    shell.castShadow = true;
    group.add(shell);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }));
    glow.scale.setScalar(weapon.size * 8);
    group.add(glow);
    group.userData.glow = glow;
    this.scene.add(group);
    return group;
  }

  // Chuva da Tempestade: riscos que acompanham a camera e inclinam com o vento.
  createRain() {
    const count = 1400;
    this.rainDrops = Array.from({ length: count }, () => ({
      x: (Math.random() * 2 - 1) * 90,
      y: Math.random() * 90,
      z: (Math.random() * 2 - 1) * 90,
      speed: 70 + Math.random() * 30,
    }));
    this.rainPositions = new Float32Array(count * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: "#b8c6d8",
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  updateRain(dt, wind) {
    if (!this.rain.visible) {
      return;
    }
    const center = this.camera.position;
    const slantX = wind.x * 0.06;
    const slantZ = wind.z * 0.06;
    this.rainDrops.forEach((drop, index) => {
      drop.y -= drop.speed * dt;
      drop.x += wind.x * 6 * dt;
      drop.z += wind.z * 6 * dt;
      if (drop.y < -40) {
        drop.y += 90;
      }
      const wrap = (value) => ((((value + 90) % 180) + 180) % 180) - 90;
      drop.x = wrap(drop.x);
      drop.z = wrap(drop.z);
      const x = center.x + drop.x;
      const y = center.y + drop.y - 30;
      const z = center.z + drop.z;
      this.rainPositions.set([x, y, z, x - slantX * 2.6, y + 2.6, z - slantZ * 2.6], index * 6);
    });
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  createGuide() {
    this.guidePositions = new Float32Array(GUIDE_POINTS * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.guidePositions, 3).setUsage(THREE.DynamicDrawUsage));
    const dot = document.createElement("canvas");
    dot.width = 32;
    dot.height = 32;
    const context = dot.getContext("2d");
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(16, 16, 13, 0, Math.PI * 2);
    context.fill();
    this.guide = new THREE.Points(geometry, new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(dot),
      alphaTest: 0.5,
      size: 0.75,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    }));
    this.guide.frustumCulled = false;
    this.scene.add(this.guide);
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.effects.resize(height);
  }

  applyTheme(theme, modifierId = "normal") {
    const sunDirection = new THREE.Vector3(...theme.sun.position).normalize();
    this.sky.applyTheme(theme, sunDirection);
    this.ground.applyTheme(theme);
    this.surroundings.applyTheme(theme);
    this.scene.fog.color.set(theme.fog);
    this.scene.fog.density = theme.fogDensity;
    this.renderer.toneMappingExposure = theme.exposure;
    this.fogFloor = modifierId === "fog" ? 0.65 : 0.3;
    this.rain.visible = modifierId === "storm";
    if (modifierId === "fog") {
      this.scene.fog.density = theme.fogDensity * 3.4;
      this.scene.fog.color.lerp(new THREE.Color("#c9ced6"), theme.id === "night" ? 0.1 : 0.5);
    } else if (modifierId === "storm") {
      this.scene.fog.density = theme.fogDensity * 1.6;
      this.scene.fog.color.lerp(new THREE.Color("#4a525e"), 0.55);
      this.renderer.toneMappingExposure = theme.exposure * 0.78;
    }
    this.hemisphere.color.set(theme.ambient.sky);
    this.hemisphere.groundColor.set(theme.ambient.ground);
    this.hemisphere.intensity = theme.ambient.intensity;
    this.sun.color.set(theme.sun.color);
    this.sun.intensity = theme.sun.intensity;
    this.sun.position.copy(ARENA_CENTER).addScaledVector(sunDirection, 320);
    if (modifierId === "storm") {
      this.sun.intensity *= 0.45;
      this.sky.uniforms.top.value.lerp(new THREE.Color("#3a4250"), 0.6);
      this.sky.uniforms.middle.value.lerp(new THREE.Color("#5a6470"), 0.6);
      this.sky.uniforms.horizon.value.lerp(new THREE.Color("#7a828c"), 0.5);
      this.sky.cloudMaterial.color.set("#5d6470");
      this.sky.cloudMaterial.opacity = 0.95;
    }
    this.theme = theme;
    this.updateDebrisColors();
  }

  // Blocos que desabaram caem animados; no destino so aparecem quando pousam.
  startCollapse(collapses) {
    const color = new THREE.Color();
    const matrix = new THREE.Matrix4();
    collapses.forEach((collapse) => {
      const mesh = new THREE.InstancedMesh(
        this.voxelGeometry,
        new THREE.MeshStandardMaterial({ roughness: 0.9 }),
        collapse.cells.length,
      );
      mesh.castShadow = true;
      collapse.cells.forEach((cell, index) => {
        const { ix, iy, iz } = cellCoords(cell.to);
        const center = cellCenter(ix, iy, iz);
        matrix.makeTranslation(center.x, center.y, center.z);
        mesh.setMatrixAt(index, matrix);
        color.copy(this.buildingColors[cell.material] ?? new THREE.Color("#777777"));
        mesh.setColorAt(index, color.multiplyScalar(0.8 + ((cell.to * 7919) % 100) / 400));
      });
      const offset = collapse.drop * 2;
      mesh.position.y = offset;
      this.scene.add(mesh);
      this.fallingChunks.push({
        mesh,
        offset,
        velocity: 0,
        cells: new Set(collapse.cells.map((cell) => cell.to)),
        center: collapse.center,
        size: collapse.cells.length,
      });
    });
    this.cityDirty = true;
  }

  hiddenCells() {
    if (!this.fallingChunks.length) {
      return null;
    }
    const hidden = new Set();
    this.fallingChunks.forEach((chunk) => chunk.cells.forEach((index) => hidden.add(index)));
    return hidden;
  }

  clearChunks() {
    this.fallingChunks.forEach((chunk) => {
      this.scene.remove(chunk.mesh);
      chunk.mesh.material.dispose();
      chunk.mesh.dispose();
    });
    this.fallingChunks = [];
    this.cityDirty = true;
  }

  updateChunks(dt) {
    if (!this.fallingChunks.length) {
      return;
    }
    let landed = false;
    this.fallingChunks = this.fallingChunks.filter((chunk) => {
      chunk.velocity += 45 * dt;
      chunk.offset = Math.max(0, chunk.offset - chunk.velocity * dt);
      chunk.mesh.position.y = chunk.offset;
      if (chunk.offset > 0) {
        return true;
      }
      this.scene.remove(chunk.mesh);
      chunk.mesh.material.dispose();
      chunk.mesh.dispose();
      const base = { x: chunk.center.x, y: chunk.center.y - 4, z: chunk.center.z };
      this.effects.burst(base, {
        count: Math.min(60, 12 + Math.round(chunk.size / 40)), colors: ["#9a8b74", "#776b5a", "#5c5c5c"],
        speed: 16, life: 2.2, size: 6, gravity: -1.5, grow: 4, drag: 1.6, alpha: 0.5, spread: 6,
      });
      this.effects.addShake(Math.min(2.5, chunk.size / 400));
      landed = true;
      return false;
    });
    if (landed) {
      this.cityDirty = true;
    }
  }

  updateDebrisColors() {
    const theme = this.theme;
    if (!theme) {
      return;
    }
    this.buildingColors = Object.fromEntries(this.world.layout.buildings.map((building) => [
      building.id,
      new THREE.Color(theme.buildings[building.type]),
    ]));
    this.buildingColors[MATERIALS.earth] = new THREE.Color("#7a5a3c");
    this.buildingColors[MATERIALS.grass] = new THREE.Color("#5d8f3b");
    this.buildingColors[MATERIALS.rock] = new THREE.Color("#6f6a62");
    this.buildingColors[MATERIALS.concrete] = new THREE.Color("#a3a3a0");
    this.buildingColors[MATERIALS.bridge] = new THREE.Color("#b9875a");
    this.buildingColors[MATERIALS.wood] = new THREE.Color("#6b4b32");
    this.buildingColors[MATERIALS.leaves] = new THREE.Color("#4f8a3a");
  }

  syncWorld(state) {
    const layout = getLayout(state.mapKind ?? "classic", state.seed);
    this.ground.setLayout(layout);
    if (layout !== this.world.layout) {
      this.world.setLayout(layout);
      this.updateDebrisColors();
    }
    const theme = SKY_THEMES[state.theme] ?? SKY_THEMES.day;
    const themeKey = `${state.theme}:${state.seed}:${state.modifier}`;
    const themeChanged = themeKey !== this.themeKey;
    if (themeChanged) {
      this.themeKey = themeKey;
      this.applyTheme(theme, ROUND_MODIFIERS[state.modifier] ? state.modifier : "normal");
    }

    const removed = this.world.sync(state.craters);
    if (removed.length && state.craters.length) {
      this.effects.spawnDebris(removed, state.craters[state.craters.length - 1], this.buildingColors);
    }
    if (this.world.collapses.length) {
      this.startCollapse(this.world.collapses);
    } else if (!state.craters.length && this.fallingChunks.length) {
      this.clearChunks();
    }
    if (themeChanged || this.world.version !== this.city.version || this.cityDirty) {
      this.cityDirty = false;
      this.city.rebuild(this.world, theme, state.seed, state.craters, this.hiddenCells());
    }
  }

  updateTanks(state, dt, time) {
    this.tanks.forEach((tank, id) => {
      if (!state.players.some((player) => player.id === id)) {
        this.scene.remove(tank.group);
        this.tanks.delete(id);
      }
    });
    state.players.forEach((player, index) => {
      let tank = this.tanks.get(player.id);
      if (!tank) {
        tank = new TankModel(this.scene, player);
        this.tanks.set(player.id, tank);
      }
      tank.update(player, {
        isTurn: state.phase === "aiming" && index === state.turnIndex,
        recoil: this.effects.getRecoil(player.id),
        time,
        dt,
      });
    });
  }

  // Marcadores da mira: onde o tiro vai cair (ajuda Completa) e onde caiu o tiro anterior.
  createAimMarkers() {
    const overlayMaterial = (color, opacity) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    });
    this.landing = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3, 40).rotateX(-Math.PI / 2), overlayMaterial("#ffffff", 0.9));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16).rotateX(-Math.PI / 2), overlayMaterial("#ffffff", 0.9));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 6).translate(0, 3.5, 0), overlayMaterial("#ffffff", 0.5));
    this.landing.add(ring, dot, post);
    this.landing.renderOrder = 20;
    this.landing.children.forEach((child) => { child.renderOrder = 20; });
    this.landing.visible = false;
    this.scene.add(this.landing);

    this.lastMarker = new THREE.Group();
    const bar = new THREE.BoxGeometry(5, 0.3, 0.9);
    const crossA = new THREE.Mesh(bar, overlayMaterial("#ffffff", 0.75));
    crossA.rotation.y = Math.PI / 4;
    const crossB = new THREE.Mesh(bar, crossA.material);
    crossB.rotation.y = -Math.PI / 4;
    const lastRing = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.7, 40).rotateX(-Math.PI / 2), overlayMaterial("#ffffff", 0.45));
    this.lastMarker.add(crossA, crossB, lastRing);
    this.lastMarker.children.forEach((child) => { child.renderOrder = 19; });
    this.lastMarker.visible = false;
    this.scene.add(this.lastMarker);
  }

  setMarkerColor(group, color) {
    group.children.forEach((child) => child.material.color.set(color));
  }

  updateGuide(state, time) {
    const player = state.players[state.turnIndex];
    const visible = state.phase === "aiming" && !player.falling;
    this.guide.visible = visible;
    this.landing.visible = false;
    this.guideInfo = null;
    this.lastMarker.visible = visible && Boolean(player.lastImpact);
    if (this.lastMarker.visible) {
      this.lastMarker.position.set(player.lastImpact.x, player.lastImpact.y + 0.3, player.lastImpact.z);
      this.setMarkerColor(this.lastMarker, player.color);
    }
    if (!visible) {
      return;
    }

    // Traca a trajetoria (sem vento) ate bater em algo; a ajuda escolhida decide quanto mostrar.
    const power = state.charge.active ? state.charge.power : player.lastPower ?? 0.5;
    const origin = getMuzzle(player.position, player.yaw, player.elevation);
    const velocity = getLaunchVelocity(player.yaw, player.elevation, powerToVelocity(power));
    const gravity = state.gravity;
    let count = 0;
    let impact = null;
    let onTarget = false;
    let targetId = null;
    for (let index = 0; index < GUIDE_POINTS; index += 1) {
      const elapsed = index * GUIDE_STEP + 0.02;
      const point = projectileAt(origin, velocity, NO_WIND, elapsed, gravity);
      const hitTank = state.players.find((entry) =>
        entry.hp > 0 && (entry.id !== player.id || elapsed > 0.5) && isInsideTankHitbox(point, entry));
      if (hitTank || this.world.isSolid(point)) {
        impact = point;
        onTarget = Boolean(hitTank && hitTank.id !== player.id);
        targetId = onTarget ? hitTank.id : null;
        break;
      }
      if (isOutOfBounds(point)) {
        break;
      }
      this.guidePositions[index * 3] = point.x;
      this.guidePositions[index * 3 + 1] = point.y;
      this.guidePositions[index * 3 + 2] = point.z;
      count += 1;
    }
    const mode = this.aimAssist ?? AIM_ASSIST.long.id;
    const shown = mode === "full" ? count : mode === "long" ? Math.max(26, Math.ceil(count * 0.55)) : 26;
    this.guide.geometry.setDrawRange(0, Math.min(count, shown));
    this.guide.geometry.attributes.position.needsUpdate = true;
    this.guide.material.color.set(state.charge.active ? "#ffffff" : player.color);

    if (mode === "full" && impact) {
      this.landing.visible = true;
      this.landing.position.set(impact.x, impact.y + 0.2, impact.z);
      this.setMarkerColor(this.landing, onTarget ? "#ff4a4a" : state.charge.active ? "#ffffff" : player.color);
      const pulse = onTarget ? 1 + 0.25 * Math.sin(time * 10) : 1;
      const far = Math.max(1, this.camera.position.distanceTo(this.landing.position) / 45);
      this.landing.scale.setScalar(pulse * far);
    }
    this.guideInfo = { onTarget, impact, targetId: mode === "full" ? targetId : null };
  }

  createCrateMesh(crate) {
    const kind = CRATES.types[crate.type] ?? CRATES.types.hp;
    const group = new THREE.Group();
    const box = new THREE.Mesh(this.crateBox, new THREE.MeshStandardMaterial({ color: "#8a6a44", roughness: 0.8 }));
    box.castShadow = true;
    group.add(box);
    const stripe = new THREE.Mesh(this.crateStripe, new THREE.MeshStandardMaterial({
      color: kind.color, emissive: kind.color, emissiveIntensity: 0.6,
    }));
    group.add(stripe);
    const beacon = new THREE.Mesh(
      new THREE.RingGeometry(3, 3.6, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: kind.color, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
    );
    beacon.position.y = 0.12;
    group.add(beacon);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 60, 12, 1, true).translate(0, 30, 0),
      new THREE.MeshBasicMaterial({
        color: kind.color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
      }),
    );
    group.add(beam);
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(this.canopyGeometry, new THREE.MeshStandardMaterial({
      color: "#f1f1f1", side: THREE.DoubleSide, roughness: 0.9,
    }));
    canopy.scale.y = 0.6;
    canopy.position.y = 9;
    chute.add(canopy);
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.2, 2.6, -1.2), new THREE.Vector3(-3.6, 9, -1.6),
        new THREE.Vector3(1.2, 2.6, -1.2), new THREE.Vector3(3.6, 9, -1.6),
        new THREE.Vector3(-1.2, 2.6, 1.2), new THREE.Vector3(-3.6, 9, 1.6),
        new THREE.Vector3(1.2, 2.6, 1.2), new THREE.Vector3(3.6, 9, 1.6),
      ]),
      new THREE.LineBasicMaterial({ color: "#dddddd" }),
    );
    chute.add(lines);
    group.add(chute);
    group.userData = { chute, beacon, box, beam };
    this.scene.add(group);
    return group;
  }

  updateCrates(state, time) {
    const alive = new Set();
    (state.crates ?? []).forEach((crate) => {
      alive.add(crate.id);
      let mesh = this.crateMeshes.get(crate.id);
      if (!mesh) {
        mesh = this.createCrateMesh(crate);
        this.crateMeshes.set(crate.id, mesh);
      }
      mesh.position.set(crate.x, crate.y, crate.z);
      mesh.userData.chute.visible = crate.falling;
      mesh.userData.beacon.visible = !crate.falling;
      mesh.userData.beam.visible = !crate.falling;
      mesh.rotation.y = crate.falling ? Math.sin(time * 1.3 + crate.id) * 0.3 : 0;
      mesh.rotation.z = crate.falling ? Math.sin(time * 1.7 + crate.id) * 0.08 : 0;
      if (!crate.falling) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 4 + crate.id);
        mesh.userData.beacon.material.opacity = 0.3 + pulse * 0.45;
        mesh.userData.beacon.scale.setScalar(1 + pulse * 0.15);
        mesh.userData.beam.material.opacity = 0.14 + pulse * 0.12;
      }
    });
    this.crateMeshes.forEach((mesh, id) => {
      if (!alive.has(id)) {
        this.scene.remove(mesh);
        this.crateMeshes.delete(id);
      }
    });
  }

  // Desenha todos os projeteis e devolve o que a camera deve seguir (centro do grupo).
  updateProjectiles(state) {
    const alive = new Set();
    state.projectiles.forEach((projectile) => {
      alive.add(projectile.id);
      let mesh = this.projectileMeshes.get(projectile.id);
      if (!mesh) {
        mesh = this.createProjectileMesh(projectile);
        this.projectileMeshes.set(projectile.id, mesh);
      }
      mesh.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
      const owner = state.players.find((player) => player.id === projectile.ownerId);
      const weapon = WEAPONS[projectile.weapon] ?? WEAPONS.standard;
      mesh.userData.glow.material.color.set(projectile.weapon === "standard" ? owner?.color ?? "#ffffff" : weapon.color);
    });
    this.projectileMeshes.forEach((mesh, id) => {
      if (!alive.has(id)) {
        this.scene.remove(mesh);
        mesh.children.forEach((child) => child.material.dispose());
        this.projectileMeshes.delete(id);
      }
    });

    if (!state.projectiles.length) {
      this.projectileLight.intensity = 0;
      return null;
    }
    const center = new THREE.Vector3();
    state.projectiles.forEach((projectile) => center.add(projectile.position));
    center.divideScalar(state.projectiles.length);
    const lead = state.projectiles[0];
    this.projectileLight.position.set(lead.position.x, lead.position.y, lead.position.z);
    this.projectileLight.intensity = 40;
    return { position: center, velocity: lead.velocity };
  }

  handleEvent(event, state, context, now) {
    this.effects.handleEvent(event, state, context);
    if (event.type === "turn") {
      this.rig.onTurn(state.players.find((player) => player.id === event.playerId));
    }
    this.replay.handleEvent(event, now, context);
  }

  render(state, dt, time) {
    this.resize();
    this.syncWorld(state);
    this.updateTanks(state, dt, time);
    this.updateGuide(state, time);
    const focus = this.updateProjectiles(state);
    this.updateCrates(state, time);
    this.updateChunks(dt);
    this.replay.record(state, time);
    this.replay.update(dt, state);

    this.effects.update(dt, state);
    this.rig.update(state, dt, { projectileFocus: focus, shake: this.effects.shake, world: this.world });

    this.cloudOffset.x += (2 + state.wind.x * 9) * dt;
    this.cloudOffset.z += (1 + state.wind.z * 9) * dt;
    // Neblina mais fraca quando a camera esta longe do que olha (livre, visao geral, topo),
    // para os carrinhos nao sumirem; de perto continua igual.
    if (this.fogBase === undefined || this.themeKey !== this.fogKey) {
      this.fogBase = this.scene.fog.density;
      this.fogKey = this.themeKey;
    }
    const viewDistance = this.camera.position.distanceTo(this.rig.target);
    this.scene.fog.density = this.fogBase * Math.min(1, Math.max(this.fogFloor ?? 0.3, 110 / Math.max(1, viewDistance)));
    this.sky.update(this.camera.position, this.cloudOffset);
    this.surroundings.update(dt);
    this.updateRain(dt, state.wind);

    this.renderer.render(this.scene, this.camera);
  }

  // Posicao na tela, ou o ponto na borda (com angulo da seta) se estiver fora de vista ou atras da camera.
  projectEdge(point, margin = 40, top = 130, bottom = 120) {
    const view = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(this.camera.matrixWorldInverse);
    const ndc = new THREE.Vector3(point.x, point.y, point.z).project(this.camera);
    const inFront = view.z < 0;
    const onScreen = inFront && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    if (onScreen) {
      return { x: (ndc.x * 0.5 + 0.5) * this.width, y: (-ndc.y * 0.5 + 0.5) * this.height, onScreen: true };
    }
    let dx = inFront ? ndc.x : -view.x;
    let dy = inFront ? -ndc.y : view.y;
    if (!inFront) {
      dy = Math.abs(dy) < 0.2 ? 0.6 : dy;
    }
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    // Area livre entre o placar do topo e a barra de forca.
    const minY = Math.min(top, this.height * 0.3);
    const maxY = this.height - Math.min(bottom, this.height * 0.3);
    const centerY = (minY + maxY) / 2;
    const halfW = this.width / 2 - margin;
    const halfH = (maxY - minY) / 2;
    const scale = Math.min(halfW / Math.max(1e-6, Math.abs(dx)), halfH / Math.max(1e-6, Math.abs(dy)));
    return {
      x: this.width / 2 + dx * scale,
      y: centerY + dy * scale,
      onScreen: false,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }

  // Converte um ponto do mundo para pixels do canvas (null se estiver atras da camera).
  project(point) {
    const vector = new THREE.Vector3(point.x, point.y, point.z).project(this.camera);
    if (vector.z > 1) {
      return null;
    }
    return { x: (vector.x * 0.5 + 0.5) * this.width, y: (-vector.y * 0.5 + 0.5) * this.height };
  }
}
