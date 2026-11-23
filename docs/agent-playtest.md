# Agent Playtest & Haptic Validation Guide

Open Fidget is an **eyes-free** haptic platform. A mode only succeeds if a player can understand and play it purely through vibration—without seeing the screen or reading internal game state.

This lab gives agents (and humans) two complementary tools:
1. **`scripts/playtest.js`** — Strict **blind** playtest harness where you feel only perceived haptics (`t`, `type`, `felt`, `smeared`).
2. **`scripts/validate.js`** — Automated multi-seed, multi-profile scorecard evaluating solvability, LRA actuator hygiene, silence gaps, and timer cleanup.

---

## 1. Strict Blind Agent Playtest (`scripts/playtest.js`)

During play, `playtest.js` enforces **strict eyes-free isolation**:
- Never exposes `getEvalState()`, `getVisualState()`, internal `cue` labels, or hidden targets.
- Applies human motor jitter and perceptual confusion (`ideal`, `typical`, or `pocket` profiles).
- Reveals ground truth **only** when you run `finish`.

### Option A: Turn-by-Turn Transcript Mode (Best for Shell Agents)

1. **Start a blind session** (prints `header` with `blindInstructions` + `initialHaptics`):
   ```bash
   node scripts/playtest.js start safe --profile typical --seed 1
   ```
   Or target an unregistered prototype directly:
   ```bash
   node scripts/playtest.js start ./src/engine/_template.js --profile typical --seed 1
   ```

2. **Take single turns** with `step`:
   ```bash
   # Touch down and wait 80ms
   node scripts/playtest.js step --input '{"type":"pointer_down","x":0.5,"y":0.5}' --advance 80

   # Wait for timed beats without new input
   node scripts/playtest.js step --advance 420 --jitter
   ```

3. **Run multi-step gestures** in one shell call with `batch` (ideal for smooth thumb sweeps or timed holds):
   ```bash
   node scripts/playtest.js batch '[
     {"input":{"type":"pointer_down","x":0.2,"y":0.5},"advance":40},
     {"input":{"type":"pointer_move","x":0.3,"y":0.5},"advance":60},
     {"input":{"type":"pointer_move","x":0.4,"y":0.5},"advance":60},
     {"input":{"type":"pointer_up","x":0.4,"y":0.5},"advance":100}
   ]'
   ```

4. **Finish and inspect the Post-Playtest Debrief**:
   ```bash
   node scripts/playtest.js finish
   ```
   This reveals `{ durationMs, totalSteps, finalEvalState, actuatorSummary, leakedTimers, blindTimeline }` so you can compare what you *felt* blind against what *actually* happened in the engine.

> Use `--session /tmp/my-session.json` if running multiple concurrent playtests.

### Option B: JSONL Stdin Pipe Mode

For single-process scripts or persistent stdio loops:
```bash
printf '%s\n' \
  '{"input":{"type":"pointer_down","x":0.5,"y":0.5},"advance":450}' \
  '{"advance":420}' \
  '{"advance":420}' \
  '{"advance":420}' \
  '{"input":{"type":"pointer_down","x":0.5,"y":0.5},"advance":50}' \
  '{"cmd":"finish"}' \
  | node scripts/playtest.js pipe ./src/engine/_template.js --profile ideal --seed 1
```

### Normalized Input Events

| `type` | Fields | Notes |
| :--- | :--- | :--- |
| `pointer_down` / `pointer_move` / `pointer_up` / `pointer_cancel` | `x`, `y` (`0..1`) | Thumb touch & drag on the pad |
| `button_down` / `button_up` | — | Dedicated press/hold input |
| `dial` | `deltaSteps` (int) | Discrete rotary steps |
| `imu` | `ax`, `ay`, `az` | Normalized tilt/acceleration |
| `squeeze` | `pressure` (`0..1`) | Pressure input, e.g. `{ type: 'squeeze', pressure: 0.7 }` |
| `action` | `name`, `value?` | Mode actions (e.g., `start`, `reset`, `replay`) |

---

## 2. Automated Validator (`scripts/validate.js`)

Run automated evaluation across seeds and human profiles (`ideal`, `typical`, `pocket`):
```bash
# Single registered mode, prototype id, or prototype file
node scripts/validate.js safe
node scripts/validate.js pulse-catch
node scripts/validate.js ./src/engine/_template.js

# All registered modes
node scripts/validate.js --all

# Custom flags
node scripts/validate.js safe --variant strict --seeds 12 --profiles ideal,typical --json --strict
```

### Two-Track Evaluation (`puzzle` vs. `fidget` / `pacer`)

`validate.js` evaluates modes according to their `kind` (or `variantKinds[variant]`):
- **`puzzle`** — Requires solving/progressing strictly above a random baseline (`idealLift` / `typicalLift` / `pocketLift`) using only perceived haptic cues, alongside LRA hygiene and timer cleanup.
- **`fidget` / `pacer`** — Does not require beating a random solver on score; instead checks responsive haptic output during active exploration, absence of dead-air stalls, LRA collision/acoustic hygiene, and clean `dispose()`.

### Interpreting the Scorecard & Verdicts

- **`PASS`** — Mode passes contract checks, active play solves/progresses reliably across profiles, LRA hygiene is clean, and `leakedTimers === 0`.
- **`NEEDS_TUNING`** — Playable, but exhibits friction under noise (`typical`/`pocket` drop-off), tight haptic gaps, moderate acoustic buzz, or weak tactile distinction. (Exits `0` by default, or `1` with `--strict`).
- **`FAIL`** — Contract violation, unsolvable/stuck loop, severe LRA collisions (`< 35ms` gaps causing smearing), excessive silence during active exploration, or leaked timers on `dispose()`.

Key metrics to watch when tuning:
- **`hardCollisions` (`< 35ms` between pulses):** Physical LRA actuators smear pulses closer than ~35ms into one muddy buzz. Keep deliberate spacing `>= 55ms`.
- **`acousticRisk` / `pulsesPerSecond`:** High pulse density becomes audible in a quiet room—bad for discreet pocket fidgeting.
- **`maxSilentGapMs` (during active exploration):** Long dead zones while the thumb is moving make an eyes-free mode feel broken.
- **`leakedTimers`:** Must always be `0` after `dispose()`.

---

## 3. Prototyping a New Haptic Game

1. **Copy the starter template & anchor the physical pitch:**
   ```bash
   cp src/engine/_template.js src/engine/myIdea.js
   ```
   Before coding, anchor every new pitch with a **Hardware Input Metaphor** (what real physical mechanism the thumb is manipulating, e.g., detent dial, spring latch, ball-in-cup) and a **Flat-Glass Caveat** (how it compensates for smooth glass having no raised edges, mechanical stops, or continuous force feedback).
2. **Design eyes-free first:**
   - Write `blindInstructions` before writing gameplay code. If you cannot explain the cues in 2–3 sentences without visuals, simplify the haptic vocabulary.
   - Give distinct meanings distinct haptic weights (e.g., `tick` for ambient detents, `medium`/`rigid` for boundaries/near-target, `heavy`/`success`/`error` for outcomes) and always include `{ cue: '...' }`.
   - Use `ctx.clock` and `ctx.rng()` exclusively—never `Date.now()`, global `setTimeout`, or `Math.random()`.
   - **Optional hooks:**
     - `actions: [{ name, label }]` — Optional validated array of action buttons surfaced automatically in the Lab prototype player (dispatched as `{ type: 'action', name }`).
     - `blindSolver(blind, { variant, profileName, seed })` — Optional mode-specific blind solver hook used by `validate.js` (receives only the anti-leak `blind` facade—never ground truth).
3. **Blind-playtest it yourself:**
   - Run `scripts/playtest.js start ./src/engine/myIdea.js --profile typical`, play purely from the `felt` outputs, then run `finish` to verify your mental model matched `finalEvalState`.
4. **Tune & validate:**
   - Run `node scripts/validate.js ./src/engine/myIdea.js --strict` and iterate on spacing, tolerances, and feedback until it hits `PASS`.
5. **Publish to the Expo Go `Lab` tab (or graduate to a built-in mode):**
   - Add vetted prototypes (`require('../myIdea')`) to `src/engine/prototypes/index.js` so they appear immediately in the Expo Go **Lab** tab (`PrototypePlayer`) for real-iPhone thumb testing, and record results in `docs/game-log.md`.
   - When a prototype is ready to become a core built-in mode, add it to `src/engine/registry.js` and wire its dedicated UI wrapper in `src/modes/`.

