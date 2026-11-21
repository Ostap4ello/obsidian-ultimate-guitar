import type { SearchResult } from "./types";

export function compareSearchResults(
    left: SearchResult,
    right: SearchResult,
    query: string,
): number {
    const textDifference = textMatchScore(right, query) - textMatchScore(left, query);
    if (textDifference !== 0) return textDifference;

    const ratingDifference = (right.rating ?? 0) - (left.rating ?? 0);
    if (ratingDifference !== 0) return ratingDifference;

    const voteDifference = (right.votes ?? 0) - (left.votes ?? 0);
    if (voteDifference !== 0) return voteDifference;

    return (right.views ?? 0) - (left.views ?? 0);
}

function textMatchScore(result: SearchResult, query: string): number {
    const normalizedQuery = normalizeSearchText(query);
    const title = normalizeSearchText(result.title);
    const artist = normalizeSearchText(result.artist);
    const combined = `${title} ${artist}`.trim();

    if (!normalizedQuery) return 0;
    if (title === normalizedQuery) return 1000;
    if (title.startsWith(normalizedQuery)) return 900;
    if (title.includes(normalizedQuery)) return 800;

    const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
    if (queryWords.length > 1 && queryWords.every((word) => title.includes(word))) {
        return 700;
    }
    if (queryWords.every((word) => combined.includes(word))) return 600;
    if (queryWords.some((word) => title.includes(word) || artist.includes(word))) {
        return 300;
    }
    return 0;
}

function normalizeSearchText(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}
