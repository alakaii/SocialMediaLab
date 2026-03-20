import { BlockStack, Button, InlineStack, ProgressBar, Text, Divider, Box } from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import { useWizardState, WIZARD_STEPS } from "../../hooks/useWizardState.js";
import type { WizardState } from "../../types/post.js";
import { Platform } from "../../types/post.js";

import { StepSchedule } from "./StepSchedule.js";
import { StepBrand } from "./StepBrand.js";
import { StepPostType } from "./StepPostType.js";
import { StepPlatforms } from "./StepPlatforms.js";
import { StepContent } from "./StepContent.js";
import { StepPlatformAdjust } from "./StepPlatformAdjust.js";

interface Brand {
  id: string;
  name: string;
  logoUrl?: string | null;
  timezone: string;
  connectedPlatforms: Platform[];
}

interface PostWizardProps {
  brands: Brand[];
  initial?: Partial<WizardState>;
}

export function PostWizard({ brands, initial }: PostWizardProps) {
  const { state, setState, step, next, back, canAdvance, setPlatformOverride } = useWizardState(initial);
  const fetcher = useFetcher();

  const progressPct = ((step + 1) / WIZARD_STEPS.length) * 100;

  const selectedBrand = brands.find((b) => b.id === state.brandId);
  const connectedPlatforms = selectedBrand?.connectedPlatforms ?? [];

  function submit(intent: "save-draft" | "schedule") {
    const formData = new FormData();
    formData.set("_intent", intent);
    formData.set("state", JSON.stringify(state));
    fetcher.submit(formData, { method: "POST" });
  }

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <StepSchedule
            scheduledAt={state.scheduledAt}
            onChange={(scheduledAt) => setState((s) => ({ ...s, scheduledAt }))}
          />
        );
      case 1:
        return (
          <StepBrand
            brands={brands.map((b) => ({ ...b, connectedPlatforms: b.connectedPlatforms }))}
            selectedId={state.brandId}
            onChange={(brandId) => setState((s) => ({ ...s, brandId, platforms: [] }))}
          />
        );
      case 2:
        return (
          <StepPostType
            selected={state.postType}
            onChange={(postType) => setState((s) => ({ ...s, postType, platforms: [] }))}
          />
        );
      case 3:
        return (
          <StepPlatforms
            postType={state.postType!}
            connectedPlatforms={connectedPlatforms}
            selected={state.platforms}
            onChange={(platforms) => setState((s) => ({ ...s, platforms }))}
          />
        );
      case 4:
        return (
          <StepContent
            postType={state.postType!}
            mainContent={state.mainContent}
            mediaAssets={state.mediaAssets}
            onContentChange={(mainContent) => setState((s) => ({ ...s, mainContent }))}
            onMediaChange={(mediaAssets) => setState((s) => ({ ...s, mediaAssets }))}
          />
        );
      case 5:
        return (
          <StepPlatformAdjust
            platforms={state.platforms}
            mainContent={state.mainContent}
            mediaAssets={state.mediaAssets}
            overrides={state.platformOverrides}
            onOverrideChange={setPlatformOverride}
          />
        );
      default:
        return null;
    }
  }

  return (
    <BlockStack gap="500">
      {/* Step indicator */}
      <BlockStack gap="200">
        <InlineStack align="space-between">
          <Text as="p" variant="bodySm" tone="subdued">
            Step {step + 1} of {WIZARD_STEPS.length}
          </Text>
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {WIZARD_STEPS[step]}
          </Text>
        </InlineStack>
        <ProgressBar progress={progressPct} size="small" tone="highlight" />
      </BlockStack>

      {/* Step content */}
      {renderStep()}

      <Divider />

      {/* Navigation */}
      <InlineStack align="space-between">
        <Button onClick={back} disabled={step === 0}>Back</Button>

        <InlineStack gap="300">
          {step === WIZARD_STEPS.length - 1 ? (
            <>
              <Button
                onClick={() => submit("save-draft")}
                loading={fetcher.state === "submitting"}
              >
                Save Draft
              </Button>
              <Button
                variant="primary"
                onClick={() => submit("schedule")}
                loading={fetcher.state === "submitting"}
                disabled={!state.scheduledAt}
              >
                Schedule Post
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={next}
              disabled={!canAdvance()}
            >
              Continue
            </Button>
          )}
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}
