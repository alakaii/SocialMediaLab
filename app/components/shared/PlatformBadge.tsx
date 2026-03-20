import { Badge } from "@shopify/polaris";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import type { Platform } from "../../types/post.js";

interface PlatformBadgeProps {
  platform: Platform;
  size?: "small" | "medium";
}

export function PlatformBadge({ platform, size = "small" }: PlatformBadgeProps) {
  const c = PLATFORM_CONSTRAINTS[platform];
  return (
    <Badge size={size}>
      {c.icon} {c.label}
    </Badge>
  );
}
