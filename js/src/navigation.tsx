import {
  createContext,
  type EffectCallback,
  type FC,
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

export function routeFromURL(
  url: string,
  scheme = "reactwatch",
): string | null {
  const prefix = `${scheme}://`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length).split(/[?#]/, 1)[0] ?? "";
  const route = normalizeRoute(decodeURIComponent(rest.replace(/^\/+/, "")));
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

function parsePattern(pattern: string): PatternSegment[] {
  return splitSegments(pattern).map((raw): PatternSegment => {
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
}

/**
 * Matches a `<NavigationRoute path>` pattern against a concrete pushed route,
 * Next.js/Expo style: `[id]`, `[...rest]` (>= 1 segment), `[[...rest]]`
 * (optional). Returns the extracted params and a specificity score, or null.
 * Mirrored in Swift's RouteMatcher so the host renders the same destination
 * useParams() resolves.
 */
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
      params[segment.name] = rest;
      return { params, score: score - 1 };
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (segment.kind === "literal") {
      if (part !== segment.value) return null;
      score += 2;
    } else {
      params[segment.name] = part;
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
  const segments = template.split("/").flatMap((seg) => {
    const optional = /^\[\[\.\.\.(.+)\]\]$/.exec(seg)?.[1];
    if (optional) {
      const value = values[optional];
      return Array.isArray(value) ? value : [];
    }
    const rest = /^\[\.\.\.(.+)\]$/.exec(seg)?.[1];
    if (rest) {
      const value = values[rest];
      return Array.isArray(value) ? value : [String(value)];
    }
    const param = /^\[(.+)\]$/.exec(seg)?.[1];
    if (param) return [String(values[param])];
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
 * Screens stay mounted across navigation (as in React Navigation), so a bare
 * useEffect with `[]` runs once at launch; route focus-scoped side effects
 * (BLE, sensor/listener subscriptions, polling) through this instead. Wrap
 * `effect` in useCallback so it only re-runs when focus actually changes.
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

/**
 * Native push stack. Publishes the active route (top of `path`) so the
 * matching <NavigationRoute> can expose its params via useParams().
 */
export function NavigationStack(props: NavigationStackProps) {
  const { path } = props;
  const top = path && path.length > 0 ? path[path.length - 1] : undefined;
  const active = top ? normalizeRoute(top) : "/";
  return (
    <ActiveRouteContext.Provider value={active}>
      <NavigationStackHost {...props} />
    </ActiveRouteContext.Provider>
  );
}

/**
 * A route in a NavigationStack. `path` may carry dynamic segments
 * (`/list/[id]`, `/shop/[name]/[[...rest]]`); when this route is active its
 * params are available to descendants through useParams().
 *
 * The screen child mounts eagerly — every route in the stack is serialized at
 * all times, even when inactive — so a screen's effects (e.g. a BLE connect)
 * run at launch, not on first open. This is deliberate, not an oversight:
 * NavigationStack is a *controlled* native push (NodeView.swift), and a link
 * tap or swipe-back drives the push optimistically (RoutedNavigationStack's
 * `pendingPath`) before the `pathChange` event round-trips to JS. SwiftUI runs
 * its `navigationDestination` closure for the new route — reading this node's
 * children straight out of the current serialized tree — in that same frame,
 * one bridge hop *before* JS re-renders with the new active route. Gating the
 * children on `active` would therefore hand the destination an empty subtree at
 * push time, flashing a blank screen until the JS ack lands. Lazy mounting
 * needs a native change (defer the destination render until JS confirms the
 * path, or carry the pushed subtree across the bridge) and on-device
 * validation; it can't be done safely in JS alone.
 */
export function NavigationRoute(props: NavigationRouteProps) {
  const { path } = props;
  const active = useContext(ActiveRouteContext);
  const match = useMemo(() => matchRoute(path, active), [path, active]);
  const params = match?.params ?? EMPTY_PARAMS;
  return (
    <FocusContext.Provider value={match !== null}>
      <RouteParamsContext.Provider value={params}>
        <NavigationRouteHost {...props} />
      </RouteParamsContext.Provider>
    </FocusContext.Provider>
  );
}

export function NavigationProvider({
  initialPath = [],
  scheme = "reactwatch",
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
