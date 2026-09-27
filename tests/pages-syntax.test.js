// Every browser module must parse: a syntax error in a page otherwise surfaces only in the Vercel build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const files = ['src/pages', 'src/ui', 'src/lib'].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => path.join(d, f)));
test('all page/ui/lib modules parse', () => {
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
  }
});
