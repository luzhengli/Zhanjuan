import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ActionPortalModalProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export const ActionPortalModal: React.FC<ActionPortalModalProps> = ({ open, onOpen, onClose }) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      {createPortal(
        <button
          ref={triggerRef}
          type="button"
          className="border border-brand bg-brand text-white rounded-lg py-[7px] px-3 font-medium fixed right-[22px] bottom-[22px] z-40 shadow-float"
          data-testid="portal-fab"
          onClick={onOpen}
        >
          Portal Action
        </button>,
        document.body,
      )}

      {open &&
        createPortal(
          <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50" onClick={onClose}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Portal Dialog"
              className="w-[400px] max-w-[92vw] bg-surface border border-line rounded-xl p-[18px] shadow-float"
              data-testid="portal-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mt-0 font-bold text-base mb-2">Portal Dialog</h3>
              <p className="mb-3 text-muted">
                Rendered via <code>createPortal(..., document.body)</code>. Press <strong>Esc</strong> to verify the
                first Esc goes to the app rather than exiting Zhanjuan focus.
              </p>
              <button
                ref={closeRef}
                type="button"
                className="border border-line bg-surface text-ink rounded-lg py-[7px] px-3 font-medium"
                onClick={() => {
                  onClose();
                  triggerRef.current?.focus();
                }}
              >
                Close Dialog (Esc)
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
