import { useState, useCallback } from 'react';
import { getStorageItem, setStorageItem } from '../utils/safe-storage';

const STORAGE_KEY = 'harmony_recent_reactions';
const MAX_RECENT = 3;
const DEFAULT_REACTIONS = ['thumbs_up', 'heart', 'laugh'];

function isAsciiReaction(value: string) {
  return /^[\x20-\x7E]+$/.test(value);
}

export function useRecentEmojis() {
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try {
      const stored = getStorageItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
            .filter(
              (emoji): emoji is string =>
                typeof emoji === 'string' && emoji.length > 0 && isAsciiReaction(emoji),
            )
            .slice(0, MAX_RECENT);
        }
      }
    } catch {
      // Ignore malformed local data and use defaults.
    }
    return DEFAULT_REACTIONS;
  });

  const addRecentEmoji = useCallback((emoji: string) => {
    setRecentEmojis((prev) => {
      // Remove the emoji if it exists, then add to front
      const filtered = prev.filter((e) => e !== emoji);
      const next = [emoji, ...filtered].slice(0, MAX_RECENT);

      setStorageItem(STORAGE_KEY, JSON.stringify(next));

      return next;
    });
  }, []);

  return { recentEmojis, addRecentEmoji };
}
