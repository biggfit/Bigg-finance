// Wrapper: runs bigg-accounting vite dev server
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const accountingDir = resolve(__dirname, '../bigg-accounting');
const vite = resolve(accountingDir, 'node_modules/vite/bin/vite.js');

const child = spawn('node', [vite], {
  cwd: accountingDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
  windowsHide: true,
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on('exit', code => process.exit(code ?? 0));
