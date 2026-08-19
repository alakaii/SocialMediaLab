import { useEffect, useMemo, useState } from "react";
import { Banner, BlockStack, Button, InlineStack, ProgressBar, Text, Divider } from "@shopify/polaris";
import { SaveBar } from "@shopify/app-bridge-react";
import { useFetcher } from "@remix-run/react";
import { useWizardState, WIZARD_STEPS } from "../../hooks/useWizardState.js";
import type { WizardState, PostType } from "../../types/post.js";
import { EMPTY_WIZARD_STATE, Platform } from "../../types/post.js";
import {
  getPlatformsForPostType,
  PLATFORM_CONSTRAINTS,
} from "../../utils/platformConstraints.js";

import { StepSchedule } from "./StepSchedule.js";
import { StepBrand } from "./StepBrand.js";
import { StepPostType } from "./StepPostType.js";
import { StepPlatforms } from "./StepPlatforms.js";
import { StepContent } from "./StepContent.js";
import { StepPlatformAdjust } from "./StepPlatformAdjust.js";

export interface WizardAccount {
  id: string;
  platform: Platform;
  accountName: string | null;
}

interface Brand {
  id: string;
  name: string;
  logoUrl?: string | null;
  timezone: string;
  accounts: WizardAccount[];
}

interface PostWizardProps {
  brands: Brand[];
  shop: string;
  /**
   * Read from the environment by the route loader rather than bundled at build
   * time, so the key can be set (or rotated) without a rebuild. Null when it is
   * not configured, which disables the Dropbox option in the content step.
   */
  dropboxAppKey?: string | null;
  initial?: Partial<WizardState>;
  /**
   * Renders a contextual save bar for pages that edit an existing post. The
   * wizard submits programmatically and has no <form> element, so App Bridge's
   * data-save-bar attribute has nothing to hook into and the bar is driven from
   * the wizard's own dirty state instead. `intent` is the action the Save button
   * submits, so a scheduled post stays scheduled and a draft stays a draft.
   * Left unset on the create flow, where each step has its own explicit action.
   */
  saveBar?: { id: string; intent: "save-draft" | "schedule" };
}

export function PostWizard({ brands, shop, dropboxAppKey = null, initial, saveBar }: PostWizardProps) {
  const { state, setState, step, next, back, canAdvance, setPlatformOverride } = useWizardState(initial);
  const fetcher = useFetcher<{ error?: string }>();

  // The state as it was loaded. Kept in a lazy initializer so it is captured
  // once, giving the save bar a stable baseline for dirty state and the exact
  // values to restore when the merchant discards.
  const [initialState] = useState<WizardState>(() => ({ ...EMPTY_WIZARD_STATE, ...initial }));
  const dirty =
    saveBar != null && JSON.stringify(state) !== JSON.stringify(initialState);

  const progressPct = ((step + 1) / WIZARD_STEPS.length) * 100;

  const selectedBrand = brands.find((b) => b.id === state.brandId);
  const brandAccounts = selectedBrand?.accounts ?? [];

  // Every account across brands, so account ids in the wizard state can be
  // mapped back to their platform (for the adjust step and derived selections).
  const accountsById = useMemo(() => {
    const map = new Map<string, WizardAccount>();
    for (const b of brands) for (const a of b.accounts) map.set(a.id, a);
    return map;
  }, [brands]);

  // Distinct platforms this post targets: platforms of the selected accounts
  // plus the selected manual platforms. Drives the per-platform adjust step.
  const selectedPlatforms = useMemo(() => {
    const set = new Set<Platform>();
    for (const id of state.selectedAccountIds) {
      const acct = accountsById.get(id);
      if (acct) set.add(acct.platform);
    }
    for (const p of state.manualPlatforms) set.add(p);
    return [...set];
  }, [state.selectedAccountIds, state.manualPlatforms, accountsById]);

  // Names of the selected accounts per platform, so the review step can name the
  // profile a preview stands for (and flag when an override covers several).
  const accountNamesByPlatform = useMemo(() => {
    const map: Partial<Record<Platform, string[]>> = {};
    for (const id of state.selectedAccountIds) {
      const acct = accountsById.get(id);
      if (!acct) continue;
      const names = map[acct.platform] ?? [];
      names.push(acct.accountName ?? PLATFORM_CONSTRAINTS[acct.platform].label);
      map[acct.platform] = names;
    }
    return map;
  }, [state.selectedAccountIds, accountsById]);

  // Accounts to pre-check when a brand or post type changes: every account of
  // the chosen brand whose platform is compatible with the chosen post type.
  function preCheckedAccountIds(brandId: string | null, postType: PostType | null): string[] {
    const brand = brands.find((b) => b.id === brandId);
    if (!brand || !postType) return [];
    const compatible = new Set(getPlatformsForPostType(postType));
    return brand.accounts.filter((a) => compatible.has(a.platform)).map((a) => a.id);
  }

  const submitting = fetcher.state !== "idle";
  const actionError = fetcher.data?.error;

  // fetcher.data is immutable, so dismissal lives here. Every new response is a
  // fresh object, which un-dismisses the banner for the next failure.
  const [errorDismissed, setErrorDismissed] = useState(false);
  useEffect(() => setErrorDismissed(false), [fetcher.data]);

  function submit(intent: "save-draft" | "schedule" | "publish-now") {
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
            brands={brands}
            selectedId={state.brandId}
            onChange={(brandId) =>
              setState((s) => ({
                ...s,
                brandId,
                // Pre-check the new brand's compatible accounts; drop manual
                // selections so they are re-confirmed against the brand context.
                selectedAccountIds: preCheckedAccountIds(brandId, s.postType),
                manualPlatforms: [],
              }))
            }
          />
        );
      case 2:
        return (
          <StepPostType
            selected={state.postType}
            onChange={(postType) =>
              setState((s) => ({
                ...s,
                postType,
                // Post type changes compatibility, so re-derive selections.
                selectedAccountIds: preCheckedAccountIds(s.brandId, postType),
                manualPlatforms: [],
              }))
            }
          />
        );
      case 3:
        return (
          <StepPlatforms
            postType={state.postType!}
            accounts={brandAccounts}
            selectedAccountIds={state.selectedAccountIds}
            manualPlatforms={state.manualPlatforms}
            onAccountsChange={(selectedAccountIds) => setState((s) => ({ ...s, selectedAccountIds }))}
            onManualChange={(manualPlatforms) => setState((s) => ({ ...s, manualPlatforms }))}
          />
        );
      case 4:
        return (
          <StepContent
            postType={state.postType!}
            mainContent={state.mainContent}
            mediaAssets={state.mediaAssets}
            product={state.product}
            shop={shop}
            dropboxAppKey={dropboxAppKey}
            onContentChange={(mainContent) => setState((s) => ({ ...s, mainContent }))}
            onMediaChange={(mediaAssets) => setState((s) => ({ ...s, mediaAssets }))}
            onProductChange={(product) => setState((s) => ({ ...s, product }))}
          />
        );
      case 5:
        return (
          <StepPlatformAdjust
            platforms={selectedPlatforms}
            mainContent={state.mainContent}
            mediaAssets={state.mediaAssets}
            overrides={state.platformOverrides}
            onOverrideChange={setPlatformOverride}
            brandName={selectedBrand?.name ?? "Your brand"}
            brandLogoUrl={selectedBrand?.logoUrl}
            accountNamesByPlatform={accountNamesByPlatform}
            product={state.product}
          />
        );
      default:
        return null;
    }
  }

  return (
    <BlockStack gap="500">
      {saveBar && (
        <SaveBar id={saveBar.id} open={dirty}>
          <button
            variant="primary"
            loading={submitting || undefined}
            onClick={() => submit(saveBar.intent)}
          >
            Save
          </button>
          <button onClick={() => setState(initialState)}>Discard</button>
        </SaveBar>
      )}

      {actionError && !errorDismissed && (
        <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>
          {actionError}
        </Banner>
      )}

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
                loading={submitting}
              >
                Save draft
              </Button>
              <Button
                variant="primary"
                onClick={() => submit("publish-now")}
                loading={submitting}
              >
                Publish now
              </Button>
              <Button
                variant="primary"
                onClick={() => submit("schedule")}
                loading={submitting}
                disabled={!state.scheduledAt}
              >
                Schedule post
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
