import { spawnSync } from 'child_process';
import path from 'path';

const isWin = process.platform === 'win32';
const py = isWin ? path.join('.venv', 'Scripts', 'python.exe') : path.join('.venv', 'bin', 'python');
const res = spawnSync(py, ['scripts/sync_r2.py'], { stdio: 'inherit' });
if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
