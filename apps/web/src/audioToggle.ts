/**
 * The remembered on/off switch behind each of the three audio channels — card
 * cues, the ambience loop, the music. All three want the same three things: a
 * `useSyncExternalStore`-shaped subscription, a value that survives a reload,
 * and a setter that tells the page about the change. Only what happens *on* the
 * change differs, which is what `onChange` is for.
 */
export type AudioToggle = {
  subscribe(listener: () => void): () => void;
  isEnabled(): boolean;
  setEnabled(next: boolean): void;
};

export function createToggle(storageKey: string, onChange?: (enabled: boolean) => void): AudioToggle {
  let enabled = read();
  const listeners = new Set<() => void>();

  function read(): boolean {
    try {
      return localStorage.getItem(storageKey) !== 'off';
    } catch {
      // Private-mode storage can throw on read as well as write.
      return true;
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isEnabled: () => enabled,
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      try {
        localStorage.setItem(storageKey, next ? 'on' : 'off');
      } catch {
        // Not being able to remember the setting is no reason to ignore it.
      }
      onChange?.(next);
      for (const listener of listeners) listener();
    },
  };
}
