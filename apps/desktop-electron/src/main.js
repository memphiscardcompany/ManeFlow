const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { DEFAULT_CORE_PORT, DEFAULT_VISION_PORT } = require('./config');

const EBAY_DEFAULT_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
];

function ebayApiBase(settings = {}) {
  return settings.ebayEnvironment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

function ebayAuthBase(settings = {}) {
  return settings.ebayEnvironment === 'sandbox' ? 'https://auth.sandbox.ebay.com/oauth2/authorize' : 'https://auth.ebay.com/oauth2/authorize';
}

function ebayScopes(settings = {}) {
  const configured = Array.isArray(settings.ebayUserScopes) ? settings.ebayUserScopes : [];
  return configured.length ? configured : EBAY_DEFAULT_SCOPES;
}

function parseEbayAuthorizationCallback(value) {
  const raw = String(value || '').trim();
  if (!raw) return { code: '', state: '' };
  try {
    const url = new URL(raw);
    return {
      code: String(url.searchParams.get('code') || '').trim(),
      state: String(url.searchParams.get('state') || '').trim(),
    };
  } catch {}
  const codeMatch = raw.match(/(?:^|[?&#\s])code=([^&\s]+)/i);
  const stateMatch = raw.match(/(?:^|[?&#\s])state=([^&\s]+)/i);
  const decode = (entry) => {
    if (!entry) return '';
    try { return decodeURIComponent(entry); } catch { return entry; }
  };
  return { code: decode(codeMatch?.[1]), state: decode(stateMatch?.[1]) };
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buildEbayConsentUrl(settings = {}, state = '') {
  if (!settings.ebayClientId) throw new Error('Save the eBay client ID first.');
  if (!settings.ebayRedirectUriName) throw new Error('Save the eBay RuName / redirect URI name first.');
  const url = new URL(ebayAuthBase(settings));
  url.searchParams.set('client_id', settings.ebayClientId);
  url.searchParams.set('redirect_uri', settings.ebayRedirectUriName);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', ebayScopes(settings).join(' '));
  url.searchParams.set('prompt', 'login');
  url.searchParams.set('locale', 'en-US');
  if (state) url.searchParams.set('state', state);
  return url.href;
}

async function exchangeEbayAuthorizationCode(settings = {}, code = '') {
  if (!settings.ebayClientId || !settings.ebayClientSecret) throw new Error('Save the eBay client ID and client secret first.');
  if (!settings.ebayRedirectUriName) throw new Error('Save the eBay RuName / redirect URI name first.');
  const authorizationCode = String(code || '').trim();
  if (!authorizationCode) throw new Error('Paste the authorization code or full redirect URL returned by eBay.');
  const auth = Buffer.from(`${settings.ebayClientId}:${settings.ebayClientSecret}`).toString('base64');
  const response = await fetch(`${ebayApiBase(settings)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: authorizationCode, redirect_uri: settings.ebayRedirectUriName }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.message || `eBay OAuth failed with HTTP ${response.status}.`);
  return payload;
}

let mainWindow = null;
let coreProcess = null;
let visionProcess = null;
let coreLog = null;
let visionLog = null;
let stoppingServices = false;
let shuttingDown = false;
let recoveryTimer = null;
let recoveryAttempts = 0;
let pendingEbayOAuth = null;
const runtimeServiceToken = crypto.randomBytes(48).toString('base64url');

const runtime = {
  corePort: DEFAULT_CORE_PORT,
  visionPort: DEFAULT_VISION_PORT,
  coreBase: `http://127.0.0.1:${DEFAULT_CORE_PORT}`,
  visionBase: `http://127.0.0.1:${DEFAULT_VISION_PORT}`,
};

function userDataDir() { return app.getPath('userData'); }
function dataDir() { return path.join(userDataDir(), 'data'); }
function logsDir() { return path.join(userDataDir(), 'logs'); }
function diagnosticsDir() { return path.join(userDataDir(), 'diagnostics'); }
function settingsPath() { return path.join(userDataDir(), 'settings.secure'); }
function coreLogPath() { return path.join(logsDir(), 'maneflow-core.log'); }
function visionLogPath() { return path.join(logsDir(), 'maneflow-vision.log'); }

function ensureDirectories() {
  for (const dir of [userDataDir(), dataDir(), logsDir(), diagnosticsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseDotEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function importLegacyEnvironmentCredentials() {
  if (!safeStorage.isEncryptionAvailable()) return { imported: false };
  const candidates = [
    process.env.MANEFLOW_IMPORT_ENV,
    path.join(process.cwd(), '.env'),
    path.join(path.dirname(process.execPath), '.env'),
    path.join(userDataDir(), 'import.env'),
    path.join(app.getPath('documents'), 'ManeFlow', '.env'),
  ].filter(Boolean);
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) return { imported: false };
  const env = parseDotEnv(source);
  const current = readSecureSettings();
  const mapping = {
    psaApiKey: env.PSA_API_KEY || env.PSA_API_TOKEN,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiVisionModel: env.OPENAI_VISION_MODEL,
    ebayClientId: env.EBAY_CLIENT_ID,
    ebayClientSecret: env.EBAY_CLIENT_SECRET,
    ebayUserAccessToken: env.EBAY_USER_ACCESS_TOKEN,
    ebayRefreshToken: env.EBAY_REFRESH_TOKEN,
    ebayRedirectUriName: env.EBAY_REDIRECT_URI_NAME || env.EBAY_RUNAME,
    ebayMarketplaceId: env.EBAY_MARKETPLACE_ID,
    ebayEnvironment: env.EBAY_ENVIRONMENT,
    justTcgApiKey: env.JUSTTCG_API_KEY,
    sportsCardsProApiToken: env.SPORTSCARDSPRO_API_TOKEN,
  };
  let changed = false;
  for (const [key, value] of Object.entries(mapping)) {
    if (!current[key] && String(value || '').trim()) {
      current[key] = String(value).trim();
      changed = true;
    }
  }
  if (changed) writeSecureSettings(current);
  return { imported: changed, source: path.basename(source) };
}

function sendStartup(stage, message, progress) {
  mainWindow?.webContents.send('startup:progress', { stage, message, progress });
}

function readSecureSettings() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(settingsPath())) return {};
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(settingsPath())));
  } catch {
    return {};
  }
}

function writeSecureSettings(settings) {
  ensureDirectories();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure credential storage is unavailable.');
  }
  fs.writeFileSync(settingsPath(), safeStorage.encryptString(JSON.stringify(settings)));
}

function publicSettings(settings = readSecureSettings()) {
  return {
    openaiConfigured: Boolean(settings.openaiApiKey),
    openaiVisionModel: settings.openaiVisionModel || 'gpt-4.1-mini',
    psaConfigured: Boolean(settings.psaApiKey),
    ebayConfigured: Boolean(settings.ebayClientId && settings.ebayClientSecret),
    ebaySellerOrdersConfigured: Boolean(settings.ebayUserAccessToken || settings.ebayRefreshToken),
    ebayOAuthReady: Boolean(settings.ebayClientId && settings.ebayClientSecret && settings.ebayRedirectUriName),
    ebayRefreshTokenConfigured: Boolean(settings.ebayRefreshToken),
    ebayRedirectUriNameConfigured: Boolean(settings.ebayRedirectUriName),
    ebayEnvironment: settings.ebayEnvironment || 'production',
    ebayMarketplaceId: settings.ebayMarketplaceId || 'EBAY_US',
    ebayMarketplaceInsightsEnabled: Boolean(settings.ebayMarketplaceInsightsEnabled),
    justTcgConfigured: Boolean(settings.justTcgApiKey),
    sportsCardsProConfigured: Boolean(settings.sportsCardsProApiToken),
    dataDirectory: dataDir(),
    logsDirectory: logsDir(),
    coreBase: runtime.coreBase,
    visionBase: runtime.visionBase,
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function resourcePaths() {
  const root = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..', '..');
  const core = app.isPackaged ? path.join(root, 'core') : root;
  const worker = path.join(root, 'vision-worker');
  const packagedWorkerExe = path.join(worker, 'maneflow-vision-worker.exe');
  const embeddedPython = path.join(root, 'runtime', 'python', 'python.exe');
  return { root, core, worker, packagedWorkerExe, embeddedPython };
}

function findOpenPort(preferred) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (error) => {
      if (error.code !== 'EADDRINUSE') return reject(error);
      const fallback = net.createServer();
      fallback.unref();
      fallback.on('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferred, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function prepareRuntimePorts() {
  runtime.visionPort = await findOpenPort(DEFAULT_VISION_PORT);
  runtime.corePort = await findOpenPort(DEFAULT_CORE_PORT);
  runtime.visionBase = `http://127.0.0.1:${runtime.visionPort}`;
  runtime.coreBase = `http://127.0.0.1:${runtime.corePort}`;
}

function scheduleRecovery(label) {
  if (stoppingServices || shuttingDown || recoveryTimer || recoveryAttempts >= 3) return;
  recoveryAttempts += 1;
  recoveryTimer = setTimeout(async () => {
    recoveryTimer = null;
    sendStartup('recovering', `${label} stopped unexpectedly. ManeFlow is restarting its local services.`, 45);
    try {
      const started = await startServices({ recovery: true });
      if (started.core?.ready) {
        recoveryAttempts = 0;
        await mainWindow?.loadURL(runtime.coreBase);
      }
    } catch (error) {
      coreLog?.write(`Recovery failed: ${error.stack || error.message}\n`);
    }
  }, Math.min(2_000 * recoveryAttempts, 6_000));
}

function attachLog(processHandle, logStream, label) {
  processHandle.stdout?.pipe(logStream, { end: false });
  processHandle.stderr?.pipe(logStream, { end: false });
  processHandle.on('error', (error) => logStream.write(`${label} process error: ${error.stack || error.message}\n`));
  processHandle.on('exit', (code, signal) => {
    logStream.write(`${label} exited code=${code} signal=${signal}\n`);
    notifyServiceStatus();
    scheduleRecovery(label);
  });
}

async function waitFor(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

async function terminate(handle) {
  if (!handle || handle.killed) return;
  if (process.platform === 'win32' && handle.pid) {
    try {
      spawnSync('taskkill.exe', ['/PID', String(handle.pid), '/T', '/F'], { windowsHide: true });
      return;
    } catch {}
  }
  try { handle.kill('SIGTERM'); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 450));
  try { if (!handle.killed) handle.kill('SIGKILL'); } catch {}
}

async function stopServices() {
  stoppingServices = true;
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  const oldCore = coreProcess;
  const oldVision = visionProcess;
  coreProcess = null;
  visionProcess = null;
  await Promise.all([terminate(oldCore), terminate(oldVision)]);
  coreLog?.end();
  visionLog?.end();
  coreLog = null;
  visionLog = null;
  stoppingServices = false;
}

function commonEnvironment() {
  const settings = readSecureSettings();
  return {
    ...process.env,
    NODE_ENV: 'desktop',
    RELEASE_CHANNEL: 'desktop-beta',
    MANEFLOW_DESKTOP_MODE: 'local',
    MANEFLOW_DEMO_MODE: 'true',
    MANEFLOW_ALLOW_GUEST_WRITES: 'true',
    MANEFLOW_ALLOW_PUBLIC_SIGNUPS: 'false',
    MANEFLOW_REQUIRE_EMAIL_VERIFICATION: 'false',
    MANEFLOW_EXPOSE_DEV_TOKENS: 'false',
    MANEFLOW_SERVICE_TOKEN: runtimeServiceToken,
    MANEFLOW_DATA_DIR: dataDir(),
    MANEFLOW_STATE_FILE: path.join(dataDir(), 'core-state.json'),
    MANEFLOW_VISION_WORKER_URL: runtime.visionBase,
    OPENAI_API_KEY: settings.openaiApiKey || '',
    OPENAI_VISION_MODEL: settings.openaiVisionModel || 'gpt-4.1-mini',
    PSA_API_KEY: settings.psaApiKey || '',
    PSA_API_TOKEN: settings.psaApiKey || '',
    PSA_API_BASE_URL: process.env.PSA_API_BASE_URL || 'https://api.psacard.com/publicapi/cert/GetByCertNumber',
    PSA_AUTH_SCHEME: process.env.PSA_AUTH_SCHEME || 'bearer',
    EBAY_CLIENT_ID: settings.ebayClientId || '',
    EBAY_CLIENT_SECRET: settings.ebayClientSecret || '',
    EBAY_USER_ACCESS_TOKEN: settings.ebayUserAccessToken || '',
    EBAY_USER_ACCESS_TOKEN_EXPIRES_AT: settings.ebayUserAccessTokenExpiresAt ? String(settings.ebayUserAccessTokenExpiresAt) : '',
    EBAY_REFRESH_TOKEN: settings.ebayRefreshToken || '',
    EBAY_REDIRECT_URI_NAME: settings.ebayRedirectUriName || '',
    EBAY_USER_SCOPES: ebayScopes(settings).join(' '),
    EBAY_ENVIRONMENT: settings.ebayEnvironment || 'production',
    EBAY_MARKETPLACE_ID: settings.ebayMarketplaceId || 'EBAY_US',
    EBAY_MARKETPLACE_INSIGHTS_ENABLED: settings.ebayMarketplaceInsightsEnabled ? 'true' : 'false',
    JUSTTCG_API_KEY: settings.justTcgApiKey || '',
    SPORTSCARDSPRO_API_TOKEN: settings.sportsCardsProApiToken || '',
  };
}

async function startVisionWorker() {
  const paths = resourcePaths();
  const env = { ...commonEnvironment(), APP_ENV: 'desktop', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' };
  visionLog = fs.createWriteStream(visionLogPath(), { flags: 'a' });
  visionLog.write(`\n--- ManeFlow vision start ${new Date().toISOString()} port=${runtime.visionPort} ---\n`);

  if (app.isPackaged && fs.existsSync(paths.packagedWorkerExe)) {
    visionProcess = spawn(paths.packagedWorkerExe, ['--host', '127.0.0.1', '--port', String(runtime.visionPort)], {
      cwd: paths.worker, env, windowsHide: true,
    });
  } else {
    const python = process.platform === 'win32' && fs.existsSync(paths.embeddedPython)
      ? paths.embeddedPython
      : (process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'));
    visionProcess = spawn(
      python,
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(runtime.visionPort), '--log-level', 'warning'],
      { cwd: paths.worker, env, windowsHide: true },
    );
  }
  attachLog(visionProcess, visionLog, 'Vision worker');
  return waitFor(`${runtime.visionBase}/health`, 90_000);
}

async function startCore() {
  const paths = resourcePaths();
  const env = {
    ...commonEnvironment(),
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(runtime.corePort),
    HOST: '127.0.0.1',
    PUBLIC_BASE_URL: runtime.coreBase,
  };
  coreLog = fs.createWriteStream(coreLogPath(), { flags: 'a' });
  coreLog.write(`\n--- ManeFlow core start ${new Date().toISOString()} port=${runtime.corePort} ---\n`);
  coreProcess = spawn(process.execPath, [path.join(paths.core, 'server.js')], {
    cwd: paths.core, env, windowsHide: true,
  });
  attachLog(coreProcess, coreLog, 'Core');
  return waitFor(`${runtime.coreBase}/healthz`, 60_000);
}

async function status() {
  const output = {
    appVersion: app.getVersion(),
    core: { ready: false, base: runtime.coreBase },
    vision: { ready: false, base: runtime.visionBase },
  };
  try {
    const response = await fetch(`${runtime.coreBase}/healthz`, { signal: AbortSignal.timeout(3_000) });
    output.core = { ready: response.ok, base: runtime.coreBase, ...(await response.json()) };
  } catch (error) { output.core.error = error.message; }
  try {
    const healthResponse = await fetch(`${runtime.visionBase}/health`, { signal: AbortSignal.timeout(3_000) });
    const readinessResponse = await fetch(`${runtime.visionBase}/readiness`, { signal: AbortSignal.timeout(5_000) });
    output.vision = {
      ready: healthResponse.ok,
      base: runtime.visionBase,
      health: await healthResponse.json(),
      readiness: readinessResponse.ok ? await readinessResponse.json() : { ready: false },
    };
  } catch (error) { output.vision.error = error.message; }
  return output;
}

async function notifyServiceStatus() {
  const value = await status();
  mainWindow?.webContents.send('services:status-changed', value);
  return value;
}

async function startServices({ recovery = false } = {}) {
  ensureDirectories();
  sendStartup('ports', 'Preparing local services…', 18);
  await stopServices();
  await prepareRuntimePorts();
  sendStartup('vision', 'Starting card imaging and recognition engine…', 35);
  const visionReady = await startVisionWorker();
  sendStartup('core', 'Starting ManeFlow card intelligence…', visionReady ? 68 : 52);
  const coreReady = await startCore();
  sendStartup('ready', coreReady ? 'ManeFlow is ready.' : 'ManeFlow needs attention.', coreReady ? 100 : 82);
  const result = await notifyServiceStatus();
  if (!recovery) recoveryAttempts = 0;
  return { ...result, visionStarted: visionReady, coreStarted: coreReady };
}

function offlinePage(description) {
  const safe = String(description || 'ManeFlow could not start its local services.')
    .replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>ManeFlow</title><body style="margin:0;background:#07100c;color:#f5f1e8;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:680px;padding:36px"><p style="color:#e0b957;text-transform:uppercase;letter-spacing:2px;font-weight:800">Startup diagnostics</p><h1>ManeFlow could not start</h1><p>${safe}</p><p>Use the buttons below to restart the services or open the logs.</p><button onclick="window.maneFlowDesktop.restartServices().then(()=>location.reload())" style="padding:12px 16px;margin-right:8px">Restart</button><button onclick="window.maneFlowDesktop.openLogs()" style="padding:12px 16px">Open logs</button></main></body>`)}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    title: 'ManeFlow — Card Intelligence',
    backgroundColor: '#07100c',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(runtime.coreBase) && !url.startsWith('data:text/html') && !url.startsWith('file:')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, _code, description, validatedURL) => {
    if (validatedURL?.startsWith(runtime.coreBase)) mainWindow.loadURL(offlinePage(description));
  });
  mainWindow.loadFile(path.join(__dirname, 'startup.html'));
}

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) fs.copyFileSync(source, destination);
}

async function createDiagnosticsBundle() {
  ensureDirectories();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(diagnosticsDir(), `ManeFlow-Diagnostics-${stamp}`);
  fs.mkdirSync(staging, { recursive: true });
  copyIfExists(coreLogPath(), path.join(staging, 'maneflow-core.log'));
  copyIfExists(visionLogPath(), path.join(staging, 'maneflow-vision.log'));
  const report = {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    release: os.release(),
    architecture: process.arch,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    cpus: os.cpus().length,
    services: await status(),
    providers: publicSettings(),
  };
  fs.writeFileSync(path.join(staging, 'diagnostics.json'), JSON.stringify(report, null, 2));

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save ManeFlow diagnostics',
    defaultPath: path.join(app.getPath('downloads'), `ManeFlow-Diagnostics-${stamp}.zip`),
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };

  if (process.platform === 'win32') {
    const command = `Compress-Archive -LiteralPath '${staging.replaceAll("'", "''")}\\*' -DestinationPath '${result.filePath.replaceAll("'", "''")}' -Force`;
    const zipped = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true });
    if (zipped.status !== 0) throw new Error('Could not create the diagnostics ZIP.');
  } else {
    spawnSync('zip', ['-qr', result.filePath, '.'], { cwd: staging });
  }
  return { saved: true, path: result.filePath };
}

ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:save', async (_event, incoming = {}) => {
  const current = readSecureSettings();
  const next = { ...current };
  for (const key of ['openaiApiKey', 'openaiVisionModel', 'psaApiKey', 'ebayClientId', 'ebayClientSecret', 'ebayUserAccessToken', 'ebayRefreshToken', 'ebayRedirectUriName', 'ebayMarketplaceId', 'ebayEnvironment', 'justTcgApiKey', 'sportsCardsProApiToken']) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      const value = String(incoming[key] ?? '').trim();
      if (value) next[key] = value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'ebayMarketplaceInsightsEnabled')) {
    next.ebayMarketplaceInsightsEnabled = Boolean(incoming.ebayMarketplaceInsightsEnabled);
  }
  for (const key of incoming.clear || []) delete next[key];
  writeSecureSettings(next);
  await startServices();
  if (mainWindow) await mainWindow.loadURL(runtime.coreBase);
  return publicSettings(next);
});

ipcMain.handle('ebay:oauth-open', async () => {
  const settings = readSecureSettings();
  const state = crypto.randomBytes(32).toString('base64url');
  pendingEbayOAuth = { state, expiresAt: Date.now() + 10 * 60_000 };
  const url = buildEbayConsentUrl(settings, state);
  await shell.openExternal(url);
  return { opened: true, expiresAt: pendingEbayOAuth.expiresAt };
});
ipcMain.handle('ebay:oauth-exchange', async (_event, callbackValue) => {
  const settings = readSecureSettings();
  const callback = parseEbayAuthorizationCallback(callbackValue);
  const pending = pendingEbayOAuth;
  pendingEbayOAuth = null;
  if (!pending) throw new Error('Start eBay authorization from ManeFlow before completing the connection.');
  if (pending.expiresAt <= Date.now()) throw new Error('The eBay authorization session expired. Start again.');
  if (!callback.code || !callback.state) throw new Error('Paste the complete eBay redirect URL so ManeFlow can validate the OAuth state.');
  if (!secureEqual(callback.state, pending.state)) throw new Error('The eBay OAuth state did not match. Connection was blocked.');
  const payload = await exchangeEbayAuthorizationCode(settings, callback.code);
  const next = {
    ...settings,
    ebayUserAccessToken: payload.access_token,
    ebayUserAccessTokenExpiresAt: Date.now() + Number(payload.expires_in || 7200) * 1000,
    ebayRefreshToken: payload.refresh_token || settings.ebayRefreshToken || '',
  };
  writeSecureSettings(next);
  await startServices();
  if (mainWindow) await mainWindow.loadURL(runtime.coreBase);
  return publicSettings(next);
});
ipcMain.handle('ebay:disconnect', async () => {
  const settings = readSecureSettings();
  for (const key of ['ebayUserAccessToken', 'ebayUserAccessTokenExpiresAt', 'ebayRefreshToken']) delete settings[key];
  writeSecureSettings(settings);
  await startServices();
  if (mainWindow) await mainWindow.loadURL(runtime.coreBase);
  return publicSettings(settings);
});

ipcMain.handle('psa:test', async (_event, certNumber) => {
  const cert = String(certNumber || '').replace(/\D/g, '');
  if (cert.length < 6) throw new Error('Enter a valid PSA certification number.');
  const response = await fetch(`${runtime.visionBase}/v1/psa/verify/${encodeURIComponent(cert)}`, { signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `PSA test failed with HTTP ${response.status}.`);
  return payload;
});

ipcMain.handle('services:status', () => status());
ipcMain.handle('services:restart', async () => {
  const started = await startServices();
  if (started.core?.ready && mainWindow) await mainWindow.loadURL(runtime.coreBase);
  return started;
});
ipcMain.handle('folder:select-ricoh', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Ricoh duplex scan folder',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('file:save', async (_event, { defaultName, data, encoding = 'utf8' } = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName || 'maneflow-export.txt' });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, data, encoding);
  return { saved: true, path: result.filePath };
});
ipcMain.handle('diagnostics:create', () => createDiagnosticsBundle());
ipcMain.handle('app:open-data', () => shell.openPath(dataDir()));
ipcMain.handle('app:open-logs', () => shell.openPath(logsDir()));
ipcMain.handle('app:version', () => app.getVersion());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    ensureDirectories();
    importLegacyEnvironmentCredentials();
    createWindow();
    const started = await startServices();
    if (started.core?.ready) await mainWindow.loadURL(runtime.coreBase);
    else await mainWindow.loadURL(offlinePage('The ManeFlow core service did not become ready.'));
  });
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', async () => {
    shuttingDown = true;
    await stopServices();
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    shuttingDown = true;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    try { coreProcess?.kill(); } catch {}
    try { visionProcess?.kill(); } catch {}
  });
}
