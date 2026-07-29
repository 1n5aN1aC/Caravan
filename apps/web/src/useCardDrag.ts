import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Dragging a card from the hand onto the table.
 *
 * Built on pointer events rather than HTML5 drag-and-drop: this is the only way
 * to get touch and mouse on one code path, and it leaves the dragged card an
 * ordinary element we can style, rather than a browser-rendered drag bitmap.
 *
 * A press only becomes a drag once the pointer has travelled `DRAG_THRESHOLD`.
 * Below that it is a click, so selecting a card and dragging it are the same
 * gesture up to the point where they visibly differ.
 */

/** Pixels the pointer must travel before a press counts as a drag, not a click. */
export const DRAG_THRESHOLD = 6;

export interface DragState {
  cardId: string;
  /** Viewport coordinates of the pointer, so the card can follow it. */
  x: number;
  y: number;
  /** `data-drop` key under the pointer, when it is a legal destination. */
  over: string | null;
}

export interface CardDrag {
  /** Non-null only once the press has become a real drag. */
  drag: DragState | null;
  handlers: (cardId: string) => {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: () => void;
  };
}

export function useCardDrag({
  enabled,
  isTarget,
  onDrop,
  onClick,
}: {
  enabled: boolean;
  /** Whether a `data-drop` key is a legal destination for the held card. */
  isTarget: (cardId: string, key: string) => boolean;
  onDrop: (cardId: string, key: string) => void;
  onClick: (cardId: string) => void;
}): CardDrag {
  const [drag, setDrag] = useState<DragState | null>(null);
  const press = useRef<{ cardId: string; x: number; y: number; moved: boolean } | null>(null);

  const dropKeyAt = useCallback(
    (cardId: string, x: number, y: number): string | null => {
      // Guarded because jsdom and older engines may not implement it; a missing
      // hit test must degrade to "no target", never throw mid-gesture.
      const element = document.elementFromPoint?.(x, y);
      // Drop targets nest: a card sits inside the caravan holding it. Walk out
      // from the deepest one, so the most specific legal destination wins — a
      // face card lands on the card under the pointer — but a card that is not
      // itself a target falls through to the caravan behind it rather than
      // reading as "nowhere to drop". Dropping a number card onto the pile it
      // extends is the obvious gesture, and it has to mean "append here".
      let host = element?.closest?.('[data-drop]') as HTMLElement | null;
      while (host) {
        const key = host.dataset.drop;
        if (key && isTarget(cardId, key)) return key;
        host = (host.parentElement?.closest?.('[data-drop]') ?? null) as HTMLElement | null;
      }
      return null;
    },
    [isTarget],
  );

  const handlers = useCallback(
    (cardId: string) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        if (!enabled || e.button !== 0) return;
        // Capture so the gesture keeps reporting once the pointer leaves the
        // card — which it does immediately, since the card is being dragged away.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        press.current = { cardId, x: e.clientX, y: e.clientY, moved: false };
      },

      onPointerMove: (e: ReactPointerEvent) => {
        const start = press.current;
        if (!start) return;
        if (
          !start.moved &&
          Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD
        ) {
          return;
        }
        start.moved = true;
        setDrag({
          cardId: start.cardId,
          x: e.clientX,
          y: e.clientY,
          over: dropKeyAt(start.cardId, e.clientX, e.clientY),
        });
      },

      onPointerUp: (e: ReactPointerEvent) => {
        const start = press.current;
        press.current = null;
        setDrag(null);
        if (!start) return;
        if (!start.moved) {
          onClick(start.cardId);
          return;
        }
        const key = dropKeyAt(start.cardId, e.clientX, e.clientY);
        if (key) onDrop(start.cardId, key);
      },

      onPointerCancel: () => {
        press.current = null;
        setDrag(null);
      },
    }),
    [enabled, dropKeyAt, onDrop, onClick],
  );

  return { drag, handlers };
}
