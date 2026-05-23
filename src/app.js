/* ═══════════════════════════════════════════════════════════════
   Serial Debug Assistant Pro — Renderer (app.js)
   ═══════════════════════════════════════════════════════════════ */

// ── Node module imports (nodeIntegration enabled) ──
const Chart = require('chart.js/auto');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');

// ── State ──
const state = {
  connected: false,
  connectionMode: 'serial',
  displayMode: 'string',    // 'string' | 'hex' | 'both'
  sendMode: 'string',       // 'string' | 'hex'
  encoding: 'UTF-8',
  sendEncoding: 'UTF-8',
  autoFrameBreak: true,
  frameBreakMs: 50,
  autoScroll: true,
  rxCount: 0,
  txCount: 0,

  // Frame break accumulator
  frameBuffer: [],
  frameTimer: null,

  // Waveform
  waveformEnabled: true,
  waveformPaused: false,
  waveformPoints: 500,
  waveformData: [],          // array of {timestamp, channels: {label:val}}
  channelConfigs: {},        // { ch0: {name, displayMode, color, scale, offset, visible} }
  waveformLineBuffer: '',    // accumulator for partial lines
  waveformMode: 'scope',     // scope mode only (plotter removed)
  waveformDirty: false,      // flag for throttled chart updates
  waveformRAF: null,         // requestAnimationFrame ID
  waveformAmpDiv: 5.0,       // scope: amplitude per division
  waveformMsDiv: 50,         // scope: ms per division
  waveformDataRateMs: 1.0,   // scope: manual data rate (ms between points)
  scopeTimingMode: 'auto',   // 'auto' (real timestamps) | 'manual' (user-defined data rate)
  waveformYCenter: 0,        // scope: Y-axis center offset

  // Commands (600 slots, paged 20 per page)
  commands: new Array(600).fill(null),
  cmdPage: 0,
  cmdPerPage: 20,

  // Sequence
  sequence: [],
  seqRunning: false,
  seqLoop: false,
  seqAbort: false,

  // Script
  scriptRunning: false,

  // Send repeat
  sendRepeatTimer: null,

  // Terminal
  terminal: null,
  terminalFitAddon: null,

  // Auto-reconnect
  autoReconnect: false,
  autoReconnectTimer: null,

  // Show timestamp
  showTimestamp: true,

  // Monitor pause
  monitorPaused: false,

  // Send history
  sendHistory: [],        // [{text, pinned}]
  sendHistoryMax: 100,
  sendHistoryIndex: -1,   // cursor for up/down arrow navigation

  // Math channels
  mathChannels: [],       // [{name, expr, color, editIndex?}]
  mathEditIndex: -1,

  // Sequence edit
  seqEditIndex: -1,

  // Data sampling
  dataSampling: false,     // sample every Nth point
  dataSampleRate: 2,       // sample every Nth point

  // Performance monitoring
  dataRateCounter: 0,
  dataRatePerSec: 0,
  dataRateWarningShown: false,
  lastCleanupTime: Date.now(),

  // Search/Filter
  searchQuery: '',
  searchFilterRx: true,
  searchFilterTx: true,

  // Channel activity tracking (for dynamic label updates)
  channelLastSeen: {},     // { channelName: timestamp }
  channelOfflineMs: 3000,  // mark offline after 3s

  // Command macros
  commandMacros: {},       // { slotIndex: keyCode }
  macroListenerActive: false,

  // Waveform multi-window splits
  waveformWindows: [],     // [{id, chartInstance, channels:[], ...}]
  waveformWindowIdCounter: 0,
  _lastChCount: 0,          // tracks channel count for per-view legend re-renders

  // Command repeat/function state per slot
  commandRepeatConfigs: {}, // { slotIndex: { repeatCount, intervalMs, functionMode, functionExpr, functionRate, functionDuration } }
  activeCommandTimers: {},  // { slotIndex: timerRef }
};

// ── Default channel colors ──
const CHANNEL_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6',
  '#a855f7', '#f97316', '#84cc16', '#e11d48',
  '#0ea5e9', '#d946ef', '#facc15', '#10b981',
];

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initWindowControls();
  initSidebar();
  initConnectionBar();
  initDisplayToolbar();
  initSendPanel();
  initWaveformPanel();
  initCommandManager();
  initSequencePanel();
  initScriptPanel();
  initTerminalPanel();
  initSettingsPanel();
  initSplitView();
  initAutoReconnect();
  initSendHistory();
  initMathChannels();
  initSeqEditModal();
  initTimestampToggle();
  initSearchBar();
  initAppErrorHandler();
  initPerformanceMonitor();
  initWaveformSendPanel();
  initCommandMacros();
  initWaveformContextMenu();
  loadSavedState();
  loadTheme();
  loadSendHistory();
  refreshPorts();

  // Save settings on close
  window.addEventListener('beforeunload', saveState);
});

// ══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 300ms ease-out';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ══════════════════════════════════════════════════════════
// WINDOW CONTROLS
// ══════════════════════════════════════════════════════════
function initWindowControls() {
  document.getElementById('btn-minimize').addEventListener('click', () => window.serialDebug.window.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.serialDebug.window.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.serialDebug.window.close());

  if (window.serialDebug.window.onMaximized) {
    window.serialDebug.window.onMaximized((isMax) => {
      const btn = document.getElementById('btn-maximize');
      if (isMax) {
        btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path fill="currentColor" d="M 2,0 2,2 0,2 0,10 8,10 8,8 10,8 10,0 Z M 3,1 9,1 9,7 8,7 8,2 3,2 Z M 1,3 7,3 7,9 1,9 Z"/></svg>';
      } else {
        btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path fill="currentColor" d="M 0,0 0,10 10,10 10,0 Z M 1,1 9,1 9,9 1,9 Z"/></svg>';
      }
    });
  }
}

// ══════════════════════════════════════════════════════════
// SIDEBAR NAVIGATION
// ══════════════════════════════════════════════════════════
function initSidebar() {
  const buttons = document.querySelectorAll('.sidebar__btn[data-panel]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.panel;
      if (!panelId) return;

      // Update tab active states
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const primaryPane = document.getElementById('split-primary');
      const content = document.getElementById('content-area');
      const isSplit = content.classList.contains('split-mode');

      // Deactivate all panels in primary pane
      primaryPane.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

      const targetPanel = document.getElementById(`panel-${panelId}`);

      // If target is in secondary split, swap it to primary
      if (isSplit) {
        const secondary = document.getElementById('split-secondary');
        if (secondary.contains(targetPanel)) {
          // Find currently active in primary (if any) and move to secondary
          const oldPrimary = primaryPane.querySelector('.panel.active');
          // Move target from secondary to primary
          targetPanel.classList.remove('active');
          primaryPane.appendChild(targetPanel);

          // If there was an active primary, it was just deactivated above,
          // move it to secondary as the new secondary panel
          if (oldPrimary) {
            secondary.appendChild(oldPrimary);
            oldPrimary.classList.add('active');
            const select = document.getElementById('split-panel-select');
            select.value = oldPrimary.id.replace('panel-', '');
          }
        }

        // Update split dropdown disabled state
        const select = document.getElementById('split-panel-select');
        Array.from(select.options).forEach(opt => {
          opt.disabled = (opt.value === panelId);
        });
      }

      targetPanel.classList.add('active');

      // Toggle panel-specific tools in the left sidebar
      document.querySelectorAll('.panel-tools').forEach(t => {
        if (t.dataset.for === panelId) {
          t.classList.remove('hidden');
        } else {
          t.classList.add('hidden');
        }
      });

      // Fit terminal when switching
      if (panelId === 'terminal' && state.terminal && state.terminalFitAddon) {
        setTimeout(() => state.terminalFitAddon.fit(), 50);
      }
      // Resize waveform chart when switching
      if (panelId === 'waveform') {
        setTimeout(() => state.waveformViews.forEach(v => { if (v.chart) v.chart.resize(); }), 50);
      }
    });
  });
}

// ══════════════════════════════════════════════════════════
// CONNECTION BAR
// ══════════════════════════════════════════════════════════
function initConnectionBar() {
  const modeSelect = document.getElementById('conn-mode');
  modeSelect.addEventListener('change', () => {
    state.connectionMode = modeSelect.value;
    updateConnectionFields();
  });

  // Custom baud rate toggle
  document.getElementById('serial-baud').addEventListener('change', (e) => {
    const customInput = document.getElementById('serial-baud-custom');
    customInput.style.display = e.target.value === 'custom' ? '' : 'none';
  });

  // Refresh ports
  document.getElementById('btn-refresh-ports').addEventListener('click', refreshPorts);

  // Port config modal (if present — settings may be inline)
  const btnPortConfig = document.getElementById('btn-port-config');
  if (btnPortConfig) {
    btnPortConfig.addEventListener('click', () => {
      document.getElementById('modal-port-config').classList.remove('hidden');
    });
  }
  const modalPortClose = document.getElementById('modal-port-config-close');
  if (modalPortClose) {
    modalPortClose.addEventListener('click', () => {
      document.getElementById('modal-port-config').classList.add('hidden');
    });
  }
  const modalPortOk = document.getElementById('modal-port-config-ok');
  if (modalPortOk) {
    modalPortOk.addEventListener('click', () => {
      document.getElementById('modal-port-config').classList.add('hidden');
    });
  }

  // Connect / Disconnect
  document.getElementById('btn-connect').addEventListener('click', toggleConnection);
}

function updateConnectionFields() {
  document.getElementById('serial-fields').classList.toggle('hidden', state.connectionMode !== 'serial');
  document.getElementById('tcp-fields').classList.toggle('hidden', !state.connectionMode.startsWith('tcp'));
  document.getElementById('udp-fields').classList.toggle('hidden', state.connectionMode !== 'udp');
}

async function refreshPorts() {
  try {
    const ports = await window.serialDebug.serial.listPorts();
    const select = document.getElementById('serial-port');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Select port...</option>';
    ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path;
      opt.textContent = `${p.path} — ${p.friendlyName}`;
      select.appendChild(opt);
    });
    if (currentVal) select.value = currentVal;
    if (ports.length > 0) {
      showToast(`Found ${ports.length} serial port(s)`, 'info', 2000);
    }
  } catch (err) {
    showToast('Error listing ports: ' + err, 'error');
  }
}

async function toggleConnection() {
  if (state.connected) {
    await disconnectCurrent();
  } else {
    await connectCurrent();
  }
}

async function connectCurrent() {
  const mode = state.connectionMode;
  let result;

  try {
    if (mode === 'serial') {
      const port = document.getElementById('serial-port').value;
      if (!port) { showToast('Please select a serial port', 'warning'); return; }
      const baudSelect = document.getElementById('serial-baud');
      let baudRate = baudSelect.value === 'custom'
        ? parseInt(document.getElementById('serial-baud-custom').value)
        : parseInt(baudSelect.value);

      result = await window.serialDebug.serial.connect({
        path: port,
        baudRate,
        dataBits: document.getElementById('cfg-data-bits').value,
        stopBits: document.getElementById('cfg-stop-bits').value,
        parity: document.getElementById('cfg-parity').value,
        flowControl: document.getElementById('cfg-flow-control').value,
      });
    } else if (mode === 'tcp-client') {
      result = await window.serialDebug.tcp.connect({
        host: document.getElementById('tcp-host').value,
        port: document.getElementById('tcp-port').value,
      });
    } else if (mode === 'tcp-server') {
      result = await window.serialDebug.tcp.startServer({
        host: '0.0.0.0',
        port: document.getElementById('tcp-port').value,
      });
    } else if (mode === 'udp') {
      result = await window.serialDebug.udp.bind({
        port: document.getElementById('udp-local-port').value,
      });
    }

    if (result && !result.success) {
      showToast('Connection failed: ' + result.error, 'error');
      return;
    }

    state.connected = true;
    // Reset waveform state on new connection for clean labels
    state.channelConfigs = {};
    state.channelLastSeen = {};
    state.waveformData = [];
    state.waveformLineBuffer = '';
    state._waveformSampleCounter = 0;
    state._lastChCount = 0;
    state.waveformViews.forEach(v => {
      if (v.chart) { v.chart.data.labels = []; v.chart.data.datasets = []; v.chart.update('none'); }
    });
    state.waveformViews.forEach(v => renderViewLegend(v));
    const legend = document.getElementById('waveform-legend');
    if (legend) { legend.innerHTML = ''; legend._lastChCount = 0; legend._needsRender = true; }
    updateConnectionUI();
    setupDataListeners();
    showToast(`Connected via ${mode}`, 'success');
  } catch (err) {
    showToast('Connection error: ' + err, 'error');
  }
}

async function disconnectCurrent() {
  try {
    const mode = state.connectionMode;
    if (mode === 'serial') {
      window.serialDebug.serial.removeAllListeners();
      await window.serialDebug.serial.disconnect();
    } else if (mode.startsWith('tcp')) {
      window.serialDebug.tcp.removeAllListeners();
      await window.serialDebug.tcp.disconnect();
    } else if (mode === 'udp') {
      window.serialDebug.udp.removeAllListeners();
      await window.serialDebug.udp.close();
    }
    state.connected = false;
    updateConnectionUI();
    showToast('Disconnected', 'info');
  } catch (err) {
    showToast('Disconnect error: ' + err, 'error');
  }
}

function updateConnectionUI() {
  const dot = document.getElementById('status-dot');
  const btn = document.getElementById('btn-connect');
  const statusLabel = document.querySelector('.status-label');

  if (state.connected) {
    dot.classList.add('connected');
    dot.classList.remove('error');
    btn.className = 'btn btn-danger btn-block btn-sm';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Disconnect`;
    if (statusLabel) statusLabel.textContent = 'Connected';
  } else {
    dot.classList.remove('connected');
    btn.className = 'btn btn-success btn-block btn-sm';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Connect`;
    if (statusLabel) statusLabel.textContent = 'Disconnected';
  }
}

// ══════════════════════════════════════════════════════════
// DATA LISTENERS
// ══════════════════════════════════════════════════════════
function setupDataListeners() {
  const mode = state.connectionMode;
  const handleData = (rawData) => {
    state.rxCount += rawData.length;
    updateCountBadges();

    // Feed to script engine
    if (state.scriptRunning) {
      window.serialDebug.script.feedData(rawData);
    }

    // Feed to terminal
    if (state.terminal) {
      const text = bufferToString(rawData, state.encoding);
      state.terminalBuffer = (state.terminalBuffer || '') + text;
      if (!state.terminalRAF) {
        state.terminalRAF = requestAnimationFrame(() => {
          state.terminal.write(state.terminalBuffer);
          state.terminalBuffer = '';
          state.terminalRAF = null;
        });
      }
    }

    // Frame break logic
    if (state.autoFrameBreak) {
      state.frameBuffer.push(...rawData);
      clearTimeout(state.frameTimer);
      state.frameTimer = setTimeout(() => {
        flushFrame('rx', [...state.frameBuffer]);
        state.frameBuffer = [];
      }, state.frameBreakMs);
    } else {
      flushFrame('rx', rawData);
    }

    // Waveform parsing
    if (state.waveformEnabled) {
      parseWaveformData(rawData);
    }
  };

  if (mode === 'serial') {
    window.serialDebug.serial.onData(handleData);
    window.serialDebug.serial.onError((err) => {
      showToast('Serial error: ' + err, 'error');
    });
    window.serialDebug.serial.onClosed(() => {
      state.connected = false;
      updateConnectionUI();
      showToast('Serial port disconnected', 'warning');
    });
  } else if (mode.startsWith('tcp')) {
    window.serialDebug.tcp.onData(handleData);
    window.serialDebug.tcp.onError((err) => showToast('TCP error: ' + err, 'error'));
    window.serialDebug.tcp.onClosed(() => {
      state.connected = false;
      updateConnectionUI();
      showToast('TCP connection closed', 'warning');
    });
    if (mode === 'tcp-server') {
      window.serialDebug.tcp.onClientConnected((info) => {
        showToast(`Client connected: ${info.address}:${info.port}`, 'info');
      });
    }
  } else if (mode === 'udp') {
    window.serialDebug.udp.onData((data, rinfo) => {
      handleData(data);
    });
  }
}

// ══════════════════════════════════════════════════════════
// DATA DISPLAY
// ══════════════════════════════════════════════════════════
function initDisplayToolbar() {
  // Display mode segmented control
  document.querySelectorAll('#display-mode .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#display-mode .segmented__btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.displayMode = btn.dataset.mode;
    });
  });

  // Encoding
  document.getElementById('display-encoding').addEventListener('change', (e) => {
    state.encoding = e.target.value;
  });

  // Frame break
  document.getElementById('auto-frame-break').addEventListener('change', (e) => {
    state.autoFrameBreak = e.target.checked;
  });
  document.getElementById('frame-break-ms').addEventListener('change', (e) => {
    state.frameBreakMs = parseInt(e.target.value) || 50;
  });

  // Auto scroll
  document.getElementById('auto-scroll').addEventListener('change', (e) => {
    state.autoScroll = e.target.checked;
  });

  // Monitor pause
  document.getElementById('btn-monitor-pause').addEventListener('click', () => {
    state.monitorPaused = !state.monitorPaused;
    const btn = document.getElementById('btn-monitor-pause');
    if (state.monitorPaused) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg> Resume';
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
    }
  });

  // Clear
  document.getElementById('btn-clear-data').addEventListener('click', clearDataDisplay);

  // Save
  document.getElementById('btn-save-data').addEventListener('click', saveDataToFile);
}

function flushFrame(direction, rawData) {
  if (state.monitorPaused) return;

  // Track data rate
  state.dataRateCounter++;

  const container = document.getElementById('data-content');

  // Remove placeholder
  if (container.querySelector('div[style*="text-align:center"]')) {
    container.innerHTML = '';
  }

  const frame = document.createElement('div');
  frame.className = 'data-frame';
  frame.dataset.direction = direction;

  const now = new Date();
  const ts = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

  let textContent = '';
  let html = '';
  if (state.showTimestamp) {
    html += `<span class="data-frame__timestamp">${ts}</span>`;
  }
  // Use different colors for RX vs TX chips
  html += `<span class="data-frame__direction data-frame__direction--${direction}">${direction.toUpperCase()}</span>`;

  if (state.displayMode === 'string' || state.displayMode === 'both') {
    const text = bufferToString(rawData, state.encoding);
    textContent = text;
    const escaped = escapeHtml(text).replace(/[\x00-\x1F\x7F]/g, (ch) => {
      if (ch === '\n') return '<br>';
      if (ch === '\r') return '';
      if (ch === '\t') return '&nbsp;&nbsp;';
      const code = ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase();
      return `<span class="non-printable">\\x${code}</span>`;
    });
    html += `<span class="data-frame__content">${escaped}</span>`;
  }

  if (state.displayMode === 'hex' || state.displayMode === 'both') {
    const hex = rawData.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    if (state.displayMode === 'both') html += '<br>';
    html += `<span class="data-frame__hex">${hex}</span>`;
  }

  frame.innerHTML = html;
  frame._textContent = textContent; // cache for search

  // Apply search filter
  if (state.searchQuery || !state.searchFilterRx || !state.searchFilterTx) {
    applySearchToFrame(frame);
  }

  // Use direct append with microtask batching for real-time display
  if (!state.frameBufferNodes) state.frameBufferNodes = [];
  state.frameBufferNodes.push(frame);

  if (!state.frameDrainTimer) {
    state.frameDrainTimer = setTimeout(() => {
      const fragment = document.createDocumentFragment();
      const nodes = state.frameBufferNodes;
      state.frameBufferNodes = [];
      nodes.forEach(f => fragment.appendChild(f));

      container.appendChild(fragment);

      // Limit frames to 500 to prevent freeze
      while (container.children.length > 500) {
        container.removeChild(container.firstChild);
      }

      if (state.autoScroll) {
        container.scrollTop = container.scrollHeight;
      }
      state.frameDrainTimer = null;
    }, 8); // ~120fps drain rate
  }
}

function applySearchToFrame(frame) {
  const dir = frame.dataset.direction;
  // Direction filter
  if (dir === 'rx' && !state.searchFilterRx) { frame.style.display = 'none'; return; }
  if (dir === 'tx' && !state.searchFilterTx) { frame.style.display = 'none'; return; }

  // Text search
  if (state.searchQuery) {
    const text = frame._textContent || frame.textContent;
    if (!text.toLowerCase().includes(state.searchQuery.toLowerCase())) {
      frame.style.display = 'none';
    } else {
      frame.style.display = '';
      // Highlight matches
      const contentSpan = frame.querySelector('.data-frame__content');
      if (contentSpan) {
        const regex = new RegExp(`(${escapeRegex(state.searchQuery)})`, 'gi');
        contentSpan.innerHTML = contentSpan.innerHTML.replace(regex, '<mark class="search-highlight">$1</mark>');
      }
    }
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearDataDisplay() {
  const container = document.getElementById('data-content');
  if (state.frameDrainTimer) {
    clearTimeout(state.frameDrainTimer);
    state.frameDrainTimer = null;
  }
  state.frameBufferNodes = [];
  container.innerHTML = '';
  state.rxCount = 0;
  state.txCount = 0;
  updateCountBadges();

  // Reset waveform channel configs on clear — rebuild from new data
  state.channelConfigs = {};
  state.channelLastSeen = {};
  state.waveformData = [];
  state.waveformLineBuffer = '';
  state._lastChCount = 0;
  state.waveformViews.forEach(v => {
    if (v.chart) { v.chart.data.labels = []; v.chart.data.datasets = []; v.chart.update('none'); }
    v.channelEnabled = {};
  });
  state.waveformViews.forEach(v => renderViewLegend(v));
  const legend = document.getElementById('waveform-legend');
  if (legend) { legend.innerHTML = ''; legend._lastChCount = 0; }
}

let _countBadgeTimer = null;
function updateCountBadges() {
  if (_countBadgeTimer) return; // already scheduled
  _countBadgeTimer = setTimeout(() => {
    _countBadgeTimer = null;
    document.querySelector('#rx-count span').textContent = formatBytes(state.rxCount);
    document.querySelector('#tx-count span').textContent = formatBytes(state.txCount);
  }, 100);
}

async function saveDataToFile() {
  const container = document.getElementById('data-content');
  const text = container.innerText;
  const result = await window.serialDebug.dialog.saveFile({
    title: 'Save Data',
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'Log Files', extensions: ['log'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!result.canceled && result.filePath) {
    await window.serialDebug.file.write(result.filePath, text);
    showToast('Data saved to ' + result.filePath, 'success');
  }
}

// ══════════════════════════════════════════════════════════
// SEND PANEL
// ══════════════════════════════════════════════════════════
function initSendPanel() {
  // Send mode
  document.querySelectorAll('#send-mode .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#send-mode .segmented__btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sendMode = btn.dataset.mode;
    });
  });

  // Send encoding
  document.getElementById('send-encoding').addEventListener('change', (e) => {
    state.sendEncoding = e.target.value;
  });

  // Send button
  document.getElementById('btn-send').addEventListener('click', sendData);

  // Enter to send, Shift+Enter for new line, Up/Down for history
  const sendInput = document.getElementById('send-input');
  sendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendData();
      sendInput.style.height = '32px';
      state.sendHistoryIndex = -1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSendHistory(sendInput, 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateSendHistory(sendInput, -1);
    }
  });
  sendInput.addEventListener('input', () => {
    sendInput.style.height = '32px';
    sendInput.style.height = Math.min(sendInput.scrollHeight, 120) + 'px';
  });

  // Auto repeat
  document.getElementById('send-repeat').addEventListener('change', (e) => {
    if (e.target.checked) {
      const ms = parseInt(document.getElementById('send-repeat-ms').value) || 1000;
      state.sendRepeatTimer = setInterval(sendData, ms);
    } else {
      clearInterval(state.sendRepeatTimer);
      state.sendRepeatTimer = null;
    }
  });
}

async function sendData() {
  if (!state.connected) {
    showToast('Not connected', 'warning');
    return;
  }

  let input = document.getElementById('send-input').value;
  if (!input && state.sendMode === 'string') return;

  const mode = state.connectionMode;
  let result;

  try {
    if (state.sendMode === 'hex') {
      // Send HEX
      const hexStr = input.replace(/[^0-9a-fA-F\s]/g, '');
      if (mode === 'serial') result = await window.serialDebug.serial.sendHex(hexStr);
      else if (mode.startsWith('tcp')) result = await window.serialDebug.tcp.sendHex(hexStr);
      else if (mode === 'udp') {
        result = await window.serialDebug.udp.sendHex(
          hexStr,
          document.getElementById('udp-remote-host').value,
          document.getElementById('udp-remote-port').value
        );
      }

      const bytes = hexStr.replace(/\s+/g, '').match(/.{2}/g) || [];
      const rawBytes = bytes.map(h => parseInt(h, 16));
      state.txCount += rawBytes.length;
      flushFrame('tx', rawBytes);
    } else {
      // Send String
      let data = input;
      if (document.getElementById('send-cr').checked) data += '\r';
      if (document.getElementById('send-newline').checked) data += '\n';

      if (mode === 'serial') result = await window.serialDebug.serial.send(data, state.sendEncoding);
      else if (mode.startsWith('tcp')) result = await window.serialDebug.tcp.send(data, state.sendEncoding);
      else if (mode === 'udp') {
        result = await window.serialDebug.udp.send(
          data,
          document.getElementById('udp-remote-host').value,
          document.getElementById('udp-remote-port').value,
          state.sendEncoding
        );
      }

      const rawBytes = stringToBytes(data, state.sendEncoding);
      state.txCount += rawBytes.length;
      flushFrame('tx', rawBytes);
    }

    updateCountBadges();

    // Add to send history
    addToSendHistory(input);

    if (result && !result.success) {
      showToast('Send failed: ' + result.error, 'error');
    }
  } catch (err) {
    showToast('Send error: ' + err, 'error');
  }
}

// ══════════════════════════════════════════════════════════
// WAVEFORM PANEL
// ══════════════════════════════════════════════════════════
let waveformChart = null;

function initWaveformPanel() {
  document.getElementById('waveform-enabled').addEventListener('change', (e) => {
    state.waveformEnabled = e.target.checked;
  });

  // waveform-points control removed (scope mode uses time-based windowing)

  // Scope timing mode toggle (Auto / Manual)
  document.querySelectorAll('#scope-timing-mode .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#scope-timing-mode .segmented__btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.scopeTimingMode = btn.dataset.mode;
      const rateField = document.getElementById('data-rate-field');
      if (rateField) rateField.style.display = state.scopeTimingMode === 'manual' ? '' : 'none';
      updateChart();
    });
  });

  document.getElementById('waveform-data-rate').addEventListener('change', (e) => {
    state.waveformDataRateMs = parseFloat(e.target.value) || 1.0;
    updateChart();
  });


  // Scope controls (amp/div, offset, ms/div) are now per-view — see buildViewUI()

  document.getElementById('btn-waveform-pause').addEventListener('click', () => {
    state.waveformPaused = !state.waveformPaused;
    const btn = document.getElementById('btn-waveform-pause');
    if (state.waveformPaused) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg> Resume';
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
    }
  });

  document.getElementById('btn-waveform-clear').addEventListener('click', () => {
    state.waveformData = [];
    state.waveformViews.forEach(v => {
      if (v.chart) {
        v.chart.data.labels = [];
        v.chart.data.datasets.forEach(ds => { ds.data = []; });
        v.chart.update('none');
      }
    });
  });

  document.getElementById('btn-waveform-screenshot').addEventListener('click', () => {
    takeAllViewsScreenshot();
  });

  // Channel config toggle & close
  document.getElementById('btn-waveform-config').addEventListener('click', () => {
    const panel = document.getElementById('channel-config');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderChannelConfig();
  });

  const closeBtn = document.getElementById('btn-close-channel-config');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('channel-config').classList.add('hidden');
    });
  }

  // Global label mode selector
  document.getElementById('waveform-label-mode').addEventListener('change', (e) => {
    const mode = e.target.value;
    Object.keys(state.channelConfigs).forEach(key => {
      state.channelConfigs[key].displayMode = mode;
    });
    const legend = document.getElementById('waveform-legend');
    if (legend) legend._needsRender = true;
    updateChart();
    renderChannelConfig();
  });

  // Data sampling controls
  const samplingCb = document.getElementById('data-sampling');
  if (samplingCb) {
    samplingCb.addEventListener('change', (e) => { state.dataSampling = e.target.checked; });
  }
  const sampleRate = document.getElementById('data-sample-rate');
  if (sampleRate) {
    sampleRate.addEventListener('change', (e) => { state.dataSampleRate = Math.max(2, parseInt(e.target.value) || 2); });
  }

  // Init chart
  initChart();
}

function initChart() {
  const ctx = document.getElementById('waveform-canvas').getContext('2d');
  // Reuse shared chart config (defined in getChartConfig()) to avoid duplication
  waveformChart = new Chart(ctx, getChartConfig());

  window.waveformChart = waveformChart;

  // Register view-0 in multi-view system
  const view0El = document.getElementById('waveform-view-0');
  const view0 = {
    id: 0, chart: waveformChart, el: view0El,
    channelEnabled: {}, autoEnableNew: true,
    ampDiv: state.waveformAmpDiv, yCenter: state.waveformYCenter, msDiv: state.waveformMsDiv,
    _legendBar: null, _scaleBar: null,
  };
  state.waveformViews = [view0];
  state.waveformWindowIdCounter = 0;
  state.activeWaveViewId = 0;
  if (view0El) {
    view0El.classList.add('active-view');
    view0El.addEventListener('mousedown', () => setActiveView(0));
    buildViewUI(view0);
  }
}

// ═══════════════════════════════════════════════════════════
// WAVEFORM SPLIT-VIEW ENGINE
// ═══════════════════════════════════════════════════════════

function getChartConfig() {
  return {
    type: 'line', data: { labels: [], datasets: [] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(17,24,39,0.9)', titleColor: '#f1f5f9', bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 8, usePointStyle: true,
          boxWidth: 8, boxHeight: 8,
          titleFont: { family: "'Inter', sans-serif", size: 11 },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
        },
      },
      scales: {
        x: {
          type: 'category', display: true, grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false },
          ticks: { color: '#64748b', font: { family: "'JetBrains Mono', monospace", size: 9 }, maxRotation: 0, maxTicksLimit: 10 }
        },
        xScope: {
          type: 'linear', display: false, grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false },
          ticks: { color: '#64748b', font: { family: "'JetBrains Mono', monospace", size: 9 }, maxRotation: 0, maxTicksLimit: 11 }
        },
        y: {
          display: true, grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false },
          ticks: { color: '#64748b', font: { family: "'JetBrains Mono', monospace", size: 10 } }
        },
      },
      elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.1 } },
    },
  };
}

function buildViewUI(view) {
  const el = view.el;
  const chartWrapper = el.querySelector('.waveform-chart-wrapper');

  // Per-view legend bar (above chart)
  const legendBar = document.createElement('div');
  legendBar.className = 'waveform-view__legend';
  view._legendBar = legendBar;
  el.insertBefore(legendBar, chartWrapper);

  // Compact scale bar (below chart)
  const scaleBar = document.createElement('div');
  scaleBar.className = 'waveform-view__scale-bar';
  scaleBar.innerHTML = `
    <div class="wv-ctrl-group">
      <button class="wv-ctrl-btn" data-act="amp-up" title="Zoom in Y">+</button>
      <div class="wv-ctrl-input-wrap">
        <span class="wv-ctrl-prefix">Y_SCALE</span>
        <input type="number" class="wv-ctrl-input wv-amp" value="${view.ampDiv}" min="0.1" step="0.5" title="Amp/div">
        <span class="wv-ctrl-unit">units/div</span>
      </div>
      <button class="wv-ctrl-btn" data-act="amp-down" title="Zoom out Y">−</button>
    </div>
    <span class="wv-ctrl-sep"></span>
    <div class="wv-ctrl-group">
      <button class="wv-ctrl-btn" data-act="off-up" title="Offset up">▲</button>
      <div class="wv-ctrl-input-wrap">
        <span class="wv-ctrl-prefix">Y_OFFSET</span>
        <input type="number" class="wv-ctrl-input wv-off" value="${view.yCenter}" step="1" title="Y Offset">
        <span class="wv-ctrl-unit">units</span>
      </div>
      <button class="wv-ctrl-btn" data-act="off-down" title="Offset down">▼</button>
    </div>
    <span class="wv-ctrl-sep"></span>
    <div class="wv-ctrl-group">
      <button class="wv-ctrl-btn" data-act="time-down" title="Zoom in time">◀</button>
      <div class="wv-ctrl-input-wrap">
        <span class="wv-ctrl-prefix">X_SCALE</span>
        <input type="number" class="wv-ctrl-input wv-time" value="${view.msDiv}" min="1" step="5" title="ms/div">
        <span class="wv-ctrl-unit">ms/div</span>
      </div>
      <button class="wv-ctrl-btn" data-act="time-up" title="Zoom out time">▶</button>
    </div>
  `;
  el.appendChild(scaleBar);
  view._scaleBar = scaleBar;

  const ampIn = scaleBar.querySelector('.wv-amp');
  const offIn = scaleBar.querySelector('.wv-off');
  const timeIn = scaleBar.querySelector('.wv-time');
  ampIn.addEventListener('change', () => { view.ampDiv = parseFloat(ampIn.value) || 5; scheduleChartUpdate(); });
  offIn.addEventListener('change', () => { view.yCenter = parseFloat(offIn.value) || 0; scheduleChartUpdate(); });
  timeIn.addEventListener('change', () => { view.msDiv = parseFloat(timeIn.value) || 50; scheduleChartUpdate(); });

  scaleBar.querySelectorAll('.wv-ctrl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.act;
      if (a === 'amp-up') { view.ampDiv = Math.max(0.1, view.ampDiv * 0.5); ampIn.value = view.ampDiv; }
      if (a === 'amp-down') { view.ampDiv = Math.min(1e6, view.ampDiv * 2); ampIn.value = view.ampDiv; }
      if (a === 'off-up') { view.yCenter += view.ampDiv; offIn.value = view.yCenter; }
      if (a === 'off-down') { view.yCenter -= view.ampDiv; offIn.value = view.yCenter; }
      if (a === 'time-down') { view.msDiv = Math.max(1, Math.floor(view.msDiv * 0.5)); timeIn.value = view.msDiv; }
      if (a === 'time-up') { view.msDiv = Math.min(5e6, Math.floor(view.msDiv * 2)); timeIn.value = view.msDiv; }
      scheduleChartUpdate();
    });
  });
  renderViewLegend(view);
}

function renderViewLegend(view) {
  const bar = view._legendBar;
  if (!bar) return;
  bar.innerHTML = '';
  const allCh = Object.keys(state.channelConfigs);
  if (allCh.length === 0) { bar.innerHTML = '<span class="wv-legend-hint">Waiting for data…</span>'; return; }
  allCh.forEach(key => {
    const cfg = state.channelConfigs[key];
    if (!cfg) return;
    if (view.channelEnabled[key] === undefined) view.channelEnabled[key] = view.autoEnableNew;
    const on = view.channelEnabled[key];
    let label;
    switch (cfg.displayMode) {
      case 'data': label = cfg.dataLabel; break;
      case 'custom': label = cfg.customName || cfg.channelNumber; break;
      default: label = cfg.channelNumber;
    }
    const item = document.createElement('div');
    item.className = `wv-legend-item${on ? '' : ' off'}`;
    item.innerHTML = `<span class="wv-legend-dot" style="background:${on ? cfg.color : 'transparent'}; border-color:${cfg.color}"></span><span class="wv-legend-name">${label}</span>`;
    item.addEventListener('click', () => { view.channelEnabled[key] = !view.channelEnabled[key]; renderViewLegend(view); scheduleChartUpdate(); });
    bar.appendChild(item);
  });
}

function createWaveformView() {
  const id = ++state.waveformWindowIdCounter;
  const viewEl = document.createElement('div');
  viewEl.className = 'waveform-view';
  viewEl.id = `waveform-view-${id}`;
  viewEl.dataset.viewId = id;
  viewEl.style.cssText = 'flex:1; display:flex; flex-direction:column; position:relative; min-width:80px; min-height:60px;';

  const chartWrapper = document.createElement('div');
  chartWrapper.className = 'waveform-chart-wrapper';
  const chartContainer = document.createElement('div');
  chartContainer.className = 'waveform-container__chart';
  const canvas = document.createElement('canvas');
  chartContainer.appendChild(canvas);
  chartWrapper.appendChild(chartContainer);
  viewEl.appendChild(chartWrapper);

  const chart = new Chart(canvas.getContext('2d'), getChartConfig());
  const view = {
    id, chart, el: viewEl,
    channelEnabled: {}, autoEnableNew: false,
    ampDiv: state.waveformAmpDiv, yCenter: state.waveformYCenter, msDiv: state.waveformMsDiv,
    _legendBar: null, _scaleBar: null,
  };

  viewEl.addEventListener('mousedown', () => setActiveView(id));
  viewEl.addEventListener('contextmenu', (e) => {
    e.preventDefault(); state._ctxMenuViewId = id;
    const m = document.getElementById('wave-ctx-menu');
    if (m) { m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.classList.remove('hidden'); }
  });

  state.waveformViews.push(view);
  buildViewUI(view);
  return view;
}

function splitWaveformView(viewId, direction) {
  const src = state.waveformViews.find(v => v.id === viewId);
  if (!src) return;
  const srcEl = src.el;
  const parent = srcEl.parentElement;
  const newView = createWaveformView();
  const isH = direction === 'split-h';

  const wrap = document.createElement('div');
  wrap.style.cssText = `display:flex; flex:1; flex-direction:${isH ? 'row' : 'column'}; overflow:hidden;`;
  const resizer = document.createElement('div');
  resizer.className = `waveform-split-resizer waveform-split-resizer--${isH ? 'v' : 'h'}`;

  parent.replaceChild(wrap, srcEl);
  wrap.appendChild(srcEl);
  wrap.appendChild(resizer);
  wrap.appendChild(newView.el);
  initSplitResizer(resizer, wrap, isH);
  setTimeout(() => { src.chart.resize(); newView.chart.resize(); }, 60);
  showToast(`Split ${isH ? 'horizontally' : 'vertically'}`, 'info', 2000);
}

function closeWaveformView(viewId) {
  if (state.waveformViews.length <= 1) { showToast('Cannot close the last view', 'warning'); return; }
  const idx = state.waveformViews.findIndex(v => v.id === viewId);
  if (idx === -1) return;
  const view = state.waveformViews[idx];
  if (view.chart) view.chart.destroy();
  const el = view.el, parent = el.parentElement;
  const sibs = Array.from(parent.children).filter(c => c !== el && !c.classList.contains('waveform-split-resizer'));
  if (sibs.length === 1 && parent !== document.getElementById('waveform-split-root')) {
    const gp = parent.parentElement, rem = sibs[0]; rem.style.flex = '1';
    gp.replaceChild(rem, parent);
    const rv = state.waveformViews.find(v => v.el === rem);
    if (rv && rv.chart) setTimeout(() => rv.chart.resize(), 50);
  } else { parent.querySelector('.waveform-split-resizer')?.remove(); el.remove(); }
  state.waveformViews.splice(idx, 1);
  if (state.activeWaveViewId === viewId) setActiveView(state.waveformViews[0].id);
  showToast('View closed', 'info', 1500);
}

function setActiveView(viewId) {
  state.activeWaveViewId = viewId;
  state.waveformViews.forEach(v => v.el.classList.toggle('active-view', v.id === viewId));
}

function initSplitResizer(resizer, wrapper, isH) {
  let startPos, startSizes;
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault(); resizer.classList.add('dragging');
    const ch = Array.from(wrapper.children).filter(c => !c.classList.contains('waveform-split-resizer'));
    startPos = isH ? e.clientX : e.clientY;
    startSizes = ch.map(c => isH ? c.getBoundingClientRect().width : c.getBoundingClientRect().height);
    const onMove = (e2) => {
      const d = (isH ? e2.clientX : e2.clientY) - startPos, t = startSizes[0] + startSizes[1];
      const nf = Math.max(60, Math.min(t - 60, startSizes[0] + d));
      ch[0].style.flex = `${nf / t}`; ch[1].style.flex = `${(t - nf) / t}`;
      state.waveformViews.forEach(v => { if (v.chart) v.chart.resize(); });
    };
    const onUp = () => { resizer.classList.remove('dragging'); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ═══════════════════════════════════════════════════════════
// CHART UPDATE (multi-view aware)
// ═══════════════════════════════════════════════════════════

function scheduleChartUpdate() {
  if (state.waveformDirty) return;
  state.waveformDirty = true;
  if (state.waveformRAF) cancelAnimationFrame(state.waveformRAF);
  state.waveformRAF = requestAnimationFrame(() => {
    state.waveformDirty = false;
    state.waveformRAF = null;
    updateChart();
  });
}

function updateChart() {
  const allChannels = Object.keys(state.channelConfigs);

  // Render global legend (toolbar) with drag support
  const legendContainer = document.getElementById('waveform-legend');
  const nowMs = Date.now();
  if (legendContainer && (legendContainer._lastChCount !== allChannels.length || legendContainer._needsRender || legendContainer._lastRender < nowMs - 1000)) {
    legendContainer.innerHTML = '';
    allChannels.forEach(key => {
      const cfg = state.channelConfigs[key];
      if (!cfg.visible) return;
      const isOffline = !key.startsWith('math_') && state.channelLastSeen[key] && (nowMs - state.channelLastSeen[key] > state.channelOfflineMs);
      let label;
      switch (cfg.displayMode) {
        case 'data': label = cfg.dataLabel; break;
        case 'custom': label = cfg.customName || cfg.channelNumber; break;
        default: label = cfg.channelNumber;
      }
      const item = document.createElement('div');
      item.className = `waveform-legend__item ${isOffline ? 'offline' : ''}`;
      item.innerHTML = `
        <div class="waveform-legend__color" style="background:${isOffline ? '#64748b' : cfg.color}" title="Open channel config"></div>
        <div class="waveform-legend__label" title="Open channel config">${label}${isOffline ? ' <span class="legend-offline-badge">OFFLINE</span>' : ''}</div>
      `;
      item.querySelector('.waveform-legend__color').addEventListener('click', () => {
        const panel = document.getElementById('channel-config');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) renderChannelConfig();
      });
      item.querySelector('.waveform-legend__label').addEventListener('click', () => {
        const panel = document.getElementById('channel-config');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) renderChannelConfig();
      });
      legendContainer.appendChild(item);
    });
    legendContainer._lastChCount = allChannels.length;
    legendContainer._needsRender = false;
    legendContainer._lastRender = nowMs;
  }

  // Update per-view legends when channels change
  if (state._lastChCount !== allChannels.length) {
    state._lastChCount = allChannels.length;
    state.waveformViews.forEach(v => renderViewLegend(v));
  }

  // Update each view's chart
  state.waveformViews.forEach(view => updateSingleViewChart(view, allChannels));
}

function updateSingleViewChart(view, allChannels) {
  const chart = view.chart;
  if (!chart) return;
  let data;

  // Scope mode: time-based X axis with amplitude/div Y axis
  chart.options.scales.x.display = false;
  chart.options.scales.xScope.display = true;
  const totalTimeMs = view.msDiv * 10;
  chart.options.scales.xScope.min = 0;
  chart.options.scales.xScope.max = totalTimeMs;
  // Force grid step to exactly match ms/div so gridmarks are accurate
  chart.options.scales.xScope.ticks.stepSize = view.msDiv;

  if (state.scopeTimingMode === 'manual') {
    // Manual mode: use user-defined data rate for uniform point spacing
    const windowSize = Math.ceil(totalTimeMs / state.waveformDataRateMs) + 1;
    data = state.waveformData.slice(-windowSize);
  } else {
    // Auto mode: use real timestamps for time-based windowing
    const nowTs = state.waveformData.length > 0
      ? state.waveformData[state.waveformData.length - 1].tsMs
      : Date.now();
    const cutoffTs = nowTs - totalTimeMs;
    // Binary-search for the first point >= cutoffTs for efficiency
    let lo = 0, hi = state.waveformData.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (state.waveformData[mid].tsMs < cutoffTs) lo = mid + 1;
      else hi = mid;
    }
    data = state.waveformData.slice(lo);
  }
  const yRange = view.ampDiv * 4;
  chart.options.scales.y.min = view.yCenter - yRange;
  chart.options.scales.y.max = view.yCenter + yRange;

  chart.data.labels = data.map(d => d.timestamp);

  // Filter channels: only show those enabled in this view
  const viewChannels = allChannels.filter(ch => view.channelEnabled[ch] === true);

  const datasets = viewChannels.map(key => {
    const cfg = state.channelConfigs[key];
    if (!cfg || !cfg.visible) return null;
    let label;
    switch (cfg.displayMode) {
      case 'data': label = cfg.dataLabel; break;
      case 'custom': label = cfg.customName || cfg.channelNumber; break;
      default: label = cfg.channelNumber;
    }
    const values = data.map((d, i) => {
      const raw = d.channels[key];
      if (raw === undefined) return null;
      const yVal = raw * cfg.scale + cfg.offset;
      const totalTimeMs = view.msDiv * 10;
      let xVal;
      if (state.scopeTimingMode === 'manual') {
        // Left-to-right: oldest point at x=0, newest grows rightward
        xVal = i * state.waveformDataRateMs;
      } else {
        // Left-to-right: oldest visible point at x=0, newest at elapsed time
        const oldestTs = data[0].tsMs;
        xVal = d.tsMs - oldestTs;
      }
      return { x: Math.min(totalTimeMs, xVal), y: yVal };
    });
    return {
      label, data: values,
      borderColor: cfg.color, backgroundColor: cfg.color,
      pointBackgroundColor: cfg.color, pointBorderColor: cfg.color,
      fill: false, hidden: false,
      xAxisID: 'xScope',
    };
  }).filter(Boolean);

  chart.data.datasets = datasets;
  chart.update('none');
}

function parseWaveformData(rawData) {
  // Convert bytes to string and accumulate partial lines
  const text = bufferToString(rawData, 'UTF-8');
  state.waveformLineBuffer += text;

  // Split into lines
  const lines = state.waveformLineBuffer.split('\n');
  // Keep the last partial line in the buffer
  state.waveformLineBuffer = lines.pop() || '';

  const nowTs = Date.now();
  let channelsChanged = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Data sampling: skip every Nth point
    if (state.dataSampling) {
      state._waveformSampleCounter = (state._waveformSampleCounter || 0) + 1;
      if (state._waveformSampleCounter % state.dataSampleRate !== 0) continue;
    }

    const channels = {};
    let parts;
    if (trimmed.indexOf(',') !== -1) {
      parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    } else if (trimmed.indexOf('\t') !== -1) {
      parts = trimmed.split('\t').map(s => s.trim()).filter(Boolean);
    } else {
      parts = trimmed.split(/\s+/).filter(Boolean);
    }
    let hasLabels = false;
    let chCounter = 0;

    parts.forEach((part) => {
      const p = part.trim();
      if (!p) return;
      const eqPos = p.indexOf('=');
      const colPos = p.indexOf(':');
      let assignPos = -1;
      if (eqPos !== -1 && colPos !== -1) assignPos = Math.min(eqPos, colPos);
      else if (eqPos !== -1) assignPos = eqPos;
      else if (colPos !== -1) assignPos = colPos;

      if (assignPos > 0) {
        const label = p.substring(0, assignPos).trim();
        const valStr = p.substring(assignPos + 1).trim();
        const val = parseFloat(valStr);
        if (!isNaN(val) && label) {
          channels[label] = val;
          hasLabels = true;
        }
      } else {
        const val = parseFloat(p);
        if (!isNaN(val)) {
          chCounter++;
          channels[`ch${chCounter}`] = val;
        }
      }
    });

    if (Object.keys(channels).length === 0) continue;

    const now = new Date();
    const timestamp = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const tsMs = now.getTime();

    state.waveformData.push({ timestamp, tsMs, channels });

    // Trim data — scope-style time-based trimming
    const maxMsDiv = Math.max(...state.waveformViews.map(v => v.msDiv || 50), state.waveformMsDiv);
    if (state.scopeTimingMode === 'manual') {
      // Manual: point-count trimming using data rate
      const maxWindow = Math.ceil((maxMsDiv * 10) / state.waveformDataRateMs) + 1;
      const maxLen = maxWindow * 3;
      if (state.waveformData.length > maxLen) {
        state.waveformData.splice(0, state.waveformData.length - maxLen);
      }
    } else {
      // Auto: time-based trimming using real timestamps
      const keepTimeMs = maxMsDiv * 10 * 3;  // keep 3× the max window duration
      const cutoff = tsMs - keepTimeMs;
      let trimIdx = 0;
      while (trimIdx < state.waveformData.length && state.waveformData[trimIdx].tsMs < cutoff) trimIdx++;
      if (trimIdx > 0) state.waveformData.splice(0, trimIdx);
    }

    // Track channel activity and create new configs dynamically
    const currentKeys = Object.keys(channels);
    currentKeys.forEach((key) => {
      state.channelLastSeen[key] = nowTs;
      if (!state.channelConfigs[key]) {
        const colorIdx = Object.keys(state.channelConfigs).filter(k => !k.startsWith('math_')).length;
        state.channelConfigs[key] = {
          channelNumber: `CH${colorIdx + 1}`,
          dataLabel: key,
          customName: '',
          displayMode: document.getElementById('waveform-label-mode').value || 'channel',
          color: CHANNEL_COLORS[colorIdx % CHANNEL_COLORS.length],
          scale: 1.0,
          offset: 0,
          visible: true,
          chartHidden: false,
        };
        channelsChanged = true;
      }
    });

    // Check for channels that are no longer in the data → mark offline
    Object.keys(state.channelConfigs).forEach(key => {
      if (key.startsWith('math_')) return;
      if (!currentKeys.includes(key) && state.channelLastSeen[key] && (nowTs - state.channelLastSeen[key] > state.channelOfflineMs)) {
        // Channel is offline — will show as gap in chart
      }
    });
  }

  // Force legend re-render if channels changed
  if (channelsChanged) {
    const legend = document.getElementById('waveform-legend');
    if (legend) legend._needsRender = true;
  }

  // Mark chart as needing update
  if (!state.waveformPaused && state.waveformViews.length > 0) {
    scheduleChartUpdate();
  }
}

function renderChannelConfig() {
  const container = document.getElementById('channel-config-list') || document.getElementById('channel-config');
  const channels = Object.keys(state.channelConfigs);

  if (channels.length === 0) {
    container.innerHTML = '<div style="padding:12px; color:var(--text-muted); text-align:center; font-size:12px;">No channels detected yet. Send waveform data to see channels.</div>';
    return;
  }

  container.innerHTML = channels.map(key => {
    const cfg = state.channelConfigs[key];
    return `
      <div class="channel-row" data-channel="${key}">
        <input type="color" class="ch-color" value="${cfg.color}" title="Color">
        <span class="channel-label">${cfg.channelNumber}</span>
        <span class="text-xs text-muted">(${cfg.dataLabel})</span>
        <select class="ch-display-mode" style="width:80px">
          <option value="channel" ${cfg.displayMode === 'channel' ? 'selected' : ''}>CH#</option>
          <option value="data" ${cfg.displayMode === 'data' ? 'selected' : ''}>Label</option>
          <option value="custom" ${cfg.displayMode === 'custom' ? 'selected' : ''}>Custom</option>
        </select>
        <input type="text" class="ch-custom-name" value="${cfg.customName}" placeholder="Name" style="width:80px; ${cfg.displayMode === 'custom' ? '' : 'display:none'}">
        <span class="text-xs text-muted">Scale:</span>
        <input type="number" class="ch-scale" value="${cfg.scale}" step="0.1" min="0.01">
        <span class="text-xs text-muted">Offset:</span>
        <input type="number" class="ch-offset" value="${cfg.offset}" step="1">
        <label class="toggle-switch" title="Visible">
          <input type="checkbox" class="ch-visible" ${cfg.visible ? 'checked' : ''}>
          <span class="toggle-switch__track"></span>
        </label>
      </div>
    `;
  }).join('');

  // Attach events
  container.querySelectorAll('.channel-row').forEach(row => {
    const key = row.dataset.channel;
    const cfg = state.channelConfigs[key];

    row.querySelector('.ch-color').addEventListener('input', (e) => {
      cfg.color = e.target.value;
      updateChart();
    });
    row.querySelector('.ch-display-mode').addEventListener('change', (e) => {
      cfg.displayMode = e.target.value;
      const customInput = row.querySelector('.ch-custom-name');
      customInput.style.display = e.target.value === 'custom' ? '' : 'none';
      updateChart();
    });
    row.querySelector('.ch-custom-name').addEventListener('input', (e) => {
      cfg.customName = e.target.value;
      updateChart();
    });
    row.querySelector('.ch-scale').addEventListener('change', (e) => {
      cfg.scale = parseFloat(e.target.value) || 1;
      updateChart();
    });
    row.querySelector('.ch-offset').addEventListener('change', (e) => {
      cfg.offset = parseFloat(e.target.value) || 0;
      updateChart();
    });
    row.querySelector('.ch-visible').addEventListener('change', (e) => {
      cfg.visible = e.target.checked;
      updateChart();
    });
  });
}

// ══════════════════════════════════════════════════════════
// COMMAND MANAGER
// ══════════════════════════════════════════════════════════
function initCommandManager() {
  // Page selector
  const pageSelect = document.getElementById('cmd-page');
  const totalPages = Math.ceil(state.commands.length / state.cmdPerPage);
  for (let i = 0; i < totalPages; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i + 1;
    pageSelect.appendChild(opt);
  }
  pageSelect.addEventListener('change', (e) => {
    state.cmdPage = parseInt(e.target.value);
    renderCommandGrid();
  });

  // Import / Export
  document.getElementById('btn-cmd-import').addEventListener('click', importCommands);
  document.getElementById('btn-cmd-export').addEventListener('click', exportCommands);

  // Modal
  document.getElementById('modal-cmd-edit-close').addEventListener('click', () => {
    document.getElementById('modal-cmd-edit').classList.add('hidden');
  });
  document.getElementById('modal-cmd-edit-cancel').addEventListener('click', () => {
    document.getElementById('modal-cmd-edit').classList.add('hidden');
  });
  document.getElementById('modal-cmd-edit-save').addEventListener('click', saveCommand);
  document.getElementById('modal-cmd-edit-delete').addEventListener('click', deleteCommand);

  // Mode tabs in command editor (Single / Repeat / Function)
  document.querySelectorAll('#cmd-mode-tabs .cmd-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#cmd-mode-tabs .cmd-mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.cmd-mode-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('cmd-mode-' + tab.dataset.mode).classList.add('active');
    });
  });

  renderCommandGrid();
}

// Map special key names to readable symbols/labels
function formatKeyName(key) {
  const KEY_MAP = {
    ' ': '␣ Space', 'Space': '␣ Space',
    'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
    'Enter': '↵ Enter', 'Tab': '⇥ Tab', 'Backspace': '⌫ Bksp',
    'Delete': '⌦ Del', 'Escape': 'Esc',
    'Control': 'Ctrl', 'Shift': '⇧ Shift', 'Alt': 'Alt', 'Meta': '⌘ Meta',
    'CapsLock': '⇪ Caps', 'Insert': 'Ins',
    'Home': 'Home', 'End': 'End', 'PageUp': 'PgUp', 'PageDown': 'PgDn',
  };
  if (KEY_MAP[key]) return KEY_MAP[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function renderCommandGrid() {
  const grid = document.getElementById('command-grid');
  const start = state.cmdPage * state.cmdPerPage;
  const end = Math.min(start + state.cmdPerPage, state.commands.length);

  document.getElementById('cmd-page-info').textContent = `${start + 1}-${end} of ${state.commands.length}`;

  grid.innerHTML = '';
  for (let i = start; i < end; i++) {
    const cmd = state.commands[i];
    const slot = document.createElement('div');
    slot.className = `command-slot ${cmd ? '' : 'empty'}`;
    slot.dataset.index = i;

    if (cmd) {
      const macroKey = state.commandMacros[i];
      const autoConfig = state.commandRepeatConfigs[i];
      let autoBadge = '';
      if (autoConfig && autoConfig.functionMode) {
        autoBadge = `<span class="cmd-auto-badge cmd-auto-badge--fn" title="f(t)=${autoConfig.functionExpr}">f(t)</span>`;
      } else if (autoConfig && autoConfig.repeatCount > 1) {
        autoBadge = `<span class="cmd-auto-badge cmd-auto-badge--repeat" title="Repeat ×${autoConfig.repeatCount}">×${autoConfig.repeatCount}</span>`;
      }
      const keyDisplay = macroKey ? formatKeyName(macroKey) : '';
      slot.innerHTML = `
        <div class="command-slot__header">
          <span class="cmd-led" data-slot="${i}"></span>
          <div class="command-slot__name">${escapeHtml(cmd.name)}</div>
          ${autoBadge}
          ${macroKey ? `<span class="cmd-macro-badge" title="Macro: ${macroKey}">${keyDisplay}</span>` : ''}
        </div>
        <div class="command-slot__data">[${cmd.format.toUpperCase()}] ${escapeHtml(cmd.data.substring(0, 50))}</div>
        <div class="command-slot__actions">
          <button class="btn btn-primary btn-sm cmd-send-btn" title="Send">Send</button>
          <button class="btn btn-outline btn-sm cmd-edit-btn" title="Edit">Edit</button>
          <button class="cmd-macro-btn" title="${macroKey ? keyDisplay + ' — click to change (Esc=remove)' : 'Click to assign hotkey'}">${keyDisplay || '—'}</button>
        </div>
      `;
      slot.querySelector('.cmd-send-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        sendCommandWithRepeat(cmd, i);
      });
      slot.querySelector('.cmd-edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openCommandEditor(i);
      });
      slot.querySelector('.cmd-macro-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        assignMacroKey(i);
      });
    } else {
      slot.innerHTML = `
        <div class="command-slot__name" style="color:var(--text-muted)">Slot ${i + 1}</div>
        <div class="command-slot__data">Empty — Click to add</div>
      `;
      slot.addEventListener('click', () => openCommandEditor(i));
    }

    grid.appendChild(slot);
  }
}

function openCommandEditor(index, prefillData = null) {
  const cmd = prefillData || state.commands[index] || { name: '', data: '', format: 'string', notes: '' };
  document.getElementById('cmd-edit-name').value = cmd.name;
  document.getElementById('cmd-edit-data').value = cmd.data;
  document.getElementById('cmd-edit-format').value = cmd.format;
  document.getElementById('cmd-edit-notes').value = cmd.notes || '';

  // Load automation config & select the right tab
  const cfg = state.commandRepeatConfigs[index] || {};
  let activeMode = 'single';
  if (cfg.functionMode) activeMode = 'function';
  else if (cfg.repeatCount > 1) activeMode = 'repeat';

  document.querySelectorAll('#cmd-mode-tabs .cmd-mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === activeMode);
  });
  document.querySelectorAll('.cmd-mode-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('cmd-mode-' + activeMode).classList.add('active');

  // Fill repeat fields
  document.getElementById('cmd-edit-repeat-count').value = cfg.repeatCount || 5;
  document.getElementById('cmd-edit-repeat-rate').value = cfg.intervalMs || 500;

  // Fill function fields
  document.getElementById('cmd-edit-fn-expr').value = cfg.functionExpr || '';
  document.getElementById('cmd-edit-fn-rate').value = cfg.functionRate || 100;
  document.getElementById('cmd-edit-fn-duration').value = cfg.functionDuration || 5;
  document.getElementById('cmd-edit-fn-decimals').value = cfg.functionDecimals != null ? cfg.functionDecimals : 2;

  document.getElementById('modal-cmd-edit').dataset.index = index;
  document.getElementById('modal-cmd-edit').classList.remove('hidden');
}

function saveCommand() {
  const index = parseInt(document.getElementById('modal-cmd-edit').dataset.index);
  const name = document.getElementById('cmd-edit-name').value.trim();
  const data = document.getElementById('cmd-edit-data').value;
  const format = document.getElementById('cmd-edit-format').value;
  const notes = document.getElementById('cmd-edit-notes').value;

  if (!name) {
    showToast('Command name is required', 'warning');
    return;
  }

  // Determine active mode from tabs
  const activeTab = document.querySelector('#cmd-mode-tabs .cmd-mode-tab.active');
  const mode = activeTab ? activeTab.dataset.mode : 'single';

  if (mode === 'function') {
    state.commandRepeatConfigs[index] = {
      functionMode: true,
      functionExpr: document.getElementById('cmd-edit-fn-expr').value || 'sin(t)',
      functionRate: parseInt(document.getElementById('cmd-edit-fn-rate').value) || 100,
      functionDuration: parseFloat(document.getElementById('cmd-edit-fn-duration').value) || 5,
      functionDecimals: parseInt(document.getElementById('cmd-edit-fn-decimals').value) || 0,
    };
  } else if (mode === 'repeat') {
    state.commandRepeatConfigs[index] = {
      functionMode: false,
      repeatCount: parseInt(document.getElementById('cmd-edit-repeat-count').value) || 5,
      intervalMs: parseInt(document.getElementById('cmd-edit-repeat-rate').value) || 500,
    };
  } else {
    delete state.commandRepeatConfigs[index];
  }

  state.commands[index] = { name, data, format, notes };
  document.getElementById('modal-cmd-edit').classList.add('hidden');
  renderCommandGrid();
  saveState();
  showToast(`Command "${name}" saved to slot ${index + 1}`, 'success');
}

function deleteCommand() {
  const index = parseInt(document.getElementById('modal-cmd-edit').dataset.index);
  state.commands[index] = null;
  document.getElementById('modal-cmd-edit').classList.add('hidden');
  renderCommandGrid();
  saveState();
  showToast('Command deleted', 'info');
}

async function sendCommand(cmd) {
  if (!state.connected) {
    showToast('Not connected', 'warning');
    return;
  }

  try {
    const mode = state.connectionMode;
    if (cmd.format === 'hex') {
      if (mode === 'serial') await window.serialDebug.serial.sendHex(cmd.data);
      else if (mode.startsWith('tcp')) await window.serialDebug.tcp.sendHex(cmd.data);
      else if (mode === 'udp') {
        await window.serialDebug.udp.sendHex(
          cmd.data,
          document.getElementById('udp-remote-host').value,
          document.getElementById('udp-remote-port').value
        );
      }
      const bytes = cmd.data.replace(/\s+/g, '').match(/.{2}/g) || [];
      state.txCount += bytes.length;
      flushFrame('tx', bytes.map(h => parseInt(h, 16)));
    } else {
      if (mode === 'serial') await window.serialDebug.serial.send(cmd.data, state.sendEncoding);
      else if (mode.startsWith('tcp')) await window.serialDebug.tcp.send(cmd.data, state.sendEncoding);
      else if (mode === 'udp') {
        await window.serialDebug.udp.send(
          cmd.data,
          document.getElementById('udp-remote-host').value,
          document.getElementById('udp-remote-port').value,
          state.sendEncoding
        );
      }
      state.txCount += cmd.data.length;
      flushFrame('tx', stringToBytes(cmd.data));
    }
    updateCountBadges();
  } catch (err) {
    showToast('Send error: ' + err, 'error');
  }
}

async function importCommands() {
  const result = await window.serialDebug.dialog.openFile({
    title: 'Import Commands',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const fileResult = await window.serialDebug.file.read(result.filePaths[0]);
    if (fileResult.success) {
      try {
        const imported = JSON.parse(fileResult.content);
        if (Array.isArray(imported)) {
          imported.forEach((cmd, i) => {
            if (i < state.commands.length && cmd) {
              state.commands[i] = cmd;
            }
          });
          renderCommandGrid();
          saveState();
          showToast(`Imported ${imported.filter(Boolean).length} commands`, 'success');
        }
      } catch (err) {
        showToast('Invalid JSON file', 'error');
      }
    }
  }
}

async function exportCommands() {
  const result = await window.serialDebug.dialog.saveFile({
    title: 'Export Commands',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (!result.canceled && result.filePath) {
    const json = JSON.stringify(state.commands, null, 2);
    await window.serialDebug.file.write(result.filePath, json);
    showToast('Commands exported', 'success');
  }
}

// ══════════════════════════════════════════════════════════
// COMMAND SEQUENCE
// ══════════════════════════════════════════════════════════
function initSequencePanel() {
  document.getElementById('btn-seq-run').addEventListener('click', runSequence);
  document.getElementById('btn-seq-stop').addEventListener('click', stopSequence);
  document.getElementById('seq-loop').addEventListener('change', (e) => {
    state.seqLoop = e.target.checked;
  });
  document.getElementById('btn-seq-add').addEventListener('click', openSeqAddModal);
  document.getElementById('btn-seq-clear').addEventListener('click', () => {
    state.sequence = [];
    renderSequenceItems();
  });

  // Seq add modal
  document.getElementById('modal-seq-add-close').addEventListener('click', () => {
    document.getElementById('modal-seq-add').classList.add('hidden');
  });
  document.getElementById('modal-seq-add-cancel').addEventListener('click', () => {
    document.getElementById('modal-seq-add').classList.add('hidden');
  });
  document.getElementById('modal-seq-add-ok').addEventListener('click', addToSequence);
}

function openSeqAddModal() {
  const select = document.getElementById('seq-add-cmd');
  select.innerHTML = '';
  state.commands.forEach((cmd, i) => {
    if (cmd) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `[${i + 1}] ${cmd.name}`;
      select.appendChild(opt);
    }
  });
  if (select.options.length === 0) {
    showToast('No commands defined. Add commands first.', 'warning');
    return;
  }
  document.getElementById('seq-add-delay').value = document.getElementById('seq-default-delay').value;
  document.getElementById('modal-seq-add').classList.remove('hidden');
}

function addToSequence() {
  const cmdIndex = parseInt(document.getElementById('seq-add-cmd').value);
  const delay = parseInt(document.getElementById('seq-add-delay').value) || 0;
  const cmd = state.commands[cmdIndex];
  if (cmd) {
    state.sequence.push({ cmdIndex, delay, cmd: { ...cmd } });
    renderSequenceItems();
  }
  document.getElementById('modal-seq-add').classList.add('hidden');
}

function renderSequenceItems() {
  const container = document.getElementById('seq-items');
  if (state.sequence.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px; color:var(--text-muted);">
        <p style="font-size:13px;">No commands in sequence.</p>
        <p style="font-size:11px; margin-top:4px; opacity:0.5;">Click "Add" to add commands from the command manager.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.sequence.map((item, idx) => `
    <div class="command-list-item" id="seq-item-${idx}">
      <span class="command-list-item__order">${idx + 1}</span>
      <span class="command-list-item__name">${escapeHtml(item.cmd.name)}</span>
      <span class="command-list-item__delay">${item.delay}ms</span>
      <button class="btn btn-ghost btn-icon btn-sm seq-edit-btn" data-idx="${idx}" title="Edit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="btn btn-ghost btn-icon btn-sm seq-remove-btn" data-idx="${idx}" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.seq-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openSeqEditModal(parseInt(btn.dataset.idx));
    });
  });

  container.querySelectorAll('.seq-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sequence.splice(parseInt(btn.dataset.idx), 1);
      renderSequenceItems();
    });
  });
}

async function runSequence() {
  if (!state.connected) {
    showToast('Not connected', 'warning');
    return;
  }
  if (state.sequence.length === 0) {
    showToast('Sequence is empty', 'warning');
    return;
  }

  state.seqRunning = true;
  state.seqAbort = false;

  do {
    for (let i = 0; i < state.sequence.length; i++) {
      if (state.seqAbort) break;

      // Highlight current
      document.querySelectorAll('.command-list-item').forEach(el => el.classList.remove('executing'));
      const el = document.getElementById(`seq-item-${i}`);
      if (el) el.classList.add('executing');

      const item = state.sequence[i];
      await sendCommand(item.cmd);

      if (item.delay > 0 && !state.seqAbort) {
        await new Promise(resolve => setTimeout(resolve, item.delay));
      }
    }
  } while (state.seqLoop && !state.seqAbort);

  document.querySelectorAll('.command-list-item').forEach(el => el.classList.remove('executing'));
  state.seqRunning = false;
  showToast('Sequence completed', 'success');
}

function stopSequence() {
  state.seqAbort = true;
  state.seqRunning = false;
  showToast('Sequence stopped', 'info');
}

// ══════════════════════════════════════════════════════════
// SCRIPT EDITOR
// ══════════════════════════════════════════════════════════
function initScriptPanel() {
  document.getElementById('btn-script-run').addEventListener('click', runScript);
  document.getElementById('btn-script-stop').addEventListener('click', stopScript);
  document.getElementById('btn-script-clear-console').addEventListener('click', () => {
    document.getElementById('script-console').innerHTML = '';
  });

  // Script log listener
  window.serialDebug.script.onLog((msg) => {
    appendScriptLog(msg);
  });

  // Script send listener - forward to active connection
  window.serialDebug.script.onSend(async (data) => {
    if (!state.connected) return;
    try {
      if (Array.isArray(data)) {
        // raw bytes
        const hex = data.map(b => b.toString(16).padStart(2, '0')).join('');
        const mode = state.connectionMode;
        if (mode === 'serial') await window.serialDebug.serial.sendHex(hex);
        else if (mode.startsWith('tcp')) await window.serialDebug.tcp.sendHex(hex);
      } else {
        const mode = state.connectionMode;
        if (mode === 'serial') await window.serialDebug.serial.send(String(data), state.sendEncoding);
        else if (mode.startsWith('tcp')) await window.serialDebug.tcp.send(String(data), state.sendEncoding);
      }
    } catch (err) {
      appendScriptLog(`Send error: ${err}`, true);
    }
  });

  // Tab key support in textarea
  document.getElementById('script-code').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    }
  });
}

async function runScript() {
  const code = document.getElementById('script-code').value;
  if (!code.trim()) {
    showToast('No script to run', 'warning');
    return;
  }

  appendScriptLog('--- Script started ---');
  state.scriptRunning = true;

  const result = await window.serialDebug.script.run(code);
  if (!result.success) {
    appendScriptLog(`Error: ${result.error}`, true);
    state.scriptRunning = false;
  } else {
    showToast('Script running', 'success');
  }
}

async function stopScript() {
  await window.serialDebug.script.stop();
  state.scriptRunning = false;
  appendScriptLog('--- Script stopped ---');
  showToast('Script stopped', 'info');
}

function appendScriptLog(msg, isError = false) {
  const console_ = document.getElementById('script-console');
  const entry = document.createElement('div');
  entry.className = `script-log-entry ${isError ? 'error' : ''}`;
  entry.textContent = msg;
  console_.appendChild(entry);
  console_.scrollTop = console_.scrollHeight;

  // Limit entries
  while (console_.children.length > 1000) {
    console_.removeChild(console_.firstChild);
  }
}

// ══════════════════════════════════════════════════════════
// TERMINAL
// ══════════════════════════════════════════════════════════
function initTerminalPanel() {
  try {
    // Terminal and FitAddon imported at top of file via require

    const terminal = new Terminal({
      theme: {
        background: '#0a0e1a',
        foreground: '#f1f5f9',
        cursor: '#6366f1',
        cursorAccent: '#0a0e1a',
        selectionBackground: 'rgba(99, 102, 241, 0.3)',
        black: '#1a2235',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#6366f1',
        magenta: '#ec4899',
        cyan: '#06b6d4',
        white: '#f1f5f9',
        brightBlack: '#64748b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#818cf8',
        brightMagenta: '#f472b6',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(document.getElementById('terminal-container'));
    fitAddon.fit();

    state.terminal = terminal;
    state.terminalFitAddon = fitAddon;

    // When user types in terminal, send to connection
    terminal.onData((data) => {
      if (!state.connected) return;

      // Local echo
      if (document.getElementById('terminal-echo').checked) {
        terminal.write(data);
      }

      const mode = state.connectionMode;
      if (mode === 'serial') {
        window.serialDebug.serial.send(data, 'UTF-8');
      } else if (mode.startsWith('tcp')) {
        window.serialDebug.tcp.send(data, 'UTF-8');
      } else if (mode === 'udp') {
        window.serialDebug.udp.send(
          data,
          document.getElementById('udp-remote-host').value,
          document.getElementById('udp-remote-port').value,
          'UTF-8'
        );
      }
    });

    // Clear terminal
    document.getElementById('btn-terminal-clear').addEventListener('click', () => {
      terminal.clear();
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (state.terminalFitAddon) {
        state.terminalFitAddon.fit();
      }
    });

  } catch (err) {
    console.error('Terminal init error:', err);
    document.getElementById('terminal-container').innerHTML = `
      <div style="padding:20px; color:var(--text-muted); text-align:center;">
        <p>Terminal initialization failed.</p>
        <p style="font-size:11px; margin-top:4px;">${err.message}</p>
      </div>
    `;
  }
}

// ══════════════════════════════════════════════════════════
// STATE PERSISTENCE
// ══════════════════════════════════════════════════════════
function saveState() {
  try {
    const uiElements = [
      'conn-mode', 'serial-baud', 'cfg-data-bits', 'cfg-parity', 'cfg-stop-bits', 'cfg-flow-control',
      'tcp-host', 'tcp-port', 'udp-local-port', 'udp-remote-host', 'udp-remote-port',
      'display-mode', 'send-mode', 'display-encoding', 'send-encoding', 'auto-scroll',
      'auto-frame-break', 'frame-break-ms', 'auto-reconnect', 'show-timestamp',
      'waveform-enabled', 'waveform-data-rate', 'scope-timing-mode', 'waveform-label-mode',
      'data-sampling', 'data-sample-rate',
      'send-newline', 'send-cr', 'send-repeat', 'send-repeat-ms',
      'seq-loop', 'seq-default-delay', 'terminal-echo',
      'setting-font-size', 'setting-mono-size', 'split-panel-select'
    ];

    const uiState = {};
    uiElements.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (el.classList.contains('segmented')) {
          const activeBtn = el.querySelector('.segmented__btn.active');
          if (activeBtn) uiState[id] = activeBtn.dataset.mode;
        } else {
          uiState[id] = el.type === 'checkbox' ? el.checked : el.value;
        }
      }
    });

    // Sparse format: only serialize non-null commands to reduce localStorage bloat
    const sparseCommands = {};
    state.commands.forEach((cmd, i) => { if (cmd) sparseCommands[i] = cmd; });
    const data = {
      commands: sparseCommands,
      commandRepeatConfigs: state.commandRepeatConfigs,
      uiState: uiState
    };
    localStorage.setItem('serialDebugPro_state', JSON.stringify(data));
  } catch (err) {
    console.error('Error saving state:', err);
  }
}

function loadSavedState() {
  try {
    const saved = localStorage.getItem('serialDebugPro_state');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.commands) {
        if (Array.isArray(data.commands)) {
          // Legacy array format
          state.commands = data.commands;
        } else {
          // Sparse object format
          state.commands = new Array(600).fill(null);
          Object.entries(data.commands).forEach(([i, cmd]) => {
            state.commands[parseInt(i)] = cmd;
          });
        }
        // Ensure 600 slots
        while (state.commands.length < 600) state.commands.push(null);
      }
      if (data.commandRepeatConfigs) {
        state.commandRepeatConfigs = data.commandRepeatConfigs;
      }
      // Don't restore channelConfigs — they rebuild from actual data each session
      // This prevents ghost channels from old sessions
      if (data.uiState) {
        Object.keys(data.uiState).forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            if (el.classList.contains('segmented')) {
              const targetBtn = el.querySelector(`.segmented__btn[data-mode="${data.uiState[id]}"]`);
              if (targetBtn) targetBtn.click();
            } else if (el.type === 'checkbox') {
              el.checked = data.uiState[id];
              el.dispatchEvent(new Event('change'));
            } else {
              el.value = data.uiState[id];
              el.dispatchEvent(new Event('change'));
            }
          }
        });
      }
      renderCommandGrid();
    }
  } catch (err) {
    console.error('Error loading state:', err);
  }
}

// ══════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════
// Shared TextDecoder instance for UTF-8 (avoid recreating per call)
const _utf8Decoder = new TextDecoder('utf-8');

function bufferToString(bytes, encoding = 'UTF-8') {
  if (encoding === 'ASCII') {
    return bytes.map(b => String.fromCharCode(b)).join('');
  }
  // Proper multi-byte UTF-8 decoding (handles emoji, CJK, accented chars)
  return _utf8Decoder.decode(new Uint8Array(bytes));
}

function stringToBytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0xFF);
  }
  return bytes;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ══════════════════════════════════════════════════════════
// THEME SYSTEM
// ══════════════════════════════════════════════════════════
const THEME_PRESETS = {
  default: {
    name: 'Default Dark',
    '--bg-primary': '#0a0e1a', '--bg-secondary': '#111827', '--bg-tertiary': '#1a2235',
    '--accent': '#6366f1', '--accent-hover': '#818cf8',
    '--text-primary': '#f1f5f9', '--text-secondary': '#94a3b8', '--text-muted': '#64748b',
    '--success': '#22c55e', '--danger': '#ef4444', '--warning': '#f59e0b', '--info': '#06b6d4',
  },
  dracula: {
    name: 'Dracula',
    '--bg-primary': '#282a36', '--bg-secondary': '#21222c', '--bg-tertiary': '#343746',
    '--accent': '#bd93f9', '--accent-hover': '#caa8fb',
    '--text-primary': '#f8f8f2', '--text-secondary': '#bfbfbf', '--text-muted': '#6272a4',
    '--success': '#50fa7b', '--danger': '#ff5555', '--warning': '#f1fa8c', '--info': '#8be9fd',
  },
  monokai: {
    name: 'Monokai Pro',
    '--bg-primary': '#2d2a2e', '--bg-secondary': '#221f22', '--bg-tertiary': '#3b383e',
    '--accent': '#ffd866', '--accent-hover': '#ffe49c',
    '--text-primary': '#fcfcfa', '--text-secondary': '#c1c0c0', '--text-muted': '#727072',
    '--success': '#a9dc76', '--danger': '#ff6188', '--warning': '#ffd866', '--info': '#78dce8',
  },
  nord: {
    name: 'Nord',
    '--bg-primary': '#2e3440', '--bg-secondary': '#272c36', '--bg-tertiary': '#3b4252',
    '--accent': '#88c0d0', '--accent-hover': '#8fbcbb',
    '--text-primary': '#eceff4', '--text-secondary': '#d8dee9', '--text-muted': '#4c566a',
    '--success': '#a3be8c', '--danger': '#bf616a', '--warning': '#ebcb8b', '--info': '#81a1c1',
  },
  onedark: {
    name: 'One Dark',
    '--bg-primary': '#282c34', '--bg-secondary': '#21252b', '--bg-tertiary': '#2c313c',
    '--accent': '#61afef', '--accent-hover': '#82bff0',
    '--text-primary': '#abb2bf', '--text-secondary': '#9da5b4', '--text-muted': '#5c6370',
    '--success': '#98c379', '--danger': '#e06c75', '--warning': '#e5c07b', '--info': '#56b6c2',
  },
  synthwave: {
    name: "Synthwave '84",
    '--bg-primary': '#262335', '--bg-secondary': '#1e1a2e', '--bg-tertiary': '#34294f',
    '--accent': '#ff7edb', '--accent-hover': '#f97cdc',
    '--text-primary': '#f0e4fc', '--text-secondary': '#b6a0d2', '--text-muted': '#6d5f88',
    '--success': '#72f1b8', '--danger': '#fe4450', '--warning': '#fede5d', '--info': '#36f9f6',
  },
  solarized: {
    name: 'Solarized Dark',
    '--bg-primary': '#002b36', '--bg-secondary': '#073642', '--bg-tertiary': '#0a4050',
    '--accent': '#268bd2', '--accent-hover': '#2aa1f0',
    '--text-primary': '#fdf6e3', '--text-secondary': '#93a1a1', '--text-muted': '#586e75',
    '--success': '#859900', '--danger': '#dc322f', '--warning': '#b58900', '--info': '#2aa198',
  },
  space: {
    name: 'James Webb Space',
    '--bg-primary': '#050508', '--bg-secondary': '#0b0c10', '--bg-tertiary': '#141822',
    '--accent': '#facc15', '--accent-hover': '#fde047',
    '--text-primary': '#ffffff', '--text-secondary': '#cbd5e1', '--text-muted': '#475569',
    '--success': '#60a5fa', '--danger': '#ef4444', '--warning': '#fbbf24', '--info': '#818cf8',
  },
  hacker: {
    name: 'Matrix Hacker',
    '--bg-primary': '#050a05', '--bg-secondary': '#0a140a', '--bg-tertiary': '#0f2412',
    '--accent': '#00ff41', '--accent-hover': '#33ff66',
    '--text-primary': '#00ff41', '--text-secondary': '#00b32c', '--text-muted': '#005915',
    '--success': '#00ff41', '--danger': '#ff003c', '--warning': '#ffb000', '--info': '#00aeff',
  },
  rainbow: {
    name: 'Rainbow Delight',
    '--bg-primary': '#1f1e2e', '--bg-secondary': '#2b2a3a', '--bg-tertiary': '#3a384e',
    '--accent': '#ff007f', '--accent-hover': '#ff4d94',
    '--text-primary': '#f4f4f5', '--text-secondary': '#a1a1aa', '--text-muted': '#6b7280',
    '--success': '#10b981', '--danger': '#ef4444', '--warning': '#f59e0b', '--info': '#3b82f6',
  },
  neon: {
    name: 'Neon Nights',
    '--bg-primary': '#0d0221', '--bg-secondary': '#13042e', '--bg-tertiary': '#1c0645',
    '--accent': '#00ffff', '--accent-hover': '#4dffff',
    '--text-primary': '#ffffff', '--text-secondary': '#00ffff', '--text-muted': '#5c5470',
    '--success': '#00ff00', '--danger': '#ff00ff', '--warning': '#ffff00', '--info': '#00ffff',
  }
};

function applyThemeColors(colors) {
  const root = document.documentElement;
  const vars = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--accent', '--accent-hover',
    '--text-primary', '--text-secondary', '--text-muted', '--success', '--danger', '--warning', '--info'];
  vars.forEach(v => {
    if (colors[v]) root.style.setProperty(v, colors[v]);
  });
  // Derived variables
  if (colors['--accent']) {
    root.style.setProperty('--accent-glow', colors['--accent'] + '4d');
    root.style.setProperty('--accent-subtle', colors['--accent'] + '14');
    root.style.setProperty('--text-accent', colors['--accent-hover'] || colors['--accent']);
  }
  if (colors['--bg-secondary']) {
    root.style.setProperty('--bg-panel', colors['--bg-secondary'] + 'd9');
    root.style.setProperty('--bg-input', colors['--bg-tertiary'] + 'e6');
  }
}

function loadTheme() {
  const saved = localStorage.getItem('serialDebugPro_theme');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      const select = document.getElementById('theme-preset');
      if (data.preset && THEME_PRESETS[data.preset]) {
        applyThemeColors(THEME_PRESETS[data.preset]);
        select.value = data.preset;
      } else if (data.preset === 'custom' && data.colors) {
        applyThemeColors(data.colors);
        select.value = 'custom';
        // Update color pickers
        document.querySelectorAll('.theme-color').forEach(picker => {
          if (data.colors[picker.dataset.var]) picker.value = data.colors[picker.dataset.var];
        });
        document.getElementById('custom-theme-editor').classList.remove('hidden');
      }
    } catch (e) { console.error('Theme load error:', e); }
  }
}

function saveThemeChoice(preset, colors) {
  localStorage.setItem('serialDebugPro_theme', JSON.stringify({ preset, colors }));
}

function getCustomColorsFromPickers() {
  const colors = {};
  document.querySelectorAll('.theme-color').forEach(picker => {
    colors[picker.dataset.var] = picker.value;
  });
  return colors;
}

function renderSavedThemes() {
  const container = document.getElementById('saved-themes-list');
  const saved = JSON.parse(localStorage.getItem('serialDebugPro_customThemes') || '[]');
  if (saved.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = '<h4 style="font-size:11px;color:var(--text-muted);margin-bottom:6px">SAVED THEMES</h4>' +
    saved.map((t, i) => `
      <div class="saved-theme-item">
        <span class="saved-theme-item__name">${escapeHtml(t.name)}</span>
        <button class="btn btn-ghost btn-xs" onclick="applySavedTheme(${i})" title="Apply">Apply</button>
        <button class="btn btn-ghost btn-xs" onclick="deleteSavedTheme(${i})" title="Delete">✕</button>
      </div>
    `).join('');
}

function applySavedTheme(index) {
  const saved = JSON.parse(localStorage.getItem('serialDebugPro_customThemes') || '[]');
  if (saved[index]) {
    applyThemeColors(saved[index].colors);
    document.getElementById('theme-preset').value = 'custom';
    document.getElementById('custom-theme-editor').classList.remove('hidden');
    document.querySelectorAll('.theme-color').forEach(picker => {
      if (saved[index].colors[picker.dataset.var]) picker.value = saved[index].colors[picker.dataset.var];
    });
    saveThemeChoice('custom', saved[index].colors);
    showToast(`Applied theme "${saved[index].name}"`, 'success');
  }
}

function deleteSavedTheme(index) {
  const saved = JSON.parse(localStorage.getItem('serialDebugPro_customThemes') || '[]');
  const name = saved[index]?.name;
  saved.splice(index, 1);
  localStorage.setItem('serialDebugPro_customThemes', JSON.stringify(saved));
  renderSavedThemes();
  showToast(`Deleted theme "${name}"`, 'info');
}

function initSettingsPanel() {
  // Theme preset
  document.getElementById('theme-preset').addEventListener('change', (e) => {
    const val = e.target.value;
    const editor = document.getElementById('custom-theme-editor');
    if (val === 'custom') {
      editor.classList.remove('hidden');
      const colors = getCustomColorsFromPickers();
      applyThemeColors(colors);
      saveThemeChoice('custom', colors);
    } else {
      editor.classList.add('hidden');
      if (THEME_PRESETS[val]) {
        applyThemeColors(THEME_PRESETS[val]);
        saveThemeChoice(val, null);
        showToast(`Theme: ${THEME_PRESETS[val].name}`, 'success', 2000);
      }
    }
  });

  // Live preview from color pickers
  document.querySelectorAll('.theme-color').forEach(picker => {
    picker.addEventListener('input', () => {
      const colors = getCustomColorsFromPickers();
      applyThemeColors(colors);
    });
  });

  // Save custom theme
  document.getElementById('btn-theme-save').addEventListener('click', () => {
    const name = document.getElementById('custom-theme-name').value.trim() || 'Untitled';
    const colors = getCustomColorsFromPickers();
    const saved = JSON.parse(localStorage.getItem('serialDebugPro_customThemes') || '[]');
    saved.push({ name, colors });
    localStorage.setItem('serialDebugPro_customThemes', JSON.stringify(saved));
    saveThemeChoice('custom', colors);
    renderSavedThemes();
    showToast(`Theme "${name}" saved`, 'success');
  });

  // Export theme
  document.getElementById('btn-theme-export').addEventListener('click', async () => {
    const preset = document.getElementById('theme-preset').value;
    let exportData;
    if (preset === 'custom') {
      exportData = { name: document.getElementById('custom-theme-name').value, colors: getCustomColorsFromPickers() };
    } else {
      exportData = { name: THEME_PRESETS[preset]?.name || preset, colors: THEME_PRESETS[preset] || {} };
    }
    const result = await window.serialDebug.dialog.saveFile({
      title: 'Export Theme', filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!result.canceled && result.filePath) {
      await window.serialDebug.file.write(result.filePath, JSON.stringify(exportData, null, 2));
      showToast('Theme exported', 'success');
    }
  });

  // Import theme
  document.getElementById('btn-theme-import').addEventListener('click', async () => {
    const result = await window.serialDebug.dialog.openFile({
      title: 'Import Theme', filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const fileResult = await window.serialDebug.file.read(result.filePaths[0]);
      if (fileResult.success) {
        try {
          const data = JSON.parse(fileResult.content);
          if (data.colors) {
            applyThemeColors(data.colors);
            document.getElementById('theme-preset').value = 'custom';
            document.getElementById('custom-theme-editor').classList.remove('hidden');
            document.querySelectorAll('.theme-color').forEach(picker => {
              if (data.colors[picker.dataset.var]) picker.value = data.colors[picker.dataset.var];
            });
            if (data.name) document.getElementById('custom-theme-name').value = data.name;
            saveThemeChoice('custom', data.colors);
            showToast(`Imported theme "${data.name || 'Custom'}"`, 'success');
          }
        } catch (e) { showToast('Invalid theme file', 'error'); }
      }
    }
  });

  // Font size sliders
  const handleFontChange = (e) => {
    const val = parseInt(e.target.value);
    const scale = val / 13; // 13px is the 1.0 base scale
    document.body.style.zoom = scale;
    document.getElementById('setting-font-size-val').textContent = val + 'px';
  };
  document.getElementById('setting-font-size').addEventListener('input', handleFontChange);
  document.getElementById('setting-font-size').addEventListener('change', handleFontChange);

  const handleMonoChange = (e) => {
    const val = parseInt(e.target.value);
    document.documentElement.style.setProperty('--mono-font-size', val + 'px');
    if (state.terminal) {
      state.terminal.options.fontSize = val;
      if (state.terminalFitAddon) state.terminalFitAddon.fit();
    }
    document.getElementById('setting-mono-size-val').textContent = val + 'px';
  };
  document.getElementById('setting-mono-size').addEventListener('input', handleMonoChange);
  document.getElementById('setting-mono-size').addEventListener('change', handleMonoChange);

  renderSavedThemes();
}

// ══════════════════════════════════════════════════════════
// SPLIT VIEW
// ══════════════════════════════════════════════════════════
function initSplitView() {
  document.getElementById('btn-split-toggle').addEventListener('click', toggleSplit);
  document.getElementById('btn-split-close').addEventListener('click', closeSplit);
  document.getElementById('split-panel-select').addEventListener('change', (e) => {
    if (document.getElementById('content-area').classList.contains('split-mode')) {
      setSplitPanel(e.target.value);
    }
  });
}

function toggleSplit() {
  const content = document.getElementById('content-area');
  const btn = document.getElementById('btn-split-toggle');
  if (content.classList.contains('split-mode')) {
    closeSplit();
  } else {
    enableSplit();
  }
}

function enableSplit() {
  const content = document.getElementById('content-area');
  const secondary = document.getElementById('split-secondary');
  const divider = document.getElementById('split-divider');
  const btn = document.getElementById('btn-split-toggle');

  content.classList.add('split-mode');
  secondary.classList.remove('hidden');
  divider.classList.remove('hidden');
  btn.classList.add('active');

  // Default: show waveform in secondary (or first non-active panel)
  const primaryActive = document.querySelector('#split-primary > .panel.active');
  const primaryId = primaryActive ? primaryActive.id.replace('panel-', '') : 'main';
  let secondaryId = 'waveform';
  if (primaryId === 'waveform') secondaryId = 'terminal';

  // Exclude active panel from dropdown
  const select = document.getElementById('split-panel-select');
  Array.from(select.options).forEach(opt => {
    opt.disabled = (opt.value === primaryId);
  });
  select.value = secondaryId;

  setSplitPanel(secondaryId);
  showToast('Split view enabled', 'info', 2000);
}

function closeSplit() {
  const content = document.getElementById('content-area');
  const primary = document.getElementById('split-primary');
  const secondary = document.getElementById('split-secondary');
  const divider = document.getElementById('split-divider');
  const btn = document.getElementById('btn-split-toggle');

  // Move any panels back to primary
  const panels = secondary.querySelectorAll('.panel');
  panels.forEach(p => {
    p.classList.remove('active');
    primary.appendChild(p);
  });

  // Reset inline styles set by the split resizer
  primary.style.width = '';
  primary.style.flex = '';
  secondary.style.flex = '';

  content.classList.remove('split-mode');
  secondary.classList.add('hidden');
  divider.classList.add('hidden');
  btn.classList.remove('active');

  // Resize charts/terminals after layout resets
  state.waveformViews.forEach(v => { if (v.chart) setTimeout(() => v.chart.resize(), 50); });
  if (state.terminal && state.terminalFitAddon) setTimeout(() => state.terminalFitAddon.fit(), 50);
}

function setSplitPanel(panelId) {
  const primary = document.getElementById('split-primary');
  const secondary = document.getElementById('split-secondary');

  // Move any current secondary panel back to primary
  const currentSecondary = secondary.querySelectorAll('.panel');
  currentSecondary.forEach(p => {
    p.classList.remove('active');
    primary.appendChild(p);
  });

  // Move selected panel to secondary
  const panel = document.getElementById(`panel-${panelId}`);
  if (panel) {
    secondary.appendChild(panel);
    panel.classList.add('active');
  }

  // Fit terminal/chart if moved
  if (panelId === 'terminal' && state.terminal && state.terminalFitAddon) {
    setTimeout(() => state.terminalFitAddon.fit(), 100);
  }
  if (panelId === 'waveform') {
    setTimeout(() => state.waveformViews.forEach(v => { if (v.chart) v.chart.resize(); }), 100);
  }
}

// ══════════════════════════════════════════════════════════
// AUTO-RECONNECT
// ══════════════════════════════════════════════════════════
function initAutoReconnect() {
  document.getElementById('auto-reconnect').addEventListener('change', (e) => {
    state.autoReconnect = e.target.checked;
    if (state.autoReconnect && !state.connected) {
      startAutoReconnect();
    } else if (!state.autoReconnect) {
      stopAutoReconnect();
    }
  });
}

function startAutoReconnect() {
  stopAutoReconnect();
  state.autoReconnectTimer = setInterval(async () => {
    if (state.connected || !state.autoReconnect) {
      stopAutoReconnect();
      return;
    }
    // Guard against concurrent reconnection attempts
    if (state._reconnecting) return;
    state._reconnecting = true;
    try {
      const mode = state.connectionMode;
      if (mode === 'serial') {
        const port = document.getElementById('serial-port').value;
        if (!port) return;
        // Check if port is available
        const ports = await window.serialDebug.serial.listPorts();
        const available = ports.some(p => p.path === port);
        if (available) {
          showToast('Auto-reconnecting...', 'info', 1500);
          await connectCurrent();
        }
      } else {
        showToast('Auto-reconnecting...', 'info', 1500);
        await connectCurrent();
      }
    } catch (e) {
      // Silently retry
    } finally {
      state._reconnecting = false;
    }
  }, 3000);
}

function stopAutoReconnect() {
  if (state.autoReconnectTimer) {
    clearInterval(state.autoReconnectTimer);
    state.autoReconnectTimer = null;
  }
}

// Hook into disconnect to trigger auto-reconnect
const _originalUpdateConnectionUI = updateConnectionUI;
updateConnectionUI = function () {
  _originalUpdateConnectionUI();
  if (!state.connected && state.autoReconnect) {
    startAutoReconnect();
  }
};

// ══════════════════════════════════════════════════════════
// TIMESTAMP TOGGLE
// ══════════════════════════════════════════════════════════
function initTimestampToggle() {
  document.getElementById('show-timestamp').addEventListener('change', (e) => {
    state.showTimestamp = e.target.checked;
  });
}

// ══════════════════════════════════════════════════════════
// SEND HISTORY
// ══════════════════════════════════════════════════════════
function initSendHistory() {
  document.getElementById('btn-send-history').addEventListener('click', () => {
    const dd = document.getElementById('send-history-dropdown');
    dd.classList.toggle('hidden');
  });
  document.getElementById('btn-history-clear').addEventListener('click', () => {
    state.sendHistory = state.sendHistory.filter(h => h.pinned);
    saveSendHistory();
    renderSendHistory();
  });
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('send-history-dropdown');
    const btn = document.getElementById('btn-send-history');
    if (!dd.classList.contains('hidden') && !dd.contains(e.target) && !btn.contains(e.target)) {
      dd.classList.add('hidden');
    }
  });
}

function addToSendHistory(text) {
  if (!text || !text.trim()) return;
  // Don't add duplicates (move to top if exists)
  const existingIdx = state.sendHistory.findIndex(h => h.text === text && !h.pinned);
  if (existingIdx >= 0) {
    state.sendHistory.splice(existingIdx, 1);
  }
  // Check if already pinned (don't add duplicate)
  const pinnedExists = state.sendHistory.some(h => h.text === text && h.pinned);
  if (!pinnedExists) {
    state.sendHistory.unshift({ text, pinned: false });
  }
  // Keep max unpinned
  const unpinned = state.sendHistory.filter(h => !h.pinned);
  if (unpinned.length > state.sendHistoryMax) {
    const removeCount = unpinned.length - state.sendHistoryMax;
    for (let i = 0; i < removeCount; i++) {
      const removeIdx = state.sendHistory.findLastIndex(h => !h.pinned);
      if (removeIdx >= 0) state.sendHistory.splice(removeIdx, 1);
    }
  }
  saveSendHistory();
  renderSendHistory();
}

function saveSendHistory() {
  localStorage.setItem('serialDebugPro_sendHistory', JSON.stringify(state.sendHistory));
}

function loadSendHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem('serialDebugPro_sendHistory') || '[]');
    state.sendHistory = saved;
    renderSendHistory();
  } catch (e) { }
}

function renderSendHistory() {
  const container = document.getElementById('send-history-items');
  if (state.sendHistory.length === 0) {
    container.innerHTML = '<div class="send-history-empty text-sm text-muted" style="padding:12px;text-align:center">No history yet</div>';
    return;
  }
  // Pinned first, then recent
  const sorted = [
    ...state.sendHistory.filter(h => h.pinned),
    ...state.sendHistory.filter(h => !h.pinned),
  ];
  container.innerHTML = sorted.map((h, i) => {
    const realIdx = state.sendHistory.indexOf(h);
    return `
    <div class="send-history-item${h.pinned ? ' pinned' : ''}">
      <span class="send-history-item__text" data-idx="${realIdx}" title="Click to fill">${escapeHtml(h.text)}</span>
      <div class="send-history-item__actions">
        <button class="btn btn-ghost btn-xs hist-send" data-idx="${realIdx}" title="Send now">▶</button>
        <button class="btn btn-ghost btn-xs hist-pin" data-idx="${realIdx}" title="${h.pinned ? 'Unpin' : 'Pin'}">${h.pinned ? '★' : '☆'}</button>
        <button class="btn btn-ghost btn-xs hist-save-cmd" data-idx="${realIdx}" title="Save as command">💾</button>
      </div>
    </div>`;
  }).join('');

  // Click text to fill input
  container.querySelectorAll('.send-history-item__text').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('send-input').value = state.sendHistory[parseInt(el.dataset.idx)].text;
    });
  });

  // Send now
  container.querySelectorAll('.hist-send').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('send-input').value = state.sendHistory[parseInt(btn.dataset.idx)].text;
      sendData();
    });
  });

  // Pin/unpin
  container.querySelectorAll('.hist-pin').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      state.sendHistory[idx].pinned = !state.sendHistory[idx].pinned;
      saveSendHistory();
      renderSendHistory();
    });
  });

  // Save as command
  container.querySelectorAll('.hist-save-cmd').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const text = state.sendHistory[idx].text;
      // Find first empty command slot
      const emptySlot = state.commands.findIndex(c => c === null);
      if (emptySlot >= 0) {
        document.getElementById('send-history-dropdown').classList.add('hidden');
        openCommandEditor(emptySlot, { name: text.substring(0, 30), data: text, format: 'string', notes: 'From send history' });
      } else {
        showToast('No empty command slots available', 'warning');
      }
    });
  });
}

// ══════════════════════════════════════════════════════════
// MATH CHANNELS
// ══════════════════════════════════════════════════════════
function initMathChannels() {
  document.getElementById('btn-math-add').addEventListener('click', () => {
    state.mathEditIndex = -1;
    document.getElementById('math-modal-title').textContent = 'Add Math Channel';
    document.getElementById('math-ch-name').value = '';
    document.getElementById('math-ch-expr').value = '';
    document.getElementById('math-ch-color').value = CHANNEL_COLORS[state.mathChannels.length % CHANNEL_COLORS.length];
    document.getElementById('modal-math-channel').classList.remove('hidden');
  });

  document.getElementById('modal-math-close').addEventListener('click', () => {
    document.getElementById('modal-math-channel').classList.add('hidden');
  });
  document.getElementById('modal-math-cancel').addEventListener('click', () => {
    document.getElementById('modal-math-channel').classList.add('hidden');
  });
  document.getElementById('modal-math-save').addEventListener('click', saveMathChannel);

  // Load saved math channels
  try {
    const saved = JSON.parse(localStorage.getItem('serialDebugPro_mathChannels') || '[]');
    state.mathChannels = saved;
    renderMathChannelsList();
  } catch (e) { }
}

function saveMathChannel() {
  const name = document.getElementById('math-ch-name').value.trim();
  const expr = document.getElementById('math-ch-expr').value.trim();
  const color = document.getElementById('math-ch-color').value;

  if (!name) { showToast('Enter a channel name', 'warning'); return; }
  if (!expr) { showToast('Enter an expression', 'warning'); return; }

  // Validate expression by test-evaluating
  try {
    evaluateMathExpr(expr, {}, 0);
  } catch (e) {
    // Allow it - channels may not exist yet
  }

  const ch = { name, expr, color };
  if (state.mathEditIndex >= 0) {
    state.mathChannels[state.mathEditIndex] = ch;
  } else {
    state.mathChannels.push(ch);
  }

  // Add channel config for the chart
  state.channelConfigs['math_' + name] = {
    channelNumber: 'MATH',
    dataLabel: name,
    customName: name,
    displayMode: 'custom',
    color: color,
    scale: 1.0,
    offset: 0,
    visible: true,
  };

  localStorage.setItem('serialDebugPro_mathChannels', JSON.stringify(state.mathChannels));
  renderMathChannelsList();
  document.getElementById('modal-math-channel').classList.add('hidden');
  showToast(`Math channel "${name}" saved`, 'success');
}

// Cache compiled math functions to avoid recompiling on every data point
const _mathFnCache = {};

function evaluateMathExpr(expr, channels, t) {
  // Build a safe context with channel values and math functions
  const ctx = {
    ...channels,
    t: t,
    PI: Math.PI,
    E: Math.E,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    abs: Math.abs,
    sqrt: Math.sqrt,
    log: Math.log,
    pow: Math.pow,
    min: Math.min,
    max: Math.max,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
  };
  const keys = Object.keys(ctx);
  const vals = Object.values(ctx);

  // Cache key: expression + parameter signature
  const cacheKey = expr + '|' + keys.join(',');
  let fn = _mathFnCache[cacheKey];
  if (!fn) {
    try {
      fn = new Function(...keys, `return (${expr});`);
      _mathFnCache[cacheKey] = fn;
    } catch (e) {
      return null;
    }
  }
  try {
    const result = fn(...vals);
    return typeof result === 'number' && isFinite(result) ? result : null;
  } catch (e) {
    return null;
  }
}

function renderMathChannelsList() {
  const container = document.getElementById('math-channels-list');
  if (state.mathChannels.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = state.mathChannels.map((ch, i) => `
    <div class="math-ch-item">
      <div class="math-ch-swatch" style="background:${ch.color}"></div>
      <span class="math-ch-item__name">${escapeHtml(ch.name)}</span>
      <span class="math-ch-item__expr" title="${escapeHtml(ch.expr)}">${escapeHtml(ch.expr)}</span>
      <button class="btn btn-ghost btn-xs math-ch-edit" data-idx="${i}" title="Edit">✎</button>
      <button class="btn btn-ghost btn-xs math-ch-del" data-idx="${i}" title="Delete">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.math-ch-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const ch = state.mathChannels[idx];
      state.mathEditIndex = idx;
      document.getElementById('math-modal-title').textContent = 'Edit Math Channel';
      document.getElementById('math-ch-name').value = ch.name;
      document.getElementById('math-ch-expr').value = ch.expr;
      document.getElementById('math-ch-color').value = ch.color;
      document.getElementById('modal-math-channel').classList.remove('hidden');
    });
  });

  container.querySelectorAll('.math-ch-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const name = state.mathChannels[idx].name;
      delete state.channelConfigs['math_' + name];
      state.mathChannels.splice(idx, 1);
      localStorage.setItem('serialDebugPro_mathChannels', JSON.stringify(state.mathChannels));
      renderMathChannelsList();
      showToast(`Removed math channel "${name}"`, 'info');
    });
  });
}

// Hook into updateChart to include math channels
const _originalUpdateChart = updateChart;
updateChart = function () {
  // Compute math channel values for each data point
  if (state.mathChannels.length > 0) {
    state.waveformData.forEach((d, t) => {
      state.mathChannels.forEach(mc => {
        const val = evaluateMathExpr(mc.expr, d.channels, t);
        if (val !== null) {
          d.channels['math_' + mc.name] = val;
        }
      });
    });
  }
  _originalUpdateChart();
};

// ══════════════════════════════════════════════════════════
// SEQUENCE EDIT MODAL
// ══════════════════════════════════════════════════════════
function initSeqEditModal() {
  document.getElementById('modal-seq-edit-close').addEventListener('click', () => {
    document.getElementById('modal-seq-edit').classList.add('hidden');
  });
  document.getElementById('modal-seq-edit-cancel').addEventListener('click', () => {
    document.getElementById('modal-seq-edit').classList.add('hidden');
  });
  document.getElementById('modal-seq-edit-save').addEventListener('click', saveSeqEdit);
  document.getElementById('modal-seq-edit-delete').addEventListener('click', () => {
    if (state.seqEditIndex >= 0) {
      state.sequence.splice(state.seqEditIndex, 1);
      renderSequenceItems();
    }
    document.getElementById('modal-seq-edit').classList.add('hidden');
  });
}

function openSeqEditModal(idx) {
  state.seqEditIndex = idx;
  const item = state.sequence[idx];
  if (!item) return;

  // Populate command dropdown
  const select = document.getElementById('seq-edit-cmd');
  select.innerHTML = '';
  state.commands.forEach((cmd, i) => {
    if (cmd) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `[${i + 1}] ${cmd.name}`;
      if (i === item.cmdIndex) opt.selected = true;
      select.appendChild(opt);
    }
  });
  document.getElementById('seq-edit-delay').value = item.delay;
  document.getElementById('modal-seq-edit').classList.remove('hidden');
}

function saveSeqEdit() {
  if (state.seqEditIndex < 0) return;
  const cmdIndex = parseInt(document.getElementById('seq-edit-cmd').value);
  const delay = parseInt(document.getElementById('seq-edit-delay').value) || 0;
  const cmd = state.commands[cmdIndex];
  if (cmd) {
    state.sequence[state.seqEditIndex] = { cmdIndex, delay, cmd: { ...cmd } };
    renderSequenceItems();
  }
  document.getElementById('modal-seq-edit').classList.add('hidden');
}

// ══════════════════════════════════════════════════════════
// SEND HISTORY NAVIGATION (Up/Down arrows)
// ══════════════════════════════════════════════════════════
function navigateSendHistory(inputEl, direction) {
  if (state.sendHistory.length === 0) return;
  const unpinned = state.sendHistory.filter(h => !h.pinned);
  const allHistory = [...state.sendHistory.filter(h => h.pinned), ...unpinned];
  if (allHistory.length === 0) return;

  if (direction > 0) {
    // Up — go back in history
    state.sendHistoryIndex = Math.min(state.sendHistoryIndex + 1, allHistory.length - 1);
  } else {
    // Down — go forward
    state.sendHistoryIndex = Math.max(state.sendHistoryIndex - 1, -1);
  }

  if (state.sendHistoryIndex < 0) {
    inputEl.value = '';
  } else {
    inputEl.value = allHistory[state.sendHistoryIndex].text;
  }
}

// ══════════════════════════════════════════════════════════
// SEARCH BAR (IDE-style search with RX/TX filter)
// ══════════════════════════════════════════════════════════
function initSearchBar() {
  const searchInput = document.getElementById('search-input');
  const filterRx = document.getElementById('search-filter-rx');
  const filterTx = document.getElementById('search-filter-tx');
  const clearBtn = document.getElementById('search-clear');

  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    applySearchToAll();
  });

  if (filterRx) {
    filterRx.addEventListener('change', (e) => {
      state.searchFilterRx = e.target.checked;
      applySearchToAll();
    });
  }
  if (filterTx) {
    filterTx.addEventListener('change', (e) => {
      state.searchFilterTx = e.target.checked;
      applySearchToAll();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      applySearchToAll();
    });
  }

  // Ctrl+F to focus search
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

function applySearchToAll() {
  const container = document.getElementById('data-content');
  if (!container) return;

  // Flush any pending buffered frames so filter applies immediately
  if (state.frameBufferNodes && state.frameBufferNodes.length > 0) {
    const fragment = document.createDocumentFragment();
    state.frameBufferNodes.forEach(f => fragment.appendChild(f));
    state.frameBufferNodes = [];
    container.appendChild(fragment);
    if (state.frameDrainTimer) {
      clearTimeout(state.frameDrainTimer);
      state.frameDrainTimer = null;
    }
  }

  const frames = container.querySelectorAll('.data-frame');
  frames.forEach(frame => {
    frame.style.display = '';
    // Remove old highlights
    frame.querySelectorAll('.search-highlight').forEach(mark => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    applySearchToFrame(frame);
  });
}

// ══════════════════════════════════════════════════════════
// APP-WIDE ERROR HANDLER
// ══════════════════════════════════════════════════════════
function initAppErrorHandler() {
  window.onerror = (message, source, lineno, colno, error) => {
    console.error('Uncaught error:', message, source, lineno);
    showToast(`Error: ${message}`, 'error', 5000);
    return false;
  };
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled rejection:', event.reason);
    showToast(`Promise Error: ${event.reason}`, 'error', 5000);
  });
}

// ══════════════════════════════════════════════════════════
// PERFORMANCE MONITOR
// ══════════════════════════════════════════════════════════
function initPerformanceMonitor() {
  // Track data rate every second
  setInterval(() => {
    state.dataRatePerSec = state.dataRateCounter;
    state.dataRateCounter = 0;

    const rateEl = document.getElementById('perf-data-rate');
    if (rateEl) rateEl.textContent = `${state.dataRatePerSec}/s`;

    // Warn if data rate is very high
    if (state.dataRatePerSec > 5000 && !state.dataRateWarningShown) {
      state.dataRateWarningShown = true;
      showToast(`⚠️ High data rate: ${state.dataRatePerSec} frames/sec. Consider enabling data sampling.`, 'warning', 8000);
      const warningBar = document.getElementById('perf-warning-bar');
      if (warningBar) warningBar.classList.remove('hidden');
    } else if (state.dataRatePerSec < 1000) {
      state.dataRateWarningShown = false;
      const warningBar = document.getElementById('perf-warning-bar');
      if (warningBar) warningBar.classList.add('hidden');
    }
  }, 1000);

  // Periodic cleanup every 30s
  setInterval(() => {
    const container = document.getElementById('data-content');
    if (container && container.children.length > 500) {
      const excess = container.children.length - 400;
      for (let i = 0; i < excess; i++) {
        container.removeChild(container.firstChild);
      }
    }
    // Trim waveform data (scope-style: time-based)
    const maxMsDiv = Math.max(...state.waveformViews.map(v => v.msDiv || 50), state.waveformMsDiv || 50);
    const maxKeep = state.scopeTimingMode === 'manual'
      ? Math.ceil((maxMsDiv * 10) / (state.waveformDataRateMs || 1)) * 3
      : 10000; // reasonable cap for auto mode
    if (state.waveformData.length > maxKeep) {
      state.waveformData.splice(0, state.waveformData.length - maxKeep);
    }
  }, 30000);
}

// ══════════════════════════════════════════════════════════
// WAVEFORM SEND PANEL (send bar in wave tab)
// ══════════════════════════════════════════════════════════
function initWaveformSendPanel() {
  const waveInput = document.getElementById('wave-send-input');
  const waveBtn = document.getElementById('btn-wave-send');
  if (!waveInput || !waveBtn) return;

  waveBtn.addEventListener('click', () => {
    document.getElementById('send-input').value = waveInput.value;
    sendData();
    waveInput.value = '';
  });

  waveInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('send-input').value = waveInput.value;
      sendData();
      waveInput.value = '';
      state.sendHistoryIndex = -1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSendHistory(waveInput, 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateSendHistory(waveInput, -1);
    }
  });
}

// ══════════════════════════════════════════════════════════
// COMMAND MACROS (keyboard shortcuts)
// ══════════════════════════════════════════════════════════
function initCommandMacros() {
  // Load saved macros
  try {
    const saved = JSON.parse(localStorage.getItem('serialDebugPro_macros') || '{}');
    state.commandMacros = saved;
  } catch (e) { }

  // Macro listener box
  const listenerBox = document.getElementById('macro-listener-box');
  if (listenerBox) {
    listenerBox.addEventListener('focus', () => {
      state.macroListenerActive = true;
      listenerBox.placeholder = 'Listening for keystrokes...';
    });
    listenerBox.addEventListener('blur', () => {
      state.macroListenerActive = false;
      listenerBox.placeholder = 'Click to activate macro keys';
    });
    listenerBox.addEventListener('keydown', (e) => {
      e.preventDefault();
      const key = e.key;
      // Check if any command has this key as macro
      for (const [slotIdx, assignedKey] of Object.entries(state.commandMacros)) {
        if (assignedKey === key) {
          const idx = parseInt(slotIdx);
          const cmd = state.commands[idx];
          if (cmd) {
            sendCommandWithRepeat(cmd, idx);
            blinkCommandLed(idx, true);
            setTimeout(() => blinkCommandLed(idx, false), 200);
            showToast(`Macro: ${cmd.name} (${key})`, 'info', 1500);
          }
        }
      }
    });
  }
}

function assignMacroKey(slotIndex) {
  showToast('Press any key to assign — Escape to remove current key', 'info', 4000);
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      delete state.commandMacros[slotIndex];
      showToast(`Macro key removed from slot ${slotIndex + 1}`, 'info');
    } else {
      state.commandMacros[slotIndex] = e.key;
      showToast(`Key "${e.key}" assigned to slot ${slotIndex + 1}`, 'success');
    }
    localStorage.setItem('serialDebugPro_macros', JSON.stringify(state.commandMacros));
    renderCommandGrid();
    document.removeEventListener('keydown', handler);
  };
  document.addEventListener('keydown', handler, { once: true });
}

// ══════════════════════════════════════════════════════════
// COMMAND REPEAT & FUNCTION OF TIME
// ══════════════════════════════════════════════════════════
async function sendCommandWithRepeat(cmd, slotIndex) {
  // Cancel any running timer for this slot first
  if (state.activeCommandTimers[slotIndex]) {
    clearInterval(state.activeCommandTimers[slotIndex]);
    delete state.activeCommandTimers[slotIndex];
    blinkCommandLed(slotIndex, false);
    showToast(`Stopped slot ${slotIndex + 1}`, 'info', 1500);
    return;
  }

  const config = state.commandRepeatConfigs[slotIndex];
  if (!config) {
    // Single send — still blink LED
    sendCommand(cmd);
    blinkCommandLed(slotIndex, true);
    setTimeout(() => blinkCommandLed(slotIndex, false), 200);
    return;
  }

  if (config.functionMode && config.functionExpr) {
    // Function of time mode
    const rate = config.functionRate || 100;
    const duration = (config.functionDuration || 5) * 1000;
    const decimals = config.functionDecimals != null ? config.functionDecimals : 2;
    const dataTemplate = cmd.data || '';
    const startTime = Date.now();
    showToast(`Sending f(t)=${config.functionExpr} for ${config.functionDuration}s`, 'info', 2000);
    const timer = setInterval(async () => {
      const t = (Date.now() - startTime) / 1000;
      if (Date.now() - startTime >= duration) {
        clearInterval(timer);
        delete state.activeCommandTimers[slotIndex];
        blinkCommandLed(slotIndex, false);
        showToast(`Function send complete (slot ${slotIndex + 1})`, 'success', 2000);
        return;
      }
      const value = evaluateMathExpr(config.functionExpr, {}, t);
      if (value !== null) {
        const formatted = Number(value).toFixed(decimals);
        // If data template contains {fn}, replace it; otherwise send raw number
        let sendStr;
        if (dataTemplate.includes('{fn}')) {
          sendStr = dataTemplate.replace(/\{fn\}/g, formatted);
        } else {
          sendStr = formatted;
        }
        await sendRawData(sendStr);
        blinkCommandLed(slotIndex, true);
        setTimeout(() => blinkCommandLed(slotIndex, false), Math.min(80, rate / 2));
      }
    }, rate);
    state.activeCommandTimers[slotIndex] = timer;
  } else if (config.repeatCount && config.repeatCount > 1) {
    // Repeat N times mode
    const interval = config.intervalMs || 500;
    let count = 0;
    showToast(`Repeating ×${config.repeatCount} every ${interval}ms`, 'info', 2000);
    const timer = setInterval(async () => {
      if (count >= config.repeatCount) {
        clearInterval(timer);
        delete state.activeCommandTimers[slotIndex];
        blinkCommandLed(slotIndex, false);
        showToast(`Repeat complete (slot ${slotIndex + 1})`, 'success', 2000);
        return;
      }
      await sendCommand(cmd);
      blinkCommandLed(slotIndex, true);
      setTimeout(() => blinkCommandLed(slotIndex, false), Math.min(80, interval / 2));
      count++;
    }, interval);
    state.activeCommandTimers[slotIndex] = timer;
  } else {
    sendCommand(cmd);
    blinkCommandLed(slotIndex, true);
    setTimeout(() => blinkCommandLed(slotIndex, false), 200);
  }
}

async function sendRawData(data) {
  if (!state.connected) return;
  try {
    const mode = state.connectionMode;
    let sendStr = data;
    if (document.getElementById('send-cr')?.checked) sendStr += '\r';
    if (document.getElementById('send-newline')?.checked) sendStr += '\n';
    if (mode === 'serial') await window.serialDebug.serial.send(sendStr, state.sendEncoding);
    else if (mode.startsWith('tcp')) await window.serialDebug.tcp.send(sendStr, state.sendEncoding);
    else if (mode === 'udp') {
      await window.serialDebug.udp.send(sendStr, document.getElementById('udp-remote-host').value, document.getElementById('udp-remote-port').value, state.sendEncoding);
    }
    const rawBytes = stringToBytes(sendStr);
    state.txCount += rawBytes.length;
    flushFrame('tx', rawBytes);
    updateCountBadges();
  } catch (err) { showToast('Send error: ' + err, 'error'); }
}

function blinkCommandLed(slotIndex, on) {
  const led = document.querySelector(`.cmd-led[data-slot="${slotIndex}"]`);
  if (led) {
    led.classList.toggle('active', on);
  }
}

// ══════════════════════════════════════════════════════════
// WAVEFORM CONTEXT MENU
// ══════════════════════════════════════════════════════════
function initWaveformContextMenu() {
  const ctxMenu = document.getElementById('wave-ctx-menu');
  if (!ctxMenu) return;

  // Right-click on view-0 chart area (new views wire their own contextmenu in createWaveformView)
  const chartArea = document.getElementById('waveform-chart-area');
  if (chartArea) {
    chartArea.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      state._ctxMenuViewId = 0;
      ctxMenu.style.left = e.clientX + 'px';
      ctxMenu.style.top = e.clientY + 'px';
      ctxMenu.classList.remove('hidden');
    });
  }

  // Close on click anywhere else
  document.addEventListener('click', (e) => {
    if (!ctxMenu.contains(e.target)) ctxMenu.classList.add('hidden');
  });

  // Handle menu items
  ctxMenu.querySelectorAll('.wave-ctx-menu__item').forEach(item => {
    item.addEventListener('click', () => {
      ctxMenu.classList.add('hidden');
      const action = item.dataset.action;
      const viewId = state._ctxMenuViewId != null ? state._ctxMenuViewId : 0;
      switch (action) {
        case 'split-h':
        case 'split-v':
          splitWaveformView(viewId, action);
          break;
        case 'close-view':
          closeWaveformView(viewId);
          break;
        case 'screenshot-view':
          takeViewScreenshot(viewId);
          break;
        case 'screenshot-all':
          takeAllViewsScreenshot();
          break;
      }
    });
  });
}

async function takeViewScreenshot(viewId) {
  const view = state.waveformViews.find(v => v.id === viewId);
  if (!view || !view.chart) return;
  const canvas = view.chart.canvas;
  if (!canvas) return;
  const dataUrl = canvas.toDataURL('image/png');
  await saveScreenshotDataUrl(dataUrl, 'Save View Screenshot');
}

async function takeAllViewsScreenshot() {
  if (state.waveformViews.length === 0) return;
  // If only one view, just take that
  if (state.waveformViews.length === 1) {
    return takeViewScreenshot(state.waveformViews[0].id);
  }
  // Composite all view canvases onto one
  const root = document.getElementById('waveform-split-root');
  if (!root) return;
  const rect = root.getBoundingClientRect();
  const compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = rect.width * window.devicePixelRatio;
  compositeCanvas.height = rect.height * window.devicePixelRatio;
  const ctx = compositeCanvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary') || '#0a0e1a';
  ctx.fillRect(0, 0, rect.width, rect.height);

  state.waveformViews.forEach(view => {
    if (!view.chart || !view.chart.canvas) return;
    const vCanvas = view.chart.canvas;
    const vRect = vCanvas.getBoundingClientRect();
    const x = vRect.left - rect.left;
    const y = vRect.top - rect.top;
    ctx.drawImage(vCanvas, x, y, vRect.width, vRect.height);
  });

  const dataUrl = compositeCanvas.toDataURL('image/png');
  await saveScreenshotDataUrl(dataUrl, 'Save All Views Screenshot');
}

async function saveScreenshotDataUrl(dataUrl, title) {
  const result = await window.serialDebug.dialog.saveFile({
    title,
    filters: [{ name: 'PNG Images', extensions: ['png'] }],
  });
  if (!result.canceled && result.filePath) {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    try {
      if (window.serialDebug.file.writeBinary) {
        await window.serialDebug.file.writeBinary(result.filePath, Array.from(bytes));
      } else {
        await window.serialDebug.file.write(result.filePath, Buffer.from ? Buffer.from(bytes) : String.fromCharCode(...bytes));
      }
      showToast('Screenshot saved', 'success');
    } catch (err) {
      showToast('Save failed: ' + err, 'error');
    }
  }
}

// ══════════════════════════════════════════════════════════
// SPLIT VIEW RESIZER
// ══════════════════════════════════════════════════════════
const _origInitSplitView = initSplitView;
initSplitView = function () {
  _origInitSplitView();

  const divider = document.getElementById('split-divider');
  if (!divider) return;

  let isDragging = false;
  let startX = 0;
  let startWidthPrimary = 0;

  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    const primary = document.getElementById('split-primary');
    startWidthPrimary = primary.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const content = document.getElementById('content-area');
    if (!content.classList.contains('split-mode')) return;

    const dx = e.clientX - startX;
    const primary = document.getElementById('split-primary');
    const secondary = document.getElementById('split-secondary');
    const totalWidth = content.offsetWidth - 4;
    const newWidth = Math.max(200, Math.min(totalWidth - 200, startWidthPrimary + dx));

    primary.style.flex = 'none';
    primary.style.width = newWidth + 'px';
    secondary.style.flex = '1';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Resize all view charts
      state.waveformViews.forEach(v => { if (v.chart) setTimeout(() => v.chart.resize(), 50); });
      if (state.terminal && state.terminalFitAddon) setTimeout(() => state.terminalFitAddon.fit(), 50);
    }
  });
};

