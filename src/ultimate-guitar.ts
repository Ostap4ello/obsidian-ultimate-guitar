import { requestUrl } from "obsidian";
import type { SearchResult, SongData } from "./types";
import { clamp } from "./utils";

const SEARCH_URL = "https://www.ultimate-guitar.com/search.php?search_type=title&value=";

export async function searchUltimateGuitar(query: string): Promise<SearchResult[]> {
  const directUrl = parseUltimateGuitarUrl(query);
  if (directUrl) return [directUrl];

  const response = await requestUrl({ url: `${SEARCH_URL}${encodeURIComponent(query)}` });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ultimate Guitar search failed (${response.status}).`);
  }
  const doc = new DOMParser().parseFromString(response.text, "text/html");
  const linkResults = Array.from(doc.querySelectorAll("a[href]"))
    .map((anchor) => {
      const href = anchor.getAttribute("href") ?? "";
      const url = new URL(href, "https://www.ultimate-guitar.com").toString();
      const surroundingText = anchor.parentElement?.textContent?.trim() ?? "";
      return {
        title: anchor.textContent?.trim() ?? "",
        artist: surroundingText.replace(anchor.textContent?.trim() ?? "", "").trim() || "Unknown artist",
        type: /chords/i.test(url) ? "Chords" : "Tab",
        url
      };
    })
    .filter((result) =>
      result.title &&
      /ultimate-guitar\.com\//.test(result.url) &&
      /\/(?:tab|chords|pro)\//.test(result.url)
    );

  const embeddedResults = extractEmbeddedSearchResults(response.text);
  const results = [...linkResults, ...embeddedResults]
    .filter((result, index, all) =>
      all.findIndex((candidate) => candidate.url === result.url) === index
    )
    .slice(0, 20);
  if (!results.length) {
    throw new Error(`Ultimate Guitar returned no parsable results for "${query}". The site may have changed its HTML or blocked the request.`);
  }
  return results;
}

export async function fetchSong(result: SearchResult): Promise<SongData> {
  const response = await requestUrl({ url: result.url });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ultimate Guitar page failed (${response.status}).`);
  }
  const doc = new DOMParser().parseFromString(response.text, "text/html");
  const payload = extractSongPayload(response.text);
  const content = payload?.content ?? extractSongContent(doc);
  if (!content) throw new Error("The page did not contain readable song content.");

  return {
    title: payload?.title || result.title,
    artist: payload?.artist || result.artist,
    type: payload?.type || result.type,
    sourceUrl: result.url,
    bpm: extractBpm(doc, response.text),
    content,
    rating: payload?.rating ?? result.rating,
    votes: payload?.votes ?? result.votes,
    views: payload?.views ?? result.views
  };
}

function parseUltimateGuitarUrl(value: string): SearchResult | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!/(^|\.)ultimate-guitar\.com$/i.test(url.hostname) ||
      !/\/(?:tab|chords|pro)\//i.test(url.pathname)) {
    return undefined;
  }
  const slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "Ultimate Guitar song";
  const title = slug
    .replace(/-\d+$/, "")
    .replace(/-(?:chords|tabs?|pro|guitar-pro)$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    title,
    artist: "Ultimate Guitar",
    type: /chords/i.test(url.pathname) ? "Chords" : "Tab",
    url: url.toString()
  };
}

function extractEmbeddedSearchResults(html: string): SearchResult[] {
  const decoded = html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'");
  const results: SearchResult[] = [];
  const pattern = /"localized_song_name":"([^"]+)","localized_artist_name":"([^"]+)"/g;
  for (const match of decoded.matchAll(pattern)) {
    const preceding = decoded.slice(Math.max(0, (match.index ?? 0) - 2500), match.index ?? 0);
    const urlMatch = [...preceding.matchAll(/"tab_url":"([^"]+)"/g)].at(-1);
    if (!urlMatch) continue;
    const url = urlMatch[1];
    if (!/\/tab\//.test(url)) continue;
    const rating = Number(preceding.match(/"rating":([0-9.]+)/)?.[1]);
    const votes = Number(preceding.match(/"votes":(\d+)/)?.[1]);
    const views = Number(preceding.match(/"tab_views":(\d+)/)?.[1]);
    results.push({
      title: match[1],
      artist: match[2],
      type: /chords/i.test(url) ? "Chords" : "Tab",
      url,
      rating: Number.isFinite(rating) ? rating : undefined,
      votes: Number.isFinite(votes) ? votes : undefined,
      views: Number.isFinite(views) ? views : undefined
    });
  }
  return results;
}

function extractSongContent(doc: Document): string {
  const candidates = ["[class*='js-store']", "[class*='tab-view']", "[class*='song-content']", "pre"];
  for (const selector of candidates) {
    const text = doc.querySelector(selector)?.textContent;
    if (text && text.length > 30) return text;
  }
  return doc.body?.innerText ?? "";
}

function extractSongPayload(html: string): Partial<SongData> | undefined {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const store = doc.querySelector(".js-store[data-content]")?.getAttribute("data-content");
  if (!store) return undefined;
  try {
    const root = JSON.parse(store);
    const pageData = root.store?.page?.data;
    const tab = pageData?.tab;
    const tabView = pageData?.tab_view;
    const content = tabView?.wiki_tab?.content;
    if (typeof content !== "string") return undefined;
    return {
      title: tab?.localized_song_name || tab?.song_name,
      artist: tab?.localized_artist_name || tab?.artist_name,
      type: tab?.type_name || tab?.type,
      content,
      rating: toNumber(tab?.rating),
      votes: toNumber(tab?.votes),
      views: toNumber(tabView?.stats?.view_total ?? tab?.tab_views)
    };
  } catch {
    return undefined;
  }
}

function extractBpm(doc: Document, html: string): number | undefined {
  const text = `${doc.body?.innerText ?? ""}\n${html}`;
  const match = text.match(/\b(?:bpm|tempo)\D{0,20}(\d{2,3})\b/i);
  return match ? clamp(Number(match[1]), 30, 240) : undefined;
}

function toNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
