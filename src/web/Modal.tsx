import { useEffect, useRef, useState } from "react";

/** A native modal dialog: the browser traps the focus and makes the page behind inert. Escape closes it, and the focus goes back to what had it. */
export function Modal({
  label,
  onClose,
  className = "",
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Once: StrictMode runs the effect twice, and the second time the dialog already holds the focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    ref.current?.showModal();
    // Unmounting an open modal skips the native close steps: give the focus back by hand, unless a panel opened by the choice took it.
    return () => {
      if (document.activeElement === document.body) opener?.focus();
    };
  }, [opener]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      // A native close request (the Android back gesture) comes here too.
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      className={`dialog-in m-auto rounded-[14px] border border-border-strong bg-card p-0 text-foreground backdrop:bg-background/80 max-md:m-0 max-md:size-full max-md:max-h-none max-md:max-w-none max-md:rounded-none ${className}`}
    >
      {children}
    </dialog>
  );
}
