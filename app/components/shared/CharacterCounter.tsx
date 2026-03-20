interface CharacterCounterProps {
  current: number;
  max: number | null;
}

export function CharacterCounter({ current, max }: CharacterCounterProps) {
  if (max === null) {
    return <span style={{ color: "var(--p-color-text-subdued)", fontSize: "12px" }}>{current} characters</span>;
  }

  const remaining = max - current;
  const pct = current / max;
  const color =
    pct >= 1
      ? "var(--p-color-text-critical)"
      : pct >= 0.9
        ? "var(--p-color-text-caution)"
        : "var(--p-color-text-subdued)";

  return (
    <span style={{ color, fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
      {remaining >= 0 ? `${remaining} remaining` : `${Math.abs(remaining)} over limit`}
    </span>
  );
}
