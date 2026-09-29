import {
  createCctvVideoSurface,
  CCTV_MODAL_LIVE_OPTIONS,
} from './cctvVideo.js';

/**
 * True when the active camera is an actual .m3u8/HLS (or other decoded
 * video) feed, or a YouTube-embedded live camera. Matches the `liveIntent`/
 * `youtubeIntent` gates _renderCctvState uses to pick the panel's still
 * frame vs. its decoded-video canvas.
 */
export function _cctvVideoModalEligible() {
  const state = this._cctvState;
  const activeCamera = state?.activeCamera || null;
  const isYoutube =
    activeCamera?.feedType === 'youtube' && !!activeCamera?.youtubeId;
  return (
    !!state?.enabled &&
    !!this.actions.isEnabled() &&
    (!!activeCamera?.isVideo || isYoutube)
  );
}

/** Opens the medium live-view modal for the active camera's live video feed. */
export function _openCctvVideoModal() {
  if (this.destroyed || !this._cctvVideoModal) return;
  if (!this._cctvVideoModalEligible()) return;
  this._cctvVideoModalOpen = true;
  this._cctvVideoModal.hidden = false;
  // Toggle the transition class on the next frame so `hidden` removal and
  // the opacity transition don't collapse into a single un-animated paint.
  requestAnimationFrame(() => {
    if (this.destroyed) return;
    this._cctvVideoModal?.classList.add('open');
  });
  this._syncCctvVideoModal();
}

/** Closes the medium live-view modal, stops its decode mirror, and unloads
 *  the YouTube iframe (cheapest way to stop that playback). */
export function _closeCctvVideoModal() {
  if (!this._cctvVideoModalOpen) return;
  this._cctvVideoModalOpen = false;
  this._cctvVideoLargeSurface?.stop();
  this._cctvVideoLargeSurface = null;
  this._cctvVideoModalCameraId = null;
  if (this._cctvYoutubeLarge) {
    if (this._cctvYoutubeLarge.src) this._cctvYoutubeLarge.src = '';
    this._cctvYoutubeLarge.hidden = true;
  }
  this._cctvYoutubeLargeCameraId = null;
  if (this._cctvVideoModal) {
    this._cctvVideoModal.classList.remove('open');
    this._cctvVideoModal.hidden = true;
  }
}

/**
 * Keeps the modal's title and video aligned with the active camera while
 * it's open, and auto-closes it if the active feed stops being eligible
 * (camera swapped to a still feed, camera cleared, or CCTV disabled) so the
 * modal never sits open over a dead/blank surface.
 *
 * Picks between the two mutually-exclusive video elements per camera:
 * the canvas decode mirror for real .m3u8/HLS (etc.) feeds, or the YouTube
 * IFrame Player for feedType 'youtube' — a cross-origin iframe's pixels can
 * never be read into the canvas, so it plays directly at modal size instead.
 */
export function _syncCctvVideoModal() {
  if (this.destroyed || !this._cctvVideoModalOpen) return;
  if (!this._cctvVideoModalEligible()) {
    this._closeCctvVideoModal();
    return;
  }
  const state = this._cctvState;
  const activeCamera = state.activeCamera;
  const activeId = state.activeCameraId || '';
  const isYoutube =
    activeCamera.feedType === 'youtube' && !!activeCamera.youtubeId;

  if (this._cctvVideoModalTitle) {
    this._cctvVideoModalTitle.textContent =
      `${activeCamera.city || ''} · ${activeCamera.name || ''}`.trim();
  }

  if (isYoutube) {
    this._cctvVideoLargeSurface?.stop();
    this._cctvVideoLargeSurface = null;
    this._cctvVideoModalCameraId = null;
    if (this._cctvVideoLarge) this._cctvVideoLarge.hidden = true;
    if (this._cctvYoutubeLarge) {
      this._cctvYoutubeLarge.hidden = false;
      if (this._cctvYoutubeLargeCameraId !== activeId) {
        this._cctvYoutubeLarge.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(activeCamera.youtubeId)}?autoplay=1&mute=0&playsinline=1&rel=0`;
        this._cctvYoutubeLargeCameraId = activeId;
      }
    }
    return;
  }

  if (this._cctvYoutubeLarge) {
    if (this._cctvYoutubeLarge.src) this._cctvYoutubeLarge.src = '';
    this._cctvYoutubeLarge.hidden = true;
  }
  this._cctvYoutubeLargeCameraId = null;
  if (this._cctvVideoLarge) this._cctvVideoLarge.hidden = false;

  if (this._cctvVideoModalCameraId !== activeId) {
    this._cctvVideoLargeSurface?.stop();
    this._cctvVideoLargeSurface = null;
  }
  this._cctvVideoModalCameraId = activeId;

  if (this._cctvVideoLarge && !this._cctvVideoLargeSurface) {
    this._cctvVideoLargeSurface = createCctvVideoSurface(
      this._cctvVideoLarge,
      () => this.cctv.getActiveVideoElement?.(),
      CCTV_MODAL_LIVE_OPTIONS,
    );
  }
}
