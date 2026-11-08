// Settings › General › Auto Answer › "Answer faster" (2026-11-08): the user can
// turn off the speculative prefetch (drafting the answer while the judge
// decides). Unset = on, the behaviour before the switch existed. The one place
// the engine is handed a prefetch is the host in main.ts, so the guard lives
// there and nowhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the host hands the engine a prefetch only while the switch is not off', () => {
  const main = read('electron/main.ts');
  const host = main.slice(main.indexOf('prefetchAnswer: (id, text) =>'), main.indexOf('warmQuery: (text) =>'));
  assert.match(host, /if \(SettingsManager\.getInstance\(\)\.get\('autoAnswerPrefetch'\) === false\) return;/);
  assert.match(host, /this\.intelligenceManager\.prefetchAutoAnswer\(id, text\);/);
  assert.equal((main.match(/prefetchAutoAnswer\(/g) || []).length, 1, 'no second, unguarded path');
});

test('unset reads as on, end to end', () => {
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /get\('autoAnswerPrefetch'\) !== false;/, 'get: unset → on');
  const ui = read('src/components/SettingsOverlay.tsx');
  assert.match(ui, /useState\(true\);/, 'the panel starts on before the read returns');
  assert.match(ui, /setAutoAnswerPrefetch\(v !== false\)/);
});
