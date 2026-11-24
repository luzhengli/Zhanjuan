import React, { useEffect, useRef, useState } from "react";

interface InfoTipProps {
  label: string;
  detail: string;
}

export const InfoTip: React.FC<InfoTipProps> = ({ label, detail }) => {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const show = () => {
    clearTimer();
    setOpen(true);
  };

  const scheduleHide = () => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 60);
  };

  return (
    <div className="relative inline-flex items-center" onMouseEnter={show} onMouseLeave={scheduleHide}>
      <button
        type="button"
        className="border border-line bg-surface-subtle text-ink rounded-full py-1 px-2.5 text-xs"
        data-testid="infotip-trigger"
        aria-expanded={open}
        onFocus={show}
        onBlur={scheduleHide}
      >
        {label}
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute top-[calc(100%+8px)] left-0 w-60 py-2.5 px-3 rounded-[9px] bg-surface border border-line shadow-float z-30 text-xs"
          data-testid="infotip-popover"
        >
          <strong>Transient Tooltip</strong>
          <div>{detail}</div>
        </div>
      )}
    </div>
  );
};
