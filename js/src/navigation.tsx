import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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
