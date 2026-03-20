import { BlockStack, Card, Text, Select, TextField } from "@shopify/polaris";
import { COMMON_TIMEZONES } from "../../utils/dateTime.js";

interface StepScheduleProps {
  scheduledAt: string | null;
  onChange: (scheduledAt: string) => void;
}

export function StepSchedule({ scheduledAt, onChange }: StepScheduleProps) {
  const [tz, setTz] = useState("UTC");

  // Derive local datetime string for the input
  const localValue = scheduledAt
    ? new Date(scheduledAt).toISOString().slice(0, 16)
    : "";

  function handleChange(value: string) {
    if (!value) return;
    // Convert to UTC ISO string
    const localDate = new Date(`${value}:00`);
    onChange(localDate.toISOString());
  }

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">When should this post go out?</Text>
        <TextField
          label="Date and time"
          type="datetime-local"
          value={localValue}
          onChange={handleChange}
          autoComplete="off"
          min={new Date().toISOString().slice(0, 16)}
        />
        <Select
          label="Timezone"
          options={COMMON_TIMEZONES.map((tz) => ({ label: tz, value: tz }))}
          value={tz}
          onChange={setTz}
        />
      </BlockStack>
    </Card>
  );
}

// Need useState import
import { useState } from "react";
