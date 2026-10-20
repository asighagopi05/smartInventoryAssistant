// Starts the API server, the Vite client and the ML service together: `npm run dev`
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Stop a child AND everything it started. With shell: true the child is a
 * cmd.exe wrapper on Windows, so child.kill() ends only the wrapper and leaves
 * Vite, the API and uvicorn running as orphans that keep their ports.
 */
function stop(p) {
  if (p.exitCode !== null || !p.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    p.kill();
  }
}

const procs = [
  ['server', 'server'],
  ['client', 'client'],
].map(([name, dir]) => {
  const p = spawn(`npm --prefix ${dir} run dev`, { stdio: 'inherit', shell: true });
  p.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    procs.forEach((other) => other !== p && stop(other));
    process.exit(code ?? 0);
  });
  return p;
});

// The ML service is optional: the combo screen reads saved results, so if the
// venv is missing or Python stops, the rest of the app keeps running.
const venvPython = path.join(__dirname, 'ml', 'venv', 'Scripts', 'python.exe');
if (fs.existsSync(venvPython)) {
  const ml = spawn(`"${venvPython}" -m uvicorn main:app --port 8000`, {
    cwd: path.join(__dirname, 'ml'), stdio: 'inherit', shell: true,
  });
  ml.on('exit', (code) => console.log(`[ml] exited with code ${code}; saved combos still work`));
  procs.push(ml);
} else {
  console.log('[ml] ml/venv not found, skipping the ML service (see ml/README.md)');
}

process.on('SIGINT', () => procs.forEach(stop));
