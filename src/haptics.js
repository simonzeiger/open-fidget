import * as Haptics from 'expo-haptics';

const safe = (fn) => {
  try {
    const res = fn();
    if (res && typeof res.catch === 'function') {
      res.catch(() => {});
    }
  } catch (_) {
    // Ignore on unsupported platforms (e.g. web preview)
  }
};

export const haptics = {
  tick: () => safe(() => Haptics.selectionAsync()),
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  rigid: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  soft: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

/**
 * Plays a timed sequence of haptic steps: [{ type: 'rigid', delay: 150 }, ...]
 * Returns a cancel function to stop remaining steps immediately.
 */
export function playPattern(steps, onComplete) {
  let cancelled = false;
  const timers = [];
  let elapsed = 0;

  steps.forEach((step) => {
    const t = setTimeout(() => {
      if (cancelled) return;
      if (step.type && haptics[step.type]) {
        haptics[step.type]();
      }
      if (step.onStep) {
        step.onStep();
      }
    }, elapsed);
    timers.push(t);
    elapsed += step.delay ?? 0;
  });

  if (onComplete) {
    const endTimer = setTimeout(() => {
      if (!cancelled) onComplete();
    }, elapsed);
    timers.push(endTimer);
  }

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}
