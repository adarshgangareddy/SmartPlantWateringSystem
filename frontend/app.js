/**
 * FloraPulse IoT - Smart Plant Watering Web Dashboard
 * Web Serial API Controller & Live Telemetry Monitor
 */

// --- State Variables ---
let port = null;
let reader = null;
let writer = null;
let readableStreamClosed = null;
let writableStreamClosed = null;
let isConnected = false;

let isSimulationMode = false;
let simulationInterval = null;

let currentMoisture = 45;
let currentRawVal = 580;
let isPumpActive = false;
let currentMode = 'AUTO';
let currentThreshold = 30;

// Gauge circumference for r=80 is 2 * PI * 80 ≈ 502.65
const GAUGE_CIRCUMFERENCE = 502;

// --- DOM Elements ---
const connectBtn = document.getElementById('connectBtn');
const connectBtnText = document.getElementById('connectBtnText');
const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const simToggle = document.getElementById('simToggle');

// Telemetry DOM
const gaugeProgress = document.getElementById('gaugeProgress');
const moistureValue = document.getElementById('moistureValue');
const rawValDisplay = document.getElementById('rawValDisplay');
const moistureCategoryBadge = document.getElementById('moistureCategoryBadge');
const currentThresholdStat = document.getElementById('currentThresholdStat');
const pumpStatusStat = document.getElementById('pumpStatusStat');
const systemModeStat = document.getElementById('systemModeStat');

// Controls DOM
const modeAutoBtn = document.getElementById('modeAutoBtn');
const modeManualBtn = document.getElementById('modeManualBtn');
const controlModeBadge = document.getElementById('controlModeBadge');
const thresholdSlider = document.getElementById('thresholdSlider');
const thresholdValueDisplay = document.getElementById('thresholdValueDisplay');
const waterBurstBtn = document.getElementById('waterBurstBtn');
const pumpToggleBtn = document.getElementById('pumpToggleBtn');
const emergencyStopBtn = document.getElementById('emergencyStopBtn');

// Hardware Cards DOM
const compRelay = document.getElementById('compRelay');
const relayTag = document.getElementById('relayTag');
const relayStatus = document.getElementById('relayStatus');
const compPump = document.getElementById('compPump');
const pumpTag = document.getElementById('pumpTag');
const pumpIconAnim = document.getElementById('pumpIconAnim');
const pumpSubDetail = document.getElementById('pumpSubDetail');

// Console DOM
const consoleBox = document.getElementById('consoleBox');
const clearLogBtn = document.getElementById('clearLogBtn');

// --- Real-time Chart.js Setup ---
const ctx = document.getElementById('moistureChart').getContext('2d');
const chartMaxPoints = 25;
const chartLabels = [];
const chartData = [];
const thresholdLineData = [];

const moistureChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: chartLabels,
    datasets: [
      {
        label: 'Moisture (%)',
        data: chartData,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: '#10b981',
      },
      {
        label: 'Threshold (%)',
        data: thresholdLineData,
        borderColor: '#f59e0b',
        borderWidth: 1.5,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0,
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#9ca3af',
          font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 }
        }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#6b7280', font: { family: "'JetBrains Mono', monospace", size: 10 } }
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#6b7280', font: { family: "'JetBrains Mono', monospace", size: 10 }, stepSize: 20 }
      }
    }
  }
});

// Helper: Append entry to Console Box
function logToConsole(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  entry.innerText = `[${time}] ${message}`;
  consoleBox.appendChild(entry);
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

// Clear Log
clearLogBtn.addEventListener('click', () => {
  consoleBox.innerHTML = '';
  logToConsole('Console log cleared.', 'system');
});

// --- UI Update Function ---
function updateDashboardUI(data) {
  currentMoisture = data.moisture;
  if (data.raw !== undefined) currentRawVal = data.raw;
  if (data.pump !== undefined) isPumpActive = Boolean(data.pump);
  if (data.mode !== undefined) currentMode = data.mode;
  if (data.threshold !== undefined) currentThreshold = data.threshold;

  // 1. Update Circular Gauge
  moistureValue.innerText = currentMoisture;
  rawValDisplay.innerText = `Raw ADC: ${currentRawVal}`;
  
  const offset = GAUGE_CIRCUMFERENCE - (GAUGE_CIRCUMFERENCE * currentMoisture / 100);
  gaugeProgress.style.strokeDashoffset = Math.max(0, Math.min(GAUGE_CIRCUMFERENCE, offset));

  // Dynamic Gauge Color & Category Badge
  if (currentMoisture < 25) {
    gaugeProgress.style.stroke = '#ef4444';
    moistureCategoryBadge.innerText = '⚠️ Dry - Needs Water';
    moistureCategoryBadge.style.color = '#f87171';
    moistureCategoryBadge.style.background = 'rgba(239, 68, 68, 0.15)';
  } else if (currentMoisture <= 65) {
    gaugeProgress.style.stroke = '#10b981';
    moistureCategoryBadge.innerText = '🌿 Optimal Hydration';
    moistureCategoryBadge.style.color = '#34d399';
    moistureCategoryBadge.style.background = 'rgba(16, 185, 129, 0.15)';
  } else {
    gaugeProgress.style.stroke = '#38bdf8';
    moistureCategoryBadge.innerText = '💧 Saturated / Wet';
    moistureCategoryBadge.style.color = '#38bdf8';
    moistureCategoryBadge.style.background = 'rgba(56, 189, 248, 0.15)';
  }

  // 2. Quick Stats
  currentThresholdStat.innerText = `${currentThreshold}%`;
  systemModeStat.innerText = currentMode;
  controlModeBadge.innerText = currentMode;

  if (isPumpActive) {
    pumpStatusStat.innerText = 'RUNNING';
    pumpStatusStat.className = 'stat-value pump-stat active';
    pumpToggleBtn.innerText = '⏹ Turn Pump OFF';
    pumpToggleBtn.className = 'btn btn-danger';
  } else {
    pumpStatusStat.innerText = 'IDLE';
    pumpStatusStat.className = 'stat-value pump-stat';
    pumpToggleBtn.innerText = '▶ Toggle Pump Continuous';
    pumpToggleBtn.className = 'btn btn-outline';
  }

  // 3. Hardware Components Cards
  if (isPumpActive) {
    compRelay.classList.add('active-pump');
    relayTag.innerText = 'Energized (PUMP ON)';
    relayTag.className = 'comp-status-tag tag-active';
    relayStatus.innerText = 'Relay Closed (NO-COM connected)';

    compPump.classList.add('active-pump');
    pumpTag.innerText = 'Pumping Water';
    pumpTag.className = 'comp-status-tag tag-active';
    pumpIconAnim.classList.add('pumping-anim');
    pumpSubDetail.innerText = 'Water flowing to plant...';
  } else {
    compRelay.classList.remove('active-pump');
    relayTag.innerText = 'Idle (Coil OFF)';
    relayTag.className = 'comp-status-tag tag-idle';
    relayStatus.innerText = 'Digital Pin 7 • Standby';

    compPump.classList.remove('active-pump');
    pumpTag.innerText = 'Standby';
    pumpTag.className = 'comp-status-tag tag-idle';
    pumpIconAnim.classList.remove('pumping-anim');
    pumpSubDetail.innerText = '3-6V DC Micro Pump • Ready';
  }

  // Mode button states
  if (currentMode === 'AUTO') {
    modeAutoBtn.classList.add('active');
    modeManualBtn.classList.remove('active');
    controlModeBadge.className = 'badge badge-active';
  } else {
    modeManualBtn.classList.add('active');
    modeAutoBtn.classList.remove('active');
    controlModeBadge.className = 'badge badge-info';
  }

  // 4. Update Chart
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (chartLabels.length >= chartMaxPoints) {
    chartLabels.shift();
    chartData.shift();
    thresholdLineData.shift();
  }
  chartLabels.push(now);
  chartData.push(currentMoisture);
  thresholdLineData.push(currentThreshold);
  moistureChart.update('none');
}

// --- Serial Command Sender ---
async function sendSerialCommand(command) {
  if (isSimulationMode) {
    handleSimulationCommand(command);
    return;
  }

  if (!writer) {
    logToConsole(`Error: Arduino not connected. Cannot send: ${command}`, 'warn');
    return;
  }

  try {
    logToConsole(`TX >> ${command}`, 'tx');
    await writer.write(command + '\n');
  } catch (err) {
    logToConsole(`Write error: ${err.message}`, 'warn');
  }
}

// --- Web Serial API Connection Flow ---
async function connectArduino() {
  if (!('serial' in navigator)) {
    alert("Web Serial API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Opera.");
    return;
  }

  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });

    isConnected = true;
    updateConnectionStatus(true);
    logToConsole('Serial connection established at 9600 baud.', 'info');

    // Turn off simulation if running
    if (isSimulationMode) {
      simToggle.checked = false;
      stopSimulation();
    }

    // Set up output writer stream
    const textEncoder = new TextEncoderStream();
    writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
    writer = textEncoder.writable.getWriter();

    // Set up input reader stream
    const textDecoder = new TextDecoderStream();
    readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();

    // Read loop
    readSerialLoop();

  } catch (err) {
    logToConsole(`Connection canceled or failed: ${err.message}`, 'warn');
    updateConnectionStatus(false);
  }
}

async function disconnectArduino() {
  try {
    if (reader) {
      await reader.cancel();
      await readableStreamClosed.catch(() => {});
      reader = null;
      readableStreamClosed = null;
    }
    if (writer) {
      await writer.close();
      await writableStreamClosed;
      writer = null;
      writableStreamClosed = null;
    }
    if (port) {
      await port.close();
      port = null;
    }
    isConnected = false;
    updateConnectionStatus(false);
    logToConsole('Arduino disconnected.', 'system');
  } catch (err) {
    logToConsole(`Disconnect error: ${err.message}`, 'warn');
  }
}

async function readSerialLoop() {
  let partialChunk = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        partialChunk += value;
        const lines = partialChunk.split('\n');
        partialChunk = lines.pop(); // Keep last incomplete fragment

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            handleSerialMessage(trimmed);
          }
        }
      }
    }
  } catch (err) {
    logToConsole(`Read loop terminated: ${err.message}`, 'warn');
  } finally {
    updateConnectionStatus(false);
  }
}

// Handle incoming lines from Arduino
function handleSerialMessage(msg) {
  // Check if it is a JSON payload
  if (msg.startsWith('{') && msg.endsWith('}')) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.moisture !== undefined) {
        updateDashboardUI(parsed);
      } else if (parsed.ack) {
        logToConsole(`ACK << Command: ${parsed.ack} (${parsed.status || parsed.val})`, 'info');
      } else if (parsed.warning) {
        logToConsole(`WARN << ${parsed.warning}`, 'warn');
      } else {
        logToConsole(`RX << ${msg}`, 'rx');
      }
    } catch (e) {
      logToConsole(`RX (Malformed JSON) << ${msg}`, 'rx');
    }
  } else {
    logToConsole(`RX << ${msg}`, 'rx');
  }
}

function updateConnectionStatus(connected) {
  isConnected = connected;
  if (connected) {
    connectionBadge.className = 'status-pill connected';
    connectionText.innerText = 'Connected';
    connectBtnText.innerText = 'Disconnect';
    connectBtn.className = 'btn btn-outline';
  } else {
    connectionBadge.className = 'status-pill disconnected';
    connectionText.innerText = isSimulationMode ? 'Simulation Active' : 'Disconnected';
    connectBtnText.innerText = 'Connect Arduino';
    connectBtn.className = 'btn btn-primary';
  }
}

// Connect/Disconnect button listener
connectBtn.addEventListener('click', () => {
  if (isConnected) {
    disconnectArduino();
  } else {
    connectArduino();
  }
});

// --- Mode Switches & Controls ---
modeAutoBtn.addEventListener('click', () => {
  sendSerialCommand('MODE_AUTO');
  currentMode = 'AUTO';
  updateDashboardUI({ moisture: currentMoisture, mode: 'AUTO', threshold: currentThreshold, pump: isPumpActive });
});

modeManualBtn.addEventListener('click', () => {
  sendSerialCommand('MODE_MANUAL');
  currentMode = 'MANUAL';
  updateDashboardUI({ moisture: currentMoisture, mode: 'MANUAL', threshold: currentThreshold, pump: isPumpActive });
});

// Threshold Slider
thresholdSlider.addEventListener('input', (e) => {
  const val = e.target.value;
  thresholdValueDisplay.innerText = `${val}%`;
});

thresholdSlider.addEventListener('change', (e) => {
  const val = e.target.value;
  sendSerialCommand(`SET_THRESHOLD:${val}`);
  currentThreshold = parseInt(val, 10);
});

// Water Now (3s Burst)
waterBurstBtn.addEventListener('click', () => {
  sendSerialCommand('PUMP_BURST');
});

// Toggle Continuous Pump
pumpToggleBtn.addEventListener('click', () => {
  if (isPumpActive) {
    sendSerialCommand('PUMP_OFF');
  } else {
    sendSerialCommand('PUMP_ON');
  }
});

// Emergency Stop
emergencyStopBtn.addEventListener('click', () => {
  sendSerialCommand('PUMP_OFF');
  sendSerialCommand('MODE_MANUAL');
  logToConsole('EMERGENCY STOP EXECUTED: Pump halted and set to MANUAL.', 'warn');
});

// --- Simulation Mode (For Portfolio Demonstrations & GitHub Pages) ---
simToggle.addEventListener('change', (e) => {
  if (e.target.checked) {
    if (isConnected) disconnectArduino();
    startSimulation();
  } else {
    stopSimulation();
  }
});

function startSimulation() {
  isSimulationMode = true;
  connectionBadge.className = 'status-pill connected';
  connectionText.innerText = 'Demo Simulation';
  logToConsole('Interactive Simulation Mode ENABLED. Generating realistic soil drying & telemetry.', 'tip');

  simulationInterval = setInterval(() => {
    // If pump is active, moisture increases rapidly
    if (isPumpActive) {
      currentMoisture = Math.min(100, currentMoisture + 8);
      currentRawVal = Math.max(280, currentRawVal - 35);
    } else {
      // Natural soil moisture depletion
      currentMoisture = Math.max(10, currentMoisture - 1);
      currentRawVal = Math.min(750, currentRawVal + 5);
    }

    // Auto watering logic simulation
    if (currentMode === 'AUTO') {
      if (currentMoisture < currentThreshold && !isPumpActive) {
        isPumpActive = true;
        logToConsole('[SIM-AUTO] Moisture fell below threshold! Activating pump.', 'info');
        setTimeout(() => {
          if (isSimulationMode && currentMode === 'AUTO') {
            isPumpActive = false;
            logToConsole('[SIM-AUTO] Watering burst complete (3s). Pump deactivated.', 'info');
          }
        }, 3000);
      }
    }

    updateDashboardUI({
      moisture: currentMoisture,
      raw: currentRawVal,
      pump: isPumpActive ? 1 : 0,
      mode: currentMode,
      threshold: currentThreshold
    });
  }, 1000);
}

function stopSimulation() {
  isSimulationMode = false;
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
  updateConnectionStatus(false);
  logToConsole('Simulation Mode DISABLED.', 'system');
}

function handleSimulationCommand(cmd) {
  logToConsole(`[SIM TX] >> ${cmd}`, 'tx');
  if (cmd === 'PUMP_ON') {
    isPumpActive = true;
    currentMode = 'MANUAL';
  } else if (cmd === 'PUMP_OFF') {
    isPumpActive = false;
  } else if (cmd === 'PUMP_BURST') {
    isPumpActive = true;
    setTimeout(() => {
      isPumpActive = false;
      logToConsole('[SIM-BURST] 3s burst complete.', 'info');
    }, 3000);
  } else if (cmd === 'MODE_AUTO') {
    currentMode = 'AUTO';
  } else if (cmd === 'MODE_MANUAL') {
    currentMode = 'MANUAL';
  } else if (cmd.startsWith('SET_THRESHOLD:')) {
    currentThreshold = parseInt(cmd.split(':')[1], 10);
  }
}

// Initial UI Setup
updateDashboardUI({
  moisture: 48,
  raw: 540,
  pump: 0,
  mode: 'AUTO',
  threshold: 30
});

