// Starts the API server and the Vite client together: `npm run dev`
const { spawn } = require('child_process');

const procs = [
  ['server', 'server'],
  ['client', 'client'],
].map(([name, dir]) => {
  const p = spawn(`npm --prefix ${dir} run dev`, { stdio: 'inherit', shell: true });
  p.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    procs.forEach((other) => other !== p && other.kill());
    process.exit(code ?? 0);
  });
  return p;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill()));
