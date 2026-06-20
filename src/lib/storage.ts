import type { AudioSettings } from "@/components/SettingsPanel";

export interface Bookmark {
  label: string;
  address: string;
  nickname: string;
}

export interface RecentConnection {
  address: string;
  nickname: string;
  lastConnectedAt: number;
}

const SETTINGS_KEY = "csspeak.settings";
const BOOKMARKS_KEY = "csspeak.bookmarks";
const RECENT_KEY = "csspeak.recentConnections";
const MAX_RECENT = 5;

export function loadSettings(fallback: AudioSettings): AudioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    // ignore corrupt storage
  }
  return fallback;
}

export function saveSettings(s: AudioSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

export function saveBookmarks(b: Bookmark[]) {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(b));
}

export function loadRecentConnections(): RecentConnection[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveRecentConnection(address: string, nickname: string) {
  const list = loadRecentConnections().filter((r) => r.address !== address);
  list.unshift({ address, nickname, lastConnectedAt: Date.now() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

export function removeRecentConnection(address: string) {
  const list = loadRecentConnections().filter((r) => r.address !== address);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
