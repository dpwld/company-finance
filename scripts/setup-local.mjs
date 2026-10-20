import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error('Node.js 22.13 or newer is required.');
if (!existsSync('node_modules/vinext')) throw new Error('Install dependencies first with npm ci.');
for (const script of ['build', 'db:migrate']) {
  console.log(`\nPreparing local workspace: ${script}`);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nLocal database is ready. Existing records were preserved; no sample data was inserted.\nRun npm run dev, then open the printed loopback URL.');
