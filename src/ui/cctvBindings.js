import {
  buildCctvCameraGroups,
  cctvCameraGroup,
  cctvCameraFeedKind,
} from '../data/cctvGroups.js';

/**
 * Group ids that contain at least one camera of the given feed kind
 * ('snapshot' or 'm3u8'), used by the FILTER CAMERAS popup's quick-filter
 * buttons. A group only ever mixes feed kinds in rare edge cases, so
 * "contains at least one" is the right rule for a quick preset — the
 * per-group ON/OFF toggle stays available for anyone who needs finer control.
 */
function cctvGroupIdsForFeedKind(cameras, kind) {
  const matching = new Set();
  for (const camera of cameras) {
    if (cctvCameraFeedKind(camera) === kind) {
      matching.add(cctvCameraGroup(camera).id);
    }
  }
  return matching;
}

export function _initCctvPanel() {
  if (!this._cctvPanel) return;

  this.listen(this._cctvFilterBtn, 'click', () => {
    this._openCctvFilterModal();
  });

  // Backdrop and the close button both carry data-cctv-filter-close, so one
  // delegated listener on the modal root covers both.
  this.listen(this._cctvFilterModal, 'click', (event) => {
    if (event.target?.closest?.('[data-cctv-filter-close]')) {
      this._closeCctvFilterModal();
    }
  });

  this.listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && this._cctvFilterModalOpen) {
      this._closeCctvFilterModal();
    }
  });

  // Each row's ON/OFF button toggles that single camera group's visibility.
  this.listen(this._cctvGroupList, 'click', async (event) => {
    const toggle = event.target?.closest?.('button[data-camera-group-id]');
    if (!toggle) return;
    const groups = this._cctvState?.cameraGroups || [];
    const clicked = groups.find(
      (group) => group.id === toggle.dataset.cameraGroupId,
    );
    // A group whose cameras are not on the globe yet: switching it ON loads
    // them from the server (the full catalog is far too big to load at once).
    if (clicked?.unloaded) {
      if (clicked.loading) return;
      const result = await this.cctv.loadCameraGroup?.(clicked.id);
      if (!result?.ok && result?.reason === 'limit') {
        this.actions.showToast?.(
          'Límite de cámaras en el globo alcanzado: apaga o recarga otros grupos antes de activar este',
        );
      } else if (!result?.ok && result?.reason === 'error') {
        this.actions.showToast?.('No se pudo cargar este grupo de cámaras');
      }
      return;
    }
    const visible = new Set(
      this._cctvState?.visibleCameraGroupIds || groups.map((group) => group.id),
    );
    const groupId = toggle.dataset.cameraGroupId;
    if (visible.has(groupId)) visible.delete(groupId);
    else visible.add(groupId);
    this.cctv.setVisibleCameraGroups?.([...visible]);
  });

  this.listen(this._cctvFilterAllOnBtn, 'click', () => {
    const groups = this._cctvState?.cameraGroups || [];
    this.cctv.setVisibleCameraGroups?.(groups.map((group) => group.id));
  });

  this.listen(this._cctvFilterAllOffBtn, 'click', () => {
    this.cctv.setVisibleCameraGroups?.([]);
  });

  // Quick presets: show only still-image cameras, or only live-video
  // (.m3u8/HLS, including YouTube-embedded live) cameras. These act on the
  // same group visibility as the per-row ON/OFF toggles above, so a group
  // with any camera of the chosen kind switches on and the rest switch off.
  this.listen(this._cctvFilterSnapshotBtn, 'click', () => {
    const cameras = this._cctvState?.cameras || [];
    const groups = this._cctvState?.cameraGroups || buildCctvCameraGroups(cameras);
    const matchingIds = cctvGroupIdsForFeedKind(cameras, 'snapshot');
    this.cctv.setVisibleCameraGroups?.(
      groups.filter((group) => matchingIds.has(group.id)).map((group) => group.id),
    );
  });

  this.listen(this._cctvFilterM3u8Btn, 'click', () => {
    const cameras = this._cctvState?.cameras || [];
    const groups = this._cctvState?.cameraGroups || buildCctvCameraGroups(cameras);
    const matchingIds = cctvGroupIdsForFeedKind(cameras, 'm3u8');
    this.cctv.setVisibleCameraGroups?.(
      groups.filter((group) => matchingIds.has(group.id)).map((group) => group.id),
    );
  });

  // Search box only hides/shows rows already in the DOM; it never touches
  // on/off state, so filtering the list never changes what's visible.
  this.listen(this._cctvFilterSearch, 'input', () => {
    const query = (this._cctvFilterSearch.value || '')
      .trim()
      .toLocaleLowerCase('es-ES');
    const rows = this._cctvGroupList?.querySelectorAll(
      '[data-camera-group-row]',
    );
    for (const row of rows || []) {
      const name = (row.dataset.cameraGroupName || '').toLocaleLowerCase(
        'es-ES',
      );
      row.hidden = query.length > 0 && !name.includes(query);
    }
  });

  this.listen(this._cctvEnableBtn, 'click', async () => {
    this._actionGeneration++;
    await this.actions.toggleEnabled();
  });

  this.listen(this._cctvNearestBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    this.actions.runExplicitFocus(
      () => this.cctv.focusNearest({ focus: false }),
      (cameraId) => this.cctv.focusCamera(cameraId, 1.8),
    );
  });

  this.listen(this._cctvPrevBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    this.actions.runExplicitFocus(
      () => this.cctv.cycleCamera(-1),
      (cameraId) => this.cctv.focusCamera(cameraId, 1.4),
    );
  });

  this.listen(this._cctvNextBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    this.actions.runExplicitFocus(
      () => this.cctv.cycleCamera(1),
      (cameraId) => this.cctv.focusCamera(cameraId, 1.4),
    );
  });

  this.listen(this._cctvSelect, 'change', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    const cameraId = this._cctvSelect.value;
    if (!cameraId) return;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    // Picking a camera from the dropdown flies to it. The catalog spans
    // three metros, so a bare selection used to leave the view in the old
    // city with a camera active thousands of km away.
    this.actions.runExplicitFocus(
      () => (this.cctv.selectCamera(cameraId) ? cameraId : null),
      (selectedId) => this.cctv.focusCamera(selectedId, 2.2),
    );
    this.actions.setParams({ selectedCameraId: cameraId }, { origin: 'user' });
  });

  this.listen(this._cctvFocusBtn, 'click', async () => {
    const generation = ++this._actionGeneration;
    const activeId = this._cctvState?.activeCameraId;
    const selected = this._cctvState?.activeCameraId || this._cctvSelect?.value;
    if (!selected) return;
    if (!(await this.actions.toggleEnabled(true))) return;
    if (
      this.destroyed ||
      generation !== this._actionGeneration ||
      !this.actions.isEnabled() ||
      (activeId && activeId !== this._cctvState?.activeCameraId)
    )
      return;
    this.actions.runExplicitFocus(
      () => selected,
      (cameraId) => this.cctv.focusCamera(cameraId, 1.9),
    );
    this.actions.setParams({ selectedCameraId: selected }, { origin: 'user' });
  });

  this.listen(this._cctvCoverageBtn, 'click', () => {
    const current =
      this._cctvState?.coverageMode ||
      (this._cctvState?.showCoverage ? 'on' : 'off');
    const next =
      current === 'off' ? 'on' : current === 'on' ? 'viewshed' : 'off';
    this.actions.setParams({ coverageMode: next }, { origin: 'user' });
  });

  this.listen(this._cctvAutoHopBtn, 'click', () => {
    const current = !!this._cctvState?.autoHop;
    this.actions.setParams({ autoHop: !current }, { origin: 'user' });
  });

  this.listen(this._cctvProjectionBtn, 'click', () => {
    const current = this._cctvState?.showProjection !== false;
    this.actions.setParams({ showProjection: !current }, { origin: 'user' });
  });

  this.listen(this._cctvAdjustBtn, 'click', () => {
    const current = !!this._cctvState?.calibrationMode;
    this.actions.setParams({ calibrationMode: !current }, { origin: 'user' });
  });

  // Click-to-edit pose readout: each chip swaps to a number input; Enter or
  // blur commits (converted to a calibration offset against basePose),
  // Escape cancels. Delegated so re-renders never re-bind.
  this.listen(this._cctvCalReadout, 'click', (event) => {
    const chip = event.target.closest?.('.cctv-cal-value');
    if (!chip || chip.disabled || chip.querySelector('input')) return;
    this._beginCctvCalValueEdit(chip);
  });

  this.listen(this._cctvCalibSaveBtn, 'click', () => {
    const cameraId = this._activeCctvCameraId();
    if (!cameraId || !this.actions.setParams) return;
    this.actions.setParams(
      {
        selectedCameraId: cameraId,
        calibration: { cameraId, save: true },
      },
      { origin: 'user' },
    );
    this.actions.showToast('CCTV calibration saved');
  });

  this.listen(this._cctvCalibResetBtn, 'click', () => {
    this._resetCctvCalibration();
  });

  this.listen(this._cctvExpandBtn, 'click', () => {
    this._openCctvVideoModal();
  });

  // Backdrop and the close button both carry data-cctv-modal-close, so one
  // delegated listener on the modal root covers both.
  this.listen(this._cctvVideoModal, 'click', (event) => {
    if (event.target?.closest?.('[data-cctv-modal-close]')) {
      this._closeCctvVideoModal();
    }
  });

  this.listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && this._cctvVideoModalOpen) {
      this._closeCctvVideoModal();
    }
  });

  this._renderCctvState(null);
  this.actions.syncViewport();
}
