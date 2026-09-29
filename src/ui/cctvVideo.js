/**
 * Paint a second surface from the projection decoder's hidden <video>.
 *
 * Two cadences share this one implementation:
 *  - the small panel card calls this with a slow `intervalMs` (a few
 *    seconds) and a small `maxWidth`, so it behaves like a still camera
 *    taking periodic snapshots rather than a second full-rate video decode;
 *  - the large live-view modal calls this with a fast `intervalMs` (real
 *    time, ~15-30fps) and a big `maxWidth`, for an actual live view.
 * Both read from the same shared <video> element (see
 * cctv/projection.js#getActiveVideoElement), so opening either — or both —
 * never starts a second network/HLS connection.
 */
export function createCctvVideoSurface(
  canvas,
  getVideo,
  {
    requestFrame = requestAnimationFrame,
    cancelFrame = cancelAnimationFrame,
    maxWidth = 640,
    intervalMs = 1000 / 15,
  } = {},
) {
  const ctx = canvas.getContext('2d');
  let handle = 0;
  let stopped = false;
  let previous = null;
  let previousTime = -1;
  let paintedAt = -Infinity;
  const paint = (now) => {
    if (stopped) return;
    const video = getVideo();
    if (video !== previous) {
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      previous = video;
      previousTime = -1;
    }
    if (
      ctx &&
      video?.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      now - paintedAt >= intervalMs &&
      video.currentTime !== previousTime
    ) {
      const width = Math.min(maxWidth, video.videoWidth);
      const height = Math.max(
        1,
        Math.round((width * video.videoHeight) / video.videoWidth),
      );
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      try {
        ctx.drawImage(video, 0, 0, width, height);
        previousTime = video.currentTime;
        paintedAt = now;
      } catch {
        /* A resolution/decode transition retries on the next frame. */
      }
    }
    handle = requestFrame(paint);
  };
  handle = requestFrame(paint);
  return {
    stop() {
      stopped = true;
      cancelFrame(handle);
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

/** Snapshot cadence for the small panel card: a still every 2.5s, not a live mirror. */
export const CCTV_PANEL_SNAPSHOT_OPTIONS = Object.freeze({
  maxWidth: 360,
  intervalMs: 2500,
});

/** Near real-time cadence for the large live-view modal. */
export const CCTV_MODAL_LIVE_OPTIONS = Object.freeze({
  maxWidth: 1280,
  intervalMs: 1000 / 24,
});
