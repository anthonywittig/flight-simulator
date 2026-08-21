// Wing-mounted paintball guns: alternating fire from each wing, ballistic
// paintballs, and paint splats that stick to NPC planes where they're hit.

import * as THREE from '../lib/three.module.min.js';
import { getTerrainHeight } from './world.js';

const G = 9.81;
const MAX_BALLS = 96;
const MUZZLE_SPEED = 90;   // m/s, relative to the plane
const FIRE_INTERVAL = 0.11; // seconds between shots (wings alternate)
const BALL_LIFE = 4;       // seconds before a ball despawns
const HIT_RADIUS = 7;      // NPC bounding-sphere radius for hit tests
const MAX_SPLATS = 40;     // per plane, oldest removed first

const PAINT_COLORS = [0xff2fa0, 0x7fff2f, 0xff8c1a, 0x2fd6ff, 0xffe61a, 0xb44dff];

// Guns sit halfway out on each wing (span 13 m), just under the leading edge.
const MUZZLE_LOCAL = new THREE.Vector3(3.25, 0.45, -1.9);

export class PaintballGuns {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.35, 6, 5),
      new THREE.MeshBasicMaterial(),
      MAX_BALLS
    );
    // Balls scatter across the whole sky; skip per-instance culling.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this.balls = []; // { pos, prev, vel, life, color }
    this.cooldown = 0;
    this.side = 1;   // which wing fires next
    this.hits = 0;
    this.splatGeo = new THREE.SphereGeometry(1, 8, 6);
  }

  reset() {
    this.balls.length = 0;
    this.hits = 0;
    this.cooldown = 0;
    this.mesh.count = 0;
  }

  tryFire(aircraft, sound) {
    if (this.cooldown > 0) return;
    this.cooldown = FIRE_INTERVAL;

    const muzzle = MUZZLE_LOCAL.clone();
    muzzle.x *= this.side;
    this.side *= -1;
    const pos = muzzle.applyQuaternion(aircraft.quaternion).add(aircraft.position);
    const vel = aircraft.forward.multiplyScalar(MUZZLE_SPEED).add(aircraft.velocity);
    const color = PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)];

    if (this.balls.length >= MAX_BALLS) this.balls.shift();
    this.balls.push({ pos, prev: pos.clone(), vel, life: BALL_LIFE, color });
    sound.shoot();
  }

  update(dt, traffic, sound) {
    this.cooldown -= dt;

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.prev.copy(b.pos);
      b.vel.y -= G * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;

      let dead = b.life <= 0 || b.pos.y < getTerrainHeight(b.pos.x, b.pos.z);

      if (!dead) {
        for (const npc of traffic.planes) {
          if (npc.crashed) continue;
          if (segmentDistanceTo(b.prev, b.pos, npc.position) < HIT_RADIUS) {
            this.addSplat(npc, b.pos, b.color);
            this.hits++;
            npc.startle();
            sound.splat();
            dead = true;
            break;
          }
        }
      }

      if (dead) this.balls.splice(i, 1);
    }

    this.renderBalls();
  }

  addSplat(npc, worldPoint, color) {
    npc.mesh.updateMatrixWorld();
    const local = npc.mesh.worldToLocal(worldPoint.clone());
    // Pull the splat onto the model so it doesn't float off in space.
    local.clampLength(0, 5.5);

    const splat = new THREE.Mesh(
      this.splatGeo,
      new THREE.MeshLambertMaterial({ color })
    );
    splat.position.copy(local);
    const s = 0.5 + Math.random() * 0.5;
    splat.scale.set(s, s * 0.35, s);
    splat.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    npc.mesh.add(splat);
    npc.splats.push(splat);
    if (npc.splats.length > MAX_SPLATS) {
      const oldest = npc.splats.shift();
      npc.mesh.remove(oldest);
      oldest.material.dispose();
    }
  }

  renderBalls() {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < this.balls.length; i++) {
      m.setPosition(this.balls[i].pos);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, c.setHex(this.balls[i].color));
    }
    this.mesh.count = this.balls.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// Distance from point `p` to segment a-b (the ball's path this frame), so
// fast-moving balls can't tunnel through a plane between frames.
function segmentDistanceTo(a, b, p) {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-8) return p.distanceTo(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
