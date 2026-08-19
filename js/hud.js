// HUD: reads aircraft state and writes it into the DOM overlay.

const el = {
  speed: document.getElementById('speed'),
  altitude: document.getElementById('altitude'),
  heading: document.getElementById('heading'),
  vspeed: document.getElementById('vspeed'),
  throttleFill: document.getElementById('throttle-fill'),
  throttlePct: document.getElementById('throttle-pct'),
  stall: document.getElementById('stall-warning'),
  message: document.getElementById('center-message'),
  help: document.getElementById('help'),
};

let messageTimer = null;

export function updateHUD(aircraft, controls, groundHeight) {
  el.speed.textContent = Math.round(aircraft.speed * 3.6);
  el.altitude.textContent = Math.round(Math.max(0, aircraft.position.y - groundHeight));
  el.heading.textContent = Math.round(aircraft.heading);
  const vs = aircraft.velocity.y;
  el.vspeed.textContent = (vs >= 0 ? '+' : '') + vs.toFixed(1);
  const pct = Math.round(controls.throttle * 100);
  el.throttleFill.style.width = `${pct}%`;
  el.throttlePct.textContent = `${pct}%`;
  el.stall.classList.toggle('visible', aircraft.stalling && !aircraft.crashed);
}

export function showMessage(title, subtitle = '', durationMs = 0) {
  el.message.innerHTML = `${title}${subtitle ? `<span class="sub">${subtitle}</span>` : ''}`;
  el.message.classList.add('visible');
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = null;
  if (durationMs > 0) {
    messageTimer = setTimeout(() => el.message.classList.remove('visible'), durationMs);
  }
}

export function hideMessage() {
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = null;
  el.message.classList.remove('visible');
}

export function toggleHelp() {
  el.help.classList.toggle('hidden');
}
