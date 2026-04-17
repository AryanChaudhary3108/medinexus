// ===== MEDINEXUS OPERATIONAL ENGINE =====
// Real-time hospital observation data + AI agent coordination

const API_BASE = window.MEDINEXUS_API_BASE || 'http://localhost:8000';

function buildFallbackPatients() {
  return Array.from({ length: 12 }, (_, idx) => {
    const id = idx + 1;
    const ews = [1, 2, 5, 5, 8, 1, 9, 4, 0, 4, 4, 1][idx];
    const status = ews >= 7 ? 'critical' : ews >= 4 ? 'warning' : 'stable';
    return {
      id,
      name: `Patient ${1000 + id}`,
      age: 25 + (idx * 4),
      room: `${100 + id}-A`,
      ward: idx % 5 === 0 ? 'ICU' : idx % 3 === 0 ? 'Cardiac' : 'General',
      bed: idx % 5 === 0 ? `ICU-${Math.max(1, Math.floor(id / 5))}` : `G-${String(id).padStart(2, '0')}`,
      conditions: ['Active inpatient case'],
      notes: 'Clinical observation-based monitoring active.',
      pendingLabs: idx % 3 === 0 ? 'Follow-up lab panel pending review' : 'No urgent labs pending',
      vitals: {
        hr: 68 + idx * 3,
        sbp: 112 + idx * 3,
        dbp: 72 + idx,
        spo2: Math.max(90, 99 - (idx % 6)),
        temp: +(36.7 + (idx % 4) * 0.3).toFixed(1),
        rr: 14 + (idx % 8),
      },
      trending: status,
    };
  });
}

const AGENT_DEFS = [
  { id:"sentinel", name:"SentinelAgent", img:"img/agent_sentinel.png", cls:"avatar-sentinel", nameCls:"name-sentinel" },
  { id:"flow",     name:"FlowAgent",     img:"img/agent_flow.png",     cls:"avatar-flow",     nameCls:"name-flow" },
  { id:"green",    name:"GreenAgent",    img:"img/agent_green.png",    cls:"avatar-green",    nameCls:"name-green" },
  { id:"guide",    name:"CareGuide",     img:"img/agent_careguide.png",cls:"avatar-guide",    nameCls:"name-guide" },
  { id:"command",  name:"CommandAgent",  img:"img/agent_command.png",  cls:"avatar-command",  nameCls:"name-command" },
];

class MediNexus {
  constructor() {
    const persistedDemoMode = localStorage.getItem('medinexus_demo_mode');
    this.demoMode = persistedDemoMode === '1';
    this.connection = {
      backendConnected: false,
      usingFallback: true,
      lastCheckedAt: null,
      source: 'fallback',
      message: 'Fallback operational data active',
    };
    this.isRunning = false;

    this.patients = buildFallbackPatients().map(p => ({
      ...p,
      vitals: { ...p.vitals },
      history: { hr: Array(20).fill(p.vitals.hr), spo2: Array(20).fill(p.vitals.spo2) },
      status: p.trending === "critical" ? "critical" : p.trending === "warning" ? "warning" : "stable",
      ews: this.calcEWS(p.vitals),
      alertSent: false,
    }));
    this.agentLog = [];
    this.alerts = [];
    this.approvedActions = [];
    this.stats = {
      totalPatients: 127,
      criticalAlerts: 3,
      bedOccupancy: 87,
      energySaved: 22,
      activeAgents: 5,
      alertsResolved: 14,
    };
    this.energyData = {
      hvac: 68, lighting: 42, equipment: 55,
      totalKw: 284, savedKw: 63, savedCost: 12400,
    };
    this.beds = this.generateBeds();
    this.callbacks = {};
    this.tick = 0;
    // Pre-populate with initial alerts
    this.initAlerts();
    this.initAgentLog();
    this.loadPatientsFromBackend();
    // Emit initial state quickly so pages can paint status chips.
    setTimeout(() => {
      this.emit('connection', this.connection);
      this.emit('demoMode', this.demoMode);
    }, 0);
  }

  toSimPatient(record) {
    const vitals = record.vitals || {};
    const ews = typeof record.ews === 'number' ? record.ews : this.calcEWS(vitals);
    const status = record.status || (ews >= 7 ? 'critical' : ews >= 4 ? 'warning' : 'stable');
    const name = record.display_name || record.patient_code || `Patient ${record.id}`;
    return {
      id: record.id,
      name,
      age: record.age || 0,
      room: record.room || 'N/A',
      ward: record.ward || 'General',
      bed: record.bed || 'N/A',
      conditions: record.conditions || [],
      notes: record.notes || '',
      pendingLabs: record.pending_labs || '',
      vitals: {
        hr: Number(vitals.hr ?? 80),
        sbp: Number(vitals.sbp ?? 120),
        dbp: Number(vitals.dbp ?? 80),
        spo2: Number(vitals.spo2 ?? 97),
        temp: Number(vitals.temp ?? 37.0),
        rr: Number(vitals.rr ?? 16),
      },
      trending: status,
      history: {
        hr: Array(20).fill(Number(vitals.hr ?? 80)),
        spo2: Array(20).fill(Number(vitals.spo2 ?? 97)),
      },
      status,
      ews,
      alertSent: false,
    };
  }

  async loadPatientsFromBackend() {
    this.connection.lastCheckedAt = new Date().toISOString();
    try {
      const res = await fetch(`${API_BASE}/api/patients`);
      if (!res.ok) {
        this.connection = {
          backendConnected: false,
          usingFallback: true,
          lastCheckedAt: new Date().toISOString(),
          source: 'fallback',
          message: 'Backend unavailable, using fallback operational data',
        };
        this.emit('connection', this.connection);
        return;
      }
      const payload = await res.json();
      if (!payload?.patients || !Array.isArray(payload.patients) || !payload.patients.length) {
        this.connection = {
          backendConnected: false,
          usingFallback: true,
          lastCheckedAt: new Date().toISOString(),
          source: 'fallback',
          message: 'No patient records returned, using fallback operational data',
        };
        this.emit('connection', this.connection);
        return;
      }
      this.patients = payload.patients.map(p => this.toSimPatient(p));
      this.connection = {
        backendConnected: true,
        usingFallback: false,
        lastCheckedAt: new Date().toISOString(),
        source: 'backend',
        message: 'Backend connected',
      };
      this.emit('vitals', this.patients);
      this.emit('connection', this.connection);
    } catch (err) {
      // Keep fallback operational placeholders when backend is unavailable.
      console.warn('MediNexus: patient API unavailable, using fallback operational placeholders.', err);
      this.connection = {
        backendConnected: false,
        usingFallback: true,
        lastCheckedAt: new Date().toISOString(),
        source: 'fallback',
        message: 'Backend unavailable, using fallback operational data',
      };
      this.emit('connection', this.connection);
    }
  }

  setDemoMode(enabled) {
    const next = Boolean(enabled);
    if (this.demoMode === next) return;
    this.demoMode = next;
    localStorage.setItem('medinexus_demo_mode', next ? '1' : '0');

    if (this.isRunning) {
      if (next) this.stopLiveLoops();
      else this.startLiveLoops();
    }

    this.addAgentMsg('command', next
      ? 'Demo mode enabled. Live patient drift paused for stable narration.'
      : 'Demo mode disabled. Live patient updates resumed.');
    this.emit('demoMode', this.demoMode);
  }

  getDemoMode() {
    return this.demoMode;
  }

  getConnectionState() {
    return { ...this.connection };
  }

  calcEWS(v) {
    let s = 0;
    if (v.hr < 40 || v.hr > 130) s += 3;
    else if (v.hr < 50 || v.hr > 110) s += 2;
    else if (v.hr < 60 || v.hr > 100) s += 1;
    if (v.spo2 < 91) s += 3;
    else if (v.spo2 < 94) s += 2;
    else if (v.spo2 < 96) s += 1;
    if (v.sbp < 90 || v.sbp > 160) s += 3;
    else if (v.sbp < 100 || v.sbp > 150) s += 2;
    else if (v.sbp < 110 || v.sbp > 140) s += 1;
    if (v.temp < 35 || v.temp > 39) s += 3;
    else if (v.temp < 36 || v.temp > 38.5) s += 2;
    else if (v.temp < 36.5 || v.temp > 38) s += 1;
    if (v.rr < 8 || v.rr > 25) s += 3;
    else if (v.rr < 12 || v.rr > 20) s += 1;
    return Math.min(s, 10);
  }

  generateBeds() {
    const beds = [];
    const statuses = ['available','occupied','occupied','occupied','occupied','reserved','critical','icu'];
    for (let i = 0; i < 60; i++) {
      const roll = Math.random();
      let st = roll < 0.13 ? 'available' : roll < 0.8 ? 'occupied' : roll < 0.9 ? 'reserved' : roll < 0.96 ? 'critical' : 'icu';
      beds.push({ id: i+1, status: st });
    }
    return beds;
  }

  initAlerts() {
    this.alerts = [
      {
        id: 'a1', severity: 'critical', room: 'Room 301-A',
        title: '⚠️ Sepsis Risk Detected — ICU Patient',
        desc: 'EWS score remains high with worsening respiratory and infection-related symptoms. Sepsis protocol recommended.',
        agent: '🛡️ SentinelAgent', time: this.timeStr(-3),
        explain: {
          trigger: 'High EWS with respiratory and temperature derangement',
          drivers: ['EWS 8/10', 'Respiratory distress signs', 'Infection symptom escalation', 'Acuity progression'],
          confidence: 'High (0.91)',
          ifIgnored: 'Risk of rapid sepsis progression and ICU transfer delay',
        },
        actions: [
          { label:'APPROVE TRANSFER', cls:'btn-approve', fn:'approveTransfer', arg:'5' },
          { label:'ESCALATE', cls:'btn-escalate', fn:'escalateAlert', arg:'a1' },
          { label:'DISMISS', cls:'btn-dismiss', fn:'dismissAlert', arg:'a1' },
        ]
      },
      {
        id: 'a2', severity: 'critical', room: 'Room 202-B',
        title: '🫀 Acute MI Alert — Cardiac Patient',
        desc: 'Cardiac symptom burden has escalated with high-risk trajectory. Cardiologist notification sent. ICU bed pre-reserved.',
        agent: '🧠 CommandAgent', time: this.timeStr(-7),
        explain: {
          trigger: 'Cardiac deterioration with oxygen desaturation and hypertensive response',
          drivers: ['Cardiac symptom progression', 'High acuity risk profile', 'Known cardiac history', 'Escalation protocol trigger'],
          confidence: 'High (0.88)',
          ifIgnored: 'Potential progression to acute coronary instability',
        },
        actions: [
          { label:'APPROVE PROTOCOL', cls:'btn-approve', fn:'approveProtocol', arg:'7' },
          { label:'DISMISS', cls:'btn-dismiss', fn:'dismissAlert', arg:'a2' },
        ]
      },
      {
        id: 'a3', severity: 'warning', room: 'Room 103-C',
        title: '🌡️ Fever Spike — Ward Patient',
        desc: 'Infection-related symptom burden increased this shift for a pneumonia case. Antibiotic escalation suggested.',
        agent: '🛡️ SentinelAgent', time: this.timeStr(-12),
        explain: {
          trigger: 'Fever rise in infectious respiratory case',
          drivers: ['Infection symptom escalation', 'Pneumonia context', 'EWS trending upward'],
          confidence: 'Moderate-High (0.79)',
          ifIgnored: 'Delayed antimicrobial adjustment and prolonged recovery',
        },
        actions: [
          { label:'APPROVE TX CHANGE', cls:'btn-approve', fn:'approveTxChange', arg:'4' },
          { label:'DISMISS', cls:'btn-dismiss', fn:'dismissAlert', arg:'a3' },
        ]
      },
      {
        id: 'a4', severity: 'info', room: 'Wing B',
        title: '🌿 Energy Optimization Ready',
        desc: 'GreenAgent recommends eco-mode for 8 non-critical devices. Estimated saving: ₹4,200/hr.',
        agent: '🌿 GreenAgent', time: this.timeStr(-18),
        explain: {
          trigger: 'Low acuity window with non-critical devices identified',
          drivers: ['8 non-critical devices', 'Current occupancy profile', 'Energy baseline variance'],
          confidence: 'Moderate (0.72)',
          ifIgnored: 'Higher operational energy spend during low-demand periods',
        },
        actions: [
          { label:'ACTIVATE ECO MODE', cls:'btn-approve', fn:'activateEco', arg:'' },
          { label:'DISMISS', cls:'btn-dismiss', fn:'dismissAlert', arg:'a4' },
        ]
      },
    ];
  }

  initAgentLog() {
    const t = this.timeStr;
    this.agentLog = [
      { agent:'command', text:'All 5 agents initialized. Hospital monitoring active. 127 patients under surveillance.', time:t(-35) },
      { agent:'green',   text:'HVAC optimization complete. Wing A energy reduced by 18%. Eco lighting active in corridors.', time:t(-28) },
      { agent:'flow',    text:'Bed occupancy: 87%. 8 beds available. Predicted 3 discharges by 18:00. Shifts reassigned.', time:t(-22) },
      { agent:'guide',   text:'Medication information request handled for an inpatient through multilingual support.', time:t(-18) },
      { agent:'sentinel',text:'Routine vital check complete. 9 stable, 3 warning, 2 critical. EWS scores updated.', time:t(-15) },
      { agent:'command', text:'Coordinating ICU response for high-acuity case. Bed reserved and escalation acknowledged.', time:t(-10) },
      { agent:'flow',    text:'Additional monitoring duty assigned for one high-priority inpatient case.', time:t(-8) },
      { agent:'sentinel',text:'ALERT: Cardiac stress markers detected in monitored case. Escalated to CommandAgent.', time:t(-7) },
      { agent:'green',   text:'Night cycle optimization ready. Recommend eco-mode for 8 devices in Wing B.', time:t(-5) },
      { agent:'guide',   text:'3 patient wayfinding requests handled. Radiology escort arranged for Room 105.', time:t(-3) },
      { agent:'command', text:'Priority queue updated. 4 active alerts. Human approval required for critical cases.', time:t(-1) },
    ];
  }

  timeStr(offsetMin = 0) {
    const d = new Date(Date.now() + offsetMin * 60000);
    return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:false });
  }

  on(event, cb) { this.callbacks[event] = cb; }
  emit(event, data) { if (this.callbacks[event]) this.callbacks[event](data); }

  start() {
    this.isRunning = true;
    this.startLiveLoops();
    this.clockTimer  = setInterval(() => this.emit('clock', new Date()), 1000);
  }

  stop() {
    this.isRunning = false;
    this.stopLiveLoops();
    clearInterval(this.clockTimer);
  }

  startLiveLoops() {
    if (this.demoMode) return;
    clearInterval(this.vitalsTimer);
    clearInterval(this.agentTimer);
    this.vitalsTimer = setInterval(() => this.updateVitals(), 2500);
    this.agentTimer = setInterval(() => this.runAgent(), 4000);
  }

  stopLiveLoops() {
    clearInterval(this.vitalsTimer);
    clearInterval(this.agentTimer);
  }

  updateVitals() {
    this.tick++;
    this.patients.forEach(p => {
      const jitter = (range) => (Math.random() - 0.5) * range;
      // Drift towards normal or deteriorate
      const isDet = p.trending === 'critical';
      const isWarn = p.trending === 'warning';

      p.vitals.hr   = Math.min(180, Math.max(35, Math.round(p.vitals.hr + jitter(isDet ? 4 : 2))));
      p.vitals.spo2 = Math.min(100, Math.max(82, +(p.vitals.spo2 + jitter(isDet ? 1.5 : 0.8)).toFixed(1)));
      p.vitals.sbp  = Math.min(200, Math.max(75, Math.round(p.vitals.sbp + jitter(isDet ? 6 : 3))));
      p.vitals.dbp  = Math.min(130, Math.max(45, Math.round(p.vitals.dbp + jitter(isDet ? 4 : 2))));
      p.vitals.temp = Math.min(41,  Math.max(35, +(p.vitals.temp + jitter(0.2)).toFixed(1)));
      p.vitals.rr   = Math.min(35,  Math.max(8,  Math.round(p.vitals.rr + jitter(isWarn || isDet ? 2 : 1))));

      // Update history arrays
      p.history.hr.push(p.vitals.hr);   if (p.history.hr.length > 20)   p.history.hr.shift();
      p.history.spo2.push(p.vitals.spo2); if (p.history.spo2.length > 20) p.history.spo2.shift();

      const prevEws = p.ews;
      p.ews = this.calcEWS(p.vitals);

      // Update status
      if (p.ews >= 7) p.status = 'critical';
      else if (p.ews >= 4) p.status = 'warning';
      else p.status = 'stable';

      // Trigger sentinel alert on deterioration
      if (p.ews >= 6 && prevEws < 6 && !p.alertSent) {
        p.alertSent = true;
        setTimeout(() => { p.alertSent = false; }, 60000); // reset after 60s
        this.triggerPatientAlert(p);
      }
    });

    // Random bed change
    if (this.tick % 6 === 0) {
      const idx = Math.floor(Math.random() * this.beds.length);
      const statuses = ['available','occupied','occupied','reserved'];
      this.beds[idx].status = statuses[Math.floor(Math.random() * statuses.length)];
    }

    this.emit('vitals', this.patients);
    this.emit('beds', this.beds);
  }

  triggerPatientAlert(p) {
    const confidence = p.ews >= 8 ? 'High (0.90)' : p.ews >= 6 ? 'Moderate-High (0.82)' : 'Moderate (0.72)';
    const alert = {
      id: 'a_' + Date.now(),
      severity: p.ews >= 8 ? 'critical' : 'warning',
      room: `Room ${p.room}`,
      title: `${p.ews >= 8 ? '🚨' : '⚠️'} EWS ${p.ews} — ${p.name}`,
      desc: `Deterioration detected from symptom and risk trajectory. Immediate clinical review required.`,
      agent: '🛡️ SentinelAgent',
      time: this.timeStr(0),
      explain: {
        trigger: `Deterioration threshold crossed (EWS ${p.ews})`,
        drivers: [
          `EWS ${p.ews}/10`,
          'Symptom severity progression',
          'Clinical concern escalation',
          'Role-based intervention threshold reached',
        ],
        confidence,
        ifIgnored: 'Higher risk of delayed intervention and avoidable escalation',
      },
      actions: [
        { label:'APPROVE TRANSFER', cls:'btn-approve', fn:'approveTransfer', arg:String(p.id) },
        { label:'ESCALATE', cls:'btn-escalate', fn:'escalateAlert', arg:'a_'+Date.now() },
        { label:'DISMISS', cls:'btn-dismiss', fn:'dismissAlert', arg:'a_'+Date.now() },
      ]
    };
    this.alerts.unshift(alert);
    if (this.alerts.length > 8) this.alerts.pop();
    this.emit('alerts', this.alerts);
    this.addAgentMsg('sentinel', `EWS ${p.ews} detected for ${p.name} (${p.room}). Alert dispatched to command.`);
  }

  runAgent() {
    const messages = {
      sentinel: [
        'Vital scan complete. Monitoring 12 active patients.',
        'Fall risk assessment updated. 2 high-risk patients flagged.',
        'Medication schedule verified for all patients in Wing A.',
        'SpO2 levels stable across ICU. Continuous monitoring active.',
        'Early sepsis markers scanned — 1 patient flagged for review.',
      ],
      flow: [
        'Bed turnover optimized. 3 predicted discharges before 18:00.',
        'Staff schedule rebalanced. Nurse:Patient ratio maintained at 1:4.',
        'Ward B has 2 beds available. Admission queue updated.',
        'Surgical suite pre-scheduled for 08:30 tomorrow.',
        `Bed occupancy: ${87 + Math.floor(Math.random()*4 - 2)}%. All wards within capacity.`,
      ],
      green: [
        `Energy savings this shift: ₹${(12000 + Math.floor(Math.random()*1000)).toLocaleString('en-IN')} (${20+Math.floor(Math.random()*4)}%).`,
        'HVAC optimization active. 3 zones in eco-mode.',
        'Non-critical equipment standby activated in Corridor D.',
        'Solar roof contributing 12.4 kWh. Grid load reduced.',
        'Night cycle ready. Initiating low-traffic zone dimming.',
      ],
      guide: [
        'Patient assistance: 5 wayfinding requests answered.',
        'Medication reminder sent to 8 patients in General Ward.',
        'Hindi language query handled — medication schedule delivered.',
        'Appointment reminder sent to a monitored inpatient case.',
        'Patient satisfaction survey sent to 4 post-discharge patients.',
      ],
      command: [
        'All 5 agents synchronized. Priority queue nominal.',
        'Alert routing optimized. Dr. Sharma on call until 22:00.',
        'Shift handover report generated automatically.',
        'Resource coordination complete — no current bottlenecks.',
        'Audit log updated with all agent actions (human-verified).',
      ],
    };

    const agents = Object.keys(messages);
    const agentId = agents[this.tick % agents.length];
    const msgs = messages[agentId];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    this.addAgentMsg(agentId, msg);
  }

  addAgentMsg(agentId, text) {
    this.agentLog.unshift({ agent:agentId, text, time:this.timeStr(0) });
    if (this.agentLog.length > 30) this.agentLog.pop();
    this.emit('agentLog', this.agentLog);
  }

  approveTransfer(patientId) {
    const p = this.patients.find(x => x.id === parseInt(patientId));
    const name = p ? p.name : 'Patient';
    this.approvedActions.unshift({ text:`Transfer approved for ${name}`, time:this.timeStr(0) });
    this.addAgentMsg('command', `Transfer of ${name} approved by clinician. ICU bed assigned. Transport en route.`);
    this.addAgentMsg('flow', `Bed allocation confirmed for ${name}. Staff notified.`);
    this.stats.alertsResolved++;
    this.emit('approved', this.approvedActions);
  }

  approveProtocol(patientId) {
    const p = this.patients.find(x => x.id === parseInt(patientId));
    const name = p ? p.name : 'Patient';
    this.approvedActions.unshift({ text:`MI Protocol activated for ${name}`, time:this.timeStr(0) });
    this.addAgentMsg('sentinel', `MI protocol approved. Cardiac team alerted for ${name}. Cath lab on standby.`);
    this.stats.alertsResolved++;
    this.emit('approved', this.approvedActions);
  }

  approveTxChange(patientId) {
    const p = this.patients.find(x => x.id === parseInt(patientId));
    const name = p ? p.name : 'Patient';
    this.approvedActions.unshift({ text:`Treatment change approved for ${name}`, time:this.timeStr(0) });
    this.addAgentMsg('sentinel', `Antibiotic escalation approved for ${name}. Pharmacy notified.`);
    this.stats.alertsResolved++;
    this.emit('approved', this.approvedActions);
  }

  activateEco() {
    this.energyData.savedKw += 8;
    this.energyData.savedCost += 4200;
    this.energyData.totalKw -= 8;
    this.stats.energySaved = Math.min(35, this.stats.energySaved + 3);
    this.approvedActions.unshift({ text:'Eco-mode activated — Wing B devices', time:this.timeStr(0) });
    this.addAgentMsg('green', 'Eco-mode activated for 8 devices in Wing B. Saving 8 kWh. Monthly projection: ₹1.2L saved.');
    this.emit('approved', this.approvedActions);
    this.emit('energy', this.energyData);
  }

  dismissAlert(alertId) {
    this.alerts = this.alerts.filter(a => a.id !== alertId);
    this.emit('alerts', this.alerts);
    this.addAgentMsg('command', 'Alert dismissed by clinician. Logged for audit trail.');
  }

  escalateAlert(alertId) {
    this.approvedActions.unshift({ text:'Alert escalated to senior physician', time:this.timeStr(0) });
    this.addAgentMsg('command', 'Alert escalated to on-call senior physician. SMS and pager notification sent.');
    this.emit('approved', this.approvedActions);
  }
}

// EWS color helper
function ewsColor(score) {
  if (score >= 7) return '#ef4444';
  if (score >= 4) return '#f59e0b';
  if (score >= 2) return '#06b6d4';
  return '#10b981';
}

// Sparkline SVG generator
function makeSpark(data, color='#0ea5e9', h=28) {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 200;
  const pts = data.map((v,i) => {
    const x = (i / (data.length-1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="sparkline">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// Format vitals with color
function vitalColor(type, val) {
  const ranges = {
    hr:   { low:50, high:100 },
    spo2: { low:95, high:100 },
    sbp:  { low:90, high:140 },
    temp: { low:36.5, high:38 },
    rr:   { low:12, high:20 },
  };
  const r = ranges[type];
  if (!r) return '#e2e8f0';
  if (val < r.low || val > r.high) return '#ef4444';
  if (val < r.low * 1.05 || val > r.high * 0.95) return '#f59e0b';
  return '#10b981';
}

function symptomSeverityFromStatus(status, ews) {
  if (status === 'critical' || ews >= 7) return 'critical';
  if (status === 'warning' || ews >= 4) return 'high';
  if (ews >= 2) return 'moderate';
  return 'mild';
}

function symptomColor(level) {
  if (level === 'critical') return '#ef4444';
  if (level === 'high') return '#f59e0b';
  if (level === 'moderate') return '#06b6d4';
  return '#10b981';
}

function inferPrimarySymptom(conditions = []) {
  const text = conditions.join(' ').toLowerCase();
  if (text.includes('sepsis') || text.includes('infection') || text.includes('pneumonia')) return 'Fever / infection symptoms';
  if (text.includes('mi') || text.includes('cardiac') || text.includes('heart')) return 'Chest discomfort / cardiac symptoms';
  if (text.includes('asthma') || text.includes('copd')) return 'Breathlessness / wheeze';
  if (text.includes('stroke') || text.includes('neuro')) return 'Neurological deficit signs';
  if (text.includes('post') || text.includes('surgery')) return 'Post-op pain / limited mobility';
  return 'General symptom monitoring';
}

function clinicalConcernLabel(level) {
  if (level === 'critical') return 'Immediate clinician review';
  if (level === 'high') return 'Senior review recommended';
  if (level === 'moderate') return 'Close observation';
  return 'Routine observation';
}

function getSymptomProfile(patient) {
  const level = symptomSeverityFromStatus(patient.status, patient.ews || 0);
  return {
    level,
    levelColor: symptomColor(level),
    primary: inferPrimarySymptom(patient.conditions || []),
    concern: clinicalConcernLabel(level),
    painScore: level === 'critical' ? 8 : level === 'high' ? 6 : level === 'moderate' ? 4 : 2,
    mobility: level === 'critical' ? 'Bed-bound / assisted' : level === 'high' ? 'Assisted ambulation' : 'Ambulatory with supervision',
    onset: level === 'critical' ? 'Acute (within 2h)' : level === 'high' ? 'Progressing this shift' : 'Stable since last round',
  };
}

function nextObservationWindow(level) {
  if (level === 'critical') return 'q15m observations';
  if (level === 'high') return 'q30m observations';
  if (level === 'moderate') return 'q2h observations';
  return 'q4h routine observations';
}

function getRoleView(patient, role = 'nurse') {
  const symptom = getSymptomProfile(patient);
  const pendingLabs = patient.pendingLabs || 'No urgent labs pending';
  const notes = patient.notes || 'No additional clinical notes';

  if (role === 'doctor') {
    return {
      focus: `Clinical review: ${symptom.primary}`,
      priority: symptom.level === 'critical' ? 'Consultant priority now' : symptom.level === 'high' ? 'Registrar priority this round' : 'Team review this shift',
      action: `Reassess treatment plan and correlate with labs (${pendingLabs}).`,
      summary: `Doctor view: ${notes}`,
    };
  }

  if (role === 'admin') {
    const risk = patient.ews >= 7 ? 'High escalation risk' : patient.ews >= 4 ? 'Moderate escalation risk' : 'Low escalation risk';
    const disposition = patient.ews >= 7 ? 'Expected >48h stay' : patient.ews >= 4 ? 'Expected 24-48h stay' : 'Expected <24h review window';
    return {
      focus: `Operational risk: ${risk}`,
      priority: `Bed flow: ${disposition}`,
      action: 'Keep staffing and escalation pathways ready for this ward.',
      summary: `Admin view: ${pendingLabs}`,
    };
  }

  return {
    focus: `Nursing concern: ${symptom.primary}`,
    priority: `Monitoring: ${nextObservationWindow(symptom.level)}`,
    action: `Continue bedside observation and medication safety checks.`,
    summary: `Nurse note: ${notes}`,
  };
}

function buildSoapMiniNote(patient, role = 'nurse') {
  const symptom = getSymptomProfile(patient);
  const roleView = getRoleView(patient, role);
  const conditions = (patient.conditions || []).slice(0, 2).join(', ') || 'General inpatient condition';
  const pendingLabs = patient.pendingLabs || 'No urgent labs pending';

  return {
    s: `${symptom.primary}; distress score ${symptom.painScore}/10; ${symptom.onset}.`,
    o: `Risk ${patient.ews}/10 (${patient.status}); mobility: ${symptom.mobility}; labs: ${pendingLabs}.`,
    a: `${conditions}; ${roleView.focus}`,
    p: `${roleView.action} ${roleView.priority}`,
  };
}

// Clock
function updateClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
}
setInterval(updateClock, 1000);
updateClock();

// Scroll reveal
const ro = new IntersectionObserver(entries => {
  entries.forEach(e => { if(e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold:0.08 });
document.querySelectorAll('.fade-in').forEach(el => ro.observe(el));

// Expose globally
window.MediNexus = MediNexus;
window.ewsColor = ewsColor;
window.makeSpark = makeSpark;
window.vitalColor = vitalColor;
window.getSymptomProfile = getSymptomProfile;
window.symptomColor = symptomColor;
window.getRoleView = getRoleView;
window.buildSoapMiniNote = buildSoapMiniNote;
