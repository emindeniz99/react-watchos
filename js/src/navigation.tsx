import {
  Children,
  createContext,
  type EffectCallback,
  type FC,
  Fragment,
  isValidElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { NavigationRouteProps, NavigationStackProps } from "./components";
import { registerNativeListener } from "./nativeEvents";

export const OPEN_URL_EVENT = "openURL";

export type NavigationAction = "push" | "replace" | "reset";

export interface NavigateOptions {
  action?: NavigationAction;
}

export interface NavigationContextValue {
  path: string[];
  route: string;
  setPath: (path: string[]) => void;
  navigate: (to: string, options?: NavigateOptions) => void;
  goBack: () => void;
  canGoBack: boolean;
}

export interface NavigationProviderProps {
  /** Pushed route stack. Root is [] and useRoute() returns "/". */
  initialPath?: string[];
  /** Custom URL scheme to accept from WidgetKit/deep links. */
  scheme?: string;
  children?: ReactNode;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function normalizeRoute(route: string): string {
  if (!route || route === "/") return "/";
  return route.startsWith("/") ? route : `/${route}`;
}

function normalizeStack(path: string[]): string[] {
  return path.map(normalizeRoute).filter((route) => route !== "/");
}

/**
 * The app's custom URL scheme. The native host injects it as
 * `globalThis.__urlScheme` at boot, sourced from the app's registered
 * `CFBundleURLSchemes` — which the config plugin's `scheme` option writes (it
 * defaults to your bundle id, so two apps never collide on a shared scheme).
 * Falls back to `"reactwatch"` only with no host (Node/tests); a real build
 * always injects the real value, so both processes agree without you wiring the
 * scheme in two places.
 */
export function getURLScheme(): string {
  const s = (globalThis as unknown as { __urlScheme?: unknown }).__urlScheme;
  return typeof s === "string" && s.length > 0 ? s : "reactwatch";
}

/**
 * Build a deep-link URL from a route (`deepLinkURL("/hydration")` ->
 * `"<scheme>://hydration"`) using the app's registered scheme. Use it for
 * widget entry `url`s and any `openURL` target so the URL you construct matches
 * what `NavigationProvider` parses — one scheme source, no literal to keep in
 * sync across the app, the widget, and the Info.plist.
 */
export function deepLinkURL(route: string, scheme = getURLScheme()): string {
  return `${scheme}://${route.replace(/^\/+/, "")}`;
}

export function routeFromURL(
  url: string,
  scheme = getURLScheme(),
): string | null {
  const prefix = `${scheme}://`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length).split(/[?#]/, 1)[0] ?? "";
  // Keep the path PERCENT-ENCODED: decoding the whole string here would (a)
  // throw on a malformed escape in a crafted deep link and (b) let an encoded
  // "/" (%2F) change the segment structure before matching. The matchers
  // (matchRoute + Swift RouteMatcher) decode each captured param instead —
  // the same rule href() encodes by.
  const route = normalizeRoute(rest.replace(/^\/+/, ""));
  return route === "/" ? null : route;
}

/** A matched route param: `[id]` yields a string, `[...rest]` an array. */
export type RouteParamValue = string | string[];
export type RouteParams = Record<string, RouteParamValue>;

export interface RouteMatch {
  params: RouteParams;
  /** Higher = more specific. Literal +2, param +1, catch-all -1, so a
   * concrete route beats a catch-all that also happens to match it. */
  score: number;
}

type PatternSegment =
  | { kind: "literal"; value: string }
  | { kind: "param"; name: string }
  | { kind: "catchAll"; name: string; optional: boolean };

function splitSegments(route: string): string[] {
  return route.split("/").filter((part) => part.length > 0);
}

/**
 * Parsed patterns, cached by string. Patterns are static route literals (a
 * handful per app), but parsePattern otherwise re-runs three RegExp.exec per
 * segment on every NavigationStack re-render (`props.children` is a fresh
 * array each parent render, so the route-matching useMemo recomputes) and on
 * every href() call — in an interpreter with no regex JIT.
 */
const patternCache = new Map<string, PatternSegment[]>();

function parsePattern(pattern: string): PatternSegment[] {
  const cached = patternCache.get(pattern);
  if (cached) return cached;
  const parsed = splitSegments(pattern).map((raw): PatternSegment => {
    const optional = /^\[\[\.\.\.(.+)\]\]$/.exec(raw);
    if (optional?.[1])
      return { kind: "catchAll", name: optional[1], optional: true };
    const catchAll = /^\[\.\.\.(.+)\]$/.exec(raw);
    if (catchAll?.[1])
      return { kind: "catchAll", name: catchAll[1], optional: false };
    const param = /^\[(.+)\]$/.exec(raw);
    if (param?.[1]) return { kind: "param", name: param[1] };
    return { kind: "literal", value: raw };
  });
  patternCache.set(pattern, parsed);
  return parsed;
}

/**
 * Matches a `<NavigationRoute path>` pattern against a concrete pushed route,
 * Next.js/Expo style: `[id]`, `[...rest]` (>= 1 segment), `[[...rest]]`
 * (optional). Returns the extracted params and a specificity score, or null.
 * Mirrored in Swift's RouteMatcher so the host renders the same destination
 * useParams() resolves.
 */
/** Percent-decode a captured param segment, throw-proof: a malformed escape
 *  ("%zz" in a crafted deep link) falls back to the raw text instead of
 *  throwing out of the matcher. Mirrored in Swift's RouteMatcher — the two
 *  must resolve identical params for the same route. */
function decodeParam(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function matchRoute(pattern: string, route: string): RouteMatch | null {
  const segments = parsePattern(pattern);
  const parts = splitSegments(route);
  const params: RouteParams = {};
  let score = 0;
  let i = 0;
  for (const segment of segments) {
    if (segment.kind === "catchAll") {
      const rest = parts.slice(i);
      if (!segment.optional && rest.length === 0) return null;
      params[segment.name] = rest.map(decodeParam);
      return { params, score: score - 1 };
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (segment.kind === "literal") {
      // Compare literals DECODED: patterns are authored raw ("/café"), but a
      // valid deep link (widgetURL, Swift URL) must carry the segment
      // percent-encoded — a raw compare would make any non-ASCII/space
      // literal unreachable from a URL. Mirrored in Swift's RouteMatcher.
      if (part !== segment.value && decodeParam(part) !== segment.value) {
        return null;
      }
      score += 2;
    } else {
      params[segment.name] = decodeParam(part);
      score += 1;
    }
    i++;
  }
  if (parts.length !== segments.length) return null;
  return { params, score };
}

const EMPTY_PARAMS: RouteParams = {};
const ActiveRouteContext = createContext<string>("/");
const RouteParamsContext = createContext<RouteParams>(EMPTY_PARAMS);
const FocusContext = createContext<boolean>(false);

/** The stack's winning `<NavigationRoute path>` patterns (ARCH-09). */
interface StackWinners {
  /** Patterns whose children must be mounted (and so serialized): the root's
   * winner plus the winner for EVERY entry of the active path — a covered
   * screen keeps its subtree, matching the native stack's held destinations. */
  mounted: ReadonlySet<string>;
  /** The single focused pattern — the winner for the TOP of the stack (the
   * screen the native host actually shows), or null when nothing matches. */
  focused: string | null;
  /** For each winning pattern, the (normalized) stack entry it won — the
   * route its params must be extracted FROM. Without this a covered screen
   * has no way back to its own entry: its pattern rarely matches the top of
   * the stack, so `/list/[id]` under a pushed detail screen used to render
   * its no-param branch ("not found") into the tree native still holds.
   * When one pattern wins several entries the TOPMOST wins (entries are
   * folded in stack order), mirroring what `focused` would report. */
  wonEntries: ReadonlyMap<string, string>;
}

/** null = no enclosing NavigationStack: render children, never focused. */
const WinningRoutesContext = createContext<StackWinners | null>(null);

/**
 * Param object inferred from a route template, matching parsePattern's bracket
 * grammar: `[id]` -> string, `[...rest]` -> string[], `[[...rest]]` -> string[]
 * (empty `[]` when the optional segment is absent — matchRoute always yields an
 * array here, never undefined). Branch order mirrors parsePattern: optional
 * catch-all, then required catch-all, then param.
 */
type SegParam<Seg extends string> = Seg extends `[[...${infer Name}]]`
  ? { [K in Name]: string[] }
  : Seg extends `[...${infer Name}]`
    ? { [K in Name]: string[] }
    : Seg extends `[${infer Name}]`
      ? { [K in Name]: string }
      : Record<never, never>;

type SegsParams<S extends string> = S extends `${infer Head}/${infer Tail}`
  ? SegParam<Head> & SegsParams<Tail>
  : SegParam<S>;

/** Params inferred from a route template: `ParamsOf<"/list/[id]">` = `{ id: string }`. */
export type ParamsOf<S extends string> = {
  [K in keyof SegsParams<S>]: SegsParams<S>[K];
};

/**
 * Dynamic-segment params of the active route. Pass the route TEMPLATE to infer
 * the shape (`useParams<"/list/[id]">()` -> `{ id: string }`), or an explicit
 * shape, or nothing for the open default.
 */
export function useParams<
  T extends string | RouteParams = RouteParams,
>(): T extends string ? ParamsOf<T> : T {
  const params = useContext(RouteParamsContext);
  return params as unknown as T extends string ? ParamsOf<T> : T;
}

/**
 * Build a concrete path from a route template and type-checked params:
 * `href("/list/[id]", { id: "42" })` -> `"/list/42"`. The params type is
 * inferred from the template, so a missing or misnamed key is a compile error.
 */
export function href<S extends string>(
  template: S,
  params: ParamsOf<S>,
): string {
  const values = params as RouteParams;
  // Percent-encode each substituted value: a "/" or "%" inside a param would
  // otherwise change the SEGMENT structure of the route (an id like "a/b"
  // silently becomes two segments and never matches [id]). The matchers
  // (matchRoute here + Swift RouteMatcher) decode captured params back.
  const enc = (v: unknown) => encodeURIComponent(String(v));
  const segments = template.split("/").flatMap((seg) => {
    const optional = /^\[\[\.\.\.(.+)\]\]$/.exec(seg)?.[1];
    if (optional) {
      const value = values[optional];
      return Array.isArray(value) ? value.map(enc) : [];
    }
    const rest = /^\[\.\.\.(.+)\]$/.exec(seg)?.[1];
    if (rest) {
      const value = values[rest];
      return Array.isArray(value) ? value.map(enc) : [enc(value)];
    }
    const param = /^\[(.+)\]$/.exec(seg)?.[1];
    if (param) return [enc(values[param])];
    return [seg];
  });
  return segments.join("/") || "/";
}

/** True while the nearest enclosing <NavigationRoute> is the active route. */
export function useIsFocused(): boolean {
  return useContext(FocusContext);
}

/**
 * Runs `effect` when the enclosing screen gains focus and cleans up when it
 * blurs or unmounts — the watchOS analog of React Navigation's useFocusEffect.
 * Routes mount lazily (ARCH-09): a screen enters the tree when its route joins
 * the active stack, so a bare useEffect with `[]` now runs on first open, not
 * at launch. Focus is still narrower than mount: every entry of a multi-screen
 * stack stays mounted while covered (as in React Navigation), so a covered
 * screen's useEffect keeps running where this hook cleans up on blur. Route
 * focus-scoped side effects (BLE, sensor/listener subscriptions, polling)
 * belong here. Wrap `effect` in useCallback so it only re-runs when focus
 * actually changes.
 */
export function useFocusEffect(effect: EffectCallback): void {
  const focused = useIsFocused();
  useEffect(() => {
    if (focused) return effect();
  }, [focused, effect]);
}

const NavigationStackHost =
  "NavigationStack" as unknown as FC<NavigationStackProps>;
const NavigationRouteHost =
  "NavigationRoute" as unknown as FC<NavigationRouteProps>;

/** Every `<NavigationRoute path>` pattern among `children`, in declaration
 * order. Recurses fragments so it sees the same flattened child set the
 * serializer hands the native host. */
function collectRoutePatterns(children: ReactNode): string[] {
  const patterns: string[] = [];
  const visit = (nodes: ReactNode): void => {
    for (const child of Children.toArray(nodes)) {
      if (!isValidElement(child)) continue;
      if (child.type === NavigationRoute) {
        patterns.push((child.props as NavigationRouteProps).path);
      } else if (child.type === Fragment) {
        visit((child.props as { children?: ReactNode }).children);
      }
    }
  };
  visit(children);
  return patterns;
}

/** The single highest-scoring pattern for `route` — the JS mirror of Swift
 * RouteMatcher.best / NodeView.routeNode, which render only the best match.
 * Ties go to the first declared (strict `>`). */
function bestOf(patterns: readonly string[], route: string): string | null {
  let bestPath: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const pattern of patterns) {
    const m = matchRoute(pattern, route);
    if (m && m.score > bestScore) {
      bestScore = m.score;
      bestPath = pattern;
    }
  }
  return bestPath;
}

/**
 * The winners for an active stack: the root's best pattern plus the best
 * pattern for each pushed entry; `focused` is the top entry's (the root's for
 * an empty path). Takes the "\n"-joined KEYS rather than the arrays so the
 * caller's useMemo can depend on stable strings — route patterns and pushed
 * paths are static literals that never contain a newline.
 */
function computeWinners(patternsKey: string, pathKey: string): StackWinners {
  const patterns = patternsKey === "" ? [] : patternsKey.split("\n");
  const entries = pathKey === "" ? [] : pathKey.split("\n");
  const mounted = new Set<string>();
  const wonEntries = new Map<string, string>();
  const rootWinner = bestOf(patterns, "/");
  if (rootWinner !== null) {
    mounted.add(rootWinner);
    wonEntries.set(rootWinner, "/");
  }
  let focused = rootWinner;
  for (const entry of entries) {
    const route = normalizeRoute(entry);
    const winner = bestOf(patterns, route);
    if (winner !== null) {
      mounted.add(winner);
      // Later entries overwrite: a pattern winning twice keeps the topmost.
      wonEntries.set(winner, route);
    }
    focused = winner;
  }
  return { mounted, focused, wonEntries };
}

/**
 * Native push stack. Publishes the active route (top of the stack) so the
 * matching <NavigationRoute> can expose its params via useParams(), and the
 * per-entry winners so only the active stack's screens mount (ARCH-09).
 *
 * Two modes, mirroring the native RoutedNavigationStack (NodeView.swift):
 *  - **Controlled** — you pass `path`; JS is the source of truth and the host's
 *    `pathChange` events flow to your `onPathChange` for you to fold back in.
 *    Fold SYNCHRONOUSLY (a plain setState in the handler is enough — the
 *    dispatch flushes it): navigation is a confirmed transaction, and a
 *    proposal your handler didn't fold reads as declined, so native won't
 *    navigate.
 *  - **Uncontrolled** — you pass neither; the native stack drives itself
 *    (NavigationLink pushes, swipe-back) and reports each change via
 *    `pathChange`. We track that here so `active` follows the real stack instead
 *    of being pinned to "/" — otherwise useParams()/useIsFocused() would be
 *    wrong on every pushed screen. A user `onPathChange` still fires either way.
 */
export function NavigationStack(props: NavigationStackProps) {
  const { path, onPathChange } = props;
  const controlled = path !== undefined;
  const [localPath, setLocalPath] = useState<string[]>([]);
  const activePath = controlled ? path : localPath;
  const top =
    activePath.length > 0 ? activePath[activePath.length - 1] : undefined;
  const active = top ? normalizeRoute(top) : "/";
  // Memoize on string KEYS, not the arrays: `props.children` is a fresh array
  // every parent render, so an identity-keyed memo would mint a fresh winners
  // object each time and re-render every NavigationRoute for nothing. With
  // stable keys the context value keeps its identity until a pattern or the
  // path actually changes.
  const patternsKey = collectRoutePatterns(props.children).join("\n");
  const pathKey = activePath.join("\n");
  const winners = useMemo(
    () => computeWinners(patternsKey, pathKey),
    [patternsKey, pathKey],
  );
  const handlePathChange = useCallback(
    (next: string[]) => {
      if (!controlled) setLocalPath(next);
      onPathChange?.(next);
    },
    [controlled, onPathChange],
  );
  return (
    <ActiveRouteContext.Provider value={active}>
      <WinningRoutesContext.Provider value={winners}>
        <NavigationStackHost {...props} onPathChange={handlePathChange} />
      </WinningRoutesContext.Provider>
    </ActiveRouteContext.Provider>
  );
}

/**
 * A route in a NavigationStack. `path` may carry dynamic segments
 * (`/list/[id]`, `/shop/[name]/[[...rest]]`); when this route is active its
 * params are available to descendants through useParams().
 *
 * The screen child mounts LAZILY (ARCH-09): children render — and serialize
 * across the bridge — only while this route is the root's winner or one of
 * the active stack's, so an inactive screen's effects (e.g. a BLE connect)
 * wait for first open instead of running at launch, and the committed tree
 * carries only what's on the stack. This is safe because navigation is a
 * confirmed transaction, not an optimistic push: native proposes a path via
 * `pathChange`, this dispatch folds it and commits the newly mounted subtree
 * synchronously (the CX-010 forced flush), and only the returned `accepted`
 * verdict lets native animate — by which time the destination's children are
 * already in the tree it holds one decode-hop later (NodeView.swift shows a
 * neutral placeholder for exactly that beat). Every entry of a multi-screen
 * stack stays mounted while covered — only the TOP is focused — but a popped
 * screen unmounts and its state is dropped; persist what must survive
 * (React Navigation behaves the same way).
 */
export function NavigationRoute(props: NavigationRouteProps) {
  const { path } = props;
  const winners = useContext(WinningRoutesContext);
  // Match against the stack entry THIS pattern won, not the top of the stack:
  // a covered `/list/[id]` keeps the id of the entry underneath, so the
  // subtree native still holds renders the real screen, not its no-param
  // branch. Only winners carry an entry, so an overlapping loser (e.g. a
  // catch-all beside a concrete path) still gets no match, no focus and no
  // params — a screen never shown must not fire useFocusEffect either.
  const wonEntry =
    winners === null ? null : (winners.wonEntries.get(path) ?? null);
  const match = useMemo(
    () => (wonEntry === null ? null : matchRoute(path, wonEntry)),
    [path, wonEntry],
  );
  const focused = match !== null && path === (winners?.focused ?? null);
  const params = match?.params ?? EMPTY_PARAMS;
  // Outside any stack (winners === null) keep rendering children — there is
  // no path to gate on and hiding them would just lose content.
  const mounted = winners === null || winners.mounted.has(path);
  return (
    <FocusContext.Provider value={focused}>
      <RouteParamsContext.Provider value={params}>
        <NavigationRouteHost {...props}>
          {mounted ? props.children : null}
        </NavigationRouteHost>
      </RouteParamsContext.Provider>
    </FocusContext.Provider>
  );
}

export function NavigationProvider({
  initialPath = [],
  scheme = getURLScheme(),
  children,
}: NavigationProviderProps) {
  const [path, setRawPath] = useState(() => normalizeStack(initialPath));

  const setPath = useCallback((next: string[]) => {
    setRawPath(normalizeStack(next));
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    const route = normalizeRoute(to);
    setRawPath((current) => {
      if (route === "/") return [];
      if (options?.action === "reset") return [route];
      if (options?.action === "replace")
        return [...current.slice(0, -1), route];
      if (current[current.length - 1] === route) return current;
      return [...current, route];
    });
  }, []);

  const goBack = useCallback(() => {
    setRawPath((current) => current.slice(0, -1));
  }, []);

  useEffect(
    () =>
      registerNativeListener(OPEN_URL_EVENT, (payload) => {
        const url = typeof payload?.url === "string" ? payload.url : "";
        const route = routeFromURL(url, scheme);
        if (route) navigate(route, { action: "reset" });
      }),
    [navigate, scheme],
  );

  const value = useMemo<NavigationContextValue>(
    () => ({
      path,
      route: path[path.length - 1] ?? "/",
      setPath,
      navigate,
      goBack,
      canGoBack: path.length > 0,
    }),
    [goBack, navigate, path, setPath],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const value = useContext(NavigationContext);
  if (!value) {
    throw new Error("useNavigation must be used inside NavigationProvider");
  }
  return value;
}

export function useNavigate(): NavigationContextValue["navigate"] {
  return useNavigation().navigate;
}

export function useRoute(): string {
  return useNavigation().route;
}

export function useCanGoBack(): boolean {
  return useNavigation().canGoBack;
}
