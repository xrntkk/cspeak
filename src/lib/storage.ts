import type { AudioSettings } from "@/components/SettingsPanel";

export interface Bookmark {
  label: string;
  address: string;
  nickname: string;
}

const SETTINGS_KEY = "csspeak.settings";
const BOOKMARKS_KEY = "csspeak.bookmarks";

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
