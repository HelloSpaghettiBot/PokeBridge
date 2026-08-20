import path from 'node:path';
import net from 'node:net';
import { GameTransport } from './game-transport.js';
import { HeadlessState, loadSurveySnapshot } from './headless-state.js';

export class HeadlessRuntime {
  #password = null;
  #mfa = null;

  constructor(options = {}) {
    this.root = path.resolve(options.root ?? '.');
    this.state = options.state ?? new HeadlessState();
    this.transportOptions = options.transport ?? null;
    this.loginAdapter = options.loginAdapter ?? null;
    this.telemetryPort = Number(options.telemetryPort ?? 0);
    this.surveyEnabled = options.surveyEnabled ?? true;
    this.transport = null;
    this.refreshTimer = null;
    this.paths = {
      status: path.join(this.root, 'captures/explorer-status.json'),
      graph: path.join(this.root, 'captures/world-graph.json'),
      centers: path.join(this.root, 'captures/pokemon-centers.json'),
      species: path.join(this.root, 'captures/client-species-index.json'),
      ...options.paths,
    };
  }

  async start() {
    if (this.surveyEnabled) await this.refreshSurvey();
    this.refreshTimer = setInterval(() => void this.refreshAll(), 750);
    if (this.transportOptions) await this.connect();
  }

  async connect() {
    if (this.transport) return;
    this.state.patch({ connection: { state: 'connecting', detail: `${this.transportOptions.host}:${this.transportOptions.port}` } });
    this.transport = new GameTransport(this.transportOptions);
    this.transport.on('packet', packet => {
      const counts = { ...this.state.value.protocol.packetCounts };
      counts[packet.opcode] = (counts[packet.opcode] ?? 0) + 1;
      this.state.patch({ protocol: { packetCounts: counts } });
    });
    this.transport.on('disconnected', () => this.state.patch({ connection: { state: 'offline', detail: 'Transport disconnected' } }));
    try {
      const secure = await this.transport.connect();
      this.state.patch({ connection: { state: 'secure', detail: `Encrypted session; checksum mode ${secure.checksumMode}` } });
    } catch (error) {
      this.state.patch({ connection: { state: 'error', detail: error.message } });
      this.transport = null;
    }
  }

  async submitCredentials(username, password) {
    this.clearSecret('#password');
    this.#password = Buffer.from(String(password), 'utf8');
    this.state.patch({ login: { state: 'authenticating', username: String(username), mfaRequired: false, notice: null, error: null } });
    try {
      if (!this.loginAdapter) {
        this.state.patch({ login: { state: 'protocol_adapter_required', username: String(username), mfaRequired: false } });
        return;
      }
      const result = await this.loginAdapter.login({ username: String(username), password: this.#password.toString('utf8') });
      this.state.patch({ login: { state: result.mfaRequired ? 'mfa_required' : 'authenticated', username: String(username), mfaRequired: Boolean(result.mfaRequired) } });
    } finally {
      this.clearSecret('#password');
    }
  }

  async submitMfa(code) {
    this.clearSecret('#mfa');
    this.#mfa = Buffer.from(String(code), 'utf8');
    try {
      if (!this.loginAdapter) throw new Error('Login protocol adapter is not loaded');
      await this.loginAdapter.submitMfa({ code: this.#mfa.toString('utf8') });
      this.state.patch({ login: { state: 'authenticated', mfaRequired: false } });
    } finally {
      this.clearSecret('#mfa');
    }
  }

  updateTelemetry(telemetry) { this.state.patch(telemetry); }
  async refreshSurvey() { this.state.patch(await loadSurveySnapshot(this.paths)); }
  async refreshAll() {
    if (this.surveyEnabled) await this.refreshSurvey();
    if (!this.telemetryPort) return;
    try {
      const response = await loopbackCommand(this.telemetryPort, 'SNAPSHOT');
      if (response.startsWith('SNAPSHOT_B64 ')) this.updateTelemetry(JSON.parse(Buffer.from(response.slice(13), 'base64').toString('utf8')));
    } catch {}
  }
  setActivity(activity) {
    if (activity.running) {
      this.state.patch({ activity: { stopReason: '' } });
      this.loginAdapter?.startBot?.(activity);
    }
    else this.loginAdapter?.stopBot?.('dashboard');
    this.state.patch({ activity });
  }
  clearSecret(name) {
    const value = name === '#password' ? this.#password : this.#mfa;
    value?.fill(0);
    if (name === '#password') this.#password = null; else this.#mfa = null;
  }
  close() { clearInterval(this.refreshTimer); this.transport?.close(); this.loginAdapter?.close?.(); this.clearSecret('#password'); this.clearSecret('#mfa'); }
}

function loopbackCommand(port, line) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }); let response = '';
    const timeout = setTimeout(() => socket.destroy(new Error('Telemetry timeout')), 500);
    socket.setEncoding('utf8'); socket.once('connect', () => socket.write(`${line}\n`));
    socket.on('data', chunk => { response += chunk; const newline = response.indexOf('\n'); if (newline < 0) return; clearTimeout(timeout); socket.end(); const answer = response.slice(0, newline).trim(); answer.startsWith('OK ') ? resolve(answer.slice(3)) : reject(new Error(answer)); });
    socket.once('error', error => { clearTimeout(timeout); reject(error); });
  });
}
