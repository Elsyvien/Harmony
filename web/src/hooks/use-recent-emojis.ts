import { useState, useCallback } from 'react';

const STORAGE_KEY = 'harmony_recent_reactions';
const MAX_RECENT = 3;
const DEFAULT_REACTIONS = ['👍', '❤️', '😂'];

export function useRecentEmojis() {
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, MAX_RECENT);
        }
      }
    } catch (e) {
      console.warn('Failed to load recent emojis', e);
    }
    return DEFAULT_REACTIONS;
  });

  const addRecentEmoji = useCallback((emoji: string) => {
    setRecentEmojis((prev) => {
      // Remove the emoji if it exists, then add to front
      const filtered = prev.filter((e) => e !== emoji);
      const next = [emoji, ...filtered].slice(0, MAX_RECENT);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.warn('Failed to save recent emojis', e);
      }

      return next;
    });
  }, []);

  return { recentEmojis, addRecentEmoji };
}
