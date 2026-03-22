/**
 * In-memory cache of known keywords from the learn log.
 * Loaded at startup, refreshed after feedback events.
 */
import { learnKnownKeywords } from '../commands/learning';

const isTauri = '__TAURI_INTERNALS__' in window;

let knownKeywords: Set<string> = new Set();
let loaded = false;

export async function refreshKnownKeywords(): Promise<void> {
  if (!isTauri) return;

  try {
    const keywords = await learnKnownKeywords();
    knownKeywords = new Set(keywords);
    loaded = true;
  } catch (e) {
    console.error('[keyword-cache] refresh failed', e);
  }
}

export function isKnownKeyword(kw: string): boolean {
  return knownKeywords.has(kw);
}

export function getKnownKeywords(): Set<string> {
  return knownKeywords;
}

export function isLoaded(): boolean {
  return loaded;
}
