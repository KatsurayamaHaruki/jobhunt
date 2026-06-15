// 依存ゼロの環境ロード。.env.local を素朴にパースする（dotenv を増やさない）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');

(function loadEnv() {
  let txt = '';
  try { txt = readFileSync(join(ROOT, '.env.local'), 'utf8'); } catch { /* なくてもよい */ }
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

export const PROFILE_PATH = process.env.PROFILE_PATH || join(ROOT, '..', 'profile-daicho.md');
export const env = (k) => process.env[k];
