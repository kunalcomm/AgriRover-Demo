'use strict';

// Replace this adapter with Flask API calls when a backend is available.
const samplePredictions = [
  { name: 'Early Blight', confidence: 91, severity: 'Moderate' },
  { name: 'Healthy', confidence: 96, severity: 'None indicated' },
  { name: 'Late Blight', confidence: 88, severity: 'High' }
];
const irrigationLimits = { tankCutoff: 10, maxSeconds: 15 };
const validPercent = value => Number.isInteger(value) && value >= 0 && value <= 100;

const preferenceKey = 'agrirover.preferences.v1';
const preferenceDefaults = { name: 'Rover AR-01', speed: 50, threshold: 30, scanInterval: 1, recentCount: 3 };

function validPreferences(value) {
  return typeof value?.name === 'string' && value.name.trim().length > 0 && value.name.length <= 40 &&
    Number.isInteger(value.speed) && value.speed >= 10 && value.speed <= 100 && value.speed % 5 === 0 &&
    validPercent(value.threshold) && Number.isInteger(value.scanInterval) && value.scanInterval >= 1 && value.scanInterval <= 10 &&
    [3, 5].includes(value.recentCount);
}
function loadPreferences() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(preferenceKey));
    if (validPreferences(stored)) return stored;
  } catch { /* Storage can be unavailable in private or local-file sessions. */ }
  return { ...preferenceDefaults };
}
let preferences = loadPreferences();
let settingsFeedback = '';
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

const demo = {
  wateringTimer: undefined,
  wateringDeadline: 0,
  autoHold: false,
  onWateringTimeout: null,
  sampleIndex: 0,
  telemetry: { battery: 86, moisture: 34, tank: 72 },
  trend: [49, 46, 43, 38, 40, 36, 34],
  prediction: { ...samplePredictions[0], time: '21 Nov · 10:42' },
  scans: [
    { ...samplePredictions[0], time: '21 Nov · 10:42' },
    { ...samplePredictions[0], confidence: 89, time: '21 Nov · 09:15' }
  ],
  activity: [
    ['Leaf scan completed', '21 Nov · 10:42'],
    ['Watering cycle completed · 2 min', '21 Nov · 10:18'],
    ['Soil probe calibrated', '21 Nov · 09:50'],
    ['Leaf scan completed', '21 Nov · 09:15']
  ],
  pump: false, auto: false, threshold: preferences.threshold, scanning: false, motion: 'Idle', stopped: false,
  record(message) {
    const time = new Date().toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    });
    this.activity.unshift([message, time]);
    return time;
  },
  captureSample(message = 'Simulated leaf scan completed') {
    const time = this.record(message);
    this.sampleIndex = (this.sampleIndex + 1) % samplePredictions.length;
    this.prediction = { ...samplePredictions[this.sampleIndex], time };
    this.scans.unshift(this.prediction);
  },
  startWatering() {
    if (this.pump || this.stopped || this.telemetry.tank <= irrigationLimits.tankCutoff) return;
    this.pump = true;
    this.wateringDeadline = Date.now() + irrigationLimits.maxSeconds * 1000;
    this.record(this.auto ? 'Automatic watering started' : 'Manual pump started');
    this.wateringTimer = window.setTimeout(() => {
      this.autoHold = this.auto;
      this.stopWatering('safety limit of ' + irrigationLimits.maxSeconds + ' seconds reached');
      this.onWateringTimeout?.();
    }, irrigationLimits.maxSeconds * 1000);
  },
  stopWatering(reason) {
    if (!this.pump) return;
    window.clearTimeout(this.wateringTimer);
    this.wateringTimer = undefined;
    this.wateringDeadline = 0;
    this.pump = false;
    this.record('Pump stopped · ' + reason);
  },
  updatePump() {
    if (this.auto && this.telemetry.moisture >= this.threshold) this.autoHold = false;
    if (this.telemetry.tank <= irrigationLimits.tankCutoff) {
      this.stopWatering('low-water safety cutoff');
      return;
    }
    if (!this.auto || this.stopped) return;
    if (this.telemetry.moisture >= this.threshold) {
      this.stopWatering('moisture threshold reached');
    } else if (!this.autoHold) {
      this.startWatering();
    }
  },
  setIrrigationTelemetry(moisture, tank) {
    if (!validPercent(moisture) || !validPercent(tank)) return;
    Object.assign(this.telemetry, { moisture, tank });
    this.record('Irrigation simulation · moisture ' + moisture + '% · tank ' + tank + '%');
    this.updatePump();
  },
  setThreshold(threshold) {
    if (!validPercent(threshold)) return;
    this.threshold = threshold;
    this.record('Moisture threshold set to ' + threshold + '%');
    this.updatePump();
  },
  command(action) {
    let message;
    switch (action) {
      case 'stop':
        this.stopped = true;
        this.motion = 'Emergency stop';
        this.stopWatering('emergency stop');
        this.auto = this.scanning = false;
        message = 'Emergency stop engaged';
        break;
      case 'reset':
        this.stopped = false;
        this.motion = 'Idle';
        message = 'Emergency stop cleared';
        break;
      case 'sample':
        if (this.stopped) return;
        this.captureSample();
        return;
      case 'scan':
        if (this.stopped) return;
        this.scanning = !this.scanning;
        message = this.scanning ? 'Simulated leaf scan completed' : 'Scanning disabled';
        if (this.scanning) {
          this.captureSample();
          return;
        }
        break;
      case 'pump-on':
        if (!this.auto) this.startWatering();
        return;
      case 'pump-off':
        this.autoHold = this.auto;
        this.stopWatering('operator stop');
        return;
      case 'auto':
        if (this.stopped) return;
        this.stopWatering('mode changed');
        this.auto = !this.auto;
        this.autoHold = false;
        this.record('Auto-irrigation ' + (this.auto ? 'enabled' : 'disabled'));
        this.updatePump();
        return;
      case 'Forward':
      case 'Left':
      case 'Right':
      case 'Backward':
        if (this.stopped) return;
        this.motion = action;
        message = 'Rover movement · ' + action;
        break;
      default:
        return;
    }
    this.record(message);
  }
};

const view = document.querySelector('#view');
const icon = name => '<i aria-hidden="true" data-lucide="' + name + '"></i>';
const intro = (title, description) => '<div class="intro"><h1>' + title + '</h1><p class="muted">' + description + '</p></div>';
const panel = (title, content) => '<section class="panel"><h2>' + title + '</h2>' + content + '</section>';
const rows = items => items.map(([name, time]) => '<div class="row"><div><strong>' + name + '</strong><small>' + time + '</small></div></div>').join('');
function button(action, label, { pressed, disabled, danger } = {}) {
  return '<button type="button" data-action="' + action + '"' +
    (pressed === undefined ? '' : ' aria-pressed="' + pressed + '"') +
    (disabled ? ' disabled' : '') + (danger ? ' class="danger"' : '') + '>' + label + '</button>';
}

const leaf = alt => '<img src="assets/sample-leaf.jpg" alt="' + alt + '">';
const meter = (label, value) => '<meter min="0" max="100" value="' + value + '" aria-label="' + label + '">' + value + '%</meter>';
const historyFilters = { query: '', category: '' };
const eventTypes = {
  Rover: { icon: 'gamepad-2', tone: 'rover' },
  'Disease Detection': { icon: 'scan-line', tone: 'disease' },
  Irrigation: { icon: 'droplets', tone: 'water' },
  Safety: { icon: 'shield-alert', tone: 'safety' },
  System: { icon: 'settings', tone: 'system' }
};
function categoryFor(name) {
  if (/emergency stop|safety limit|safety cutoff/i.test(name)) return 'Safety';
  if (/scan|camera capture/i.test(name)) return 'Disease Detection';
  if (/water|pump|irrigation|threshold/i.test(name)) return 'Irrigation';
  if (/rover movement/i.test(name)) return 'Rover';
  return 'System';
}
function filteredEvents() {
  const query = historyFilters.query.trim().toLowerCase();
  return demo.activity.filter(([name, time]) => {
    const category = categoryFor(name);
    return (!historyFilters.category || category === historyFilters.category) &&
      (name + ' ' + time + ' ' + category).toLowerCase().includes(query);
  });
}
function updateHistory() {
  const target = view.querySelector('#event-results');
  if (!target) return;
  const events = filteredEvents();
  target.innerHTML = events.length ? events.map(([name, time]) => {
    const category = categoryFor(name);
    const type = eventTypes[category];
    return '<div class="event-entry"><span class="event-marker ' + type.tone + '">' + icon(type.icon) +
      '</span><div><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(time) +
      '</small></div><span class="event-tag ' + type.tone + '">' + category + '</span></div>';
  }).join('') : '<div class="events-empty"><strong>No matching events</strong><p>Try a different search or choose All.</p></div>';
  view.querySelector('#event-count').textContent = events.length + (events.length === 1 ? ' event' : ' events');
  view.querySelector('[data-action="export-events"]').disabled = !events.length;
  window.lucide?.createIcons();
}
function eventsCsv(events) {
  const field = value => '"' + (/^[\s]*[=+@-]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"';
  return [['Timestamp', 'Category', 'Event', 'Source'], ...events.map(([name, time]) =>
    [time, categoryFor(name), name, 'DEMO'])].map(row => row.map(field).join(',')).join('\r\n');
}
function exportEvents() {
  const events = filteredEvents();
  if (!events.length) return;
  const url = URL.createObjectURL(new Blob(['\uFEFF', eventsCsv(events)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'agrirover-demo-events.csv';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let sampleTimer;
let scanPhase = 'Idle';
let selectedScan;
const scanBusy = () => scanPhase === 'Scanning' || scanPhase === 'Processing';
function predictionDetails({ name, confidence, severity, time }) {
  return '<span class="badge">DEMO PREDICTION</span><strong class="value">' + name +
    '</strong><p><strong>' + confidence + '% simulated model confidence</strong></p>' +
    meter('Simulated model confidence', confidence) + '<p><span class="badge warning">Possible severity · ' +
    severity + '</span></p><p><small>Simulated scan · ' + time + '</small></p>';
}

function irrigationScene(running) {
  const plants = [84, 161, 238, 315, 392, 469, 546].map((x, index) =>
    '<use href="#irrigation-crop" x="' + x + '" y="' + (index % 2 ? 147 : 157) + '"/>').join('');
  const spray = [-2, -1, 0, 1, 2].map((offset, index) =>
    '<path style="--delay:' + (-index * .19) + 's" d="M320 66 Q' + (320 + offset * 30) +
    ' 65 ' + (320 + offset * 78) + ' ' + (133 + Math.abs(offset) * 6) + '"/>').join('');
  return '<figure class="irrigation-scene"><svg viewBox="0 0 640 192" aria-hidden="true">' +
    '<defs><g id="irrigation-crop"><path d="M0 9V-28" stroke="#26563d" stroke-width="3"/><path d="M0-9Q-36-12-30-35Q-5-34 0-9" fill="#4c915a"/><path d="M0-19Q13-48 30-38Q27-16 0-19" fill="#75aa5d"/></g></defs>' +
    '<path fill="#c0d9ad" d="M0 132Q166 62 320 115Q467 63 640 126V192H0Z"/><path fill="#e2ccaa" d="M0 151Q170 132 308 155Q463 138 640 158V192H0Z"/>' +
    '<path d="M28 167H612" stroke="#8a6b49" stroke-width="2" stroke-dasharray="8 9"/>' + plants +
    '<path d="M46 112V47Q46 38 55 38H308Q320 38 320 50V62" fill="none" stroke="#345c4d" stroke-width="10" stroke-linecap="round"/>' +
    '<path d="M309 63H331" stroke="#234739" stroke-width="7" stroke-linecap="round"/>' +
    (running ? '<g class="irrigation-spray">' + spray + '</g>' : '') +
    '</svg><figcaption><span class="badge">DEMO</span><strong>' + (running ? 'Sprinkler on' : 'Sprinkler off') + '</strong></figcaption></figure>';
}

let backendTelemetry = null;
const staticDemo = location.protocol === 'file:' || location.hostname?.endsWith('.github.io');
let backendState = staticDemo ? 'static-demo' : 'connecting';
const passiveMeter = (label, value, key) => meter(label, value).replace('<meter ', '<meter data-passive="' + key + '" ');
function paintBackendTelemetry() {
  const badge = document.querySelector('#backend-status');
  const labels = {
    'static-demo': 'Demo Mode — No Backend Connected',
    connecting: 'Connecting',
    connected: 'Backend Connected (Demo)',
    offline: 'Backend Offline'
  };
  if (badge && badge.textContent !== labels[backendState]) badge.textContent = labels[backendState];
  if (badge) badge.dataset.state = backendState;
  const readings = backendTelemetry ?? demo.telemetry;
  view.querySelectorAll('[data-passive]').forEach(element => {
    const value = readings[element.dataset.passive];
    if (element.tagName === 'METER') element.value = value;
    else element.textContent = value + '%';
  });
  view.querySelectorAll('[data-telemetry-source]').forEach(element => {
    element.textContent = backendTelemetry ? 'Backend demo readings' : 'Local demo readings';
  });
}

const pages = {
  overview() {
    const { battery, moisture, tank } = demo.telemetry;
    const mode = demo.stopped ? 'Emergency stop active' : demo.auto ? 'Automatic irrigation' : 'Manual irrigation';
    const metrics = [
      ['battery-charging', 'Battery level', battery + '%', escapeHtml(preferences.name), battery, 'battery'],
      ['sprout', 'Soil moisture', moisture + '%', 'Simulated volumetric reading', moisture, 'moisture'],
      ['droplets', 'Water tank', tank + '%', 'Reservoir fill level', tank, 'tank'],
      ['power', 'Pump state', demo.pump ? 'On' : 'Off', mode, null]
    ].map(([symbol, label, value, detail, level, reading]) =>
      '<section class="metric"><div class="metric-heading"><span class="tile-icon">' + icon(symbol) +
      '</span><span>' + label + '</span></div><strong class="value"' + (reading ? ' data-passive="' + reading + '"' : '') + '>' + value + '</strong>' +
      (level === null ? '<span class="pump-track ' + (demo.pump ? 'is-running' : '') + '" aria-hidden="true"></span>' : passiveMeter(label, level, reading)) +
      '<small>' + detail + '</small></section>').join('');
    const shortcuts = [
      ['live', 'gamepad-2', 'Live Rover'],
      ['disease', 'scan-line', 'Disease Detection'],
      ['irrigation', 'droplets', 'Irrigation Control']
    ].map(([route, symbol, label]) => '<a href="#' + route + '">' + icon(symbol) + label + '</a>').join('');
    return '<div class="overview-refresh">' +
      intro('Field overview', 'Monitor rover telemetry, crop health, and irrigation across the North Plot.') +
      '<section class="mission"><div class="mission-copy"><span class="eyebrow">DEMO · FIELD TELEMETRY</span>' +
      '<h2>' + escapeHtml(preferences.name) + '</h2><p>North Plot · Greenfield Farm</p><div class="hero-status">' +
      '<span class="badge">ESP32 · Not connected</span><span class="badge">' + mode +
      '</span></div><small class="hero-update">' + icon('clock-3') + ' <span data-telemetry-source>Local demo readings</span></small></div>' +
      '<img class="hero-art" src="assets/rover.svg" alt=""></section>' +
      '<div class="metrics">' + metrics + '</div><nav class="quick-actions" aria-label="Overview quick actions">' + shortcuts + '</nav><div class="columns">' +
      panel('Soil moisture trend', '<p class="muted">Calibrated readings over the last 7 days</p><div class="chart"><canvas id="moisture-chart" role="img" aria-label="Daily soil moisture from 15 to 21 November: ' + demo.trend.join(', ') + ' percent"></canvas><p id="chart-fallback" hidden>15–21 Nov · ' + demo.trend.join('%, ') + '%</p></div>') +
      '<div class="stack">' + panel('Disease alert', '<div class="row scan-row"><span class="thumbnail">' + leaf('') +
      '</span><div><strong>' + demo.prediction.name + '</strong><small>' + demo.prediction.time + ' · Simulated prediction</small></div></div>' +
      '<div class="alert-details"><span class="badge warning">Possible severity · ' + demo.prediction.severity + '</span><span class="badge">' +
      demo.prediction.confidence + '% simulated confidence</span></div><a class="link" href="#disease">View Detection</a>') +
      panel('Recent activity', rows(demo.activity.slice(0, preferences.recentCount)) + '<a class="link" href="#history">View activity history</a>') + '</div></div></div>';
  },
  live() {
    const directions = { Forward: 'arrow-up', Left: 'arrow-left', Backward: 'arrow-down', Right: 'arrow-right' };
    const pad = Object.entries(directions).map(([name, symbol]) =>
      button(name, icon(symbol) + name, { disabled: demo.stopped, pressed: demo.motion === name })).join('');
    return '<div class="live-rover">' + intro('Live Rover', escapeHtml(preferences.name) + ' · North Plot · Simulation only') +
      '<div class="live-grid"><div class="stack">' +
      panel('Camera monitor', '<div class="camera-preview"><span class="badge">DEMO CAMERA</span>' + icon('video-off') +
        '<strong>No camera connected</strong><small>Simulated preview · ' + escapeHtml(preferences.name) + '</small></div><div class="live-meta"><span class="badge">ESP32 · Not connected</span><span class="badge">' +
        (demo.scanning ? 'Scan active' : 'Scan idle') + '</span></div><div class="actions">' +
        button('capture', 'Capture sample', { disabled: demo.stopped }) + '<small>' +
        (drive.capture ? 'Last simulated capture · ' + drive.capture : 'Demo snapshot · 21 Nov, 10:42') + '</small></div>') +
      panel('Crop scanning', '<p>' + (demo.scanning ? 'Simulated scan active. A sample result was added at scan start.' :
        'Start a simulated scan to add a sample result to Disease Detection.') + '</p><div class="actions">' +
        button('scan', demo.scanning ? 'Stop Scan' : 'Start Scan', { pressed: demo.scanning, disabled: demo.stopped }) +
        '<a class="link" href="#disease">View scan results</a></div>') + '</div><div class="stack">' +
      panel('Drive controls', '<div class="live-telemetry"><div><small>Movement</small><strong id="live-motion" role="status">' +
        demo.motion + '</strong></div><div><small>Battery · DEMO</small><small data-telemetry-source>Local demo readings</small><strong data-passive="battery">' + demo.telemetry.battery + '%</strong>' +
        passiveMeter('Simulated battery', demo.telemetry.battery, 'battery') + '</div></div><div class="live-speed"><label for="drive-speed">Demo speed</label>' +
        '<output id="speed-value" for="drive-speed">' + drive.speed + '%</output><input type="range" id="drive-speed" min="10" max="100" step="5" value="' +
        drive.speed + '" title="Adjust simulated speed"' + (demo.stopped ? ' disabled' : '') + '></div>' +
        '<div class="controls" role="group" aria-label="Directional controls" title="Focus a direction and hold an arrow key to move">' + pad + '</div><div class="live-stop">' +
        button('stop', 'Emergency stop', { danger: true, disabled: demo.stopped }) +
        button('reset', 'Reset stop', { disabled: !demo.stopped }) + '</div>') +
      panel('Operating safety', '<p>Focus a direction button and hold an arrow key to move. Release the key or leave the pad to stop. Clicking a direction sends one short demo command.</p>' +
        '<p class="notice spaced">For real equipment, keep people clear of the operating area and verify the physical emergency stop before operation.</p>') + '</div></div></div>';
  },
  disease() {
    const phase = demo.stopped ? 'Paused · Emergency stop' : scanPhase;
    return '<div class="disease-monitor">' + intro('Disease Detection', 'Inspect simulated tomato leaf predictions from this demo session.') +
      '<div class="columns"><div class="stack">' +
      panel('Tomato leaf reference', '<figure class="sample-photo">' + leaf('Tomato leaves with visible spotting') +
        '<span class="badge">SAMPLE IMAGE</span></figure><small>Photo by <a class="link" href="https://commons.wikimedia.org/wiki/File:Early_blight_on_tomato_leaves_(7871930010).jpg">Dwight Sipler</a> · <a class="link" href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a> · display cropped</small>' +
        '<div class="actions">' + button('sample', 'Start Demo Scan', { disabled: demo.stopped || scanBusy() }) +
        '<span class="badge scan-phase" role="status">' + phase + '</span></div>') +
      panel('What a prediction means', '<p>Healthy, Early Blight, and Late Blight are preset demo outputs. Every entry uses the same reference photo to illustrate the interface.</p><p class="spaced">The confidence score is simulated. Confirm suspected disease through field inspection or a qualified crop specialist before making treatment decisions.</p>') +
      '</div><div class="stack">' + panel('Latest prediction', predictionDetails(demo.prediction)) +
      panel('Scan history', '<div class="scan-list">' + demo.scans.map((scan, index) =>
        button('inspect-' + index, '<span class="thumbnail">' + leaf('') + '</span><span><strong>' + scan.name +
          '</strong><small>' + scan.time + ' · Simulated</small></span><span class="badge">' + scan.confidence + '%</span>',
          { pressed: selectedScan === scan })).join('') + '</div>' +
        (selectedScan ? '<section class="scan-inspector" aria-label="Selected scan"><h3>Selected scan</h3>' + predictionDetails(selectedScan) + '</section>' : '')) +
      '</div></div></div>';
  },
  irrigation() {
    const { moisture, tank } = demo.telemetry;
    const dry = moisture < demo.threshold;
    const low = tank <= irrigationLimits.tankCutoff;
    const status = dry ? 'Dry' : moisture > 65 ? 'Wet' : 'Optimal';
    const feedback = demo.stopped ? 'Emergency stop is active. Reset it in Live Rover.' :
      low ? 'Low water · watering blocked' :
      demo.autoHold ? 'Automatic watering paused. Re-enable Auto or bring moisture back to the threshold to re-arm.' :
      demo.pump ? 'Demo watering cycle active' : 'Simulated pump is off';
    const events = demo.activity.filter(([name]) => categoryFor(name) === 'Irrigation' || (categoryFor(name) === 'Safety' && /pump|emergency stop engaged/i.test(name)));
    return '<div class="irrigation-view">' + intro('Irrigation Control', 'North Plot · DEMO simulation · No pump or sensors connected') +
      '<div class="irrigation-readings">' +
      panel('Soil moisture · Local simulation', '<div class="reading-body"><div class="moisture-dial ' + (dry ? 'is-dry' : '') +
        '" data-level="' + moisture + '"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="dial-track" cx="60" cy="60" r="51"/><circle class="dial-arc" cx="60" cy="60" r="51" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + (100 - moisture) + '"/></svg><strong>' + moisture + '%</strong></div><div><span class="badge ' + (dry ? 'warning' : '') +
        '">' + status + '</span><p>Demo threshold · ' + demo.threshold + '%</p><small>Meaningful moisture percentages require sensor calibration.</small></div></div>') +
      panel('Water tank · Local simulation', '<div class="reading-body"><div class="tank-vessel" aria-hidden="true" data-level="' + tank + '"><span class="tank-fill" style="height:' + tank + '%"></span></div><div><strong class="value">' +
        tank + '%</strong><span class="badge ' + (low ? 'warning' : '') + '">' + (low ? 'Low water · pump blocked' : 'Above safety cutoff') +
        '</span><p><small>Safety cutoff at ' + irrigationLimits.tankCutoff + '%</small></p></div></div>') + '</div><div class="irrigation-operation">' + panel('North Plot irrigation', irrigationScene(demo.pump)) +
      panel('Pump control', '<div class="motor-state"><span class="motor-icon ' + (demo.pump ? 'is-running' : '') + '">' + icon('power') +
        '</span><div><strong>Motor ' + (demo.pump ? 'running' : 'off') + '</strong><small>DEMO · ' + (demo.auto ? 'Automatic' : 'Manual') + '</small></div></div>' +
        '<div class="cycle-readout"><span>Cycle safety timer</span><strong id="cycle-time"></strong></div><progress id="cycle-progress" aria-label="Demo watering time remaining" max="' + irrigationLimits.maxSeconds + '" value="0"></progress><p class="notice irrigation-feedback" role="status">' + feedback + '</p><div class="actions">' +
        button('pump-on', 'Pump ON', { pressed: demo.pump && !demo.auto, disabled: demo.pump || demo.auto || demo.stopped || low }) +
        button('pump-off', 'Pump OFF', { pressed: !demo.pump, disabled: !demo.pump }) +
        '</div><p class="spaced"><small>Maximum demo cycle · ' + irrigationLimits.maxSeconds + ' seconds. Pump OFF also stops an automatic cycle.</small></p>') + '</div><div class="columns"><div class="stack">' +
      panel('Automatic irrigation', '<div class="actions">' + button('auto', '<span class="auto-switch" aria-hidden="true"></span> Automatic watering · ' +
        (demo.auto ? 'On' : 'Off'), { pressed: demo.auto, disabled: demo.stopped }) +
        '</div><p>Starts below the saved threshold when water is above the cutoff. Stops at the threshold or when a safety limit is reached.</p>' +
        '<form id="threshold-form"><label for="threshold">Moisture threshold (%)</label><div class="actions"><input id="threshold" type="range" min="0" max="100" value="' +
        demo.threshold + '"><output for="threshold" id="threshold-value">' + demo.threshold +
        '%</output><button type="submit">Save threshold</button></div></form>') + '</div><div class="stack">' +
      panel('Passive telemetry · DEMO', '<p data-telemetry-source>Local demo readings</p><p>Soil <strong data-passive="moisture">' +
        moisture + '%</strong> · Tank <strong data-passive="tank">' + tank +
        '%</strong></p><p><small>Watering rules use the local simulation readings.</small></p>') +
      panel('DEMO telemetry', '<form id="irrigation-sim"><label for="sim-moisture">Soil moisture (%)</label><input id="sim-moisture" type="number" min="0" max="100" required value="' +
        moisture + '"><label for="sim-tank">Tank level (%)</label><input id="sim-tank" type="number" min="0" max="100" required value="' +
        tank + '"><div class="actions"><button type="submit">Apply demo readings</button></div></form>') +
      panel('Irrigation activity', '<div class="timeline irrigation-log">' + rows(events) + '</div>') + '</div></div></div>';
  },
  history() {
    const categories = ['', 'Rover', 'Disease Detection', 'Irrigation', 'Safety'];
    const options = categories.map(category => '<option value="' + category + '">' + (category || 'All') + '</option>').join('');
    return '<div class="activity-page">' + intro('Activity History', 'Review and export simulated rover, crop, and irrigation events.') +
      panel('DEMO event timeline', '<div class="history-filters"><label>Search events<input id="history-search" type="search" placeholder="Event, category, or date"></label>' +
      '<label>Category<select id="history-category">' + options + '</select></label>' + button('export-events', 'Export CSV') +
      '</div><p id="event-count" class="muted" role="status"></p><div id="event-results"></div>') + '</div>';
  },
  settings() {
    const number = (id, label, value, min, max, step = 1) => '<label for="' + id + '">' + label +
      '</label><input id="' + id + '" name="' + id + '" type="number" required min="' + min + '" max="' + max +
      '" step="' + step + '" value="' + value + '">';
    return '<div class="settings-page">' + intro('Settings', 'Configure this demo workspace. Preferences are saved in this browser.') +
      '<form id="settings-form"><div class="settings-grid">' +
      panel('Rover Configuration', '<label for="rover-name">Rover display name</label><input id="rover-name" name="rover-name" required maxlength="40" value="' +
      escapeHtml(preferences.name) + '">' + number('default-speed', 'Default drive speed (%)', preferences.speed, 10, 100, 5) +
      '<p class="muted">Used by the Live Rover demo controls.</p>') +
      panel('Irrigation Preferences', number('settings-threshold', 'Moisture threshold (%)', demo.threshold, 0, 100) +
      '<p class="muted">Saving updates the active demo threshold. If Auto is already enabled, the watering rule is reevaluated.</p>') +
      panel('Disease Scanning', number('scan-interval', 'Scan interval (seconds)', preferences.scanInterval, 1, 10) +
      '<p class="muted">Time a Disease Detection demo scan spends scanning before processing.</p>') +
      panel('Dashboard Preferences', '<label for="recent-count">Overview recent events</label><select id="recent-count" name="recent-count">' +
      [3, 5].map(count => '<option value="' + count + '"' + (count === preferences.recentCount ? ' selected' : '') + '>' + count + ' events</option>').join('') +
      '</select><p class="muted">Choose how many entries appear on the Overview card.</p>') +
      '</div><div class="actions"><button type="submit">Save Settings</button>' + button('settings-reset', 'Reset to Defaults') +
      '</div><p id="settings-feedback" role="status">' + settingsFeedback + '</p></form></div>';
  }
};

const drive = { speed: preferences.speed, capture: '', key: null, timer: undefined };
const driveKeys = { ArrowUp: 'Forward', ArrowLeft: 'Left', ArrowDown: 'Backward', ArrowRight: 'Right' };

function paintDrive() {
  const status = view.querySelector('#live-motion');
  if (!status) return;
  status.textContent = demo.motion === 'Idle' || demo.stopped ? demo.motion : demo.motion + ' · ' + drive.speed + '% demo speed';
  view.querySelectorAll('.live-rover .controls button').forEach(control =>
    control.setAttribute('aria-pressed', String(control.dataset.action === demo.motion)));
}

function releaseDrive() {
  window.clearTimeout(drive.timer);
  drive.key = null;
  if (demo.stopped || demo.motion === 'Idle') return;
  demo.motion = 'Idle';
  paintDrive();
}

view.addEventListener('keydown', event => {
  if (!event.target.closest('.live-rover .controls button') || !Object.hasOwn(driveKeys, event.key) || demo.stopped) return;
  event.preventDefault();
  if (event.repeat) return;
  releaseDrive();
  drive.key = event.key;
  demo.command(driveKeys[event.key]);
  paintDrive();
});
window.addEventListener('keyup', event => {
  if (event.key === drive.key) releaseDrive();
});
window.addEventListener('blur', releaseDrive);
view.addEventListener('focusout', event => {
  if (event.target.closest('.live-rover .controls') && !event.relatedTarget?.closest?.('.live-rover .controls')) releaseDrive();
});

let chart;
let cycleTicker;
function updateWateringClock() {
  const remaining = Math.max(0, (demo.wateringDeadline - Date.now()) / 1000);
  view.querySelector('#cycle-time').textContent = demo.pump ? Math.ceil(remaining) + ' s left' : 'Idle';
  view.querySelector('#cycle-progress').value = remaining;
}
function animateReading(selector, previous, target, keyframes) {
  const element = view.querySelector(selector);
  if (previous !== undefined && previous !== target && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.animate(keyframes(previous, target), { duration: 560, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }
}
function render({ navigate = false, focusAction, announcement } = {}) {
  const requested = location.hash.slice(1);
  const page = Object.hasOwn(pages, requested) ? requested : 'overview';
  chart?.destroy();
  chart = undefined;
  const oldMoisture = view.querySelector('.moisture-dial')?.dataset.level;
  const oldTank = view.querySelector('.tank-vessel')?.dataset.level;
  window.clearInterval(cycleTicker);
  view.innerHTML = pages[page]() + '<p class="sr-only" role="status"></p>';
  paintBackendTelemetry();
  if (page === 'irrigation') {
    animateReading('.dial-arc', oldMoisture, String(demo.telemetry.moisture), (from, to) =>
      [{ strokeDashoffset: 100 - from }, { strokeDashoffset: 100 - to }]);
    animateReading('.tank-fill', oldTank, String(demo.telemetry.tank), (from, to) =>
      [{ height: from + '%' }, { height: to + '%' }]);
    updateWateringClock();
    if (demo.pump) cycleTicker = window.setInterval(updateWateringClock, 100);
  }
  if (announcement) view.querySelector('.sr-only').textContent = announcement;
  if (page === 'history') {
    view.querySelector('#history-search').value = historyFilters.query;
    view.querySelector('#history-category').value = historyFilters.category;
    updateHistory();
  }
  view.querySelectorAll('img[src="assets/sample-leaf.jpg"]').forEach(image => {
    const fallback = () => {
      image.hidden = true;
      if (image.alt) image.parentElement.insertAdjacentHTML('beforeend', '<span class="image-fallback">Sample photo unavailable</span>');
    };
    image.addEventListener('error', fallback, { once: true });
    if (image.complete && !image.naturalWidth) fallback();
  });
  document.querySelectorAll('.sidebar nav a').forEach(link => {
    if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.lucide?.createIcons();
  const canvas = document.querySelector('#moisture-chart');
  if (canvas && window.Chart) {
    chart = new window.Chart(canvas, {
      type: 'line',
      data: {
        labels: ['15 Nov', '16 Nov', '17 Nov', '18 Nov', '19 Nov', '20 Nov', '21 Nov'],
        datasets: [{ label: 'Soil moisture (%)', data: demo.trend, borderColor: '#287551', backgroundColor: '#3d9a6924', fill: true, tension: .36, pointRadius: 3 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : undefined,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { min: 20, max: 60, ticks: { callback: value => value + '%' } } }
      }
    });
  } else if (canvas) {
    canvas.hidden = true;
    document.querySelector('#chart-fallback').hidden = false;
  }
  if (navigate) {
    view.focus();
    window.scrollTo(0, 0);
  } else if (focusAction) {
    const target = view.querySelector('[data-action="' + focusAction + '"]');
    (target && !target.disabled ? target : view).focus();
  }
}

function applyPreferences(next, message) {
  preferences = next;
  drive.speed = next.speed;
  demo.setThreshold(next.threshold);
  demo.record(message);
  settingsFeedback = message + '.';
  try {
    window.localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    settingsFeedback += ' Browser storage is unavailable. Changes apply to this session.';
  }
}
function saveSettings(form) {
  const value = name => form.elements.namedItem(name).value;
  const next = { name: value('rover-name').trim(), speed: Number(value('default-speed')),
    threshold: Number(value('settings-threshold')), scanInterval: Number(value('scan-interval')),
    recentCount: Number(value('recent-count')) };
  if (!validPreferences(next)) {
    view.querySelector('#settings-feedback').textContent = 'Enter a display name and valid values before saving.';
    return;
  }
  applyPreferences(next, 'Demo settings saved');
  render();
  view.querySelector('#settings-form button[type="submit"]').focus();
}

view.addEventListener('click', event => {
  const control = event.target.closest('button[data-action]');
  if (!control) return;
  const action = control.dataset.action;
  if (action === 'export-events') {
    exportEvents();
    return;
  }
  if (action === 'settings-reset') {
    applyPreferences({ ...preferenceDefaults }, 'Demo settings reset to defaults');
    render({ focusAction: action });
    return;
  }
  if (location.hash === '#live') {
    releaseDrive();
    if (Object.values(driveKeys).includes(action)) {
      if (demo.stopped) return;
      demo.command(action);
      paintDrive();
      drive.timer = window.setTimeout(releaseDrive, 450);
      return;
    }
    if (action === 'capture') {
      if (demo.stopped) return;
      demo.captureSample('Simulated camera capture · sample scan saved');
      drive.capture = demo.prediction.time;
      render({ focusAction: action, announcement: demo.activity[0][0] });
      return;
    }
  }
  if (action.startsWith('inspect-')) {
    selectedScan = demo.scans[Number(action.slice(8))];
    render({ focusAction: action, announcement: 'Selected scan: ' + selectedScan.name });
    return;
  }
  if (action === 'sample') {
    if (scanBusy() || demo.stopped) return;
    const refreshScan = () => {
      if (location.hash === '#disease') render();
    };
    scanPhase = 'Scanning';
    render({ focusAction: action });
    sampleTimer = window.setTimeout(() => {
      scanPhase = 'Processing';
      refreshScan();
      sampleTimer = window.setTimeout(() => {
        if (demo.stopped) return;
        demo.command('sample');
        scanPhase = 'Completed';
        refreshScan();
      }, 450);
    }, preferences.scanInterval * 1000);
    return;
  }
  if (action === 'stop') {
    window.clearTimeout(sampleTimer);
    if (scanBusy()) scanPhase = 'Idle';
  }
  demo.command(action);
  const focusAction = action === 'stop' ? 'reset' : action === 'reset' ? 'stop' : action;
  render({ focusAction, announcement: demo.activity[0][0] });
});
view.addEventListener('input', event => {
  if (event.target.id === 'drive-speed' && !demo.stopped) {
    drive.speed = event.target.valueAsNumber;
    view.querySelector('#speed-value').value = drive.speed + '%';
  }
  if (event.target.id === 'threshold') view.querySelector('#threshold-value').value = event.target.value + '%';
  if (event.target.id === 'history-search') {
    historyFilters.query = event.target.value;
    updateHistory();
  }
});
view.addEventListener('change', event => {
  if (event.target.id !== 'history-category') return;
  historyFilters.category = event.target.value;
  updateHistory();
});
view.addEventListener('submit', event => {
  const form = event.target;
  if (form.id === 'settings-form') {
    event.preventDefault();
    saveSettings(form);
    return;
  }
  if (!['threshold-form', 'irrigation-sim'].includes(form.id)) return;
  event.preventDefault();
  const value = id => form.querySelector(id).valueAsNumber;
  if (form.id === 'threshold-form') demo.setThreshold(value('#threshold'));
  else demo.setIrrigationTelemetry(value('#sim-moisture'), value('#sim-tank'));
  render({ announcement: demo.activity[0][0] });
  view.querySelector('#' + form.id + ' button[type="submit"]').focus();
});
demo.onWateringTimeout = () => {
  if (location.hash === '#irrigation' || location.hash === '#overview' || location.hash === '#history' || !location.hash) {
    render({ announcement: demo.activity[0][0] });
  }
};
window.addEventListener('hashchange', () => {
  releaseDrive();
  render({ navigate: true });
});
render();

if (!staticDemo && window.AgriRoverApi) {
  const telemetryPoller = window.AgriRoverApi.createTelemetryPoller({
    fetcher: window.fetch.bind(window),
    isHidden: () => document.hidden,
    onUpdate(state, readings) {
      backendState = state;
      backendTelemetry = readings;
      paintBackendTelemetry();
    }
  });
  document.addEventListener('visibilitychange', telemetryPoller.visibilityChanged);
  telemetryPoller.start();
}
