import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const walk = (p) => readdirSync(p, { withFileTypes: true }).flatMap((e) => {
  const next = path.join(p, e.name);
  return e.isDirectory() ? walk(next) : e.isFile() && /\.(m?js)$/.test(e.name) ? [next] : [];
});
const files = [...walk('src'), ...walk('public/assets/js'), ...walk('tests'), 'scripts/check-syntax.mjs'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Синтаксис проверен: ${files.length} файлов`);
