import { X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./PopupSheet.module.css";

export interface PopupSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

export const PopupSheet = ({ open, onOpenChange, title, ariaLabel, children }: PopupSheetProps) => {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setShown(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!mounted || !shown) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, shown, onOpenChange]);

  const handleBackdropTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.propertyName !== "opacity") return;
      if (!open) {
        setMounted(false);
      }
    },
    [open]
  );

  const handleBackdropClick = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <>
      <div
        role="presentation"
        className={styles.backdrop}
        data-shown={shown ? "true" : "false"}
        onClick={handleBackdropClick}
        onTransitionEnd={handleBackdropTransitionEnd}
        aria-hidden={!shown}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : (ariaLabel ?? "Dialog")}
        className={styles.panel}
        data-shown={shown ? "true" : "false"}
      >
        <div className={styles.header}>
          {title ? (
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
          ) : (
            <div className={styles.titleSpacer} />
          )}
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </>,
    document.body
  );
};
