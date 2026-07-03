import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /**
   * Shown when a descendant throws. A function receives the error and the
   * React error info (its `componentStack` names the component subtree that
   * threw) — `info` is null on the first fallback render and populated on the
   * re-render that follows `componentDidCatch`.
   */
  fallback: ReactNode | ((error: Error, info: ErrorInfo | null) => ReactNode);
  children: ReactNode;
  /** Called with the error AND its React error info (the `componentStack`),
   *  so a consumer can log/where-did-it-break to the inspector or telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catches render/lifecycle errors in its subtree and shows `fallback`
 * instead of letting the whole app fail (WatchRoot rethrows uncaught
 * errors). Wrap a screen so one broken screen doesn't take down the rest.
 * React boundaries don't catch errors in event handlers — those still
 * surface through the host's onError banner.
 *
 * The React `componentStack` (which component tree threw) is surfaced to both
 * `onError` and the function `fallback`, so a dev overlay / remote inspector
 * can point at the offending component rather than just the error message.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // getDerivedStateFromError only sees the error; the componentStack arrives
    // here, so record it (re-rendering the fallback with it) and report it.
    this.setState({ info });
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    const { error, info } = this.state;
    if (error) {
      const { fallback } = this.props;
      return typeof fallback === "function" ? fallback(error, info) : fallback;
    }
    return this.props.children;
  }
}
