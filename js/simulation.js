// ===== MEDINEXUS SIMULATION ENGINE =====
// Real-time hospital data + AI agent simulation

const PATIENTS = [
  { id:1,  name:"Rajesh Kumar",    age:58, room:"101-A", ward:"General",   bed:"G-01", conditions:["Hypertension","Diabetes"],     vitals:{ hr:75, sbp:125, dbp:82, spo2:97, temp:37.1, rr:16 }, trending:"stable" },
  { id:2,  name:"Priya Sharma",    age:34, room:"102-B", ward:"General",   bed:"G-02", conditions:["Post-op"],                    vitals:{ hr:88, sbp:118, dbp:76, spo2:98, temp:37.4, rr:18 }, trending:"stable" },
  { id:3,  name:"Mohammed Ali",    age:67, room:"201-A", ward:"Cardiac",   bed:"C-01", conditions:["CAD","Heart Failure"],        vitals:{ hr:92, sbp:145, dbp:92, spo2:95, temp:37.0, rr:20 }, trending:"warning" },
  { id:4,  name:"Anita Patel",     age:45, room:"103-C", ward:"General",   bed:"G-03", conditions:["Pneumonia"],                  vitals:{ hr:95, sbp:130, dbp:85, spo2:94, temp:38.3, rr:22 }, trending:"warning" },
  { id:5,  name:"Suresh Nair",     age:72, room:"301-A", ward:"ICU",       bed:"ICU-1",conditions:["Sepsis","Renal Failure"],     vitals:{ hr:110,sbp:95,  dbp:60, spo2:91, temp:39.1, rr:26 }, trending:"critical" },
  { id:6,  name:"Meena Reddy",     age:29, room:"104-A", ward:"General",   bed:"G-04", conditions:["Appendectomy Post-op"],       vitals:{ hr:82, sbp:115, dbp:74, spo2:99, temp:37.8, rr:15 }, trending:"stable" },
  { id:7,  name:"Vikram Singh",    age:55, room:"202-B", ward:"Cardiac",   bed:"C-02", conditions:["Acute MI","Hypertension"],    vitals:{ hr:108,sbp:158, dbp:100,spo2:92, temp:37.6, rr:24 }, trending:"critical" },
  { id:8,  name:"Lakshmi Devi",    age:80, room:"401-A", ward:"Geriatric", bed:"R-01", conditions:["COPD","Arthritis"],           vitals:{ hr:78, sbp:135, dbp:88, spo2:93, temp:36.8, rr:19 }, trending:"warning" },
  { id:9,  name:"Arjun Mehta",     age:42, room:"105-B", ward:"General",   bed:"G-05", conditions:["Back surgery recovery"],      vitals:{ hr:70, sbp:120, dbp:78, spo2:99, temp:37.2, rr:14 }, trending:"stable" },
  { id:10, name:"Fatima Begum",    age:38, room:"106-A", ward:"General",   bed:"G-06", conditions:["Asthma","Allergic Reaction"], vitals:{ hr:98, sbp:122, dbp:80, spo2:95, temp:37.9, rr:21 }, trending:"warning" },
  { id:11, name:"Ravi Krishnan",   age:63, room:"302-B", ward:"ICU",       bed:"ICU-2",conditions:["Stroke","Hypertension"],      vitals:{ hr:85, sbp:170, dbp:105,spo2:96, temp:37.3, rr:17 }, trending:"warning" },
  { id:12, name:"Sunita Joshi",    age:52, room:"107-C", ward:"General",   bed:"G-07", conditions:["Gallstones"],                 vitals:{ hr:73, sbp:118, dbp:76, spo2:98, temp:37.0, rr:15 }, trending:"stable" },
];

const AGENT_DEFS = [
  { id:"sentinel", name:"SentinelAgent", img:"img/agent_sentinel.png", cls:"avatar-sentinel", nameCls:"name-sentinel" },
  { id:"flow",     name:"FlowAgent",     img:"img/agent_flow.png",     cls:"avatar-flow",     nameCls:"name-flow" },
  { id:"green",    name:"GreenAgent",    img:"img/agent_green.png",    cls:"avatar-green",    nameCls:"name-green" },
  { id:"guide",    name:"CareGuide",     img:"img/agent_careguide.png",cls:"avatar-guide",    nameCls:"name-guide" },
  { id:"command",  name:"CommandAgent",  img:"img/agent_command.png",  cls:"avatar-command",  nameCls:"name-command" },
];

class MediNexus {
  constructor() {
    this.patients = PATIENTS.map(p => ({
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
        title: '⚠️ Sepsis Risk Detected — Suresh Nair',
        desc: 'EWS Score: 8. SpO2 dropped to 91%, temp 39.1°C, HR 110. Sepsis protocol recommended.',
        agent: '🛡️ SentinelAgent', time: this.timeStr(-3),
        actions: [
          { label:'APPROVE TRANSFER', cls:'btn-approve', fn:'approveTransfer', arg:'5' },
          { label:'ESCALATE', cls:'btn-escalate', fn:'escalateAlert', arg:'a1' },
          { label:'DISMISS', cls:'btn-dismiss', fn:'dismissAlert', arg:'a1' },
        ]
      },
      {
        id: 'a2', severity: 'critical', room: 'Room 202-B',
        title: '🫀 Acute MI Alert — Vikram Singh',
        desc: 'HR 108, SpO2 92%, BP 158/100. Cardiologist notification sent. ICU bed pre-reserved.',
        agent: '🧠 CommandAgent', time: this.timeStr(-7),
        actions: [
          { label:'APPROVE PROTOCOL', cls:'btn-approve', fn:'approveProtocol', arg:'7' },
          { label:'DISMISS', cls:'btn-dismiss', fn:'dismissAlert', arg:'a2' },
        ]
      },
      {
        id: 'a3', severity: 'warning', room: 'Room 103-C',
        title: '🌡️ Fever Spike — Anita Patel',
        desc: 'Temperature elevated to 38.3°C. Pneumonia patient. Antibiotic escalation suggested.',
        agent: '🛡️ SentinelAgent', time: this.timeStr(-12),
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
      { agent:'guide',   text:'Patient Kumar (Room 201) requested medication info in Hindi. Response delivered.', time:t(-18) },
      { agent:'sentinel',text:'Routine vital check complete. 9 stable, 3 warning, 2 critical. EWS scores updated.', time:t(-15) },
      { agent:'command', text:'Coordinating ICU response for Room 301. Bed 3 reserved. Dr. Patel notified via pager.', time:t(-10) },
      { agent:'flow',    text:'Nurse Chen assigned additional monitoring duty for Patient #5 (Suresh Nair).', time:t(-8) },
      { agent:'sentinel',text:'ALERT: Vikram Singh (202-B) showing cardiac stress markers. Escalated to CommandAgent.', time:t(-7) },
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
    this.vitalsTimer = setInterval(() => this.updateVitals(), 2500);
    this.agentTimer  = setInterval(() => this.runAgent(),    4000);
    this.clockTimer  = setInterval(() => this.emit('clock', new Date()), 1000);
  }

  stop() {
    clearInterval(this.vitalsTimer);
    clearInterval(this.agentTimer);
    clearInterval(this.clockTimer);
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
    const alert = {
      id: 'a_' + Date.now(),
      severity: p.ews >= 8 ? 'critical' : 'warning',
      room: `Room ${p.room}`,
      title: `${p.ews >= 8 ? '🚨' : '⚠️'} EWS ${p.ews} — ${p.name}`,
      desc: `Deterioration detected. HR:${p.vitals.hr}, SpO2:${p.vitals.spo2}%, BP:${p.vitals.sbp}/${p.vitals.dbp}. Immediate review required.`,
      agent: '🛡️ SentinelAgent',
      time: this.timeStr(0),
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
        'Appointment reminder sent to Room 204 (Ravi Krishnan).',
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
