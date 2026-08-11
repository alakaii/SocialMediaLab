import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  InlineStack,
  Spinner,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import type { WizardMediaAsset } from "../../types/post.js";
import {
  CLOUD_IMPORT_MAX_FILES,
  CLOUD_MEDIA_EXTENSIONS,
  CLOUD_PROVIDERS,
} from "../../utils/cloudProviders.js";
import type {
  CloudImportRequestFile,
  CloudImportResponse,
  CloudProvider,
} from "../../utils/cloudProviders.js";

/**
 * Lets the merchant pull post media out of a cloud drive.
 *
 * Dropbox uses its client-side Chooser: the merchant picks in Dropbox's own
 * popup, and the browser gets back temporary direct links. Those links are
 * posted straight to /api/cloud-import, which copies the bytes into Shopify
 * Files and hands back the same permanent CDN URL an upload produces, so a
 * MediaAsset never points at Dropbox.
 *
 * The other providers are listed from CLOUD_PROVIDERS as disabled "Coming soon"
 * buttons; adding one later is an entry there plus a branch in openPicker.
 */

interface DropboxChooserFile {
  link: string;
  name: string;
  bytes: number;
  isDir: boolean;
}

interface DropboxChooserOptions {
  success: (files: DropboxChooserFile[]) => void;
  cancel?: () => void;
  linkType?: "preview" | "direct";
  multiselect?: boolean;
  extensions?: string[];
  folderselect?: boolean;
  sizeLimit?: number;
}

interface DropboxChooser {
  choose: (options: DropboxChooserOptions) => void;
  isBrowserSupported?: () => boolean;
}

declare global {
  interface Window {
    Dropbox?: DropboxChooser;
  }
}

const DROPINS_SRC = "https://www.dropbox.com/static/api/2/dropins.js";
// Dropbox's drop-ins require this exact id alongside the data-app-key attribute.
const DROPINS_SCRIPT_ID = "dropboxjs";

// Module-level so the script is injected once per page no matter how often the
// merchant flips between media tabs.
let dropinsPromise: Promise<void> | null = null;

function loadDropins(appKey: string): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (window.Dropbox) return Promise.resolve();
  if (dropinsPromise) return dropinsPromise;

  dropinsPromise = new Promise<void>((resolve, reject) => {
    const fail = () => {
      // Let a later attempt retry rather than caching the failure forever.
      dropinsPromise = null;
      reject(new Error("Dropbox could not be loaded."));
    };

    const existing = document.getElementById(DROPINS_SCRIPT_ID);
    if (existing) {
      if (window.Dropbox) {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", fail, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.id = DROPINS_SCRIPT_ID;
    script.src = DROPINS_SRC;
    script.async = true;
    script.setAttribute("data-app-key", appKey);
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", fail, { once: true });
    document.head.appendChild(script);
  });

  return dropinsPromise;
}

interface CloudMediaPickerProps {
  assets: WizardMediaAsset[];
  onChange: (assets: WizardMediaAsset[]) => void;
  maxFiles: number;
  /**
   * Passed down from the route loader. Null when DROPBOX_APP_KEY is not set on
   * the server, which disables the Dropbox button.
   */
  dropboxAppKey: string | null;
  /** File extensions the picker offers, narrowed to the post type. */
  extensions?: string[];
}

export function CloudMediaPicker({
  assets,
  onChange,
  maxFiles,
  dropboxAppKey,
  extensions = CLOUD_MEDIA_EXTENSIONS,
}: CloudMediaPickerProps) {
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [dropboxReady, setDropboxReady] = useState(false);
  const [dropboxFailed, setDropboxFailed] = useState(false);

  // The import runs outside React's render cycle, so read the current assets
  // from a ref instead of a captured prop.
  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  // Loaded when the merchant opens this tab, not when the app boots. Waiting
  // until the click would mean calling choose() after an await, which browsers
  // treat as a popup rather than a user gesture, so the button stays disabled
  // until the script is in.
  useEffect(() => {
    if (!dropboxAppKey) return;
    let cancelled = false;
    loadDropins(dropboxAppKey)
      .then(() => {
        if (!cancelled) setDropboxReady(true);
      })
      .catch(() => {
        if (!cancelled) setDropboxFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dropboxAppKey]);

  const atLimit = assets.length >= maxFiles;

  const importFiles = useCallback(
    async (picked: CloudImportRequestFile[]) => {
      const problems: string[] = [];
      const room = Math.max(0, maxFiles - assetsRef.current.length);

      if (room === 0) {
        setErrors(["You have reached the media limit for this post."]);
        return;
      }

      let queue = picked;
      if (queue.length > room) {
        problems.push(
          `Only ${maxFiles} ${maxFiles === 1 ? "file fits" : "files fit"} in this post, so ${queue.length - room} of the files you picked were skipped.`,
        );
        queue = queue.slice(0, room);
      }
      if (queue.length > CLOUD_IMPORT_MAX_FILES) {
        problems.push(
          `Up to ${CLOUD_IMPORT_MAX_FILES} files can be imported at once, so the rest were skipped.`,
        );
        queue = queue.slice(0, CLOUD_IMPORT_MAX_FILES);
      }

      setErrors(problems);
      setImporting(true);

      try {
        const response = await fetch("/api/cloud-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(queue),
        });
        const data = (await response
          .json()
          .catch(() => ({}))) as CloudImportResponse;

        if (!response.ok || !data.results) {
          setErrors([
            ...problems,
            data.error ?? "Those files could not be imported. Please try again.",
          ]);
          return;
        }

        let next = assetsRef.current;
        for (const result of data.results) {
          if (result.ok) {
            next = [
              ...next,
              {
                id: crypto.randomUUID(),
                url: result.url,
                mimeType: result.mimeType,
                width: result.width,
                height: result.height,
                sizeBytes: result.sizeBytes,
              },
            ];
          } else {
            problems.push(`${result.name}: ${result.error}`);
          }
        }

        if (next !== assetsRef.current) onChange(next);
        setErrors(problems);
      } catch {
        setErrors([
          ...problems,
          "The import did not finish. Please check your connection and try again.",
        ]);
      } finally {
        setImporting(false);
      }
    },
    [maxFiles, onChange],
  );

  // Called straight from the click handler so Dropbox's popup keeps the user
  // gesture that lets it open.
  function openDropbox() {
    const chooser = window.Dropbox;
    if (!chooser) {
      setErrors(["Dropbox is still loading. Please try again in a moment."]);
      return;
    }
    chooser.choose({
      linkType: "direct",
      multiselect: true,
      extensions,
      success: (files) => {
        void importFiles(
          files
            .filter((file) => !file.isDir)
            .map((file) => ({ url: file.link, name: file.name })),
        );
      },
      cancel: () => {
        // Nothing to do; the merchant closed the picker.
      },
    });
  }

  function providerState(provider: CloudProvider): {
    disabled: boolean;
    onClick?: () => void;
    note?: string;
  } {
    if (!provider.enabled) return { disabled: true };
    if (provider.id !== "dropbox") return { disabled: true };
    if (!dropboxAppKey) {
      return { disabled: true, note: "Ask your administrator to configure Dropbox" };
    }
    if (dropboxFailed) {
      return {
        disabled: true,
        note: "Dropbox could not be reached. Check your connection and reload the page.",
      };
    }
    if (!dropboxReady) return { disabled: true, note: "Loading Dropbox..." };
    return { disabled: importing || atLimit, onClick: openDropbox };
  }

  return (
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" tone="subdued">
        {atLimit
          ? "You have reached the media limit for this post type."
          : "Pick files from a cloud drive. They are copied into your store's files, so the post keeps working after the link expires."}
      </Text>

      {errors.length > 0 && (
        <Banner
          tone="critical"
          title="Some files were not added"
          onDismiss={() => setErrors([])}
        >
          <BlockStack gap="100">
            {errors.map((message, index) => (
              <Text as="p" key={`${index}-${message}`}>
                {message}
              </Text>
            ))}
          </BlockStack>
        </Banner>
      )}

      <InlineStack gap="300" wrap blockAlign="start">
        {CLOUD_PROVIDERS.map((provider) => {
          const state = providerState(provider);
          return (
            <BlockStack key={provider.id} gap="100" inlineAlign="center">
              <Button disabled={state.disabled} onClick={state.onClick}>
                {`${provider.icon}  ${provider.label}`}
              </Button>
              {!provider.enabled ? (
                <Badge>Coming soon</Badge>
              ) : state.note ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {state.note}
                </Text>
              ) : null}
            </BlockStack>
          );
        })}
      </InlineStack>

      {importing && (
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" accessibilityLabel="Importing files" />
          <Text as="p" tone="subdued">
            Importing your files into your store{"'"}s files...
          </Text>
        </InlineStack>
      )}

      {assets.length > 0 && (
        <InlineStack gap="300" wrap>
          {assets.map((asset) => (
            <BlockStack key={asset.id} gap="100" inlineAlign="center">
              <Thumbnail
                size="large"
                alt={asset.altText ?? "Media"}
                source={
                  asset.mimeType.startsWith("image/")
                    ? asset.url
                    : "/assets/video-thumb.svg"
                }
              />
              <Button
                size="micro"
                tone="critical"
                onClick={() => onChange(assets.filter((a) => a.id !== asset.id))}
              >
                Remove
              </Button>
            </BlockStack>
          ))}
        </InlineStack>
      )}
    </BlockStack>
  );
}
