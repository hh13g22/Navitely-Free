// The Natively Plans card after getting started shows the Unlock Pro plans
// page (Pro Pack, API Pro, Pro Yearly), the same offers as the Modes and
// Profile Intelligence paywalls, not a second copy of the plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('the startup Plans card renders the Unlock Pro page', () => {
  const card = read('src/components/onboarding/PlansToaster.tsx');
  assert.match(card, /import \{ UnlockProPlans \} from '\.\.\/upgrade\/UnlockProPlans'/);
  assert.match(card, /<UnlockProPlans[\s\S]*surface="plans_card"/, 'checkouts keep the plans_card funnel surface');
  assert.match(card, /label: 'Continue for free'/, 'a quiet way out, no close button');
  assert.match(card, /onCheckoutOpened=\{handleCheckoutOpened\}/, "an opened checkout closes the card as 'acted'");
  assert.doesNotMatch(card, /NativelyApiSettings/, 'no second copy of the API plans');
});

// Local build: the startup plans popup is disabled. The host keeps the card's
// slot in the scheduler (pacing unchanged) but renders nothing for it and
// retires it at once, so no pricing popup appears on launch.
test('the host does not render the plans popup; it retires the slot', () => {
  const host = read('src/components/onboarding/OrchestratedToasterHost.tsx');
  assert.doesNotMatch(host, /<PlansToaster/, 'no plans popup is rendered');
  assert.match(host, /case 'plans':[\s\S]*<SelfDismiss onMount=\{\(\) => closeWith\('plans'\)\(\)\}/, 'the plans slot self-dismisses');
});
