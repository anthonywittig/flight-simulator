// World generation: terrain heightfield, runway, trees, and clouds.
// The terrain height function is exported so the aircraft can collide with it.

import * as THREE from '../lib/three.module.min.js';

export const RUNWAY = {
  width: 40,
  length: 900,
  // Runway runs along the Z axis; the plane spawns at z=0 facing -Z.
  zStart: 150,   // behind the spawn point
  zEnd: -750,
};

// --- Deterministic value noise (no dependencies) ---------------------------

function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function smoothNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y) {
  let value = 0, amp = 1, freq = 1, total = 0;
  for (let i = 0; i < 4; i++) {
    value += smoothNoise(x * freq, y * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / total;
}

// Terrain height at world (x, z). Flat around the runway, hills further out.
export function getTerrainHeight(x, z) {
  const hills = (fbm(x * 0.0018 + 10, z * 0.0018 + 10) - 0.35) * 220;
  const detail = (fbm(x * 0.01, z * 0.01) - 0.5) * 12;
  let h = hills + detail;

  // Flatten a corridor around the runway with a smooth falloff.
  const cx = Math.max(0, Math.abs(x) - RUNWAY.width * 2);
  const czNear = Math.max(0, RUNWAY.zEnd - 250 - z);
  const czFar = Math.max(0, z - (RUNWAY.zStart + 250));
  const dist = Math.sqrt(cx * cx + czNear * czNear + czFar * czFar);
  const flatten = Math.min(1, dist / 400);
  const ease = flatten * flatten * (3 - 2 * flatten);
  return h * ease;
}

// --- Scene building --------------------------------------------------------

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x87b5d9);
  scene.fog = new THREE.Fog(0x87b5d9, 1500, 6500);

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(1500, 2200, 800);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x556b3f, 0.9));

  buildTerrain(scene);
  buildRunway(scene);
  buildTrees(scene);
  buildClouds(scene);
}

function buildTerrain(scene) {
  const size = 14000;
  const segments = 220;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const lowland = new THREE.Color(0x5e7d3a);
  const upland = new THREE.Color(0x8a8f6a);
  const peak = new THREE.Color(0xd8d8d4);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = getTerrainHeight(x, z);
    pos.setY(i, h);

    const t = Math.min(1, Math.max(0, h / 140));
    if (t < 0.6) tmp.lerpColors(lowland, upland, t / 0.6);
    else tmp.lerpColors(upland, peak, (t - 0.6) / 0.4);
    // Slight noise variation so the ground isn't perfectly banded.
    const shade = 0.92 + hash2(x * 0.05, z * 0.05) * 0.16;
    colors[i * 3] = tmp.r * shade;
    colors[i * 3 + 1] = tmp.g * shade;
    colors[i * 3 + 2] = tmp.b * shade;
  }
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  scene.add(new THREE.Mesh(geo, mat));
}

function buildRunway(scene) {
  const length = RUNWAY.zStart - RUNWAY.zEnd;
  const zCenter = (RUNWAY.zStart + RUNWAY.zEnd) / 2;

  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width, length),
    new THREE.MeshLambertMaterial({ color: 0x3a3d42 })
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, 0.05, zCenter);
  scene.add(runway);

  // Center line stripes.
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
  const stripeGeo = new THREE.PlaneGeometry(1.2, 14);
  for (let z = RUNWAY.zStart - 30; z > RUNWAY.zEnd + 30; z -= 40) {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.1, z);
    scene.add(stripe);
  }

  // Threshold bars at each end.
  const barGeo = new THREE.PlaneGeometry(2.5, 12);
  for (const zEndPos of [RUNWAY.zStart - 10, RUNWAY.zEnd + 10]) {
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const bar = new THREE.Mesh(barGeo, stripeMat);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(i * 4.5, 0.1, zEndPos);
      scene.add(bar);
    }
  }
}

function buildTrees(scene) {
  const count = 900;
  const trunkGeo = new THREE.CylinderGeometry(0.6, 0.9, 6, 5);
  const crownGeo = new THREE.ConeGeometry(4.5, 12, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f5e2a });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
  const m = new THREE.Matrix4();

  let placed = 0;
  let attempt = 0;
  while (placed < count && attempt < count * 20) {
    attempt++;
    const x = (hash2(attempt, 7) - 0.5) * 9000;
    const z = (hash2(attempt, 13) - 0.5) * 9000;
    // Keep trees off the runway corridor and off steep/high ground.
    if (Math.abs(x) < RUNWAY.width * 3 && z < RUNWAY.zStart + 300 && z > RUNWAY.zEnd - 300) continue;
    const h = getTerrainHeight(x, z);
    if (h > 90) continue;

    const s = 0.7 + hash2(attempt, 29) * 0.9;
    m.makeScale(s, s, s);
    m.setPosition(x, h + 3 * s, z);
    trunks.setMatrixAt(placed, m);
    m.makeScale(s, s, s);
    m.setPosition(x, h + 11 * s, z);
    crowns.setMatrixAt(placed, m);
    placed++;
  }
  trunks.count = placed;
  crowns.count = placed;
  scene.add(trunks, crowns);
}

function buildClouds(scene) {
  const count = 60;
  const geo = new THREE.SphereGeometry(1, 7, 5);
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
  });
  const clouds = new THREE.InstancedMesh(geo, mat, count * 4);
  const m = new THREE.Matrix4();

  let idx = 0;
  for (let i = 0; i < count; i++) {
    const cx = (hash2(i, 101) - 0.5) * 10000;
    const cz = (hash2(i, 211) - 0.5) * 10000;
    const cy = 450 + hash2(i, 307) * 500;
    // Each cloud is a few squashed, overlapping spheres.
    for (let j = 0; j < 4; j++) {
      const ox = (hash2(i * 4 + j, 17) - 0.5) * 90;
      const oz = (hash2(i * 4 + j, 23) - 0.5) * 60;
      const s = 28 + hash2(i * 4 + j, 31) * 40;
      m.makeScale(s * 1.6, s * 0.55, s);
      m.setPosition(cx + ox, cy + (hash2(i * 4 + j, 41) - 0.5) * 18, cz + oz);
      clouds.setMatrixAt(idx++, m);
    }
  }
  scene.add(clouds);
}
