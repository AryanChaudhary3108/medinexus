// ===== MEDINEXUS OPERATIONAL ENGINE =====
// Real-time hospital observation data + AI agent coordination

const API_BASE = window.MEDINEXUS_API_BASE || (
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:8000'
    : window.location.origin
);
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
      usingFallback: false,
      lastCheckedAt: null,
      source: 'backend',
      message: 'Connecting to backend...',
    };
    this.isRunning = false;

    this.patients = [];
    this.agentLog = [];
    this.alerts = [];
    this.proactiveRisks = [];
    this.approvedActions = [];
    this.stats = {
      totalPatients: 0,
      criticalAlerts: 0,
      bedOccupancy: 0,
      energySaved: 0,
      activeAgents: 5,
      alertsResolved: 0,
    };
    this.energyData = {
      hvac: 0,
      lighting: 0,
      equipment: 0,
      totalKw: 0,
      savedKw: 0,
      savedCost: 0,
      history: [],
    };
    this.beds = [];
    this.callbacks = {};
    this.tick = 0;
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
      source: 'backend',
    };
  }

  toSimBed(record) {
    return {
      id: Number(record.id),
      code: record.bed_code || `BED-${record.id}`,
      ward: record.ward || 'General',
      room: record.room || '',
      status: record.status || 'available',
      patientId: record.patient_id || null,
      patientCode: record.patient_code || '',
      patientName: record.patient_name || '',
    };
  }

  async loadBedsFromBackend() {
    try {
      const res = await fetch(`${API_BASE}/api/beds`);
      if (!res.ok) {
        if (!this.beds.length) {
          this.beds = this.generateBedsFromPatients(80, this.patients.length);
        }
        return;
      }
      const payload = await res.json();
      this.beds = Array.isArray(payload?.beds)
        ? payload.beds.map(b => this.toSimBed(b))
        : [];
    } catch (_) {
      if (!this.beds.length) {
        this.beds = this.generateBedsFromPatients(80, this.patients.length);
      }
    }
  }

  toSimRisk(record) {
    return {
      id: record.id || `risk_${record.patient_id}`,
      patientId: Number(record.patient_id),
      patientName: record.patient_name || 'Patient',
      ward: record.ward || 'General',
      bed: record.bed || 'N/A',
      room: record.room || 'N/A',
      currentEws: Number(record.current_ews ?? 0),
      predictedEws: Number(record.predicted_ews ?? 0),
      status: record.status || 'warning',
      etaMin: Number(record.eta_min ?? 90),
      confidence: Number(record.confidence ?? 0.75),
      drivers: Array.isArray(record.drivers) ? record.drivers : [],
      playbook: Array.isArray(record.playbook) ? record.playbook : [],
      expectedDrop: Number(record.expected_ews_reduction ?? 1),
      reason: record.reason || '',
    };
  }

  buildFallbackProactiveRisks() {
    const items = (this.patients || [])
      .filter(p => (p.ews || 0) >= 5)
      .map((p) => {
        const predicted = Math.min(10, Number(p.ews || 0) + (p.status === 'critical' ? 1 : 0));
        return {
          id: `risk_fallback_${p.id}`,
          patientId: p.id,
          patientName: p.name,
          ward: p.ward,
          bed: p.bed,
          room: p.room,
          currentEws: Number(p.ews || 0),
          predictedEws: predicted,
          status: predicted >= 7 ? 'critical' : 'warning',
          etaMin: predicted >= 8 ? 45 : 90,
          confidence: predicted >= 8 ? 0.86 : 0.74,
          drivers: [
            `Current EWS ${p.ews || 0}/10`,
            'Trend and symptom drift indicate potential deterioration',
          ],
          playbook: [
            'Increase monitoring frequency',
            'Escalate to duty doctor',
            'Prioritize pending labs and reassessment',
          ],
          expectedDrop: predicted >= 8 ? 2 : 1,
          reason: 'Fallback risk model (backend proactive endpoint unavailable)',
        };
      })
      .sort((a, b) => b.predictedEws - a.predictedEws || a.etaMin - b.etaMin)
      .slice(0, 8);
    this.proactiveRisks = items;
  }

  async loadProactiveRisksFromBackend() {
    try {
      const res = await fetch(`${API_BASE}/api/proactive-risks?limit=8`);
      if (!res.ok) {
        this.buildFallbackProactiveRisks();
        return;
      }
      const payload = await res.json();
      this.proactiveRisks = Array.isArray(payload?.risks)
        ? payload.risks.map(r => this.toSimRisk(r))
        : [];
    } catch (_) {
      this.buildFallbackProactiveRisks();
    }
  }

  async loadPatientsFromBackend() {
    this.connection.lastCheckedAt = new Date().toISOString();
    try {
      const res = await fetch(`${API_BASE}/api/patients`);
      if (!res.ok) {
        throw new Error('Backend unavailable');
      }
      const payload = await res.json();
      this.patients = payload.patients.map(p => this.toSimPatient(p));
      await this.loadBedsFromBackend();
      await this.loadProactiveRisksFromBackend();
      this.rebuildDerivedState();
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
      console.warn('MediNexus: patient API unavailable.', err);
      this.connection = {
        backendConnected: false,
        usingFallback: false,
        lastCheckedAt: new Date().toISOString(),
        source: 'backend',
        message: 'Backend unavailable',
      };
      this.patients = [];
      this.beds = [];
      this.proactiveRisks = [];
      this.rebuildDerivedState();
      this.emit('vitals', this.patients);
      this.emit('connection', this.connection);
    }
  }

  rebuildDerivedState() {
    const totalPatients = this.patients.length;
    const criticalPatients = this.patients.filter(p => p.status === 'critical' || p.ews >= 7);
    const warningPatients = this.patients.filter(p => p.status === 'warning' || (p.ews >= 4 && p.ews < 7));
    if (!this.beds.length) {
      this.beds = this.generateBedsFromPatients(80, criticalPatients.length);
    }
    const unavailableBeds = this.beds.filter(b => b.status !== 'available').length;
    const criticalBeds = this.beds.filter(b => b.status === 'critical').length;

    this.stats.totalPatients = totalPatients;
    this.stats.criticalAlerts = criticalBeds || criticalPatients.length;
    this.stats.bedOccupancy = this.beds.length ? Math.round((unavailableBeds / this.beds.length) * 100) : 0;

    this.energyData = this.buildEnergyData(totalPatients, criticalPatients.length, warningPatients.length);
    this.stats.energySaved = this.energyData.totalKw > 0
      ? Math.round((this.energyData.savedKw / this.energyData.totalKw) * 100)
      : 0;

    this.alerts = this.buildBedActionAlerts(criticalPatients, warningPatients);
    this.agentLog = this.buildAgentLogFromPatients(totalPatients, criticalPatients.length, warningPatients.length);

    this.emit('stats', this.stats);
    this.emit('beds', this.beds);
    this.emit('alerts', this.alerts);
    this.emit('proactiveRisks', this.proactiveRisks);
    this.emit('agentLog', this.agentLog);
    this.emit('energy', this.energyData);
  }

  generateBedsFromPatients(capacity = 60, criticalCount = 0) {
    const occupiedCount = Math.min(capacity, this.patients.length);
    const critical = Math.min(occupiedCount, criticalCount);
    const icuCount = Math.min(
      occupiedCount - critical,
      this.patients.filter(p => p.ward === 'ICU' && p.status !== 'critical').length,
    );
    const reserved = Math.max(0, Math.min(capacity - occupiedCount, Math.round(capacity * 0.08)));
    const normalOccupied = Math.max(0, occupiedCount - critical - icuCount);
    const available = Math.max(0, capacity - critical - icuCount - normalOccupied - reserved);

    const statuses = [
      ...Array(critical).fill('critical'),
      ...Array(icuCount).fill('icu'),
      ...Array(normalOccupied).fill('occupied'),
      ...Array(reserved).fill('reserved'),
      ...Array(available).fill('available'),
    ];

    return statuses.map((status, idx) => ({
      id: idx + 1,
      code: `BED-${String(idx + 1).padStart(3, '0')}`,
      ward: 'General',
      room: '',
      status,
      patientId: null,
      patientCode: '',
      patientName: '',
    }));
  }

  buildBedActionAlerts(criticalPatients, warningPatients) {
    const queue = [];
    const now = this.timeStr(0);

    this.beds
      .filter(b => b.status === 'reserved')
      .slice(0, 4)
      .forEach((b) => {
        queue.push({
          id: `bed_reserved_${b.id}`,
          severity: 'warning',
          room: b.room || b.ward,
          title: `🟨 Reserved Bed ${b.code}`,
          desc: `Bed is reserved and waiting for assignment. Release if no admission is expected.`,
          agent: '🛏️ FlowAgent',
          time: now,
          actions: [
            { label: 'RELEASE', cls: 'btn-approve', fn: 'releaseBed', arg: String(b.id) },
            { label: 'DISMISS', cls: 'btn-dismiss', fn: 'dismissAlert', arg: `bed_reserved_${b.id}` },
          ],
        });
      });

    this.beds
      .filter(b => b.status === 'available')
      .slice(0, 3)
      .forEach((b) => {
        queue.push({
          id: `bed_available_${b.id}`,
          severity: 'warning',
          room: b.room || b.ward,
          title: `🟩 Vacant Bed ${b.code}`,
          desc: `Vacant bed ready for incoming admissions. Mark as reserved when assigning queue patients.`,
          agent: '🛏️ FlowAgent',
          time: now,
          actions: [
            { label: 'RESERVE', cls: 'btn-approve', fn: 'reserveBed', arg: String(b.id) },
            { label: 'DISMISS', cls: 'btn-dismiss', fn: 'dismissAlert', arg: `bed_available_${b.id}` },
          ],
        });
      });

    criticalPatients.slice(0, 3).forEach((p) => {
      queue.push({
        id: `patient_transfer_${p.id}`,
        severity: 'critical',
        room: `Room ${p.room}`,
        title: `🚨 Transfer Priority — ${p.name}`,
        desc: `Critical occupancy at ${p.ward} ${p.bed}. Approve transfer workflow when ICU coordination is needed.`,
        agent: '🛡️ SentinelAgent',
        time: now,
        actions: [
          { label: 'APPROVE TRANSFER', cls: 'btn-approve', fn: 'approveTransfer', arg: String(p.id) },
          { label: 'ESCALATE', cls: 'btn-escalate', fn: 'escalateAlert', arg: `patient_transfer_${p.id}` },
          { label: 'DISMISS', cls: 'btn-dismiss', fn: 'dismissAlert', arg: `patient_transfer_${p.id}` },
        ],
      });
    });

    if (!queue.length && warningPatients.length) {
      const p = warningPatients[0];
      queue.push({
        id: `patient_watch_${p.id}`,
        severity: 'warning',
        room: `Room ${p.room}`,
        title: `⚠️ Capacity Watch — ${p.name}`,
        desc: `Monitor this occupied bed for possible escalation and downstream bed turnover planning.`,
        agent: '🛏️ FlowAgent',
        time: now,
        actions: [
          { label: 'DISMISS', cls: 'btn-dismiss', fn: 'dismissAlert', arg: `patient_watch_${p.id}` },
        ],
      });
    }

    return queue.slice(0, 8);
  }

  buildEnergyData(totalPatients, criticalCount, warningCount) {
    const totalKw = Math.max(120, Math.round(150 + totalPatients * 3 + criticalCount * 8 + warningCount * 3));
    const savedKw = Math.max(8, Math.round(totalKw * 0.18));
    const savedCost = savedKw * 195;
    const hvac = Math.round(totalKw * 0.48);
    const lighting = Math.round(totalKw * 0.24);
    const equipment = Math.max(0, totalKw - hvac - lighting);
    const history = Array.from({ length: 9 }, (_, i) => {
      const drift = (8 - i) * 4;
      return Math.max(100, totalKw + drift - Math.round(savedKw * 0.2));
    });

    return {
      hvac,
      lighting,
      equipment,
      totalKw,
      savedKw,
      savedCost,
      history,
    };
  }

  buildAgentLogFromPatients(totalPatients, criticalCount, warningCount) {
    const availableBeds = this.beds.filter(b => b.status === 'available').length;
    const occupiedBeds = this.beds.filter(b => b.status !== 'available').length;
    const reservedBeds = this.beds.filter(b => b.status === 'reserved').length;
    return [
      { agent: 'command', text: `Backend census synced: ${totalPatients} active patients across monitored wards.`, time: this.timeStr(-6) },
      { agent: 'sentinel', text: `Acuity scan: ${criticalCount} critical, ${warningCount} warning, ${Math.max(0, totalPatients - criticalCount - warningCount)} stable.`, time: this.timeStr(-5) },
      { agent: 'flow', text: `Bed map synced from backend inventory. ${occupiedBeds} occupied, ${reservedBeds} reserved, ${availableBeds} available.`, time: this.timeStr(-4) },
      { agent: 'green', text: `Energy model recomputed from occupancy profile. Estimated load ${this.energyData.totalKw} kW.`, time: this.timeStr(-3) },
      { agent: 'guide', text: `CareGuide context refreshed using latest patient notes and pending labs.`, time: this.timeStr(-2) },
      { agent: 'command', text: `Priority queue refreshed with ${this.alerts.length} active risk alerts.`, time: this.timeStr(-1) },
    ];
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

  timeStr(offsetMin = 0) {
    const d = new Date(Date.now() + offsetMin * 60000);
    return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:false });
  }

  on(event, cb) { this.callbacks[event] = cb; }
  emit(event, data) { if (this.callbacks[event]) this.callbacks[event](data); }

  start() {
    this.isRunning = true;
    clearInterval(this.backendSyncTimer);
    this.backendSyncTimer = setInterval(() => this.loadPatientsFromBackend(), 5000);
    this.startLiveLoops();
    this.clockTimer  = setInterval(() => this.emit('clock', new Date()), 1000);
  }

  stop() {
    this.isRunning = false;
    this.stopLiveLoops();
    clearInterval(this.backendSyncTimer);
    clearInterval(this.clockTimer);
  }

  startLiveLoops() {
    if (this.demoMode) return;
    const hasSimulatedPatients = this.patients.some(p => p.source !== 'backend');
    if (!hasSimulatedPatients) return;
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
    let hasSimulatedPatients = false;
    this.patients.forEach(p => {
      if (p.source === 'backend') return;
      hasSimulatedPatients = true;
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

    // Random bed change only for simulated (non-backend) records
    if (hasSimulatedPatients && this.tick % 6 === 0) {
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
    const hasSimulatedPatients = this.patients.some(p => p.source !== 'backend');
    if (!hasSimulatedPatients) return;

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
    this.emit('stats', this.stats);
    this.emit('approved', this.approvedActions);
  }

  approveProtocol(patientId) {
    const p = this.patients.find(x => x.id === parseInt(patientId));
    const name = p ? p.name : 'Patient';
    this.approvedActions.unshift({ text:`MI Protocol activated for ${name}`, time:this.timeStr(0) });
    this.addAgentMsg('sentinel', `MI protocol approved. Cardiac team alerted for ${name}. Cath lab on standby.`);
    this.stats.alertsResolved++;
    this.emit('stats', this.stats);
    this.emit('approved', this.approvedActions);
  }

  approveTxChange(patientId) {
    const p = this.patients.find(x => x.id === parseInt(patientId));
    const name = p ? p.name : 'Patient';
    this.approvedActions.unshift({ text:`Treatment change approved for ${name}`, time:this.timeStr(0) });
    this.addAgentMsg('sentinel', `Antibiotic escalation approved for ${name}. Pharmacy notified.`);
    this.stats.alertsResolved++;
    this.emit('stats', this.stats);
    this.emit('approved', this.approvedActions);
  }

  async updateBedStatus(bedId, status) {
    try {
      const res = await fetch(`${API_BASE}/api/beds/${bedId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        throw new Error(await this.readApiErrorDetail(res, 'Unable to update bed status'));
      }
      await this.loadPatientsFromBackend();
      return { ok: true, error: null };
    } catch (err) {
      this.addAgentMsg('command', `Bed status update failed for bed ${bedId}: ${String(err.message || err)}`);
      return { ok: false, error: String(err.message || err) };
    }
  }

  async readApiErrorDetail(response, fallbackMessage) {
    try {
      const data = await response.json();
      if (data && data.detail) return String(data.detail);
    } catch (_) {
      // Ignore JSON parse failures and use text fallback.
    }
    try {
      const text = await response.text();
      if (text) return text;
    } catch (_) {
      // Ignore text read failure and use fallback.
    }
    return fallbackMessage;
  }

  async reserveBed(bedId) {
    const result = await this.updateBedStatus(bedId, 'reserved');
    if (!result.ok) return result;
    this.approvedActions.unshift({ text: `Bed #${bedId} marked reserved`, time: this.timeStr(0) });
    this.stats.alertsResolved++;
    this.emit('stats', this.stats);
    this.emit('approved', this.approvedActions);
    this.addAgentMsg('flow', `Bed #${bedId} reserved for incoming assignment.`);
    return { ok: true, error: null };
  }

  async releaseBed(bedId) {
    const result = await this.updateBedStatus(bedId, 'available');
    if (!result.ok) return result;
    this.approvedActions.unshift({ text: `Bed #${bedId} released to available pool`, time: this.timeStr(0) });
    this.stats.alertsResolved++;
    this.emit('stats', this.stats);
    this.emit('approved', this.approvedActions);
    this.addAgentMsg('flow', `Bed #${bedId} released and ready for allocation.`);
    return { ok: true, error: null };
  }

  async assignBedToPatient(bedId, patientId) {
    try {
      const res = await fetch(`${API_BASE}/api/beds/${bedId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: Number(patientId) }),
      });
      if (!res.ok) {
        throw new Error(await this.readApiErrorDetail(res, 'Unable to assign bed'));
      }
      await this.loadPatientsFromBackend();
      this.approvedActions.unshift({ text: `Assigned bed #${bedId} to patient #${patientId}`, time:this.timeStr(0) });
      this.stats.alertsResolved++;
      this.emit('stats', this.stats);
      this.emit('approved', this.approvedActions);
      this.addAgentMsg('flow', `Bed #${bedId} assigned to patient #${patientId}.`);
      return { ok: true, error: null };
    } catch (err) {
      this.addAgentMsg('command', `Bed assignment failed for bed ${bedId}: ${String(err.message || err)}`);
      return { ok: false, error: String(err.message || err) };
    }
  }

  async vacateBed(bedId) {
    try {
      const res = await fetch(`${API_BASE}/api/beds/${bedId}/vacate`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(await this.readApiErrorDetail(res, 'Unable to vacate bed'));
      }
      await this.loadPatientsFromBackend();
      this.approvedActions.unshift({ text: `Vacated bed #${bedId}`, time:this.timeStr(0) });
      this.stats.alertsResolved++;
      this.emit('stats', this.stats);
      this.emit('approved', this.approvedActions);
      this.addAgentMsg('flow', `Bed #${bedId} vacated and added back to capacity.`);
      return { ok: true, error: null };
    } catch (err) {
      this.addAgentMsg('command', `Vacate action failed for bed ${bedId}: ${String(err.message || err)}`);
      return { ok: false, error: String(err.message || err) };
    }
  }

  async transferPatientToBed(sourceBedId, targetBedId) {
    try {
      const res = await fetch(`${API_BASE}/api/beds/${sourceBedId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_bed_id: Number(targetBedId) }),
      });
      if (!res.ok) {
        throw new Error(await this.readApiErrorDetail(res, 'Unable to transfer patient'));
      }
      await this.loadPatientsFromBackend();
      this.approvedActions.unshift({ text: `Transferred patient from bed #${sourceBedId} to bed #${targetBedId}`, time:this.timeStr(0) });
      this.stats.alertsResolved++;
      this.emit('stats', this.stats);
      this.emit('approved', this.approvedActions);
      this.addAgentMsg('flow', `Patient transfer completed: bed #${sourceBedId} -> bed #${targetBedId}.`);
      return { ok: true, error: null };
    } catch (err) {
      this.addAgentMsg('command', `Transfer failed (${sourceBedId} -> ${targetBedId}): ${String(err.message || err)}`);
      return { ok: false, error: String(err.message || err) };
    }
  }

  async applyProactivePlaybook(patientId, riskId) {
    const id = Number(patientId);
    const patient = this.patients.find(p => p.id === id);
    const risk = this.proactiveRisks.find(r => r.id === riskId || r.patientId === id);
    if (!patient) {
      return { ok: false, error: 'Patient not found for playbook action.' };
    }

    const drop = Math.max(1, Number(risk?.expectedDrop || 1));
    const cooldownMin = 5;
    const approvedAt = new Date().toISOString();
    const machineTag = `PLAYBOOK_APPROVED at=${approvedAt} drop=${drop} cooldown=${cooldownMin}`;
    const noteLine = `Playbook approved ${approvedAt}: monitoring intensified, senior review initiated, reassessment scheduled in 30m.`;
    try {
      const res = await fetch(`${API_BASE}/api/patients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: `${patient.notes || ''}\n${machineTag}\n${noteLine}`.trim() }),
      });
      if (!res.ok) {
        throw new Error(await this.readApiErrorDetail(res, 'Unable to apply proactive playbook'));
      }
      await this.loadPatientsFromBackend();
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }

    this.approvedActions.unshift({
      text: `Proactive playbook approved for ${patient.name} (target risk reduction: ${drop} EWS points)`,
      time: this.timeStr(0),
    });
    this.stats.alertsResolved++;
    this.proactiveRisks = this.proactiveRisks.filter(r => r.id !== riskId && r.patientId !== id);
    this.emit('stats', this.stats);
    this.emit('approved', this.approvedActions);
    this.emit('proactiveRisks', this.proactiveRisks);
    this.addAgentMsg('command', `Proactive playbook activated for ${patient.name}. Team notified for rapid preventive intervention.`);
    return { ok: true, error: null };
  }

  activateEco() {
    this.energyData.savedKw += 8;
    this.energyData.savedCost += 4200;
    this.energyData.totalKw -= 8;
    this.stats.energySaved = Math.min(35, this.stats.energySaved + 3);
    this.approvedActions.unshift({ text:'Eco-mode activated — Wing B devices', time:this.timeStr(0) });
    this.addAgentMsg('green', 'Eco-mode activated for 8 devices in Wing B. Saving 8 kWh. Monthly projection: ₹1.2L saved.');
    this.emit('stats', this.stats);
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
