import { Component, type ReactNode } from "react";
import { captureException } from "./telemetry.ts";
import { alertBox, button } from "./ui.ts";

/** Catches a page whose code could not be downloaded (lazy import), or with a `fallback` any crash of the app (decision 083 F); a class, as React has no hook for it. The error itself is not shown. */
export class LoadErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    captureException(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div role="alert" className={`mx-[26px] mt-4 ${alertBox}`}>
        <p>Impossible de charger la page.</p>
        <button
          type="button"
          onClick={() => location.reload()}
          className={`mt-3 ${button}`}
        >
          Recharger
        </button>
      </div>
    );
  }
}
