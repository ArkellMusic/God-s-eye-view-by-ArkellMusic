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

  // Quick presets. They work on EVERY camera group, including the ones that
  // still live on the server (geojson pack): those are loaded first, smallest
  // groups first so as many as possible fit under the globe's camera limit.
  //   all      -> every group ON, no feed-kind filter
  //   none     -> every group OFF
  //   snapshot -> only still-image cameras, in every group that has any
  //   m3u8     -> only live-video cameras, in every group that has any
  const runPreset = (mode) => () => this._applyCctvFilterPreset(mode);
  this.listen(this._cctvFilterAllOnBtn, 'click', runPreset('all'));
  this.listen(this._cctvFilterAllOffBtn, 'click', runPreset('none'));
  this.listen(this._cctvFilterSnapshotBtn, 'click', runPreset('snapshot'));
  this.listen(this._cctvFilterM3u8Btn, 'click', runPreset('m3u8'));

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

/**
 * Applies one of the FILTER CAMERAS quick presets to the whole catalog.
 * @param {'all'|'none'|'snapshot'|'m3u8'} mode
 */
export async function _applyCctvFilterPreset(mode) {
  if (this.destroyed || this._cctvPresetBusy) return;
  const feedKind = mode === 'snapshot' || mode === 'm3u8' ? mode : null;
  if (mode === 'none') {
    this.cctv.setVisibleCameraGroups?.([], { feedKind: null });
    return;
  }
  const wants = (group) =>
    mode === 'all' ||
    Number(group[mode === 'snapshot' ? 'snapshot' : 'm3u8'] || 0) > 0;
  const groups = (this._cctvState?.cameraGroups || []).filter(wants);
  const pending = groups
    .filter((group) => group.unloaded)
    .sort((a, b) => (a.total || 0) - (b.total || 0));

  this._cctvPresetBusy = true;
  this._cctvFilterModal?.classList.add('is-busy');
  let hitLimit = false;
  let failed = 0;
  try {
    // Show what is already loaded right away, then stream the rest in.
    const loadedIds = groups.filter((g) => !g.unloaded).map((g) => g.id);
    this.cctv.setVisibleCameraGroups?.(loadedIds, { feedKind });
    for (let i = 0; i < pending.length; i += 1) {
      if (this.destroyed) return;
      const group = pending[i];
      if (pending.length > 1) {
        this.actions.showToast?.(
          `Cargando cámaras… ${i + 1}/${pending.length} (${group.name})`,
        );
      }
      const result = await this.cctv.loadCameraGroup?.(group.id);
      if (result?.ok || result?.reason === 'already-loaded') continue;
      if (result?.reason === 'limit') hitLimit = true;
      else if (result?.reason !== 'empty') failed += 1;
    }
    // Loaded groups are now real records: switch on everything that fits.
    const fresh = this._cctvState?.cameraGroups || [];
    const ids = fresh.filter((g) => !g.unloaded && wants(g)).map((g) => g.id);
    this.cctv.setVisibleCameraGroups?.(ids, { feedKind });
    if (hitLimit) {
      this.actions.showToast?.(
        'Límite de cámaras en el globo alcanzado: algunos grupos grandes no se han cargado',
      );
    } else if (failed) {
      this.actions.showToast?.(`${failed} grupo(s) no se pudieron cargar`);
    }
  } finally {
    this._cctvPresetBusy = false;
    this._cctvFilterModal?.classList.remove('is-busy');
  }
}
