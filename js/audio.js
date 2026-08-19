// Procedural sound: engine, wind, stall beeper, touchdown thump, crash.
// Everything is synthesized with the Web Audio API — no audio files.

export class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.rpm = 0; // smoothed throttle, drives engine pitch/volume
    this.stallPhase = 0;

    // Browsers only allow audio after a user gesture; init lazily on the
    // first key press or click.
    const init = () => {
      this.init();
      window.removeEventListener('keydown', init);
      window.removeEventListener('pointerdown', init);
    };
    window.addEventListener('keydown', init);
    window.addEventListener('pointerdown', init);
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);

    // --- Engine: two detuned saws through a lowpass, like a rough piston drone.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 42;
    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc1.start();

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.frequency.value = 85;
    this.engineOsc2.connect(this.engineFilter);
    this.engineOsc2.start();

    // --- Wind: looped white noise through a bandpass that opens with speed.
    this.noiseBuffer = makeNoiseBuffer(ctx, 2);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    windSrc.start();

    // --- Stall warning beeper.
    this.stallGain = ctx.createGain();
    this.stallGain.gain.value = 0;
    const stallOsc = ctx.createOscillator();
    stallOsc.type = 'square';
    stallOsc.frequency.value = 780;
    stallOsc.connect(this.stallGain);
    this.stallGain.connect(this.master);
    stallOsc.start();
  }

  update(dt, aircraft, controls) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    const t = this.ctx.currentTime;

    // Engine pitch lags the throttle like a real engine spooling.
    this.rpm += (controls.throttle - this.rpm) * Math.min(1, 2 * dt);
    const f = 42 + this.rpm * 78;
    this.engineOsc1.frequency.setTargetAtTime(f, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(f * 2.03, t, 0.05); // slight detune = beating rumble
    this.engineFilter.frequency.setTargetAtTime(250 + this.rpm * 1400, t, 0.1);
    const engineVol = aircraft.crashed ? 0 : 0.05 + this.rpm * 0.17;
    this.engineGain.gain.setTargetAtTime(engineVol, t, 0.1);

    // Wind builds with airspeed.
    const speed = aircraft.crashed ? 0 : aircraft.speed;
    const windAmount = Math.min(1, Math.max(0, (speed - 8) / 60));
    this.windGain.gain.setTargetAtTime(windAmount * windAmount * 0.3, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + speed * 11, t, 0.15);

    // Stall beeper: intermittent beep while stalling.
    if (aircraft.stalling && !aircraft.crashed) {
      this.stallPhase += dt;
      const on = this.stallPhase % 0.5 < 0.22;
      this.stallGain.gain.setTargetAtTime(on ? 0.1 : 0, t, 0.01);
    } else {
      this.stallPhase = 0;
      this.stallGain.gain.setTargetAtTime(0, t, 0.01);
    }
  }

  // Short filtered-noise burst; harder landings are louder and darker.
  thump(sinkRate) {
    if (!this.ctx) return;
    const intensity = Math.min(1, sinkRate / 8);
    this.playBurst(0.15 + intensity * 0.2, 0.25 + intensity * 0.5, 500 - intensity * 250);
  }

  crash() {
    if (!this.ctx) return;
    this.playBurst(1.2, 0.9, 180);
    // Low boom underneath the debris noise.
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 1.0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 1.3);
  }

  playBurst(duration, volume, filterHz) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.1);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }
}

function makeNoiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
