import Holidays from "date-holidays";

export interface UpcomingHoliday {
  /** Holiday name, e.g. "Christmas Day". */
  name: string;
  /** Calendar date as YYYY-MM-DD, used to prefill a new post draft. */
  date: string;
  /** Friendly label, e.g. "Fri, Dec 25". */
  label: string;
}

export interface CountryOption {
  label: string;
  value: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local YYYY-MM-DD for a Date (avoids UTC shifting the calendar day). */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Public holidays for the given country within the next `days` days.
 * Runs server-side only (date-holidays must not ship to the client bundle).
 */
export function getUpcomingHolidays(country: string, days = 60): UpcomingHoliday[] {
  let hd: Holidays;
  try {
    hd = new Holidays(country || "US");
  } catch {
    hd = new Holidays("US");
  }

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + days * DAY_MS);

  const years = new Set([start.getFullYear(), end.getFullYear()]);
  const holidays = [...years].flatMap((year) => hd.getHolidays(year) ?? []);

  return holidays
    .filter((h) => h.type === "public")
    .map((h) => ({ when: h.start, name: h.name }))
    .filter((h) => h.when >= start && h.when <= end)
    .sort((a, b) => a.when.getTime() - b.when.getTime())
    .map((h) => ({
      name: h.name,
      date: toDateKey(h.when),
      label: h.when.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    }));
}

/** Sorted list of supported countries for the settings select. */
export function getCountryOptions(): CountryOption[] {
  const countries = new Holidays().getCountries();
  return Object.entries(countries)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
