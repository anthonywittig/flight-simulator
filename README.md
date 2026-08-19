# flight-simulator

A browser-based 3D flight simulator built with [Three.js](https://threejs.org/).
No build step, no install — just open it in a browser.

## Running it

Because the code uses ES modules, it needs to be served over HTTP (opening
`index.html` directly with `file://` won't work in most browsers). Any static
server does the job:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

or

```sh
npx serve .
```

Three.js is vendored in `lib/`, so the simulator works fully offline.

## How to fly

1. Hold **Shift** for full throttle and roll down the runway.
2. At about **120 km/h**, hold **W** (or **↑**) to rotate and lift off.
3. Ease off and climb — watch your airspeed: below ~95 km/h the wings stall.

| Key | Action |
| --- | --- |
| `W` / `S` or `↑` / `↓` | Pitch (nose up / down) |
| `A` / `D` or `←` / `→` | Roll |
| `Q` / `E` | Rudder / ground steering |
| `Shift` / `Ctrl` | Throttle up / down |
| `C` | Cycle camera (chase / cockpit / orbit) |
| `R` | Reset to the runway |
| `H` | Toggle the help panel |

Landing: line up with the runway, throttle back, and touch down gently —
descending faster than ~8 m/s (or hitting the ground far off-level, or
terrain off the runway) counts as a crash. Press `R` to reset.

## What's in the flight model

The physics are simplified but real forces, computed every frame:

- **Thrust** along the nose, scaled by throttle.
- **Lift** proportional to airspeed² and angle of attack, applied along the
  wing normal — with a stall regime below ~26 m/s where lift collapses and
  the nose drops.
- **Drag** — parasitic (speed²) plus induced (grows with angle of attack).
- **Gravity**, side-slip resistance from the fuselage, and a
  coordinated-turn model so banking pulls the nose around.
- Ground handling: rudder steering, rolling friction, brakes at idle
  throttle, and crash detection based on sink rate and attitude.

## Project layout

```
index.html        page shell, HUD markup and styles
js/main.js        renderer, cameras, game loop
js/aircraft.js    aircraft mesh + flight physics
js/world.js       terrain (value-noise heightfield), runway, trees, clouds
js/controls.js    keyboard input with smoothed control axes
js/hud.js         HUD/DOM updates
lib/              vendored Three.js (r160)
```
