// 2026-10-02: "Won set 1 <0x1A> won match" looked like corrupt frozen Match DNA evidence. Root cause: scripts/db/run_sql.ps1
// wrote query results through the legacy console codepage when piped, turning U+2192 (→) into 0x1A (SUB). The database
// was clean (0 packets / 0 snapshots with any control byte). These tests keep every layer honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CTL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

test('run_sql.ps1 writes UTF-8 (a piped stdout must never re-encode non-ASCII as 0x1A)', () => {
  const s = fs.readFileSync(new URL('../scripts/db/run_sql.ps1', import.meta.url), 'utf8');
  assert.match(s, /\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(s, /\$OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
});

test('Match DNA metric labels: legitimate Unicode kept (→), no ASCII control bytes', async () => {
  const src = fs.readFileSync(new URL('../workers/shared/dna/match-dna.js', import.meta.url), 'utf8');
  assert.ok(src.includes("label: 'Won set 1 → won match'"), 'the arrow is real Unicode at the source');
  assert.doesNotMatch(src, CTL);
});

test('committed fixtures carry no control bytes and no hand-made <0x..> markers', () => {
  const root = new URL('./fixtures/', import.meta.url);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(root.pathname.replace(/^\/([A-Za-z]:)/, '$1')).filter((f) => /\.(json|html|txt)$/.test(f));
  assert.ok(files.length > 10);
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /<0x[0-9a-f]{2}>/i, `${f} carries a control-byte marker`);
    if (/\.json$/.test(f)) assert.doesNotMatch(s, CTL, `${f} carries a raw control byte`);
  }
  const munar = fs.readFileSync(new URL('./fixtures/news/munar-fritz-tokyo-2026-packet.json', import.meta.url), 'utf8');
  assert.ok(munar.includes('Won set 1 → won match'));
});
