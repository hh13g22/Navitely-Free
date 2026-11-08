// Hover labels for icon-only controls (src/lib/hoverLabels.ts): which controls
// get one, where it goes, and that it can never become a native tooltip or
// show while undetectable. UI audit 2026-11-08: ~100 icon controls carried an
// aria-label but showed nothing on hover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hoverLabelFor, placeLabel } from '../hoverLabels.ts';

const el = (attrs = {}, insideTtWrap = false) => ({
  getAttribute: (n) => (n in attrs ? attrs[n] : null),
  closest: (sel) => (sel === '.t-tt-wrap' && insideTtWrap ? {} : null),
});

test('an icon-only control shows its accessible name', () => {
  assert.equal(hoverLabelFor(el({ 'aria-label': 'Quick settings' }), ''), 'Quick settings');
  assert.equal(hoverLabelFor(el({ 'aria-label': '  Close  ' }), '\n'), 'Close');
});

test('the guard-stashed title names a control whose title was stripped', () => {
  assert.equal(hoverLabelFor(el({ title: '', 'data-native-title': 'Hide' }), ''), 'Hide');
});

test('controls that already explain themselves get nothing', () => {
  assert.equal(hoverLabelFor(el({ 'aria-label': 'Clarify' }), 'Clarify'), null, 'visible text');
  assert.equal(hoverLabelFor(el({ 'aria-label': 'Settings', title: 'Settings' }), ''), null, 'a live native title');
  assert.equal(hoverLabelFor(el({ 'aria-label': 'Refresh' }, true), ''), null, 'its own .t-tt tooltip');
  assert.equal(hoverLabelFor(el({}), ''), null, 'nothing to say');
  assert.equal(hoverLabelFor(null, ''), null);
});

test('placed below and centred; flipped above near the bottom; kept inside the view', () => {
  const view = { width: 400, height: 120 };
  const tip = { width: 80, height: 18 };
  assert.deepEqual(placeLabel({ left: 100, top: 10, right: 130, bottom: 40 }, tip, view), { left: 75, top: 46, side: 'below' });
  // Near the bottom of a short overlay window: above.
  const up = placeLabel({ left: 100, top: 90, right: 130, bottom: 110 }, tip, view);
  assert.equal(up.side, 'above');
  assert.equal(up.top, 90 - 6 - 18);
  // At the right edge: clamped so the label stays visible.
  assert.equal(placeLabel({ left: 380, top: 10, right: 398, bottom: 30 }, tip, view).left, 400 - 80 - 4);
  assert.equal(placeLabel({ left: 0, top: 10, right: 10, bottom: 30 }, tip, view).left, 4);
});

test('stealth: drawn in the DOM, never as a title, and hidden while undetectable', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const src = fs.readFileSync(path.join(root, 'src/lib/hoverLabels.ts'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /setAttribute\(\s*['"]title['"]/, 'never writes a native title (OS tooltips leak into screen shares)');
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.match(css, /html\[data-tooltips='off'\] \.hover-label \{\s*display: none !important;/);
  const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
  assert.ok(main.indexOf('wireStealthTooltips(') < main.indexOf('installHoverLabels(document)'), 'installed after the stealth wiring');
});
