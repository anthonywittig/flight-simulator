// Entry point: scene setup, cameras, and the simulation loop.

import * as THREE from '../lib/three.module.min.js';
import { buildWorld, getTerrainHeight } from './world.js';
import { Aircraft } from './aircraft.js';
import { Controls } from './controls.js';
import { updateHUD, showMessage, hideMessage, toggleHelp } from './hud.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 20000);

buildWorld(scene);
const aircraft = new Aircraft(scene);
const controls = new Controls();

// Handy for debugging from the browser console.
window.__sim = { aircraft, controls };

// Camera modes: chase, cockpit, flyby tower.
const CAMERA_MODES = ['chase', 'cockpit', 'orbit'];
let cameraMode = 0;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') cameraMode = (cameraMode + 1) % CAMERA_MODES.length;
  if (e.code === 'KeyH') toggleHelp();
  if (e.code === 'KeyR') {
    aircraft.reset();
    controls.throttle = 0;
    hideMessage();
    showMessage('READY', 'Full throttle (hold Shift), rotate at 120 km/h', 3500);
  }
});

const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
let orbitAngle = 0;

function updateCamera(dt) {
  const mode = CAMERA_MODES[cameraMode];

  if (mode === 'chase') {
    // Sit behind and above the plane, following smoothly.
    const behind = new THREE.Vector3(0, 6, 22).applyQuaternion(aircraft.quaternion);
    camPos.copy(aircraft.position).add(behind);
    // Don't let the chase camera clip below the terrain.
    const minY = getTerrainHeight(camPos.x, camPos.z) + 2;
    if (camPos.y < minY) camPos.y = minY;
    camera.position.lerp(camPos, Math.min(1, 5 * dt));
    camTarget.copy(aircraft.position).addScaledVector(aircraft.forward, 25);
    camera.lookAt(camTarget);
    camera.up.copy(aircraft.up).lerp(new THREE.Vector3(0, 1, 0), 0.6).normalize();
  } else if (mode === 'cockpit') {
    const seat = new THREE.Vector3(0, 1.6, -1.5).applyQuaternion(aircraft.quaternion);
    camera.position.copy(aircraft.position).add(seat);
    camTarget.copy(camera.position).addScaledVector(aircraft.forward, 100);
    camera.up.copy(aircraft.up);
    camera.lookAt(camTarget);
  } else {
    // Slow orbit around the aircraft — nice for screenshots.
    orbitAngle += dt * 0.25;
    const r = 45;
    camPos.set(
      aircraft.position.x + Math.cos(orbitAngle) * r,
      aircraft.position.y + 15,
      aircraft.position.z + Math.sin(orbitAngle) * r
    );
    const minY = getTerrainHeight(camPos.x, camPos.z) + 2;
    if (camPos.y < minY) camPos.y = minY;
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(aircraft.position);
  }
}

let wasCrashed = false;
let lastTime = performance.now();

showMessage('READY', 'Full throttle (hold Shift), rotate at 120 km/h', 5000);

function tick(now) {
  requestAnimationFrame(tick);
  // Clamp dt so tab-switches don't teleport the plane.
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  controls.update(dt);
  aircraft.setThrottleVisual(controls.throttle);
  aircraft.update(dt, controls);

  if (aircraft.crashed && !wasCrashed) {
    showMessage('CRASHED', 'Press R to reset');
  }
  wasCrashed = aircraft.crashed;

  updateCamera(dt);
  updateHUD(aircraft, controls, getTerrainHeight(aircraft.position.x, aircraft.position.z));
  renderer.render(scene, camera);
}

requestAnimationFrame(tick);
