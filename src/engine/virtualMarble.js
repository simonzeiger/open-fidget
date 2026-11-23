'use strict';

const PEGS = Object.freeze([
  Object.freeze({ x: -0.45, y: -0.42 }),
  Object.freeze({ x: 0.45, y: -0.42 }),
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: -0.45, y: 0.42 }),
  Object.freeze({ x: 0.45, y: 0.42 }),
]);

const TRAYS = Object.freeze(['hole', 'ridges', 'pegs']);
const VALID_TRAYS = new Set(TRAYS);

const VirtualMarbleMode = {
  id: 'marble',
  name: 'Virtual Marble',
  kind: 'puzzle',
  variants: TRAYS,
  variantKinds: Object.freeze({
    ridges: 'fidget',
    pegs: 'fidget',
    hole: 'puzzle',
  }),
  inputs: ['imu', 'action'],
  blindInstructions:
    'Tilt the device to roll an invisible marble in a walled tray. Feel crisp wall bounces, grid ridges, or pegs; in Hole Drop, listen for gentle rim clicks near the hidden hole and hold the marble steady inside to drop it in.',

  create(ctx, config = {}) {
    const cfg = config || {};

    function randomHole() {
      return {
        x: (ctx.rng() - 0.5) * 1.35,
        y: (ctx.rng() - 0.5) * 1.35,
      };
    }

    let tray = 'ridges';
    if (VALID_TRAYS.has(cfg.variant)) {
      tray = cfg.variant;
    } else if (VALID_TRAYS.has(cfg.tray)) {
      tray = cfg.tray;
    }

    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    let cellX = 0;
    let cellY = 0;
    let lastHitMs = -1000;
    let inHoleFrames = 0;
    let zeroX = 0;
    let zeroY = 0;
    let rawX = 0;
    let rawY = 0;
    let hole = randomHole();
    let holesScored = 0;
    let disposed = false;

    let lastNotifiedX = x;
    let lastNotifiedY = y;
    let lastNotifiedTray = tray;
    let lastNotifiedScored = holesScored;
    let lastNotifiedHole = hole;

    function getVisualState() {
      return {
        tray,
        pos: { x, y },
        hole: { x: hole.x, y: hole.y },
        holesScored,
        pegs: PEGS,
      };
    }

    function getEvalState() {
      const distToHole = Math.hypot(hole.x - x, hole.y - y);
      return {
        score: holesScored,
        progress: holesScored,
        tray,
        variantKind: tray === 'hole' ? 'puzzle' : 'fidget',
        pos: { x, y },
        vel: { vx, vy },
        hole: { x: hole.x, y: hole.y },
        distToHole,
        inHoleFrames,
        activeExploration:
          Math.hypot(rawX - zeroX, rawY - zeroY) > 0.05 || Math.hypot(vx, vy) > 0.01,
        phase: tray,
      };
    }

    function notifyIfChanged(force = false) {
      if (typeof ctx.onStateChange !== 'function') return;
      const moved =
        Math.abs(x - lastNotifiedX) > 1e-5 || Math.abs(y - lastNotifiedY) > 1e-5;
      const metaChanged =
        tray !== lastNotifiedTray ||
        holesScored !== lastNotifiedScored ||
        hole !== lastNotifiedHole;
      if (force || moved || metaChanged) {
        lastNotifiedX = x;
        lastNotifiedY = y;
        lastNotifiedTray = tray;
        lastNotifiedScored = holesScored;
        lastNotifiedHole = hole;
        ctx.onStateChange(getVisualState());
      }
    }

    function stepPhysics() {
      if (disposed) return;

      const now = ctx.clock.now();

      // Convert phone tilt into tray acceleration
      const ax = (rawX - zeroX) * 0.042;
      const ay = -(rawY - zeroY) * 0.042;

      vx = (vx + ax) * 0.935;
      vy = (vy + ay) * 0.935;

      // Clamp max velocity
      const speed = Math.hypot(vx, vy);
      if (speed > 0.16) {
        vx = (vx / speed) * 0.16;
        vy = (vy / speed) * 0.16;
      }

      x += vx;
      y += vy;

      // Wall collisions
      const limit = 0.92;
      let wallImpact = 0;
      if (x > limit) {
        x = limit;
        wallImpact = Math.max(wallImpact, Math.abs(vx));
        vx = -vx * 0.52;
      } else if (x < -limit) {
        x = -limit;
        wallImpact = Math.max(wallImpact, Math.abs(vx));
        vx = -vx * 0.52;
      }
      if (y > limit) {
        y = limit;
        wallImpact = Math.max(wallImpact, Math.abs(vy));
        vy = -vy * 0.52;
      } else if (y < -limit) {
        y = -limit;
        wallImpact = Math.max(wallImpact, Math.abs(vy));
        vy = -vy * 0.52;
      }

      if (wallImpact > 0.018 && now - lastHitMs > 75) {
        lastHitMs = now;
        if (wallImpact > 0.08) ctx.haptics.rigid({ cue: 'wall_rigid' });
        else if (wallImpact > 0.045) ctx.haptics.medium({ cue: 'wall_medium' });
        else ctx.haptics.soft({ cue: 'wall_soft' });
      }

      // Tray-specific tactile mechanics
      if (tray === 'ridges') {
        const cx = Math.floor((x + 1) * 3.5);
        const cy = Math.floor((y + 1) * 4.5);
        if ((cx !== cellX || cy !== cellY) && now - lastHitMs > 45) {
          cellX = cx;
          cellY = cy;
          lastHitMs = now;
          if (speed > 0.06) ctx.haptics.light({ cue: 'ridge_cross' });
          else ctx.haptics.tick({ cue: 'ridge_cross' });
        }
      } else if (tray === 'pegs') {
        const pegRadius = 0.17;
        for (let i = 0; i < PEGS.length; i += 1) {
          const p = PEGS[i];
          const dx = x - p.x;
          const dy = y - p.y;
          const d = Math.hypot(dx, dy);
          if (d > 0.001 && d < pegRadius) {
            const nx = dx / d;
            const ny = dy / d;
            x = p.x + nx * pegRadius;
            y = p.y + ny * pegRadius;
            const dot = vx * nx + vy * ny;
            if (dot < 0) {
              vx -= 1.7 * dot * nx;
              vy -= 1.7 * dot * ny;
            }
            if (now - lastHitMs > 70) {
              lastHitMs = now;
              ctx.haptics.rigid({ cue: 'peg_hit' });
            }
          }
        }
      } else if (tray === 'hole') {
        const dx = hole.x - x;
        const dy = hole.y - y;
        const d = Math.hypot(dx, dy);

        if (d < 0.32 && d > 0.01) {
          // Subtle gravity well near the dimple rim
          vx += (dx / d) * 0.006;
          vy += (dy / d) * 0.006;
        }

        if (d < 0.15) {
          inHoleFrames += 1;
          if (inHoleFrames === 1 && now - lastHitMs > 80) {
            lastHitMs = now;
            ctx.haptics.tick({ cue: 'hole_enter' });
          }
          if (inHoleFrames > 14 && speed < 0.045) {
            inHoleFrames = 0;
            ctx.haptics.success({ cue: 'hole_score' });
            holesScored += 1;
            hole = randomHole();
          }
        } else {
          inHoleFrames = 0;
        }
      }

      notifyIfChanged(false);
    }

    const tickTimer = ctx.clock.setInterval(stepPhysics, 25);

    function onInput(event) {
      if (disposed || !event || typeof event.type !== 'string') return;

      if (event.type === 'imu') {
        if (Number.isFinite(event.ax)) rawX = event.ax;
        if (Number.isFinite(event.ay)) rawY = event.ay;
        return;
      }

      if (event.type === 'action') {
        if (event.name === 'set_tray') {
          if (VALID_TRAYS.has(event.value)) {
            tray = event.value;
            inHoleFrames = 0;
            if (tray === 'ridges') {
              cellX = Math.floor((x + 1) * 3.5);
              cellY = Math.floor((y + 1) * 4.5);
            }
            ctx.haptics.tick({ cue: 'tray_change' });
            notifyIfChanged(true);
          }
        } else if (event.name === 'calibrate') {
          zeroX = rawX;
          zeroY = rawY;
          ctx.haptics.medium({ cue: 'calibrate' });
        } else if (event.name === 'reset_marble') {
          x = 0;
          y = 0;
          vx = 0;
          vy = 0;
          inHoleFrames = 0;
          cellX = Math.floor((x + 1) * 3.5);
          cellY = Math.floor((y + 1) * 4.5);
          notifyIfChanged(true);
        }
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      ctx.clock.clearInterval(tickTimer);
    }

    return {
      onInput,
      getVisualState,
      getEvalState,
      dispose,
    };
  },
};

module.exports = VirtualMarbleMode;
