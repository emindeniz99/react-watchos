import { Component, type ReactNode } from "react";

interface Props {
  /** Shown when a descendant throws; receives the error if a function. */
  fallback: ReactNode | ((error: Error) => ReactNode);
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors in its subtree and shows `fallback`
 * instead of letting the whole app fail (WatchRoot rethrows uncaught
 * errors). Wrap a screen so one broken screen doesn't take down the rest.
 * React boundaries don't catch errors in event handlers — those still
 * surface through the host's onError banner.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      const { fallback } = this.props;
      return typeof fallback === "function" ? fallback(error) : fallback;
    }
    return this.props.children;
  }
}
