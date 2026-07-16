import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  version,
} from "react";
import type {
  ColorValue,
  Coordinate,
  MapAnnotation,
  POIResult,
} from "../src/index";
import {
  BUNDLE_VERSION,
  Button,
  bleConnect,
  bleDisconnect,
  bleSubscribe,
  bleWrite,
  CrownRotation,
  Divider,
  ErrorBoundary,
  fetchAndApplyUpdate,
  Gauge,
  generateText,
  getCurrentLocation,
  HStack,
  href,
  Image,
  List,
  MapView,
  NavigationLink,
  NavigationProvider,
  NavigationRoute,
  NavigationStack,
  onBleNotify,
  onBleState,
  onPhoneMessage,
  Picker,
  ProgressView,
  playHaptic,
  publishWidgets,
  registerNativeListener,
  requestNotificationPermission,
  ScrollView,
  Spacer,
  scheduleNotification,
  searchPOI,
  sendToPhone,
  TabView,
  Text,
  TextField,
  TimerText,
  Toggle,
  useFocusEffect,
  useNavigation,
  useParams,
  useTheme,
  VStack,
  ZStack,
} from "../src/index";
import { hydrationStore } from "./hydrationStore";
import {
  addItem,
  addList,
  findShoppingList,
  getFeaturedListId,
  getShoppingLists,
  setFeaturedList,
  setShoppingItemDone,
  subscribeShopping,
  toggleShoppingItem,
} from "./shoppingStore";

const OTA_UPDATE_URL = process.env.REACT_WATCH_OTA_URL;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatElapsedPrecise(ms: number): string {
  return `${formatElapsed(ms)}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
}

export interface StopwatchState {
  startedAt: number | null;
  frozen: number;
}

export function toggleStopwatch(
  state: StopwatchState,
  now: number,
): StopwatchState {
  if (state.startedAt !== null) {
    return {
      startedAt: null,
      frozen: Math.max(0, now - state.startedAt),
    };
  }
  return {
    startedAt: now - state.frozen,
    frozen: state.frozen,
  };
}

/**
 * Stopwatch driven by <TimerText>: React commits once on start/stop;
 * SwiftUI ticks the digits natively, including milliseconds when requested.
 */
function StopwatchScreen() {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [frozen, setFrozen] = useState(0);
  const [phase, setPhase] = useState("active");
  const running = startedAt !== null;

  useEffect(
    () =>
      registerNativeListener("scenePhase", (p) =>
        setPhase(String(p?.phase ?? "active")),
      ),
    [],
  );

  return (
    <VStack spacing={6}>
      {running ? (
        <TimerText since={startedAt} milliseconds bold size={30} />
      ) : (
        <Text bold size={30} monospacedDigit>
          {formatElapsedPrecise(frozen)}
        </Text>
      )}
      <HStack spacing={8}>
        <Button
          onPress={() => {
            const now = Date.now();
            const next = toggleStopwatch({ startedAt, frozen }, now);
            setStartedAt(next.startedAt);
            setFrozen(next.frozen);
          }}
        >
          <Text>{running ? "Stop" : "Start"}</Text>
        </Button>
        <Button
          onPress={() => {
            setStartedAt(null);
            setFrozen(0);
          }}
        >
          <Text>Reset</Text>
        </Button>
      </HStack>
      <Text size={11} color="secondary">
        {`SwiftUI ticks this · phase: ${phase}`}
      </Text>
    </VStack>
  );
}

/** The original showcase: state, both event kinds, stacks and symbols. */
function CounterScreen() {
  const [count, setCount] = useState(0);
  const [liked, setLiked] = useState(false);
  return (
    <VStack spacing={6}>
      <HStack spacing={4}>
        <Image
          systemName={liked ? "heart.fill" : "heart"}
          color={liked ? "red" : "secondary"}
          accessibilityLabel={liked ? "Liked" : "Not liked"}
        />
        <Text bold size={16}>
          React on watchOS
        </Text>
      </HStack>
      <Text size={24} bold>
        Count: {count}
      </Text>
      <HStack spacing={8}>
        <Button onPress={() => setCount((c) => c - 1)}>
          <Text size={20}>-</Text>
        </Button>
        <Button onPress={() => setCount((c) => c + 1)}>
          <Text size={20}>+</Text>
        </Button>
      </HStack>
      <Toggle value={liked} onChange={setLiked} label="Like" />
      <Spacer />
      <Text size={11} color="secondary">
        React {version} in QuickJS
      </Text>
    </VStack>
  );
}

/**
 * Drives the hydration complication: every change updates the shared
 * store and republishes all widget timelines (App Group storage +
 * WidgetCenter reload on the native side).
 */
// Leading+trailing debounce for the republish: renderWidgets() re-renders
// EVERY registered widget timeline, so a tap streak must collapse — but the
// FIRST tap publishes immediately (a single tap-then-wrist-down must not
// lose its complication update to a timer that won't run while suspended;
// the qjs-smoke engine suite pins this). Later taps within the window fold
// into one trailing publish carrying the streak's final state. The counter
// write itself is always immediate and atomic in applyDelta.
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let lastPublishMs = 0;
function schedulePublish() {
  const now = Date.now();
  if (publishTimer === undefined && now - lastPublishMs > 200) {
    lastPublishMs = now;
    publishWidgets();
    return;
  }
  if (publishTimer !== undefined) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = undefined;
    lastPublishMs = Date.now();
    publishWidgets();
  }, 200);
}
function HydrationScreen() {
  // Lazy initializer: the glasses getter is a bridge hop into a coordinated
  // file read, and a non-lazy useState re-runs it on EVERY render (the screen
  // keeps re-rendering while it's anywhere on the active stack) just to throw
  // the value away.
  const [glasses, setGlasses] = useState(() => hydrationStore.glasses);
  // Atomic add (ARCH-05): the widget extension may increment the same counter,
  // so we add a delta rather than set an absolute value (which would lose the
  // extension's update). The returned total is the authoritative new value.
  const applyDelta = (delta: number) => {
    const total = hydrationStore.addGlasses(delta);
    setGlasses(total);
    schedulePublish();
    if (total === hydrationStore.goal) playHaptic("success");
  };
  const remind = () => {
    requestNotificationPermission();
    scheduleNotification({
      id: "hydration.reminder",
      title: "Hydration",
      body: "Time for a glass of water",
      afterMs: 30 * 60_000,
    });
    playHaptic("click");
  };
  // Dogfoods the design system (docs/status.md rows): theme tokens for
  // every value, card modifiers for the gauge, and a spring on the card so
  // the fill/count transition instead of snapping.
  const t = useTheme();
  return (
    <VStack spacing={t.space.sm}>
      <VStack
        spacing={t.space.xs}
        padding={t.space.md}
        background={t.colors.surface}
        cornerRadius={t.radius.lg}
        frame={{ maxWidth: "infinity" }}
        tint={t.colors.accent}
        animation={{ kind: "spring" }}
      >
        <Gauge
          value={glasses}
          min={0}
          max={hydrationStore.goal}
          label="Water"
          style="circular"
        />
        <Text {...t.text.muted}>
          {`${glasses} of ${hydrationStore.goal} glasses`}
        </Text>
      </VStack>
      <Button onPress={() => applyDelta(1)}>
        <Text>Add glass</Text>
      </Button>
      <Button onPress={() => applyDelta(-hydrationStore.goal)}>
        <Text {...t.text.caption} color={t.colors.muted}>
          Reset
        </Text>
      </Button>
      <Button onPress={remind}>
        <Text {...t.text.caption}>Remind me in 30 min</Text>
      </Button>
      <Text {...t.text.muted}>Updates the complication</Text>
    </VStack>
  );
}

/** The primitives added after v1, in one scrollable gallery. */
function GalleryScreen() {
  const [progress, setProgress] = useState(2);
  return (
    <ScrollView>
      <VStack spacing={8}>
        <Gauge value={0.7} label="Gauge" style="linear" />
        <Divider />
        <ProgressView value={progress} total={5} label="ProgressView" />
        <Button onPress={() => setProgress((p) => (p + 1) % 6)}>
          <Text size={12}>Advance progress</Text>
        </Button>
        <Divider />
        <ZStack>
          <Image systemName="circle.fill" color="blue" size={44} />
          <Text bold color="white" size={12}>
            ZStack
          </Text>
        </ZStack>
      </VStack>
    </ScrollView>
  );
}

const MOODS = ["calm", "focused", "tired", "great"];

/** TextField (dictation/scribble), Picker, and haptics. */
function InputsScreen() {
  const [name, setName] = useState("");
  const [mood, setMood] = useState(0);
  return (
    <VStack spacing={8}>
      <TextField value={name} placeholder="Your name" onChange={setName} />
      <Text size={12} color="secondary">
        {name ? `Hi, ${name}!` : "Dictate or scribble above"}
      </Text>
      <Picker label="Mood" options={MOODS} value={mood} onChange={setMood} />
      <Button onPress={() => playHaptic(mood === 3 ? "success" : "click")}>
        <Text size={12}>{`Feel ${MOODS[mood]} (haptic)`}</Text>
      </Button>
    </VStack>
  );
}

/** Each child of TabView is a vertically-paged screen on watchOS. */
function TabsScreen() {
  return (
    <TabView>
      <VStack spacing={4}>
        <Image systemName="1.circle.fill" color="blue" size={28} />
        <Text size={12}>Swipe up for page 2</Text>
      </VStack>
      <VStack spacing={4}>
        <Image systemName="2.circle.fill" color="green" size={28} />
        <Text size={12}>React-paged TabView</Text>
      </VStack>
    </TabView>
  );
}

/**
 * A full-screen MapKit map (watchOS 26+) with a few pinned landmarks and a
 * route between them — exercises the `Map` primitive's region, annotations,
 * polyline and edge-to-edge `fullScreen` layout (the back chevron floats over
 * the map).
 */
function MapScreen() {
  return (
    <MapView
      fullScreen
      latitude={37.795}
      longitude={-122.402}
      span={0.03}
      annotations={[
        {
          lat: 37.7955,
          lon: -122.3937,
          title: "Ferry Building",
          systemImage: "ferry.fill",
          tint: "blue",
        },
        {
          lat: 37.8024,
          lon: -122.4058,
          title: "Coit Tower",
          systemImage: "building.columns.fill",
          tint: "orange",
        },
        {
          lat: 37.788,
          lon: -122.4074,
          title: "Union Square",
          systemImage: "bag.fill",
          tint: "green",
        },
      ]}
      route={[
        { lat: 37.7955, lon: -122.3937 },
        { lat: 37.8024, lon: -122.4058 },
        { lat: 37.788, lon: -122.4074 },
      ]}
    />
  );
}

// San Francisco — the fallback center when the watch location is unavailable.
const SF: Coordinate = { lat: 37.7793, lon: -122.4193 };

/** Region (center + padded span) that fits every result, or null when empty. */
function fitRegion(results: POIResult[]) {
  if (results.length === 0) return null;
  const lats = results.map((r) => r.lat);
  const lons = results.map((r) => r.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    // Pad the wider axis so pins aren't flush to the edge; floor so a single
    // result still zooms to street level instead of the whole world.
    span: Math.max(maxLat - minLat, maxLon - minLon, 0.008) * 1.5 + 0.01,
  };
}

/**
 * Searchable POI map: a full-screen map with a search field floating over it
 * (ZStack, top-aligned). Typing a query runs MapKit's `searchPOI`
 * (MKLocalSearch) and drops a red pin per result; the camera then zooms to fit
 * them. With no results the map shows the live blue user-location dot and the
 * camera follows it — both native (`showsUserLocation` + `followsUserLocation`,
 * MapKit's own `UserAnnotation` + `.userLocation` camera), so moving is smooth
 * and there's no per-fix work crossing the bridge. `getCurrentLocation` is
 * called once on focus only to prompt for permission and bias the search;
 * the marker and camera don't depend on it. watchOS text entry is modal, so
 * `onChange` fires once with the finished query.
 */
function MapSearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<POIResult[]>([]);
  const [bias, setBias] = useState<Coordinate>(SF);
  // Bumped to re-apply the camera target — lets the recenter button snap back
  // to the user even after they've panned away (see MapProps.cameraTrigger).
  const [cameraTrigger, setCameraTrigger] = useState(0);
  const nudgeCamera = () => setCameraTrigger((n) => n + 1);
  // Immersive map: a tap on the map hides the overlay chrome, another shows it.
  const [chromeVisible, setChromeVisible] = useState(true);
  // The search field is revealed by the search button (and auto-focuses).
  const [searching, setSearching] = useState(false);

  // A single fix on focus: enough to prompt for permission and bias the search.
  // Not a stream — the live dot + follow are native, so the watch moving costs
  // nothing here. Focus (not mount) because a covered screen stays mounted
  // while deeper routes sit on top of it (see useFocusEffect in navigation.tsx).
  useFocusEffect(
    useCallback(() => {
      getCurrentLocation()
        .then(setBias)
        .catch(() => {}); // keep the SF fallback
    }, []),
  );

  const runSearch = (q: string) => {
    setSearching(false);
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      nudgeCamera();
      return;
    }
    searchPOI(q, { latitude: bias.lat, longitude: bias.lon, span: 0.2 })
      .then((r) => {
        setResults(r);
        nudgeCamera();
      })
      .catch(() => {
        setResults([]);
        nudgeCamera();
      });
  };

  // "Recenter on me": clear the search so the camera returns to following the
  // live location, and nudge so it re-centers even if the user had panned.
  const recenterOnMe = () => {
    setSearching(false);
    setResults([]);
    setQuery("");
    nudgeCamera();
  };

  // A tap on the map: leave search if we're in it, else toggle the chrome.
  const onMapTap = () => {
    if (searching) setSearching(false);
    else setChromeVisible((v) => !v);
  };

  const following = results.length === 0;
  // Fit the results when there are any; otherwise the bias region is just the
  // fallback the native follow uses until the first live fix lands.
  const region = fitRegion(results) ?? {
    latitude: bias.lat,
    longitude: bias.lon,
    span: 0.15,
  };

  return (
    <ZStack alignment="bottom" ignoresSafeArea>
      <MapView
        fullScreen
        showsUserLocation
        followsUserLocation={following}
        cameraTrigger={cameraTrigger}
        latitude={region.latitude}
        longitude={region.longitude}
        span={region.span}
        onPress={onMapTap}
        annotations={results.map(
          (r): MapAnnotation => ({
            lat: r.lat,
            lon: r.lon,
            title: r.title,
            systemImage: "mappin.circle.fill",
            tint: "red",
          }),
        )}
      />
      {searching ? (
        // The search field, revealed by the search button and auto-focused so
        // the keyboard opens in one tap. Commit → runSearch collapses it back.
        <VStack padding={{ horizontal: 8, vertical: 8 }}>
          <TextField
            value={query}
            placeholder="Search — coffee, park…"
            onChange={runSearch}
            autoFocus
            frame={{ maxWidth: "infinity" }}
          />
        </VStack>
      ) : (
        // Immersive chrome: two small round buttons pinned to the bottom
        // corners (Spacer splits them), tap the map to hide/show them.
        chromeVisible && (
          <VStack spacing={6} padding={{ horizontal: 16, vertical: 24 }}>
            {results.length > 0 && (
              <Text
                size={13}
                color="#1C1C1E"
                background="#FFFFFFE6"
                cornerRadius={10}
                padding={{ horizontal: 10, vertical: 3 }}
              >
                {`${results.length} places`}
              </Text>
            )}
            <HStack>
              <RoundButton
                icon="magnifyingglass"
                tint="white"
                onPress={() => setSearching(true)}
                label="Search places"
              />
              <Spacer />
              <RoundButton
                icon="location.fill"
                tint="#0A84FF"
                onPress={recenterOnMe}
                label="Recenter on my location"
              />
            </HStack>
          </VStack>
        )
      )}
    </ZStack>
  );
}

/** A small round Liquid Glass map control — the same frosted material as the
 *  system back button. `plain` strips the default button chrome, the `glass`
 *  modifier applies `.glassEffect()`, and equal padding around the glyph makes
 *  the glass capsule read as a circle. */
function RoundButton({
  icon,
  tint,
  onPress,
  label,
}: {
  icon: string;
  tint: ColorValue;
  onPress: () => void;
  label: string;
}) {
  return (
    <Button
      onPress={onPress}
      buttonStyle="plain"
      glass
      padding={10}
      accessibilityLabel={label}
    >
      <Image systemName={icon} size={16} color={tint} />
    </Button>
  );
}

/**
 * Movie remote over BLE: connects to a laptop's GATT service, shows the
 * now-playing title, drives transport with buttons and volume with the
 * Crown. The watch is the central; the laptop is the peripheral.
 */
function MovieRemoteScreen() {
  const [state, setState] = useState("connecting…");
  const [title, setTitle] = useState("—");
  const [volume, setVolume] = useState(50);
  // BLE ops now return Promises (CX-022) that reject on failure/timeout — surface
  // the reason instead of leaking an unhandled rejection (which would trip the
  // dev error overlay). Without a real peripheral, connect rejects after the
  // timeout and you'll see "ble: …" here.
  const ble = (p: Promise<unknown>) =>
    p.catch((e: { code?: string }) => setState(`ble: ${e?.code ?? "error"}`));
  const sendCmd = (c: string, v: string) => ble(bleWrite(c, v));
  // Focus-gated, not a bare useEffect: a covered screen stays mounted while
  // deeper routes sit on top, so connect only while this screen is frontmost
  // and disconnect on blur. See useFocusEffect in navigation.tsx.
  useFocusEffect(
    useCallback(() => {
      const offState = onBleState((p) => setState(String(p?.state ?? "")));
      const offNotify = onBleNotify((p) => {
        if (p?.characteristic === "title") setTitle(String(p.value));
      });
      // The laptop remote's service UUID — must be a valid 128-bit UUID that
      // matches the peripheral's advertised service (the bridge ignores
      // malformed UUIDs). "4D4F5649-4500" spells MOVIE; the tail spells "remote".
      // Inline .catch (not the `ble` helper) so this focus effect's deps stay
      // empty — setState is stable, the helper isn't.
      bleConnect("4D4F5649-4500-4000-8000-72656D6F7465").catch(
        (e: { code?: string }) => setState(`ble: ${e?.code ?? "error"}`),
      );
      bleSubscribe("title").catch(() => {});
      return () => {
        offState();
        offNotify();
        bleDisconnect();
      };
    }, []),
  );
  return (
    <VStack spacing={4}>
      <Text size={11} color="secondary">
        {state}
      </Text>
      <Text bold>{title}</Text>
      <HStack spacing={10}>
        <Button onPress={() => sendCmd("transport", "prev")}>
          <Image systemName="backward.fill" accessibilityLabel="Previous" />
        </Button>
        <Button onPress={() => sendCmd("transport", "playpause")}>
          <Image
            systemName="playpause.fill"
            accessibilityLabel="Play or pause"
          />
        </Button>
        <Button onPress={() => sendCmd("transport", "next")}>
          <Image systemName="forward.fill" accessibilityLabel="Next" />
        </Button>
      </HStack>
      <CrownRotation
        value={volume}
        min={0}
        max={100}
        accessibilityLabel="Volume"
        onChange={(v) => {
          setVolume(v);
          sendCmd("volume", String(Math.round(v)));
        }}
      >
        <Gauge value={volume} min={0} max={100} label="Vol" style="circular" />
      </CrownRotation>
    </VStack>
  );
}

/**
 * OTA update: fetch the manifest, and if it's newer than this bundle, download
 * + stage it (fetchAndApplyUpdate). It takes effect on the next launch — the
 * watch loads a staged bundle before the shipped one. REACT_WATCH_OTA_URL is
 * the manifest endpoint. Within App Store 2.5.2 (UI fixes to reviewed features).
 */
function UpdatesScreen() {
  const [status, setStatus] = useState(
    OTA_UPDATE_URL
      ? `v${BUNDLE_VERSION} — tap to check`
      : "set REACT_WATCH_OTA_URL",
  );
  const check = async () => {
    if (!OTA_UPDATE_URL) {
      setStatus("set REACT_WATCH_OTA_URL");
      return;
    }
    setStatus("checking…");
    try {
      const staged = await fetchAndApplyUpdate(OTA_UPDATE_URL);
      setStatus(
        staged === null
          ? `up to date (v${BUNDLE_VERSION})`
          : `staged v${staged} — relaunch to apply`,
      );
    } catch (e) {
      setStatus(`no update: ${(e as Error).message}`);
    }
  };
  return (
    <VStack spacing={6}>
      <Text bold>OTA Update</Text>
      <Text size={11} color="secondary">
        {status}
      </Text>
      {OTA_UPDATE_URL ? (
        <Text size={9} color="secondary">
          {OTA_UPDATE_URL}
        </Text>
      ) : null}
      <Button onPress={check}>
        <Text>Check for update</Text>
      </Button>
    </VStack>
  );
}

/** Phone <-> watch: shows the last phone message, pings the phone. */
function ConnectivityScreen() {
  const [last, setLast] = useState("none yet");
  const [sent, setSent] = useState("");
  useEffect(() => onPhoneMessage((p) => setLast(JSON.stringify(p))), []);
  // sendToPhone rejects when the phone isn't reachable (CX-022) — handle it so a
  // ping with no phone shows a status instead of an unhandled rejection.
  const ping = async () => {
    try {
      await sendToPhone({ kind: "ping", at: Date.now() });
      setSent("sent ✓");
    } catch {
      setSent("phone unreachable");
    }
  };
  return (
    <VStack spacing={6}>
      <Text bold>From phone:</Text>
      <Text size={12} color="secondary">
        {last}
      </Text>
      <Button onPress={ping}>
        <Text>Ping phone</Text>
      </Button>
      {sent ? (
        <Text size={12} color="secondary">
          {sent}
        </Text>
      ) : null}
    </VStack>
  );
}

/** The Digital Crown drives a 0–100 value (volume-style). */
function CrownScreen() {
  const [volume, setVolume] = useState(30);
  return (
    <CrownRotation
      value={volume}
      min={0}
      max={100}
      step={1}
      onChange={setVolume}
      accessibilityLabel="Volume"
    >
      <VStack spacing={6}>
        <Gauge
          value={volume}
          min={0}
          max={100}
          label="Volume"
          style="circular"
        />
        <Text bold size={24}>
          {String(volume)}
        </Text>
        <Text size={11} color="secondary">
          Turn the Crown
        </Text>
      </VStack>
    </CrownRotation>
  );
}

/**
 * On-device AI via Apple's Foundation Models (~3B LLM, watchOS 26+). The
 * prompt runs entirely on the watch — no network, no phone. The Generate
 * button is double-tap-enabled (primaryAction), so it fires on a pinch.
 */
function AIScreen() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const go = async () => {
    setResult("thinking…");
    try {
      setResult(await generateText(prompt || "Say hi in three words"));
    } catch (e) {
      setResult(`error: ${(e as Error).message}`);
    }
  };
  return (
    <VStack spacing={6}>
      <TextField
        value={prompt}
        placeholder="Ask the watch…"
        onChange={setPrompt}
      />
      <Button primaryAction onPress={go}>
        <Text>Generate</Text>
      </Button>
      <Text size={12} color="secondary">
        {result || "Runs on-device · double-tap to generate"}
      </Text>
    </VStack>
  );
}

/** A list of shopping lists; tapping one pushes the dynamic /list/[id]. */
function ListsScreen() {
  // Subscribe so the "N left" counts refresh after a toggle on the detail
  // screen (the snapshot's identity changes, so the compiler recomputes).
  const lists = useSyncExternalStore(subscribeShopping, getShoppingLists);
  const featuredId = useSyncExternalStore(subscribeShopping, getFeaturedListId);
  const [draft, setDraft] = useState("");
  const create = () => {
    addList(draft);
    setDraft("");
  };
  return (
    <List>
      {lists.map((list) => {
        const remaining = list.items.filter((item) => !item.done).length;
        const featured = list.id === featuredId;
        return (
          <NavigationLink
            key={list.id}
            to={href("/list/[id]", { id: list.id })}
            accessibilityLabel={`${list.name}, ${remaining} left${
              featured ? ", on watch face" : ""
            }`}
          >
            <HStack spacing={6}>
              <Image systemName="checklist" color="cyan" />
              <Text>{list.name}</Text>
              <Spacer />
              {featured ? (
                <Image systemName="star.fill" color="yellow" size={14} />
              ) : null}
              <Text size={12} color="secondary">
                {String(remaining)}
              </Text>
            </HStack>
          </NavigationLink>
        );
      })}
      <HStack spacing={6}>
        <Image systemName="plus.circle.fill" color="green" />
        <TextField value={draft} placeholder="New list" onChange={setDraft} />
      </HStack>
      <Button onPress={create} accessibilityLabel="Add list">
        <Text color="green" size={14}>
          Add list
        </Text>
      </Button>
    </List>
  );
}

/**
 * A dynamic /list/[id] route: useParams() selects the list. Each row taps to
 * toggle, and offers directional swipe actions (the common iOS row pattern):
 * swipe left-to-right (leading) to mark Done, right-to-left (trailing) to mark
 * Undone — a full "long" swipe triggers it without tapping the button. An
 * immutable store update keeps ticks across navigation; useSyncExternalStore
 * drives the re-render so it survives the React Compiler's auto-memoization
 * (an in-place mutation would not).
 */
function ListDetailScreen() {
  const { id } = useParams<"/list/[id]">();
  const list = useSyncExternalStore(subscribeShopping, () =>
    findShoppingList(id ?? ""),
  );
  const featuredId = useSyncExternalStore(subscribeShopping, getFeaturedListId);
  const [itemDraft, setItemDraft] = useState("");
  if (!list) {
    return (
      <Text size={12} color="secondary">
        List not found
      </Text>
    );
  }
  const featured = list.id === featuredId;
  const toggle = (itemId: string) => {
    const wasDone = list.items.find((item) => item.id === itemId)?.done;
    toggleShoppingItem(list.id, itemId);
    if (!wasDone) {
      playHaptic("success");
    }
  };
  const setDone = (itemId: string, done: boolean) => {
    setShoppingItemDone(list.id, itemId, done);
    if (done) {
      playHaptic("success");
    }
  };
  const create = () => {
    addItem(list.id, itemDraft);
    setItemDraft("");
  };
  const done = list.items.filter((item) => item.done).length;
  return (
    <List>
      <HStack spacing={6}>
        <Text bold size={17}>
          {list.name}
        </Text>
        <Spacer />
        <Text size={13} color="secondary">
          {`${done}/${list.items.length}`}
        </Text>
      </HStack>
      <Button
        onPress={() => setFeaturedList(featured ? null : list.id)}
        accessibilityLabel={
          featured ? "Remove from watch face" : "Show on watch face"
        }
      >
        <HStack spacing={6}>
          <Image
            systemName={featured ? "star.fill" : "star"}
            color={featured ? "yellow" : "secondary"}
            size={16}
          />
          <Text size={13} color={featured ? "yellow" : "secondary"}>
            {featured ? "On watch face" : "Show on watch face"}
          </Text>
          <Spacer />
        </HStack>
      </Button>
      {list.items.map((item) => (
        <Button
          key={item.id}
          onPress={() => toggle(item.id)}
          leadingSwipeActionLabel="Done"
          leadingSwipeActionSystemImage="checkmark"
          leadingSwipeActionTint="green"
          onLeadingSwipeAction={() => setDone(item.id, true)}
          swipeActionLabel="Undone"
          swipeActionSystemImage="arrow.uturn.backward"
          swipeActionTint="gray"
          onSwipeAction={() => setDone(item.id, false)}
          accessibilityLabel={`${item.text}, ${item.done ? "done" : "not done"}`}
        >
          <HStack spacing={12}>
            <Image
              systemName={item.done ? "checkmark.circle.fill" : "circle"}
              color={item.done ? "green" : "secondary"}
              size={22}
            />
            <Text {...(item.done ? { color: "secondary" } : {})}>
              {item.text}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      ))}
      <HStack spacing={12}>
        <Image systemName="plus.circle.fill" color="green" size={22} />
        <TextField
          value={itemDraft}
          placeholder="New item"
          onChange={setItemDraft}
        />
      </HStack>
      <Button onPress={create} accessibilityLabel="Add item">
        <Text color="green" size={14}>
          Add item
        </Text>
      </Button>
    </List>
  );
}

export function App() {
  return (
    <ErrorBoundary
      fallback={(e) => (
        <VStack spacing={4}>
          <Text bold color="red">
            Something broke
          </Text>
          <Text size={11} color="secondary">
            {e.message}
          </Text>
        </VStack>
      )}
    >
      <AppScreens />
    </ErrorBoundary>
  );
}

function AppScreens() {
  return (
    <NavigationProvider>
      <DemoNavigation />
    </NavigationProvider>
  );
}

function DemoNavigation() {
  const { path, setPath } = useNavigation();

  return (
    <NavigationStack path={path} onPathChange={setPath}>
      <NavigationRoute path="/" title="React Watch">
        <HomeScreen />
      </NavigationRoute>
      <NavigationRoute path="/counter" title="Counter">
        <CounterScreen />
      </NavigationRoute>
      <NavigationRoute path="/lists" title="Shopping">
        <ListsScreen />
      </NavigationRoute>
      <NavigationRoute path="/list/[id]">
        <ListDetailScreen />
      </NavigationRoute>
      <NavigationRoute path="/hydration" title="Hydration">
        <HydrationScreen />
      </NavigationRoute>
      <NavigationRoute path="/gallery" title="Gallery">
        <GalleryScreen />
      </NavigationRoute>
      <NavigationRoute path="/inputs" title="Inputs">
        <InputsScreen />
      </NavigationRoute>
      <NavigationRoute path="/tabs" title="Tabs">
        <TabsScreen />
      </NavigationRoute>
      <NavigationRoute path="/map" title="Map">
        <MapScreen />
      </NavigationRoute>
      <NavigationRoute path="/map-search" title="Places">
        <MapSearchScreen />
      </NavigationRoute>
      <NavigationRoute path="/stopwatch" title="Stopwatch">
        <StopwatchScreen />
      </NavigationRoute>
      <NavigationRoute path="/crown" title="Crown">
        <CrownScreen />
      </NavigationRoute>
      <NavigationRoute path="/phone" title="Phone">
        <ConnectivityScreen />
      </NavigationRoute>
      <NavigationRoute path="/movie-remote" title="Movie Remote">
        <MovieRemoteScreen />
      </NavigationRoute>
      <NavigationRoute path="/ai" title="AI">
        <AIScreen />
      </NavigationRoute>
      <NavigationRoute path="/updates" title="Updates">
        <UpdatesScreen />
      </NavigationRoute>
    </NavigationStack>
  );
}

function HomeScreen() {
  return (
    <List>
      <NavigationLink to="/counter" label="Counter" />
      <NavigationLink to="/lists" label="Shopping" />
      <NavigationLink to="/hydration" accessibilityLabel="Hydration">
        <HStack spacing={4}>
          <Image systemName="drop.fill" color="cyan" />
          <Text>Hydration</Text>
        </HStack>
      </NavigationLink>
      <NavigationLink to="/gallery" label="Gallery" />
      <NavigationLink to="/inputs" label="Inputs" />
      <NavigationLink to="/tabs" label="Tabs" />
      <NavigationLink to="/map" label="Map" />
      <NavigationLink to="/map-search" label="Places" />
      <NavigationLink to="/stopwatch" label="Stopwatch" />
      <NavigationLink to="/crown" label="Crown" />
      <NavigationLink to="/phone" label="Phone" />
      <NavigationLink to="/movie-remote" label="Movie Remote" />
      <NavigationLink to="/ai" label="AI" />
      <NavigationLink to="/updates" label="Updates" />
    </List>
  );
}
