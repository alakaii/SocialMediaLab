import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  DropZone,
  InlineStack,
  Spinner,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import type { WizardMediaAsset } from "../../types/post.js";

interface MediaUploaderProps {
  assets: WizardMediaAsset[];
  onChange: (assets: WizardMediaAsset[]) => void;
  accept?: string;
  maxFiles?: number;
}

/** What /api/upload returns: the media fields on success, or an error message. */
interface UploadResponse {
  url?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  error?: string;
}

interface UploadProgress {
  current: number;
  total: number;
  name: string;
}

/**
 * Uploads dropped files to /api/upload one at a time.
 *
 * The route takes a single "file" part per request, so several files have to be
 * several requests: sending them as repeated parts of one POST silently dropped
 * everything after the first. A sequential loop also means each file's error
 * (too large, wrong type, Shopify refused it) can be reported against that file
 * instead of failing the whole drop.
 */
export function MediaUploader({
  assets,
  onChange,
  accept = "image/*,video/*",
  maxFiles = 10,
}: MediaUploaderProps) {
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  // The upload loop runs outside React's render cycle, so it reads the current
  // assets from a ref rather than a prop captured when the drop happened.
  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  const uploadingRef = useRef(false);

  const handleDrop = useCallback(
    async (_files: File[], accepted: File[], rejected: File[]) => {
      if (uploadingRef.current) return;

      const problems: string[] = [];

      if (rejected.length > 0) {
        problems.push(
          `${rejected.length} ${rejected.length === 1 ? "file was" : "files were"} skipped because that file type cannot be added to this post.`,
        );
      }

      const room = Math.max(0, maxFiles - assetsRef.current.length);
      const queue = accepted.slice(0, room);
      if (accepted.length > room) {
        problems.push(
          room === 0
            ? `This post already has the maximum of ${maxFiles} ${maxFiles === 1 ? "file" : "files"}.`
            : `Only ${maxFiles} ${maxFiles === 1 ? "file fits" : "files fit"} in this post, so ${accepted.length - room} were skipped.`,
        );
      }

      if (queue.length === 0) {
        setErrors(problems);
        return;
      }

      uploadingRef.current = true;
      setErrors(problems);

      let next = assetsRef.current;

      for (let index = 0; index < queue.length; index++) {
        const file = queue[index];
        setProgress({ current: index + 1, total: queue.length, name: file.name });

        try {
          const formData = new FormData();
          // One file per request: the route's contract is unchanged.
          formData.append("file", file);

          const response = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          const data = (await response.json().catch(() => ({}))) as UploadResponse;

          if (!response.ok || !data.url || !data.mimeType) {
            problems.push(
              `${file.name}: ${data.error ?? "This file could not be uploaded."}`,
            );
            setErrors([...problems]);
            continue;
          }

          next = [
            ...next,
            {
              id: crypto.randomUUID(),
              url: data.url,
              mimeType: data.mimeType,
              width: data.width,
              height: data.height,
              durationSec: data.durationSec,
              sizeBytes: data.sizeBytes,
            },
          ];
          onChange(next);
        } catch {
          problems.push(
            `${file.name}: the upload did not finish. Please check your connection and try again.`,
          );
          setErrors([...problems]);
        }
      }

      setProgress(null);
      uploadingRef.current = false;
    },
    [maxFiles, onChange],
  );

  const removeAsset = (id: string) => onChange(assets.filter((a) => a.id !== id));
  const uploading = progress !== null;

  return (
    <BlockStack gap="300">
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

      {assets.length < maxFiles && (
        <DropZone
          accept={accept}
          onDrop={handleDrop}
          disabled={uploading}
          allowMultiple={maxFiles > 1}
        >
          <DropZone.FileUpload actionTitle={uploading ? "Uploading..." : "Add files"} />
        </DropZone>
      )}

      {progress && (
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" accessibilityLabel="Uploading" />
          <Text as="p" tone="subdued">
            {`Uploading ${progress.name} (${progress.current} of ${progress.total})...`}
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
                source={asset.mimeType.startsWith("image/") ? asset.url : "/assets/video-thumb.svg"}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                {asset.mimeType.startsWith("video/") && asset.durationSec
                  ? `${Math.round(asset.durationSec)}s`
                  : `${asset.width}×${asset.height}`}
              </Text>
              <Button size="micro" tone="critical" onClick={() => removeAsset(asset.id)}>
                Remove
              </Button>
            </BlockStack>
          ))}
        </InlineStack>
      )}
    </BlockStack>
  );
}
