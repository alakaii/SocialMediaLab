export function countHashtags(text: string): number {
  return (text.match(/#\w+/g) ?? []).length;
}

export function extractHashtags(text: string): string[] {
  return text.match(/#\w+/g) ?? [];
}

export function stripHashtags(text: string): string {
  return text.replace(/#\w+/g, "").replace(/\s{2,}/g, " ").trim();
}

export function appendHashtagBlock(text: string, tags: string[]): string {
  if (!tags.length) return text;
  const tagBlock = tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return `${text.trim()}\n\n${tagBlock}`;
}
