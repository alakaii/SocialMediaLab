import { useState, useCallback } from "react";
import { DropZone, Thumbnail, Text, BlockStack, InlineStack, Button } from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import type { WizardMediaAsset } from "../../types/post.js";

interface MediaUploaderProps {
  assets: WizardMediaAsset[];
  onChange: (assets: WizardMediaAsset[]) => void;
  accept?: string;
  maxFiles?: number;
}

export function MediaUploader({ assets, onChange, accept = "image/*,video/*", maxFiles = 10 }: MediaUploaderProps) {
  const fetcher = useFetcher<{ url: string; width?: number; height?: number; mimeType: string; durationSec?: number; sizeBytes?: number }>();
  const [uploading, setUploading] = useState(false);

  const handleDrop = useCallback(
    (_: File[], accepted: File[]) => {
      if (!accepted.length) return;
      setUploading(true);
      const formData = new FormData();
      accepted.forEach((f) => formData.append("file", f));
      fetcher.submit(formData, { method: "POST", action: "/api/upload", encType: "multipart/form-data" });
    },
    [fetcher],
  );

  if (fetcher.data && uploading) {
    setUploading(false);
    const d = fetcher.data;
    const newAsset: WizardMediaAsset = {
      id: crypto.randomUUID(),
      url: d.url,
      mimeType: d.mimeType,
      width: d.width,
      height: d.height,
      durationSec: d.durationSec,
      sizeBytes: d.sizeBytes,
    };
    onChange([...assets, newAsset]);
  }

  const removeAsset = (id: string) => onChange(assets.filter((a) => a.id !== id));

  return (
    <BlockStack gap="300">
      {assets.length < maxFiles && (
        <DropZone accept={accept} onDrop={handleDrop} disabled={uploading}>
          <DropZone.FileUpload actionTitle={uploading ? "Uploading..." : "Add files"} />
        </DropZone>
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
