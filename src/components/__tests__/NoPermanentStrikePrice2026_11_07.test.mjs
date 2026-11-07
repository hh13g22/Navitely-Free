// A struck "was" price is shown only during a named sale (lib/lifetimeSale.mjs:
// yearly $39, lifetime $79). API Pro has only ever charged $15, so a struck
// $20 next to it, shown all year, read as a discount that never existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('the Natively API plans carry no fixed struck price', () => {
  assert.doesNotMatch(read('src/components/settings/NativelyApiSettings.tsx'), /\bwasPrice\s*:/);
});

// Local build: the in-panel plans page is gone (replaced by "Your Context"),
// so there is no struck price anywhere on it — the strongest form of the rule.
test('the in-panel plans page carries no struck price at all', () => {
  const rel = 'src/components/upgrade/UnlockProPlans.tsx';
  if (!fs.existsSync(path.join(REPO, rel))) return;
  const wases = [...read(rel).matchAll(/\bwas:\s*([^,\n]+)/g)].map((m) => m[1].trim()).filter((w) => !/^string\b/.test(w));
  assert.equal(wases.length, 0);
});
