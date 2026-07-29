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
 *
 * ### Everything INBOUND is reduced to JSON, per key and silently
 *
 * Apple's contract for these channels is that the sender's dictionary holds
 * PROPERTY LIST values, and WatchConnectivity hands each delegate that
 * dictionary verbatim. A property list is a wider type than JSON, so a `Date`,
 * a `Data`, or a non-finite number is the sending iPhone using Apple's API
 * exactly as documented — and this bridge cannot carry it. The host DROPS such
 * a leaf and delivers the rest, rather than losing the whole payload.
 *
 * That reduction applies to every inbound plist — {@link onPhoneMessage},
 * {@link onApplicationContext}, {@link onUserInfo}, {@link ReceivedFile.metadata},
 * and the reply {@link sendToPhone} resolves — and it is **not reported**:
 * nothing rejects, no `onError`/diagnostic fires, and the key is simply absent,
 * indistinguishable from one the sender never set. A container is reduced, never
 * dropped, so an all-unbridgeable object/array arrives as `{}`/`[]`.
 *
 * Send `completedAt` as `Date.now()` (a number) or an ISO string, not a `Date`,
 * and bytes as {@link transferFile} rather than a `Data` leaf. Background:
 * `docs/design-platform-data-package.md` §"Everything inbound is a property list".
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
 *
 * The REPLY is reduced to JSON like every other inbound plist — a `Date`/`Data`
 * leaf the phone legitimately replied with is dropped per-key and silently; see
 * the inbound reduction note at the top of this module.
 */
export function sendToPhone(
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return invoke("sendToPhone", message);
}

/** Registers a handler for messages pushed from the iPhone. Returns an
 *  unsubscribe. The payload is reduced to JSON — a `Date`/`Data` leaf the phone
 *  legitimately sent is dropped per-key and silently; see the inbound reduction
 *  note at the top of this module. */
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
 *  Returns an unsubscribe. The payload is reduced to JSON — a `Date`/`Data` leaf
 *  the phone legitimately sent is dropped per-key and silently; see the inbound
 *  reduction note at the top of this module. */
export function onApplicationContext(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(APPLICATION_CONTEXT_EVENT, handler);
}

/** Queued userInfo transfers from the iPhone, delivered in order (its
 *  `transferUserInfo`). Returns an unsubscribe. Every ITEM is delivered, but
 *  each is reduced to JSON — a `Date`/`Data` leaf the phone legitimately sent is
 *  dropped per-key and silently; see the inbound reduction note at the top of
 *  this module. */
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
   *  {@link readReceivedFile}, then {@link deleteReceivedFile} it.
   *
   *  `fetch(path)` → `arrayBuffer()` is **not** the way to read one, and each
   *  reason is a defect {@link readReceivedFile} exists to avoid:
   *
   *  - **`fetch` reports failure on success.** A `file://` load is not an
   *    `HTTPURLResponse`, so the host reports `status: 0` — making
   *    `ok === false` and `statusText === "Server Error"` on a read that fully
   *    succeeded. (The `file://` leg itself is also still device-unverified:
   *    see `docs/design-platform-data-package.md` §"What is verified".)
   *  - **`fetch` cannot read a large file at all.** It caps a bridged body at
   *    5 MiB and `file://` honours no HTTP Range, so a bigger file — and the
   *    sending phone is under no matching cap — had no readable form.
   *    {@link readReceivedFile} bounds one CHUNK, not the file.
   *  - **`fetch` needs the `network` feature**, not `connectivity`, so a bundle
   *    policy-limited to `connectivity` received files it had no way to open.
   *    {@link readReceivedFile} is gated on `connectivity`, with the receive.
   */
  path: string;
  /** The name the sender gave the file. */
  name: string;
  size: number;
  /** What the sender passed as `metadata`, REDUCED TO JSON — see the inbound
   *  reduction note at the top of this module. A `Date`/`Data`/non-finite leaf
   *  the sender legitimately put in this property list is dropped per-key and
   *  silently, so a key it set can be missing here, and `{}` means EITHER "sent
   *  none" OR "every value was unbridgeable". */
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

/** One chunk of a received file, as {@link readReceivedFile} resolves it. */
export interface ReceivedFileChunk {
  /** Base64 of this chunk's bytes. Successive chunks **concatenate**: the host
   *  trims a chunk that does not end the file to a multiple of 3 bytes, so
   *  `atob(a + b + c)` is the file — no per-chunk decode-and-join needed. */
  base64: string;
  /** Decoded byte count of THIS chunk. Authoritative: add it to `offset` for
   *  the next read. The `length` you asked for is not — the host clamps it
   *  against the end of the file, the chunk ceiling, and the multiple-of-3 trim
   *  above, so a non-final chunk is up to 2 bytes shorter than requested. */
  bytes: number;
  /** Byte offset this chunk starts at. */
  offset: number;
  /** The whole file's size, so a loop knows where it is going. */
  totalBytes: number;
  /** True when this chunk ends the file. */
  eof: boolean;
}

/**
 * Reads a file this app received, by the `path` its {@link onReceivedFile}
 * event carried — the package's byte-reading API for the inbox, and the reason
 * {@link ReceivedFile.path} says not to `fetch` one.
 *
 * Reads at most one chunk per call, so a file larger than the bridge's body
 * ceiling is still readable — the ceiling bounds a chunk, not the file:
 *
 * ```ts
 * let b64 = "";
 * for (let offset = 0; ; ) {
 *   const chunk = await readReceivedFile(file.path, { offset });
 *   b64 += chunk.base64;                 // chunks concatenate, see `base64`
 *   if (chunk.eof) break;
 *   offset += chunk.bytes;               // NOT the length you asked for
 * }
 * await deleteReceivedFile(file.path);
 * ```
 *
 * Gated on `connectivity`, with the receive itself — reading a file the host
 * handed you is the same privilege as deleting it, not a network one.
 *
 * ### Cost
 *
 * The read, the base64 and the JSON hop all happen on the main thread, so a
 * ceiling-sized chunk is a visible pause. Pass a smaller `length` — at least 3,
 * see the refusals below — if you are reading while anything is animating, and
 * prefer a user action over a render or sensor path.
 *
 * Rejects `INVALID_REQUEST` for a path outside the inbox, a path retention has
 * already reclaimed, an `offset`/`length` that is not a whole number of bytes
 * (both are `number` here, so `{ offset: file.size / 2 }` is type-legal and
 * refused — round it yourself), a negative `offset`, an `offset` past the end,
 * a `length` that is not positive, a `length` over the chunk ceiling, and a
 * window of 1 or 2 bytes that stops short of the end — a chunk that does not
 * end the file is trimmed to a multiple of 3 so its base64 concatenates (see
 * {@link ReceivedFileChunk.base64}), and nothing under 3 bytes survives that
 * trim. So `{ offset: 0, length: 2 }` to peek at a header is a refusal, not a
 * short read: ask for 3 or more, or for the whole file, and slice the bytes
 * yourself. The host never silently returns a different range than the one
 * asked for.
 */
export function readReceivedFile(
  path: string,
  options?: { offset?: number; length?: number },
): Promise<ReceivedFileChunk> {
  return invoke<ReceivedFileChunk>("readReceivedFile", {
    path,
    ...(options?.offset === undefined ? {} : { offset: options.offset }),
    ...(options?.length === undefined ? {} : { length: options.length }),
  });
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
