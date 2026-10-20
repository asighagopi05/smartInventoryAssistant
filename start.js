// Runs the app for real use on the shop network: `npm start`
// Builds the screens, then starts the API (which serves them) and the ML service.
// For development with auto-reload, use `npm run dev` instead.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || '5000';

/** Same as dev.js: on Windows kill the whole tree, not just the cmd.exe wrapper. */
function stop(p) {
  if (p.exitCode !== null || !p.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    p.kill();
  }
}

/**
 * This PC's address on the Wi-Fi. Phones open the app and the QR codes at it.
 * Private ranges are preferred so a VPN or virtual adapter does not win.
 */
function lanAddress() {
  const all = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal);
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return (all.find((a) => isPrivate(a.address)) || all[0] || {}).address;
}

// 1. Build the screens. VITE_API_URL=/api because the API serves them from the same origin.
console.log('[build] building the screens...');
// cwd is pinned so `node path/to/start.js` from any folder runs THIS copy, not one in the current folder.
const build = spawnSync('npm --prefix client run build', {
  cwd: __dirname, stdio: 'inherit', shell: true, env: { ...process.env, VITE_API_URL: '/api' },
});
if (build.status !== 0) {
  console.error('[build] the client build failed; nothing was started');
  process.exit(build.status || 1);
}

// 2. The QR codes must encode an address a phone can reach. SIA_PUBLIC_URL overrides it.
const ip = lanAddress();
const publicUrl = process.env.SIA_PUBLIC_URL || `http://${ip || 'localhost'}:${PORT}`;
if (!ip) console.log('[start] no network address found; QR codes will only work on this PC');

// Variables set here win over server/.env (dotenv never overrides).
const env = { ...process.env, NODE_ENV: 'production', PORT, PUBLIC_BASE_URL: publicUrl };

const procs = [];
const api = spawn('npm --prefix server start', { cwd: __dirname, stdio: 'inherit', shell: true, env });
api.on('exit', (code) => {
  console.log(`[api] exited with code ${code}`);
  procs.forEach((p) => p !== api && stop(p));
  process.exit(code ?? 0);
});
procs.push(api);

// 3. The ML service is optional, as in dev.js: saved results still show without it.
const venvPython = path.join(__dirname, 'ml', 'venv', 'Scripts', 'python.exe');
if (fs.existsSync(venvPython)) {
  const ml = spawn(`"${venvPython}" -m uvicorn main:app --host 127.0.0.1 --port 8000`, {
    cwd: path.join(__dirname, 'ml'), stdio: 'inherit', shell: true,
  });
  ml.on('exit', (code) => console.log(`[ml] exited with code ${code}; saved combos still work`));
  procs.push(ml);
} else {
  console.log('[ml] ml/venv not found, skipping the ML service (see ml/README.md)');
}

console.log(`\n  Smart Inventory Assistant`);
console.log(`  On this PC:          http://localhost:${PORT}`);
console.log(`  On the shop network: ${publicUrl}\n`);

process.on('SIGINT', () => procs.forEach(stop));
