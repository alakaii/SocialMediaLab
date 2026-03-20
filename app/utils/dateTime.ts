import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export function formatScheduledTime(
  isoString: string,
  tz: string = "UTC",
): string {
  return dayjs(isoString).tz(tz).format("MMM D, YYYY [at] h:mm A z");
}

export function toLocalISO(date: Date, tz: string): string {
  return dayjs(date).tz(tz).format("YYYY-MM-DDTHH:mm");
}

export function fromLocalISO(localISO: string, tz: string): Date {
  return dayjs.tz(localISO, tz).toDate();
}

export function isInFuture(isoString: string): boolean {
  return dayjs(isoString).isAfter(dayjs());
}

export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
];
