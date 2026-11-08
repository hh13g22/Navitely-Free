// src/components/upgrade/UnlockProPlans.tsx
//
// This used to be the "Unlock Pro" pricing page (Pro Pack / API Pro / Pro
// Yearly). In this local build the app drives the user's OWN Claude Code CLI,
// so there is nothing to sell: the component now renders "My Profile"
// (profile/MyProfilePanel — attach a CV / cover letter, a few fields) in the
// same spot. The prop shape is kept so every caller compiles unchanged; the
// sales-only props are accepted and ignored.
//
// The previous pricing implementation is in git history if it is ever wanted back.
import React from 'react';
import { MyProfilePanel } from '../profile/MyProfilePanel';

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

export function UnlockProPlans({ onBack, onClose, dismiss }: Props) {
  return <MyProfilePanel onClose={onClose ?? dismiss?.onClick ?? onBack} />;
}

export default UnlockProPlans;
