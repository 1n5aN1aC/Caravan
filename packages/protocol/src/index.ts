export * from './messages.js';
export * from './redact.js';

/** Shared timing and sizing constants, so client and server never disagree. */
export const NET = {
  /** Reconnect grace before a match is abandoned. */
  RECONNECT_GRACE_MS: 90_000,
  /** Rooms untouched for this long are garbage collected. */
  IDLE_SWEEP_MS: 10 * 60_000,
  /** Client heartbeat interval. */
  PING_MS: 15_000,
  ROOM_CODE_LENGTH: 4,
} as const;
