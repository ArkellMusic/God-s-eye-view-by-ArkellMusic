import {
  buildCctvCameraGroups,
  cctvCameraFeedKind,
  cctvCameraGroup,
  cctvGroupLabel,
} from '../data/cctvGroups.js';
import {
  createCctvVideoSurface,
  CCTV_PANEL_SNAPSHOT_OPTIONS,
} from './cctvVideo.js';
export function _calBadgeLabel(badge) {
  switch (badge) {
    case 'calibrated':
      return 'CALIBRATED';
    case 'curated':
      return 'CURATED';
    case 'raw-prior':
      return 'RAW PRIOR';
    default:
      return '--';
  }
}

export function _renderCctvState(state) {
  if (this.destroyed) return;
  if (
    !state?.enabled ||
    !this.actions.isEnabled() ||
    state?.activeCameraId !== this._cctvState?.activeCameraId
  ) {
    this._calibrationEdit?.(false);
  }
  this._cctvState = state || null;
  const cameras = state?.cameras || [];
  const groups = state?.cameraGroups || buildCctvCameraGroups(cameras);
  const visibleGroupIds = new Set(
    state?.visibleCameraGroupIds || groups.map((group) => group.id),
  );
  const feedKind = state?.visibleFeedKind || null;
  const visibleCameras = cameras.filter(
    (camera) =>
      visibleGroupIds.has(cctvCameraGroup(camera).id) &&
      (!feedKind || cctvCameraFeedKind(camera) === feedKind),
  );
  // Highlight the active quick preset (ALL ON = every group on, no feed filter).
  const allGroupsOn =
    groups.length > 0 && groups.every((group) => visibleGroupIds.has(group.id));
  const setActive = (btn, on) => {
    btn?.classList.toggle('is-active', Boolean(on));
    btn?.setAttribute('aria-pressed', String(Boolean(on)));
  };
  setActive(this._cctvFilterAllOnBtn, allGroupsOn && !feedKind);
  setActive(this._cctvFilterAllOffBtn, visibleGroupIds.size === 0);
  setActive(this._cctvFilterSnapshotBtn, feedKind === 'snapshot');
  setActive(this._cctvFilterM3u8Btn, feedKind === 'm3u8');
  if (this._cctvFilterBtn) {
    const visibleCount = groups.reduce(
      (count, group) => count + Number(visibleGroupIds.has(group.id)),
      0,
    );
    this._cctvFilterBtn.textContent = `FILTER CAMERAS (${visibleCount}/${groups.length})`;
    this._cctvFilterBtn.disabled = groups.length === 0;
  }
  if (this._cctvGroupList) {
    const searchQuery = (this._cctvFilterSearch?.value || '')
      .trim()
      .toLocaleLowerCase('es-ES');
    // 1500+ rows: only rebuild the list when something in it changed.
    const listSignature =
      searchQuery +
      '|' +
      (feedKind || '') +
      '|' +
      groups
        .map(
          (group) =>
            `${group.id}:${visibleGroupIds.has(group.id) ? 1 : 0}${group.loading ? 'L' : ''}${group.count}`,
        )
        .join(',');
    const rebuildList = this._cctvGroupListSignature !== listSignature;
    this._cctvGroupListSignature = listSignature;
    if (rebuildList) this._cctvGroupList.replaceChildren();
    for (const group of rebuildList ? groups : []) {
      const isVisible = visibleGroupIds.has(group.id);
      const row = document.createElement('div');
      row.className = 'cctv-group-row';
      row.dataset.cameraGroupRow = 'true';
      const name = cctvGroupLabel(group);
      row.dataset.cameraGroupName = name;
      if (searchQuery && !name.toLocaleLowerCase('es-ES').includes(searchQuery)) {
        row.hidden = true;
      }
      const text = document.createElement('span');
      text.className = 'cctv-group-name';
      text.textContent = name;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'cctv-group-toggle';
      toggle.dataset.cameraGroupId = group.id;
      toggle.setAttribute('aria-pressed', String(isVisible));
      toggle.classList.toggle('is-on', isVisible);
      toggle.classList.toggle('is-off', !isVisible);
      toggle.textContent = group.loading ? '…' : isVisible ? 'ON' : 'OFF';
      row.append(text, toggle);
      this._cctvGroupList.appendChild(row);
    }
  }
  const enabled = !!state?.enabled && !!this.actions.isEnabled();
  const activeId = state?.activeCameraId || '';
  const activeCamera = state?.activeCamera || null;

  // Auto-expand the panel when the active camera CHANGES to a new non-null
  // id while the layer is enabled. Covers click-on-globe, panel controls,
  // and voice (selectCamera/cycleCamera/focusNearest all notify through
  // this subscription). The last-seen guard keeps routine notifications
  // from re-expanding a panel the user deliberately collapsed, and timed
  // auto-hop transitions only expand on the first activation so the panel
  // does not pop open on every hop.
  const effectiveActiveId = enabled ? activeId || null : null;
  const isFirstActivation = this._lastSeenCctvActiveId === null;
  if (
    effectiveActiveId &&
    effectiveActiveId !== this._lastSeenCctvActiveId &&
    (!state?.autoHop || isFirstActivation)
  ) {
    this.actions.setPanelCollapsed('cctv-panel', false, {
      explicit: Boolean(state?.explicitSelection),
    });
  }
  this._lastSeenCctvActiveId = effectiveActiveId;

  this._updateCctvSyncChip(state?.loading, enabled);

  if (this._cctvEnableBtn) {
    this._cctvEnableBtn.classList.toggle('active', enabled);
    this._cctvEnableBtn.textContent = enabled ? 'CCTV ON' : 'CCTV OFF';
  }

  if (this._cctvSelect) {
    const shouldRebuild =
      this._cctvSelect.options.length !== visibleCameras.length ||
      visibleCameras.length !== this._filteredCameraIds?.length ||
      visibleCameras.some(
        (cam, idx) => this._cctvSelect.options[idx]?.value !== cam.id,
      );
    if (shouldRebuild) {
      this._cctvSelect.innerHTML = '';
      this._filteredCameraIds = visibleCameras.map((camera) => camera.id);
      for (const camera of visibleCameras) {
        const option = document.createElement('option');
        option.value = camera.id;
        option.textContent = `${camera.city} · ${camera.name}`;
        this._cctvSelect.appendChild(option);
      }
    }
    this._cctvSelect.disabled = !enabled || visibleCameras.length === 0;
    if (
      activeId &&
      Array.from(this._cctvSelect.options).some((opt) => opt.value === activeId)
    ) {
      this._cctvSelect.value = activeId;
    } else if (!activeId) {
      this._cctvSelect.selectedIndex = -1;
    }
  }

  for (const btn of [
    this._cctvNearestBtn,
    this._cctvPrevBtn,
    this._cctvNextBtn,
  ]) {
    if (!btn) continue;
    btn.disabled = !enabled || visibleCameras.length === 0;
  }
  if (this._cctvFocusBtn) {
    this._cctvFocusBtn.disabled =
      !enabled || visibleCameras.length === 0 || !activeId;
  }

  if (this._cctvCoverageBtn) {
    // Tri-state (viewshed design §3b): off → on (wireframes) → viewshed
    // (color-coded volumes). The click handler cycles; this renders.
    const mode = state?.coverageMode || (state?.showCoverage ? 'on' : 'off');
    this._cctvCoverageBtn.classList.toggle('active', mode !== 'off');
    this._cctvCoverageBtn.textContent =
      mode === 'viewshed'
        ? 'VIEWSHED ON'
        : mode === 'on'
          ? 'COVERAGE ON'
          : 'COVERAGE OFF';
    this._cctvCoverageBtn.disabled = !enabled;
  }

  if (this._cctvAutoHopBtn) {
    const autoHop = !!state?.autoHop;
    this._cctvAutoHopBtn.classList.toggle('active', autoHop);
    this._cctvAutoHopBtn.textContent = autoHop ? 'AUTO HOP ON' : 'AUTO HOP OFF';
    this._cctvAutoHopBtn.disabled = !enabled;
  }

  if (this._cctvProjectionBtn) {
    const showProjection = state?.showProjection !== false;
    this._cctvProjectionBtn.classList.toggle('active', showProjection);
    this._cctvProjectionBtn.textContent = showProjection
      ? 'PROJECTION ON'
      : 'PROJECTION OFF';
    this._cctvProjectionBtn.disabled = !enabled;
  }

  if (this._cctvQualityChip) {
    // CAL badge (cctv-v2 design §3b, amended by LOCKED §9.2 — panel-only,
    // no in-world tint): three states driven by cctv.js's deriveCalBadge,
    // no client-side scoring math. Casing is unified via _calBadgeLabel so
    // the chip and the meta line never drift onto different conventions.
    // Save-gated persistence (viewshed design §3e): unsaved live edits show
    // EDITED on top of whatever the persisted badge state is — SAVE CAL
    // promotes to CALIBRATED, RESET CAL clears.
    const badge = activeCamera?.calBadge || null;
    const dirty = !!activeCamera?.calDirty;
    this._cctvQualityChip.textContent = dirty
      ? 'CAL · EDITED (UNSAVED)'
      : `CAL · ${this._calBadgeLabel(badge)}`;
    this._cctvQualityChip.dataset.calBadge = dirty ? 'edited' : badge || '';
  }

  this._syncCctvCalReadout(enabled, activeCamera);

  if (this._cctvMeta) {
    if (activeCamera) {
      const provider =
        activeCamera.sourceLabel ||
        activeCamera.provider ||
        'Configured Source';
      const statusMsg = activeCamera.sourceMessage
        ? ` · ${activeCamera.sourceMessage}`
        : '';
      // A partner-supplied feed inside a pack names its owner here.
      const credit = activeCamera.credit ? ` · ${activeCamera.credit}` : '';
      const calBadge = activeCamera.calBadge
        ? this._calBadgeLabel(activeCamera.calBadge)
        : '';
      const projLabel = state?.showProjection !== false ? 'MONITOR' : 'OFF';
      this._cctvMeta.textContent = `${activeCamera.city} · HDG ${Math.round(activeCamera.headingDeg)}° · FOV ${Math.round(activeCamera.fovDeg)}° · RANGE ${Math.round(activeCamera.rangeM)}m · ${projLabel}${calBadge ? ` · ${calBadge}` : ''} · ${provider}${credit}${statusMsg}`;
    } else if (cameras.length > 0) {
      this._cctvMeta.textContent = enabled
        ? `${cameras.length} cameras loaded · click a camera to activate`
        : `${cameras.length} cameras loaded · enable CCTV to activate`;
    } else {
      this._cctvMeta.textContent = 'Enable CCTV to load camera intersections';
    }
  }

  // YouTube-sourced cameras (feedType 'youtube') can never feed the pulled
  // HLS/canvas path — their manifest always points segments at a different
  // CDN origin than the playlist, which the proxy's same-origin guard
  // rejects by design (see sameOriginHlsUrl in server/providers/cctv/stream.js).
  // The small panel card never embeds YouTube's own iframe chrome (title,
  // channel, red play button): it shows the same periodically-refreshed
  // still frame as a snapshot camera (server resolves this to a YouTube
  // thumbnail — see youtubeThumbnailFallback in server/providers/cctv.js),
  // with the EXPAND button opening the real IFrame Player only inside the
  // medium popup, via _syncCctvVideoModal.
  const youtubeIntent =
    enabled &&
    activeCamera?.feedType === 'youtube' &&
    !!activeCamera?.youtubeId;
  const liveIntent = enabled && !!activeCamera?.isVideo;

  if (this._cctvVideo) {
    this._cctvVideo.hidden = !liveIntent;
    if (this._cctvFrame) this._cctvFrame.hidden = liveIntent;
    const visible =
      liveIntent &&
      !document.hidden &&
      !this._cctvPanel?.classList.contains('collapsed');
    if (!visible || this._cctvVideoCameraId !== activeId) {
      this._cctvVideoSurface?.stop();
      this._cctvVideoSurface = null;
    }
    this._cctvVideoCameraId = activeId;
    if (visible && !this._cctvVideoSurface) {
      // Panel card: a periodic snapshot, not a full-rate mirror — the real
      // live view lives in the medium modal, opened via the EXPAND button.
      this._cctvVideoSurface = createCctvVideoSurface(
        this._cctvVideo,
        () => this.cctv.getActiveVideoElement?.(),
        CCTV_PANEL_SNAPSHOT_OPTIONS,
      );
    }
  }

  // EXPAND affordance + the medium live-view modal apply to real decoded
  // video feeds (.m3u8/HLS etc.) and to YouTube-embedded live cameras alike
  // — see _cctvVideoModalEligible/_syncCctvVideoModal, which pick the canvas
  // decode or the IFrame Player depending on feedType.
  if (this._cctvExpandBtn) {
    this._cctvExpandBtn.hidden = !liveIntent && !youtubeIntent;
  }
  this._syncCctvVideoModal();

  if (this._cctvFrame && !liveIntent) {
    const nextSrc = enabled ? activeCamera?.frameUrl : null;
    const nextCameraId = enabled ? activeCamera?.id || '' : '';
    const cameraChanged = this._cctvFrame.dataset.cameraId !== nextCameraId;
    const frameLoading = this._cctvFrame.dataset.loading === 'true';
    // A same-camera refresh waits for the current image to settle. Replacing
    // src every 10 seconds can cancel a slow but healthy decode forever and
    // leave SNAPSHOT · OK beside a blank/loading preview. Camera changes are
    // immediate so navigation never waits on the prior camera's request.
    if (
      nextSrc &&
      (cameraChanged ||
        (!frameLoading && this._cctvFrame.dataset.currentSrc !== nextSrc))
    ) {
      this._queueCctvFrame(nextSrc, nextCameraId, cameraChanged);
    }
    if (!nextSrc) {
      this._clearCctvFrame();
    }
  } else if (liveIntent) {
    this._clearCctvFrame();
  }

  this._syncCctvSourceBadge(activeCamera, enabled);
  this._typeCctvSummary(
    state?.summary ||
      'Enable CCTV to start camera-linked intelligence summaries.',
  );
}

export function _typeCctvSummary(text) {
  if (this.destroyed || !this._cctvSummary) return;
  const nextText = String(text || '').trim() || 'No summary available.';
  if (nextText === this._lastCctvSummaryText) return;
  this._lastCctvSummaryText = nextText;

  clearInterval(this._cctvSummaryTypingTimer);
  this._cctvSummary.textContent = '';
  let idx = 0;
  this._cctvSummaryTypingTimer = setInterval(() => {
    if (this.destroyed) return;
    idx += 3;
    if (idx >= nextText.length) {
      this._cctvSummary.textContent = nextText;
      clearInterval(this._cctvSummaryTypingTimer);
      this._cctvSummaryTypingTimer = null;
      return;
    }
    this._cctvSummary.textContent = nextText.slice(0, idx);
  }, 20);
}

export function _updateCctvSyncChip(loading, enabled) {
  if (this.destroyed) return;
  if (!this._cctvSyncChip || !this._cctvSyncLabel || !this._cctvSyncProgress)
    return;
  const total = Number(loading?.total) || 0;
  const loaded = Math.max(0, Math.min(Number(loading?.loaded) || 0, total));
  const busy = !!enabled && !!loading?.active && total > 0;

  if (busy) {
    clearTimeout(this._cctvChipHideTimer);
    this._cctvChipHideTimer = null;
    this._cctvChipWasBusy = true;
    this.actions.setSplitFlapText(this._cctvSyncLabel, 'loading frames');
    // The counter is left plain on purpose: it ticks every few frames
    // during a grid load, and flapping it would read as a slot machine.
    this._cctvSyncProgress.textContent = `${loaded}/${total}`;
    this._cctvSyncChip.classList.add('visible');
    return;
  }

  if (this._cctvChipWasBusy && enabled && total > 0) {
    // Load just completed — flash the final count, then auto-hide.
    this._cctvChipWasBusy = false;
    this.actions.setSplitFlapText(this._cctvSyncLabel, 'camera grid ready');
    this._cctvSyncProgress.textContent = `${total}/${total}`;
    this._cctvSyncChip.classList.add('visible');
    clearTimeout(this._cctvChipHideTimer);
    this._cctvChipHideTimer = window.setTimeout(() => {
      if (this.destroyed) return;
      this._cctvChipHideTimer = null;
      this._cctvSyncChip.classList.remove('visible');
    }, 1500);
    return;
  }

  if (!this._cctvChipHideTimer) {
    this._cctvChipWasBusy = false;
    this._cctvSyncChip.classList.remove('visible');
  }
}
