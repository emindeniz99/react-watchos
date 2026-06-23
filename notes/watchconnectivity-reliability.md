# WatchConnectivity reliability — and a multi-transport alternative

- **Source:** Tarek Sabry — "WatchConnectivity was failing 40% of the time. So I stopped using it."
- **Link:** <https://tarek-builds.dev/p/watchconnectivity-was-failing-40-of-the-time-so-i-stopped-using-it/>
- **Captured:** 2026-06-23
- **Why it matters here:** This project ships phone↔watch messaging via the
  `react-native-watch-connectivity` dependency (which wraps Apple's
  WatchConnectivity / `WCSession`). If we lean on it for anything important,
  these failure modes apply to us directly.

## The problem the author hit

- **`sendMessageData` ~60% success rate.** Messages vanished silently; worse,
  the error handler fired *repeatedly even for messages that had succeeded*.
- **`isReachable` is unreliable** — returned `true` while delivery was failing.
  Author: "a random bool generator with a confidence problem."
- Following Apple's docs exactly didn't help — the framework itself was the
  bottleneck. Retry logic / timeout tweaks / radars only patched symptoms.

## Root cause

Not precisely stated beyond "the framework is fundamentally unreliable." The
conclusion: incremental fixes inside WatchConnectivity are futile; reliability
has to be built at the **application layer**.

## The alternative architecture

- **Transports:** BLE for service discovery + HTTP for data transfer + SSE
  (Server-Sent Events) for phone→watch push. Multi-transport "racing":
  WatchConnectivity can run *alongside* HTTP as a fallback.
- **Reliability mechanisms (the actual lesson):**
  - **Frame ID on every message.**
  - **Explicit application-level acknowledgements** (don't trust transport
    guarantees).
  - **Deduplication** to prevent double-delivery.
  - **Retry queue:** messages persist locally until the receiver acks.
  - **Heartbeat ping/pong** to detect connection loss.
  - Net effect: "exactly-once delivery" via device-level acks → ~99% reliable.

## Takeaways for us (future, not acted on yet)

- **Treat `react-native-watch-connectivity` delivery as best-effort.** For
  anything that matters, add an **app-level ack + dedup + retry** layer with a
  message id — exactly the pattern we'd want regardless of transport. (Note our
  store already favors idempotent, identity-swapping updates, which composes
  well with dedup.)
- **Don't trust `isReachable`** as a gate for "can I send now." Send + await an
  ack instead.
- **Active-session features** (live workout/health, device control) assume
  *both* apps are foregrounded — design around that, or use a push transport.
- **Cross-platform (Android↔watch) is impossible with WatchConnectivity**
  (iOS-only). An HTTP+BLE protocol is transport-agnostic — any device with an
  IP / BLE advertising can participate. Relevant if we ever bridge to the
  laptop/desktop (we already do BLE for the movie-remote demo).

## Open-source reference: WatchLink

- **Repo:** <https://github.com/tareksabry1337/WatchLink>
- **Shape:** three Swift 6 modules, zero third-party deps:
  - `WatchLinkCore` — protocol layer (framing, ack/retry, dedup, state
    machine); no platform deps.
  - `WatchLink` — watch client (BLE discovery, HTTP, SSE).
  - `WatchLinkHost` — phone HTTP server on `Network.framework` (no Vapor in
    prod), BLE advertiser, SSE push.
- **API:** one `send()` for both fire-and-forget and request/response; the type
  system routes.
- Worth studying if we outgrow `react-native-watch-connectivity` — the
  Core/protocol split mirrors our own JS-owns-logic, native-is-transport stance
  ([[react-native-watchos_js-driven-principle]] in memory).
