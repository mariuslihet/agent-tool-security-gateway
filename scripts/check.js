import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
let count = 0;
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'var') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (path.endsWith('.js')) {
      const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });
      assert.equal(check.status, 0, check.stderr); count++;
    } else if (path.endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'));
  }
}
visit('.'); console.log(`Syntax and JSON checks passed (${count} JavaScript files).`);
