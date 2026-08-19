// NPC traffic: AI planes that wander near the player with banked turns,
// gentle climbs/descents, and terrain avoidance. Planes that drift too far
// away are recycled back into the player's vicinity.

import * as THREE from '../lib/three.module.min.js';
import { buildAircraftMesh } from './aircraft.js';
import { getTerrainHeight } from './world.js';

const G = 9.81;
const RECYCLE_DIST = 4500;  // beyond this, respawn near the player
const MIN_CLEARANCE = 120;  // meters above terrain NPCs try to keep

const PALETTES = [
  { body: 0xf2d54a, accent: 0x2a5db0 }, // yellow / blue
  { body: 0xdfe6ec, accent: 0x2f8f4e }, // white / green
  { body: 0x9fb8c8, accent: 0xd07f27 }, // gray / orange
  { body: 0xe8e2d6, accent: 0x7a3fa0 }, // cream / purple
  { body: 0xc9d2da, accent: 0x1f7f8a }, // silver / teal
];

export class Traffic {
  constructor(scene, count = 5) {
    this.planes = [];
    for (let i = 0; i < count; i++) {
      this.planes.push(new NPCPlane(scene, PALETTES[i % PALETTES.length], i));
    }
  }

  // (Re)place every plane around a center point — used at start and on reset.
  scatter(center) {
    for (const p of this.planes) p.respawn(center);
  }

  update(dt, playerPos) {
    for (const p of this.planes) p.update(dt, playerPos);
  }

  // Remove all paint splats from every plane (fresh round).
  clearPaint() {
    for (const p of this.planes) p.clearSplats();
  }

  // Distance from `pos` to the nearest live NPC.
  nearestDistance(pos) {
    let min = Infinity;
    for (const p of this.planes) {
      if (p.crashed) continue;
      const d = p.position.distanceTo(pos);
      if (d < min) min = d;
    }
    return min;
  }
}

class NPCPlane {
  constructor(scene, palette, seed) {
    this.mesh = buildAircraftMesh(palette);
    this.prop = this.mesh.userData.prop;
    scene.add(this.mesh);

    this.position = new THREE.Vector3();
    this.seed = seed;
    this.speed = 42 + rand(seed, 1) * 18; // m/s
    this.heading = rand(seed, 2) * Math.PI * 2;
    this.targetHeading = this.heading;
    this.targetAlt = 250;
    this.turnRate = 0;
    this.retargetTimer = 0;
    this.crashed = false;
    this.respawnTimer = 0;
    this.velocity = new THREE.Vector3(); // used only while falling
    this.splats = []; // paint marks attached to the mesh

    this.respawn(new THREE.Vector3());
  }

  respawn(center) {
    // Place at a ring around the center, headed to pass near it.
    const angle = Math.random() * Math.PI * 2;
    const dist = 1200 + Math.random() * 1500;
    this.position.set(
      center.x + Math.cos(angle) * dist,
      0,
      center.z + Math.sin(angle) * dist
    );
    const ground = getTerrainHeight(this.position.x, this.position.z);
    this.position.y = Math.max(center.y, ground + MIN_CLEARANCE) + 60 + Math.random() * 280;
    this.targetAlt = this.position.y;

    // Aim at a point offset from the center so paths cross nearby, not head-on.
    const aimX = center.x + (Math.random() - 0.5) * 800;
    const aimZ = center.z + (Math.random() - 0.5) * 800;
    this.heading = Math.atan2(aimX - this.position.x, -(aimZ - this.position.z));
    this.targetHeading = this.heading;
    this.turnRate = 0;
    this.retargetTimer = 2 + Math.random() * 6;
    this.crashed = false;
    this.syncMesh(0);
  }

  // A paintball hit: jink away and shed some altitude discipline.
  startle() {
    this.targetHeading = this.heading + (Math.random() - 0.5) * 2.5;
    this.targetAlt += (Math.random() - 0.5) * 180;
    this.retargetTimer = 3 + Math.random() * 5;
  }

  clearSplats() {
    for (const s of this.splats) {
      this.mesh.remove(s);
      s.material.dispose();
    }
    this.splats.length = 0;
  }

  crash() {
    if (this.crashed) return;
    this.crashed = true;
    this.respawnTimer = 8;
    // Carry current motion into the fall.
    const dir = headingDir(this.heading);
    this.velocity.copy(dir).multiplyScalar(this.speed);
  }

  update(dt, playerPos) {
    if (this.crashed) {
      this.updateCrashFall(dt, playerPos);
      return;
    }

    // Occasionally pick a new heading and altitude.
    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0) {
      this.retargetTimer = 6 + Math.random() * 8;
      this.targetHeading = this.heading + (Math.random() - 0.5) * 2.2;
      this.targetAlt += (Math.random() - 0.5) * 220;
    }

    // Terrain avoidance: look ahead and keep clearance.
    const dir = headingDir(this.heading);
    const aheadX = this.position.x + dir.x * 300;
    const aheadZ = this.position.z + dir.z * 300;
    const floor = Math.max(
      getTerrainHeight(aheadX, aheadZ),
      getTerrainHeight(this.position.x, this.position.z)
    ) + MIN_CLEARANCE;
    if (this.targetAlt < floor) this.targetAlt = floor + 40;

    // Steer smoothly toward the target heading.
    let dh = this.targetHeading - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const desiredTurn = THREE.MathUtils.clamp(dh, -0.28, 0.28);
    this.turnRate += (desiredTurn - this.turnRate) * Math.min(1, 1.5 * dt);
    this.heading += this.turnRate * dt;

    // Climb/descend toward the target altitude.
    const vy = THREE.MathUtils.clamp((this.targetAlt - this.position.y) * 0.25, -6, 7);

    this.position.x += dir.x * this.speed * dt;
    this.position.z += dir.z * this.speed * dt;
    this.position.y += vy * dt;

    // Recycle planes that wandered too far from the player.
    if (this.position.distanceTo(playerPos) > RECYCLE_DIST) {
      this.respawn(playerPos);
      return;
    }

    this.syncMesh(vy);
  }

  updateCrashFall(dt, playerPos) {
    const ground = getTerrainHeight(this.position.x, this.position.z) + 2;
    if (this.position.y > ground) {
      this.velocity.y -= G * dt;
      this.velocity.multiplyScalar(Math.max(0, 1 - 0.5 * dt));
      this.position.addScaledVector(this.velocity, dt);
      if (this.position.y < ground) this.position.y = ground;
      this.mesh.position.copy(this.position);
      this.mesh.rotation.z += 2.5 * dt; // tumble
    } else {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn(playerPos);
    }
  }

  syncMesh(vy) {
    this.mesh.position.copy(this.position);
    const pitch = Math.atan2(vy, this.speed);
    const roll = THREE.MathUtils.clamp(-this.turnRate * 2.4, -0.65, 0.65);
    this.mesh.rotation.set(pitch, -this.heading, roll, 'YXZ');
    this.prop.rotation.z += 1.2;
  }
}

// Unit direction for a heading (0 = -Z, increasing toward +X, matching the
// player aircraft's heading convention).
function headingDir(heading) {
  return new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
}

function rand(seed, salt) {
  const x = Math.sin(seed * 374.61 + salt * 668.27) * 43758.5453;
  return x - Math.floor(x);
}
