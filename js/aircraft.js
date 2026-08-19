// The aircraft: a low-poly model plus a simplified flight model with
// thrust, lift, drag, gravity, stall behavior, and ground handling.

import * as THREE from '../lib/three.module.min.js';
import { getTerrainHeight, RUNWAY } from './world.js';

const G = 9.81;

// Tuning constants for a small single-prop aircraft. Units are metric-ish;
// the goal is believable handling rather than an exact Cessna.
const TUNING = {
  mass: 1100,              // kg
  maxThrust: 12500,        // N at full throttle
  liftFactor: 48,          // scales lift from speed^2 * AoA
  dragFactor: 2.0,         // parasitic drag from speed^2
  inducedDragFactor: 60,   // drag that grows with AoA
  stallSpeed: 26,          // m/s (~94 km/h) — below this, wings lose grip
  pitchRate: 1.1,          // rad/s at full deflection
  rollRate: 1.7,
  yawRate: 0.55,
  gearHeight: 2.2,         // meters between aircraft origin and wheels
};

export class Aircraft {
  constructor(scene) {
    this.scene = scene;
    this.mesh = buildAircraftMesh();
    this.prop = this.mesh.userData.prop;
    this.lastThrottle = 0;
    scene.add(this.mesh);

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();

    this.onGround = true;
    this.crashed = false;
    this.stalling = false;

    this.reset();
  }

  reset() {
    this.position.set(0, TUNING.gearHeight, 0);
    this.quaternion.identity(); // facing -Z, down the runway
    this.velocity.set(0, 0, 0);
    this.onGround = true;
    this.crashed = false;
    this.stalling = false;
    this.syncMesh();
  }

  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
  }
  get up() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
  }
  get right() {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
  }

  get speed() {
    return this.velocity.length();
  }

  get heading() {
    const f = this.forward;
    let deg = Math.atan2(f.x, -f.z) * (180 / Math.PI);
    if (deg < 0) deg += 360;
    return deg;
  }

  update(dt, controls) {
    if (this.crashed) return;

    const speed = this.speed;
    const forward = this.forward;
    const up = this.up;
    const right = this.right;

    // --- Rotation ---
    // Control surfaces need airflow: effectiveness ramps up with airspeed.
    const authority = Math.min(1, speed / 45);
    const rot = new THREE.Quaternion();
    const q = new THREE.Quaternion();

    if (this.onGround) {
      // On the ground: rudder steers, elevator can rotate for takeoff
      // once there's enough speed for the tail to bite.
      const steer = controls.yaw * 1.2 * Math.min(1, speed / 15) * (speed > 0.5 ? 1 : 0);
      rot.multiply(q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -steer * dt));
      if (speed > TUNING.stallSpeed * 0.75 && controls.pitch > 0) {
        rot.multiply(q.setFromAxisAngle(right, controls.pitch * TUNING.pitchRate * 0.6 * dt));
      }
    } else {
      rot.multiply(q.setFromAxisAngle(right, controls.pitch * TUNING.pitchRate * authority * dt));
      rot.multiply(q.setFromAxisAngle(forward, controls.roll * TUNING.rollRate * authority * dt));
      rot.multiply(q.setFromAxisAngle(up, -controls.yaw * TUNING.yawRate * authority * dt));

      // A banked wing pulls the nose around: simple coordinated-turn yaw.
      const bank = right.y; // ~sin(bank angle), positive right-wing-up
      rot.multiply(q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), bank * 0.55 * authority * dt));

      // In a stall the nose drops toward the velocity vector.
      if (this.stalling) {
        const pitchDown = q.setFromAxisAngle(right, -0.5 * dt);
        rot.multiply(pitchDown);
      }
    }
    this.quaternion.premultiply(rot).normalize();

    // --- Forces ---
    const force = new THREE.Vector3();

    // Thrust along the nose.
    force.addScaledVector(this.forward, TUNING.maxThrust * controls.throttle);

    // Gravity.
    force.y -= TUNING.mass * G;

    if (speed > 0.1) {
      const airDir = this.velocity.clone().normalize();

      // Angle of attack: how far the nose points above the airflow.
      const aoa = Math.asin(
        THREE.MathUtils.clamp(airDir.clone().negate().dot(this.up), -1, 1)
      ); // positive when the nose points above the velocity vector

      // Lift: grows with speed^2 and AoA, collapses in a stall.
      this.stalling = !this.onGround && speed < TUNING.stallSpeed && this.position.y > getTerrainHeight(this.position.x, this.position.z) + 5;
      const aoaEff = THREE.MathUtils.clamp(aoa + 0.09, -0.35, 0.35); // wing incidence baked in
      let liftMag = TUNING.liftFactor * speed * speed * aoaEff;
      if (this.stalling) liftMag *= 0.35;
      const liftDir = this.up.clone().sub(airDir.clone().multiplyScalar(this.up.dot(airDir))).normalize();
      if (liftDir.lengthSq() > 0.5) force.addScaledVector(liftDir, liftMag);

      // Drag: parasitic + induced.
      const dragMag = TUNING.dragFactor * speed * speed +
        TUNING.inducedDragFactor * speed * speed * aoaEff * aoaEff;
      force.addScaledVector(airDir, -dragMag);

      // Side-slip resistance: the fuselage resists flying sideways.
      const slip = this.velocity.dot(this.right);
      force.addScaledVector(this.right, -slip * 220);
    }

    // --- Integrate ---
    this.velocity.addScaledVector(force, dt / TUNING.mass);
    this.position.addScaledVector(this.velocity, dt);

    // --- Ground contact ---
    const groundY = getTerrainHeight(this.position.x, this.position.z) + TUNING.gearHeight;
    if (this.position.y <= groundY) {
      const sinkRate = -this.velocity.y;
      const onRunway =
        Math.abs(this.position.x) < RUNWAY.width / 2 &&
        this.position.z < RUNWAY.zStart && this.position.z > RUNWAY.zEnd;
      const levelEnough = this.up.y > 0.85;

      if (sinkRate > 8 || !levelEnough || (!onRunway && sinkRate > 3.5)) {
        this.crashed = true;
        this.velocity.set(0, 0, 0);
        this.position.y = groundY;
        this.syncMesh();
        return;
      }

      // Touch down / roll.
      this.position.y = groundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
      this.stalling = false;

      // Rolling friction (stronger off-runway) plus brakes-when-idle.
      const friction = (onRunway ? 0.08 : 1.5) + (controls.throttle < 0.05 ? 1.2 : 0);
      this.velocity.multiplyScalar(Math.max(0, 1 - friction * dt));

      // Settle the plane level with the ground while rolling slowly
      // (fast enough taxiing means we might be rotating for takeoff).
      if (this.speed < 15) {
        const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
        euler.x += (0 - euler.x) * Math.min(1, 3 * dt);
        euler.z += (0 - euler.z) * Math.min(1, 3 * dt);
        this.quaternion.setFromEuler(euler);
      }
    } else if (this.position.y > groundY + 0.5) {
      this.onGround = false;
    }

    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
    // Spin the propeller with throttle.
    if (this.prop) this.prop.rotation.z += 0.3 + this.lastThrottle * 1.4;
  }

  setThrottleVisual(throttle) {
    this.lastThrottle = throttle;
  }
}

function buildAircraftMesh() {
  const plane = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xd8dde3 });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0xc23b22 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2e33 });

  // Fuselage: tapered box.
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.55, 9, 8), bodyMat);
  fuselage.rotation.x = Math.PI / 2;
  plane.add(fuselage);

  // Nose cowling.
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 1.2, 8), accentMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -5.0;
  plane.add(nose);

  // Propeller.
  const prop = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 0.08), darkMat);
  prop.add(blade);
  const blade2 = blade.clone();
  blade2.rotation.z = Math.PI / 2;
  prop.add(blade2);
  prop.position.z = -5.7;
  plane.add(prop);
  plane.userData.prop = prop;

  // Main wing.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(13, 0.22, 2.2), bodyMat);
  wing.position.set(0, 0.55, -0.4);
  plane.add(wing);
  const wingTipL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.24, 2.2), accentMat);
  wingTipL.position.set(-6.2, 0.55, -0.4);
  plane.add(wingTipL);
  const wingTipR = wingTipL.clone();
  wingTipR.position.x = 6.2;
  plane.add(wingTipR);

  // Tail.
  const hstab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 1.3), bodyMat);
  hstab.position.set(0, 0.3, 4.1);
  plane.add(hstab);
  const vstab = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.1, 1.5), accentMat);
  vstab.position.set(0, 1.2, 4.2);
  plane.add(vstab);

  // Landing gear.
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
  const strutGeo = new THREE.BoxGeometry(0.14, 1.2, 0.14);
  for (const [x, z] of [[-1.5, -1.2], [1.5, -1.2], [0, 3.9]]) {
    const strut = new THREE.Mesh(strutGeo, darkMat);
    strut.position.set(x, -1.2, z);
    plane.add(strut);
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -1.8, z);
    plane.add(wheel);
  }

  return plane;
}

export { TUNING };
