export function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function formatStats(
  result: Pick<import("./types").SearchResult, "rating" | "votes" | "views">
): string {
  const stats = [];
  if (result.rating !== undefined) stats.push(`★ ${result.rating.toFixed(1)}`);
  if (result.votes !== undefined) stats.push(`${result.votes.toLocaleString()} ratings`);
  if (result.views !== undefined) stats.push(`${formatCompact(result.views)} views`);
  return stats.join(" · ");
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}
