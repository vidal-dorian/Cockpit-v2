import { Component, type ReactNode } from "react";
import { alertBox, button } from "./ui.ts";

/** Catches a page whose code could not be downloaded (lazy import); a class, as React has no hook for it. The error itself is not shown. */
export class LoadErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
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
