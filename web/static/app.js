// Phoenix YouTube Bot — Web Client Logic

class PhoenixUI {
  constructor() {
    this.status = 'idle';
    this.currentProxyMode = 'direct';
    this.eventSource = null;
    this.pollInterval = null;

    this.initElements();
    this.bindEvents();
    this.setupSSE();
    this.startPolling();

    // Initial thumbnail refresh
    this.updateVideoPreview(this.streamInput.value);
  }

  initElements() {
    // Header telemetry
    this.globalStatusPill = document.getElementById('globalStatusPill');
    this.globalStatusDot = document.getElementById('globalStatusDot');
    this.globalStatusText = document.getElementById('globalStatusText');
    this.cpuStat = document.getElementById('cpuStat');
    this.ramStat = document.getElementById('ramStat');
    this.activeStat = document.getElementById('activeStat');

    // Controls
    this.streamInput = document.getElementById('streamInput');
    this.pasteBtn = document.getElementById('pasteBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.videoThumb = document.getElementById('videoThumb');
    this.previewBadge = document.getElementById('previewBadge');
    this.previewTitle = document.getElementById('previewTitle');
    this.watchLink = document.getElementById('watchLink');

    // Windows Slider
    this.windowsRange = document.getElementById('windowsRange');
    this.windowsDisplay = document.getElementById('windowsDisplay');
    this.presetBtns = document.querySelectorAll('.preset-btn');

    // Mode tabs
    this.modeTabs = document.querySelectorAll('.mode-tab');
    this.customProxyDrawer = document.getElementById('customProxyDrawer');
    this.scrapeDrawer = document.getElementById('scrapeDrawer');
    this.customProxiesText = document.getElementById('customProxiesText');
    this.customProxyCount = document.getElementById('customProxyCount');
    this.scrapeAmount = document.getElementById('scrapeAmount');

    // Options
    this.headlessToggle = document.getElementById('headlessToggle');
    this.durationSelect = document.getElementById('durationSelect');
    this.masterActionBtn = document.getElementById('masterActionBtn');

    // Telemetry display
    this.bottedCounter = document.getElementById('bottedCounter');
    this.activeWindowsCount = document.getElementById('activeWindowsCount');
    this.uptimeCounter = document.getElementById('uptimeCounter');
    this.statusSubtitle = document.getElementById('statusSubtitle');

    // Terminal
    this.terminalOutput = document.getElementById('terminalOutput');
    this.autoScrollCheck = document.getElementById('autoScrollCheck');
    this.clearLogsBtn = document.getElementById('clearLogsBtn');

    // Radar
    this.workersGrid = document.getElementById('workersGrid');
    this.radarBadge = document.getElementById('radarBadge');
  }

  bindEvents() {
    // Video input typing & paste
    this.streamInput.addEventListener('input', (e) => {
      this.updateVideoPreview(e.target.value);
    });

    this.clearBtn.addEventListener('click', () => {
      this.streamInput.value = '';
      this.updateVideoPreview('');
      this.streamInput.focus();
    });

    this.pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          this.streamInput.value = text.trim();
          this.updateVideoPreview(text);
        }
      } catch (err) {
        this.addLocalLog('Clipboard permission denied. Please paste manually.', 'warning');
      }
    });

    // Windows Slider
    this.windowsRange.addEventListener('input', (e) => {
      const val = e.target.value;
      this.windowsDisplay.innerText = `${val} Windows`;
      this.presetBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === val);
      });
    });

    // Preset buttons
    this.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val;
        this.windowsRange.value = val;
        this.windowsDisplay.innerText = `${val} Windows`;
        this.presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Mode tabs
    this.modeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.modeTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentProxyMode = tab.dataset.mode;
        this.updateProxyDrawers();
      });
    });

    // Custom proxies textarea
    this.customProxiesText.addEventListener('input', () => {
      const count = this.customProxiesText.value.split('\n').filter(s => s.trim()).length;
      this.customProxyCount.innerText = `${count} Proxies`;
    });

    // Master Action Button
    this.masterActionBtn.addEventListener('click', () => {
      if (this.status === 'running' || this.status === 'starting') {
        this.stopBot();
      } else {
        this.startBot();
      }
    });

    // Clear logs
    this.clearLogsBtn.addEventListener('click', () => {
      this.terminalOutput.innerHTML = '';
      this.addLocalLog('Console cleared by user.', 'info');
    });
  }

  extractVideoId(raw) {
    if (!raw || !raw.trim()) return '';
    const str = raw.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
      return str;
    }
    const match = str.match(/(?:v=|\/|be\/|shorts\/)([a-zA-Z0-9_-]{11})/i);
    return match ? match[1] : '';
  }

  updateVideoPreview(raw) {
    const videoId = this.extractVideoId(raw);
    const card = document.getElementById('videoPreviewCard');
    if (!videoId) {
      if (card) card.style.display = 'none';
      return;
    }
    if (card) card.style.display = 'flex';
    this.videoThumb.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    this.previewBadge.innerText = `ID: ${videoId}`;
    this.previewTitle.innerText = `YouTube Stream (${videoId})`;
    this.watchLink.href = `https://www.youtube.com/watch?v=${videoId}`;
  }

  updateProxyDrawers() {
    this.customProxyDrawer.style.display = this.currentProxyMode === 'custom' ? 'block' : 'none';
    this.scrapeDrawer.style.display = this.currentProxyMode === 'scrape' ? 'block' : 'none';
  }

  async startBot() {
    const stream = this.streamInput.value.trim();
    if (!stream) {
      this.addLocalLog('⚠️ Please enter or paste a YouTube stream URL or Video ID first.', 'warning');
      this.streamInput.focus();
      return;
    }
    const windows = parseInt(this.windowsRange.value, 10);
    const proxy_mode = this.currentProxyMode;
    const custom_proxies = this.customProxiesText.value;
    const scrape_amount = parseInt(this.scrapeAmount.value, 10);
    const duration = parseInt(this.durationSelect.value, 10);
    const headless = this.headlessToggle.checked;

    this.setBtnState('starting');

    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream,
          windows,
          proxy_mode,
          custom_proxies,
          scrape_amount,
          duration,
          headless
        })
      });

      const data = await res.json();
      if (!data.success) {
        this.addLocalLog(`Failed to start: ${data.message}`, 'danger');
        this.setBtnState('idle');
      }
    } catch (err) {
      this.addLocalLog(`Network error contacting server: ${err.message}`, 'danger');
      this.setBtnState('idle');
    }
  }

  async stopBot() {
    this.setBtnState('stopping');
    try {
      const res = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        this.addLocalLog(`Stop error: ${data.message}`, 'warning');
      }
    } catch (err) {
      this.addLocalLog(`Network error: ${err.message}`, 'danger');
    }
  }

  setBtnState(state) {
    if (state === 'starting') {
      this.masterActionBtn.className = 'btn-master stop';
      this.masterActionBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">INITIALIZING BROWSERS...</span>';
    } else if (state === 'running') {
      this.masterActionBtn.className = 'btn-master stop';
      this.masterActionBtn.innerHTML = '<span class="btn-icon">🛑</span><span class="btn-text">STOP BOT & CLOSE BROWSERS</span>';
    } else if (state === 'stopping') {
      this.masterActionBtn.className = 'btn-master stop';
      this.masterActionBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">CLOSING BROWSER SESSIONS...</span>';
    } else {
      this.masterActionBtn.className = 'btn-master start';
      this.masterActionBtn.innerHTML = '<span class="btn-icon">🚀</span><span class="btn-text">LAUNCH BOT NOW</span>';
    }
  }

  startPolling() {
    this.pollInterval = setInterval(() => this.pollStatus(), 1000);
  }

  async pollStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();
      this.renderTelemetry(data);
    } catch (e) {
      // Server might be reloading
    }
  }

  renderTelemetry(data) {
    this.status = data.status;

    // Header Pills
    this.globalStatusDot.className = `status-indicator-dot ${data.status}`;
    if (data.status === 'running') {
      this.globalStatusText.innerText = 'BOT ACTIVE — STREAMING';
      this.statusSubtitle.innerText = 'Active viewer engagement';
      this.setBtnState('running');
    } else if (data.status === 'starting') {
      this.globalStatusText.innerText = 'SPAWNING BROWSERS...';
      this.statusSubtitle.innerText = 'Launching instances';
      this.setBtnState('starting');
    } else if (data.status === 'stopping') {
      this.globalStatusText.innerText = 'TERMINATING...';
      this.statusSubtitle.innerText = 'Closing windows';
      this.setBtnState('stopping');
    } else {
      this.globalStatusText.innerText = 'STANDBY — IDLE';
      this.statusSubtitle.innerText = 'Ready to stream';
      this.setBtnState('idle');
    }

    this.cpuStat.innerText = `${data.cpu_percent}%`;
    this.ramStat.innerText = `${data.ram_mb} MB`;
    this.activeStat.innerText = `${data.active_windows} / ${data.max_windows}`;

    // Hero Counters
    this.animateNumber('bottedCounter', data.botted);
    this.activeWindowsCount.innerText = `${data.active_windows} / ${data.max_windows}`;
    this.uptimeCounter.innerText = this.formatSeconds(data.elapsed_seconds);

    // Render Radar grid
    this.renderWorkersRadar(data.active_windows, data.max_windows, data.proxy_mode);
  }

  animateNumber(elId, targetNum) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerText = targetNum.toLocaleString();
  }

  formatSeconds(secs) {
    if (!secs || secs < 0) return '00:00:00';
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  renderWorkersRadar(activeCount, maxCount, mode) {
    this.radarBadge.innerText = `${activeCount} / ${maxCount} Active`;

    if (activeCount === 0) {
      if (this.status === 'running') {
        this.workersGrid.innerHTML = `<div class="workers-empty">Launching Chrome browser workers...</div>`;
      } else {
        this.workersGrid.innerHTML = `<div class="workers-empty">Press <strong>Launch Bot Now</strong> to spawn browser workers</div>`;
      }
      return;
    }

    let html = '';
    for (let i = 1; i <= maxCount; i++) {
      const isActive = i <= activeCount;
      const proxyLabel = mode === 'direct' ? 'Direct IP' : (isActive ? 'Proxy Live' : 'Idle');
      const stateLabel = isActive ? 'Streaming Video' : 'Standby';

      html += `
        <div class="worker-node ${isActive ? 'active' : ''}">
          <div class="worker-node-top">
            <span class="worker-id">Worker #${i}</span>
            <span class="worker-dot" style="${isActive ? '' : 'background: #64748b; box-shadow: none;'}"></span>
          </div>
          <div class="worker-proxy">${proxyLabel}</div>
          <div class="worker-state">${stateLabel}</div>
        </div>
      `;
    }

    this.workersGrid.innerHTML = html;
  }

  setupSSE() {
    try {
      this.eventSource = new EventSource('/api/logs/stream');
      this.eventSource.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data);
          this.appendLogLine(entry.time, entry.text, entry.level);
        } catch (e) {}
      };

      this.eventSource.onerror = () => {
        // SSE disconnected, will auto-reconnect
      };
    } catch (err) {
      // Fallback
    }
  }

  appendLogLine(timeStr, text, level = 'info') {
    const div = document.createElement('div');
    div.className = `log-line ${level}`;

    let tag = '[INFO]';
    if (level === 'success') tag = '[+] OK';
    else if (level === 'danger') tag = '[-] ERR';
    else if (level === 'warning') tag = '[!] WARN';

    div.innerHTML = `
      <span class="log-time">[${timeStr || new Date().toLocaleTimeString()}]</span>
      <span class="log-tag">${tag}</span>
      <span class="log-msg">${this.escapeHTML(text)}</span>
    `;

    this.terminalOutput.appendChild(div);

    if (this.autoScrollCheck.checked) {
      this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
    }

    // Keep log lines within max 200 elements in DOM
    while (this.terminalOutput.children.length > 250) {
      this.terminalOutput.removeChild(this.terminalOutput.firstChild);
    }
  }

  addLocalLog(text, level = 'info') {
    const time = new Date().toLocaleTimeString();
    this.appendLogLine(time, text, level);
  }

  escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Instantiate on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new PhoenixUI();
});
