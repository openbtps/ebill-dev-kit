// "@ebilladdress/app-sdk/browser": what runs in your app's own pages. Nothing here needs Node.
export {
  DEFAULT_EBILL_ORIGIN,
  SYNC_WINDOW_PATH,
  SyncBlockedError,
  SyncCancelledError,
  openSyncWindow,
  syncWindowUrl,
  type SyncHost,
  type SyncKind,
  type SyncMessageEvent,
  type SyncPopup,
  type SyncResult,
  type SyncWindowOptions,
} from "./sync-window.ts";
export type { SealedDocument } from "./sync.ts";
