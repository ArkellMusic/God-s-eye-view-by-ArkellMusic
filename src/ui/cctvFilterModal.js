/** Opens the camera-filter popup listing every camera group with ON/OFF toggles. */
export function _openCctvFilterModal() {
  if (this.destroyed || !this._cctvFilterModal) return;
  this._cctvFilterModalOpen = true;
  this._cctvFilterModal.hidden = false;
  this._cctvFilterBtn?.setAttribute('aria-expanded', 'true');
  // Toggle the transition class on the next frame so `hidden` removal and
  // the opacity transition don't collapse into a single un-animated paint.
  requestAnimationFrame(() => {
    if (this.destroyed) return;
    this._cctvFilterModal?.classList.add('open');
  });
  this._cctvFilterSearch?.focus();
}

/** Closes the camera-filter popup. */
export function _closeCctvFilterModal() {
  if (!this._cctvFilterModalOpen) return;
  this._cctvFilterModalOpen = false;
  if (this._cctvFilterModal) {
    this._cctvFilterModal.classList.remove('open');
    this._cctvFilterModal.hidden = true;
  }
  this._cctvFilterBtn?.setAttribute('aria-expanded', 'false');
  this._cctvFilterBtn?.focus();
}
