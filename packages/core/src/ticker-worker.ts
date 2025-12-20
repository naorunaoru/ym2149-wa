/**
 * Ticker Worker - Background-safe timing for music playback
 *
 * Web Worker timers are not throttled in background tabs on Safari,
 * making this ideal for maintaining steady playback timing.
 *
 * Uses drift correction: runs a fast timer and checks elapsed time
 * to maintain accurate average frame rate despite timer imprecision.
 */

let intervalId: number | null = null;
let frameIntervalMs = 0;
let nextFrameTime = 0;

self.onmessage = (e: MessageEvent<number | 'stop'>) => {
  if (e.data === 'stop') {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  } else if (typeof e.data === 'number') {
    // Clear any existing interval before starting new one
    if (intervalId !== null) {
      clearInterval(intervalId);
    }

    frameIntervalMs = e.data;
    nextFrameTime = performance.now() + frameIntervalMs;

    // Run at ~4ms (fast) and check if it's time to emit a tick
    intervalId = self.setInterval(() => {
      const now = performance.now();
      // Emit ticks for any frames that are due (handles catch-up too)
      while (now >= nextFrameTime) {
        self.postMessage(null);
        nextFrameTime += frameIntervalMs;
      }
    }, 4);
  }
};
