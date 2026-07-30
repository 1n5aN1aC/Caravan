import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artUrls } from './cardArt.js';
import { resetWarmAssets, warmAssets } from './preload.js';

/**
 * The warm-up is all side effect and no return value, so these watch what it
 * asks the browser for: which `Image` sources it sets, and how many at once.
 */

/** Every `new Image()` the warm-up made, in the order it set their sources. */
let requested: string[];
/** Sources still outstanding, so a case can assert on the concurrency cap. */
let pending: Array<() => void>;

class FakeImage {
  decoding = '';
  fetchPriority = '';
  private handlers = new Map<string, () => void>();

  addEventListener(type: string, handler: () => void) {
    this.handlers.set(type, handler);
  }

  set src(url: string) {
    requested.push(url);
    pending.push(() => this.handlers.get('load')?.());
  }
}

/** Lets every outstanding fetch finish, which is what frees the next batch. */
function settleAll(): void {
  // Draining rather than iterating: finishing one queues the next immediately.
  let guard = 0;
  while (pending.length > 0 && guard++ < 1000) pending.shift()!();
}

beforeEach(() => {
  requested = [];
  pending = [];
  resetWarmAssets();
  vi.stubGlobal('Image', FakeImage);
  // Idle work runs inline, so a case does not have to wait for the browser to
  // decide it is bored.
  vi.stubGlobal('requestIdleCallback', (work: () => void) => {
    work();
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('warmAssets', () => {
  it('fetches the card backs before the faces', () => {
    warmAssets();
    settleAll();

    // Both lists are non-empty in this repo; if a build ever ships without art
    // the warm-up is a no-op and there is nothing to order.
    expect(artUrls.backs.length).toBeGreaterThan(0);
    expect(artUrls.faces.length).toBeGreaterThan(0);

    const lastBack = Math.max(...artUrls.backs.map((url) => requested.indexOf(url)));
    const firstFace = Math.min(...artUrls.faces.map((url) => requested.indexOf(url)));
    expect(lastBack).toBeLessThan(firstFace);
  });

  it('eventually fetches every bundled image exactly once', () => {
    warmAssets();
    settleAll();

    const everything = [...artUrls.backs, ...artUrls.faces];
    expect(new Set(requested)).toEqual(new Set(everything));
    expect(requested).toHaveLength(everything.length);
  });

  it('keeps only a few fetches in flight, so the warm-up cannot hog the connection', () => {
    warmAssets();
    // Nothing has been allowed to finish, so this is the whole in-flight set.
    expect(requested.length).toBeLessThanOrEqual(3);
  });

  it('does nothing on a second call', () => {
    warmAssets();
    settleAll();
    const first = requested.length;

    warmAssets();
    settleAll();
    expect(requested).toHaveLength(first);
  });
});
