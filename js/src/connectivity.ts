import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Phone <-> watch messaging over WatchConnectivity, surfaced through the
 * native-event channel and SPLIT by delivery semantics (ARCH-12) — the three
 * channels carry different guarantees and a merged stream forced JS to guess
 * which one fired:
 *
 * | channel                | direction guarantees                                  |
 * |------------------------|-------------------------------------------------------|
 * | `sendToPhone` /        | interactive: needs the phone REACHABLE now; resolves  |
 * | {@link onPhoneMessage} | the phone's reply                                      |
 * | {@link updateApplicationContext} / {@link onApplicationContext} | latest-wins state: the counterpart gets the MOST RECENT context when it next wakes |
 * | {@link transferUserInfo} / {@link onUserInfo} | FIFO queue: every item delivered in order, queue survives suspension |
 * | {@link transferFile} / {@link onReceivedFile} | FIFO queue of FILES: the payload is a file on disk, not a plist — see {@link transferFile} |
 *
 * Rule of thumb: request/reply → sendToPhone; "current state" sync (settings,
 * dashboard data) → updateApplicationContext; must-not-drop event streams
 * (logged workouts, purchases) → transferUserInfo; bytes that aren't a
 * property list (an audio clip, an export, an image) → transferFile.
 */
export const PHONE_MESSAGE_EVENT = "watchConnectivity";
export const APPLICATION_CONTEXT_EVENT = "watchConnectivity.applicationContext";
export const USER_INFO_EVENT = "watchConnectivity.userInfo";
/** A file the iPhone sent, already moved into this app's inbox. */
export const RECEIVED_FILE_EVENT = "watchConnectivity.file";
/** An outbound {@link transferFile} finished or failed. */
export const FILE_TRANSFER_EVENT = "watchConnectivity.fileTransfer";
/** WCSession activation / reachability / companion-install changed. */
export const CONNECTIVITY_STATE_EVENT = "watchConnectivity.state";

/**
 * Sends a message to the paired iPhone and resolves its reply (CX-022). Rejects
 * (with an InvokeError `code`) when the phone isn't reachable, the message
 * couldn't be delivered, or there's no connectivity-capable host — so a failed
 * send no longer vanishes. Uses WCSession.sendMessage under the hood, which
 * needs the counterpart reachable.
 */
export function sendToPhone(
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return invoke("sendToPhone", message);
}

/** Registers a handler for messages pushed from the iPhone. Returns an unsubscribe. */
export function onPhoneMessage(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(PHONE_MESSAGE_EVENT, handler);
}

/**
 * Publishes latest-wins state to the paired iPhone in the BACKGROUND: the
 * phone receives the most recent context when it next wakes — no reachability
 * requirement, no queue (each call overwrites the previous context). Resolves
 * once handed to WCSession; rejects (`UNAVAILABLE`) when the session isn't
 * activated or (`INVALID_REQUEST`) on an oversized/non-plist payload. The
 * right channel for "current state" sync — settings, dashboard data.
 */
export function updateApplicationContext(
  context: Record<string, unknown>,
): Promise<void> {
  return invoke("updateApplicationContext", context);
}

/**
 * Queues a background transfer to the paired iPhone: every queued item is
 * delivered IN ORDER when the counterpart wakes, and the queue survives app
 * suspension. Resolves once queued (per-item delivery isn't observable).
 * The right channel for must-not-drop event streams — logged workouts,
 * completed purchases.
 */
export function transferUserInfo(
  userInfo: Record<string, unknown>,
): Promise<void> {
  return invoke("transferUserInfo", userInfo);
}

/** Latest-wins context pushed from the iPhone (its `updateApplicationContext`).
 *  Returns an unsubscribe. */
export function onApplicationContext(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(APPLICATION_CONTEXT_EVENT, handler);
}

/** Queued userInfo transfers from the iPhone, delivered in order (its
 *  `transferUserInfo`). Returns an unsubscribe. */
export function onUserInfo(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(USER_INFO_EVENT, handler);
}

/** What {@link transferFile} resolves: the id this bridge minted for the
 *  queued transfer. Pass it to {@link cancelFileTransfer}, and match it
 *  against {@link onFileTransfer}'s `id`. */
export interface FileTransferHandle {
  id: number;
}

/** One entry of {@link outstandingFileTransfers}. */
export interface FileTransferStatus {
  /** `null` for a transfer queued by a PREVIOUS launch: the id space is this
   *  launch's, and `WCSessionFileTransfer` carries no identity of its own, so
   *  there is nothing honest to report. Such a transfer still completes and
   *  still fires {@link onFileTransfer} — with `id: null`. */
  id?: number;
  /** Last path component of the file being sent. */
  name: string;
  transferring: boolean;
  /** 0–1 (`WCSessionFileTransfer.progress`). Poll this; there is deliberately
   *  no progress push channel — a KVO observer per transfer pushing at an
   *  unbounded rate is the wakeup anti-pattern
   *  `docs/perf-battery-audit-2026-07-08.md` §P1-1 measures. */
  fractionCompleted: number;
}

/** A snapshot of the WCSession, for **observability only** — see
 *  {@link getConnectivityState}. */
export interface ConnectivityState {
  activationState: "notActivated" | "inactive" | "activated";
  /** Apple: valid **only** for a session that activated successfully; ignore
   *  it while `activationState` is anything but `"activated"`. */
  reachable: boolean;
  companionAppInstalled: boolean;
  hasContentPending: boolean;
}

/** A file received from the iPhone, as delivered to {@link onReceivedFile}. */
export interface ReceivedFile {
  /** Absolute `file://` path inside this app's inbox. Read it with
   *  `fetch(path)` → `arrayBuffer()`, then {@link deleteReceivedFile} it —
   *  with three caveats. (The `file://` leg itself is still device-unverified:
   *  see `docs/design-platform-data-package.md` §"What is verified".)
   *
   *  - **Ignore `response.ok` and `response.status`.** A `file://` load is not
   *    an `HTTPURLResponse`, so the host reports `status: 0` — making
   *    `ok === false` and `statusText === "Server Error"` on a read that fully
   *    succeeded. `arrayBuffer()` still returns the bytes; a rejected promise
   *    is the only real failure signal here.
   *  - **Over 5 MiB is unreadable.** The host caps a bridged body at
   *    `FetchResponse.defaultMaxBodyBytes` and rejects past it, to keep an
   *    unbounded body out of the watch's tight QuickJS heap — and the sending
   *    phone is under no matching cap. Check {@link ReceivedFile.size} first;
   *    `file://` honours no HTTP Range, so there is no chunked read and no
   *    other byte-reading API in this package.
   *  - **Reading needs the `network` feature**, not `connectivity`. `fetch` is
   *    gated separately, so a bundle policy-limited to `connectivity` receives
   *    files it has no way to open.
   */
  path: string;
  /** The name the sender gave the file. */
  name: string;
  size: number;
  /** Whatever the sender passed as `metadata`; `{}` when it sent none. */
  metadata: Record<string, unknown>;
  /** ms since epoch, stamped when the file landed. */
  receivedAt: number;
}

/** The terminal state of one outbound {@link transferFile}. */
export interface FileTransferResult {
  /** The id {@link transferFile} resolved, or `null` for a transfer queued by
   *  a previous launch (see {@link FileTransferStatus.id}). */
  id: number | null;
  state: "finished" | "failed";
  /** Native failure message; absent when `state` is `"finished"`. */
  error?: string;
  /** The `WCError.Code` case name (e.g. `"insufficientSpace"`), when the
   *  failure was one — so a caller can branch without parsing `error`. */
  code?: string;
}

/**
 * Queues a FILE for the paired iPhone (`WCSession.transferFile`) and resolves
 * **once queued**, with the id to track it by — not once delivered.
 *
 * Delivery is deliberately not awaited. Apple throttles file transfers "to
 * accommodate performance and power concerns", the queue survives app
 * suspension, and a transfer can finish in a **later launch** — so an invoke
 * that waited for completion would blow its watchdog rather than report
 * anything useful. Completion arrives on {@link onFileTransfer} instead, and
 * may arrive in a process that never called this function.
 *
 * `path` is a `file://` URL or an absolute container path this app can read.
 * `metadata` must contain property-list values only; a non-plist value fails
 * the transfer *later*, on the delegate, not here.
 *
 * ### Size and battery
 *
 * Apple publishes no byte cap, but the radio is the dominant cost and the
 * system throttles. Ours, provisional and unmeasured: keep watch → phone
 * transfers **under ~1 MB**, never transfer from a render or sensor path, and
 * batch to an explicit user action or a background-refresh wake. Crossing the
 * soft cap emits a WARN `budget` diagnostic and still transfers — `WCError` is
 * the authority on what is actually too large. See
 * `docs/budgets-and-limits.md`.
 */
export function transferFile(
  path: string,
  metadata?: Record<string, unknown>,
): Promise<FileTransferHandle> {
  return invoke<FileTransferHandle>("transferFile", {
    path,
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/**
 * Cancels a queued/in-flight transfer by the id {@link transferFile} resolved.
 * Rejects `INVALID_REQUEST` when this launch never minted that id — including
 * for a transfer queued by a previous launch, which has no id to cancel by.
 *
 * Cancelling an id this launch DID mint always resolves, even if the transfer
 * already completed — Apple defines `cancel()` on a transferred file as having
 * "no effect", and the completion races the cancel by nature (it arrives on
 * {@link onFileTransfer}, not here). Await {@link onFileTransfer} for the
 * terminal state; this resolving does not mean the transfer was stopped.
 */
export function cancelFileTransfer(id: number): Promise<void> {
  return invoke("cancelFileTransfer", { id });
}

/** Every transfer WCSession still has queued, including ones this launch did
 *  not queue (`id: null`). The polling counterpart to {@link onFileTransfer}. */
export function outstandingFileTransfers(): Promise<FileTransferStatus[]> {
  return invoke<FileTransferStatus[]>("outstandingFileTransfers");
}

/**
 * A snapshot of the session: activation, reachability, whether the companion
 * iPhone app is installed, and whether WCSession still has content queued.
 *
 * **Observability, not a gate.** Do not branch "can I send now" on
 * `reachable`: the field lesson recorded in
 * `notes/watchconnectivity-reliability.md` is that `isReachable` returns
 * `true` while delivery is failing ("a random bool generator with a confidence
 * problem"). Send and await an ack instead. This exists so a UI can *show* a
 * connection state and so a bug report can carry one — nothing more.
 */
export function getConnectivityState(): Promise<ConnectivityState> {
  return invoke<ConnectivityState>("getConnectivityState");
}

/**
 * Deletes a file this app received, by the `path` its
 * {@link onReceivedFile} event carried. Call it once you've read the bytes.
 *
 * The inbox is also pruned natively on each receive (newest 32 files / 7 days),
 * but pruning alone would delete files an app is still holding a path to —
 * hence an explicit release. Rejects `INVALID_REQUEST` for a path outside the
 * inbox; resolves for a path that is already gone (deleting twice is not an
 * error).
 */
export function deleteReceivedFile(path: string): Promise<void> {
  return invoke("deleteReceivedFile", { path });
}

/**
 * Runs `handler` for each file the iPhone sends. The file has already been
 * moved out of the system's temporary directory into this app's inbox (native
 * must do that synchronously or the system deletes it), so `path` is live when
 * your handler runs. Returns an unsubscribe.
 *
 * **It is not yours forever.** The inbox keeps the newest 32 files / 7 days and
 * prunes on every receive, exactly as {@link deleteReceivedFile} describes.
 * Native will not delete a file whose event has not reached you yet — that is
 * guaranteed — but once this handler returns, the next burst of arrivals can
 * reclaim it. Copy the bytes out if you need them past the current burst, and
 * call {@link deleteReceivedFile} when you are done.
 */
export function onReceivedFile(
  handler: (file: ReceivedFile) => void,
): Unsubscribe {
  return registerNativeListener(RECEIVED_FILE_EVENT, (payload) => {
    handler({
      path: String(payload?.path ?? ""),
      name: String(payload?.name ?? ""),
      size: Number(payload?.size ?? 0),
      metadata: (payload?.metadata as Record<string, unknown>) ?? {},
      receivedAt: Number(payload?.receivedAt ?? 0),
    });
  });
}

/**
 * Runs `handler` when an outbound {@link transferFile} finishes or fails —
 * possibly in a launch that never queued it (`id: null`). Returns an
 * unsubscribe.
 */
export function onFileTransfer(
  handler: (result: FileTransferResult) => void,
): Unsubscribe {
  return registerNativeListener(FILE_TRANSFER_EVENT, (payload) => {
    const id = payload?.id;
    handler({
      id: typeof id === "number" ? id : null,
      state: payload?.state === "failed" ? "failed" : "finished",
      ...(typeof payload?.error === "string" ? { error: payload.error } : {}),
      ...(typeof payload?.code === "string" ? { code: payload.code } : {}),
    });
  });
}

/**
 * Runs `handler` whenever the session state changes — activation completing,
 * reachability flipping, or the companion app being installed/removed. Those
 * three are the *complete* set of state callbacks watchOS delivers (there is
 * no watch-side `sessionWatchStateDidChange`), so one event covers them all.
 * Same caveat as {@link getConnectivityState}: observe, don't gate.
 */
export function onConnectivityState(
  handler: (state: ConnectivityState) => void,
): Unsubscribe {
  return registerNativeListener(CONNECTIVITY_STATE_EVENT, (payload) => {
    const activationState = payload?.activationState;
    handler({
      activationState:
        activationState === "activated" || activationState === "inactive"
          ? activationState
          : "notActivated",
      reachable: Boolean(payload?.reachable),
      companionAppInstalled: Boolean(payload?.companionAppInstalled),
      hasContentPending: Boolean(payload?.hasContentPending),
    });
  });
}

/**
 * A phone<->watch message contract (DX-6): each key is a message name, its value
 * the payload type. Declare it once and share the same `T` on both sides (this
 * watch package and the iPhone companion) so messaging is type-checked end to
 * end instead of hand-rolled JSON.
 */
export type MessageContract = Record<string, unknown>;

/** Typed `send`/`on` over one {@link MessageContract}; see {@link defineMessages}. */
export interface TypedMessages<T extends MessageContract> {
  /** Send a typed message to the phone; resolves the phone's reply. */
  send<K extends keyof T & string>(
    name: K,
    payload: T[K],
  ): Promise<Record<string, unknown>>;
  /** Handle a typed message from the phone. Returns an unsubscribe. */
  on<K extends keyof T & string>(
    name: K,
    handler: (payload: T[K]) => void,
  ): Unsubscribe;
}

/**
 * Builds a typed wrapper over {@link sendToPhone}/{@link onPhoneMessage} for one
 * message contract (DX-6), turning "wire the JSON yourself" into "define once,
 * type-checked on both sides". Messages travel as `{ type, payload }`; `on`
 * dispatches by `type` and hands the handler the typed payload.
 *
 *     const m = defineMessages<{ togglePlay: { on: boolean } }>();
 *     m.on("togglePlay", ({ on }) => setPlaying(on)); // on: boolean
 *     await m.send("togglePlay", { on: true });
 */
export function defineMessages<T extends MessageContract>(): TypedMessages<T> {
  return {
    send(name, payload) {
      return sendToPhone({ type: name, payload });
    },
    on(name, handler) {
      return onPhoneMessage((message) => {
        if (message?.type === name) {
          handler(message.payload as T[typeof name]);
        }
      });
    },
  };
}
