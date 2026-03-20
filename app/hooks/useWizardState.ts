import { useState } from "react";
import { EMPTY_WIZARD_STATE } from "../types/post.js";
import type { WizardState, Platform, PlatformOverride } from "../types/post.js";

export const WIZARD_STEPS = [
  "Schedule",
  "Brand",
  "Post Type",
  "Platforms",
  "Content",
  "Adjust",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export function useWizardState(initial?: Partial<WizardState>) {
  const [state, setState] = useState<WizardState>({ ...EMPTY_WIZARD_STATE, ...initial });
  const [step, setStep] = useState(0);

  function canAdvance(): boolean {
    switch (step) {
      case 0: return state.scheduledAt !== null;
      case 1: return state.brandId !== null;
      case 2: return state.postType !== null;
      case 3: return state.platforms.length > 0;
      case 4: return state.mainContent.trim().length > 0;
      default: return true;
    }
  }

  function next() {
    if (canAdvance() && step < WIZARD_STEPS.length - 1) setStep((s) => s + 1);
  }

  function back() {
    if (step > 0) setStep((s) => s - 1);
  }

  function setPlatformOverride(platform: Platform, override: PlatformOverride) {
    setState((prev) => ({
      ...prev,
      platformOverrides: { ...prev.platformOverrides, [platform]: override },
    }));
  }

  return { state, setState, step, setStep, next, back, canAdvance, setPlatformOverride };
}
