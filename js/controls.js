// Keyboard input with smoothed control axes so the plane responds
// gradually instead of snapping to full deflection.

const keys = new Set();
let seenInput = false;

// True once any keyboard input has reached the page — used to detect
// focus problems (e.g. the address bar still has keyboard focus).
export function hasSeenInput() {
  return seenInput;
}

window.addEventListener('keydown', (e) => {
  seenInput = true;
  keys.add(e.code);
  // Keep the page from scrolling with arrows/space.
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

export function isPressed(code) {
  return keys.has(code);
}

export class Controls {
  constructor() {
    this.pitch = 0;    // -1 = nose down, +1 = nose up
    this.roll = 0;     // -1 = roll left, +1 = roll right
    this.yaw = 0;      // -1 = yaw left, +1 = yaw right
    this.throttle = 0; // 0..1
  }

  update(dt) {
    // Joystick convention: pushing the stick forward (W / up arrow) drops
    // the nose; pulling back (S / down arrow) raises it.
    const target = {
      pitch: (isPressed('KeyW') || isPressed('ArrowUp') ? -1 : 0) +
             (isPressed('KeyS') || isPressed('ArrowDown') ? 1 : 0),
      roll:  (isPressed('KeyA') || isPressed('ArrowLeft') ? -1 : 0) +
             (isPressed('KeyD') || isPressed('ArrowRight') ? 1 : 0),
      yaw:   (isPressed('KeyQ') ? -1 : 0) + (isPressed('KeyE') ? 1 : 0),
    };

    // Move each axis toward its target, and recenter faster than deflecting
    // so releasing a key settles the controls quickly.
    for (const axis of ['pitch', 'roll', 'yaw']) {
      const t = target[axis];
      const rate = t === 0 ? 4.0 : 2.5;
      this[axis] += (t - this[axis]) * Math.min(1, rate * dt);
      if (t === 0 && Math.abs(this[axis]) < 0.01) this[axis] = 0;
    }

    const throttleRate = 0.5;
    if (isPressed('ShiftLeft') || isPressed('ShiftRight') || isPressed('Equal')) this.throttle += throttleRate * dt;
    if (isPressed('ControlLeft') || isPressed('ControlRight') || isPressed('Minus')) this.throttle -= throttleRate * dt;
    this.throttle = Math.min(1, Math.max(0, this.throttle));
  }
}
