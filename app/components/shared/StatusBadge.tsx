import { Badge } from "@shopify/polaris";
import type { BadgeProps } from "@shopify/polaris";
import { PostStatus } from "../../types/post.js";

const STATUS_CONFIG: Record<PostStatus, { tone: BadgeProps["tone"]; label: string }> = {
  [PostStatus.Draft]: { tone: undefined, label: "Draft" },
  [PostStatus.Scheduled]: { tone: "info", label: "Scheduled" },
  [PostStatus.Publishing]: { tone: "attention", label: "Publishing" },
  [PostStatus.Published]: { tone: "success", label: "Published" },
  [PostStatus.Failed]: { tone: "critical", label: "Failed" },
  [PostStatus.Cancelled]: { tone: "warning", label: "Cancelled" },
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status as PostStatus] ?? { tone: undefined, label: status };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}
