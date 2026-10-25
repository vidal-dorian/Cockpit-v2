import { Component, type ReactNode } from "react";
import { focusRing } from "./ui.ts";

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
      <div
        role="alert"
        className="m-4 rounded-xl bg-destructive-soft p-4 text-destructive"
      >
        <p>Impossible de charger la page.</p>
        <button
          type="button"
          onClick={() => location.reload()}
          className={`mt-3 min-h-10 rounded-lg bg-card px-4 font-semibold text-foreground ${focusRing}`}
        >
          Recharger
        </button>
      </div>
    );
  }
}
