// src/components/upgrade/UnlockProPlans.tsx
//
// This used to be the "Unlock Pro" pricing page (Pro Pack / API Pro / Pro
// Yearly). In this local build the app drives the user's OWN Claude Code CLI,
// so there is nothing to sell: the component now renders the "Your Context"
// panel (ClaudeContextPanel) in the same spot — the user's résumé / job / bio,
// fed to their own Claude. The prop shape is kept so every caller (PlansToaster,
// ProfileIntelligenceSettings) compiles unchanged; the sales-only props
// (onCheckoutOpened, onHaveLicense) are accepted and ignored.
//
// The previous pricing implementation is in git history (before this commit) if
// it is ever wanted back.
import React from 'react';
import { ClaudeContextPanel } from './ClaudeContextPanel';

type Surface = 'plans_card' | 'profile_intelligence' | 'modes_settings' | string;

interface Props {
  surface?: Surface;
  onBack?: () => void;
  onClose?: () => void;
  dismiss?: { label: string; onClick: () => void };
  onCheckoutOpened?: (tierId: string) => void;
  onHaveLicense?: () => void;
  subtitle?: string;
  theme: 'light' | 'dark';
}

export function UnlockProPlans({ onBack, onClose, dismiss, subtitle, theme }: Props) {
  return (
    <ClaudeContextPanel
      theme={theme}
      onBack={onBack}
      onClose={onClose}
      dismiss={dismiss}
      subtitle={subtitle}
    />
  );
}

export default UnlockProPlans;
