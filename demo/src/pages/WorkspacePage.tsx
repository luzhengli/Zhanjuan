import React, { useState } from "react";
import { ActionPortalModal } from "../components/ActionPortalModal.js";
import { InfoTip } from "../components/InfoTip.js";

const STORAGE_KEY = "demo.onboarding.dismissed";

const btnBase = "border border-line bg-surface text-ink rounded-lg py-[7px] px-3 font-medium";

export const WorkspacePage: React.FC = () => {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [modalOpen, setModalOpen] = useState(false);

  const dismissBanner = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Ignore storage errors.
    }
  };

  const resetBanner = () => {
    setDismissed(false);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  };

  return (
    <div data-page="workspace" className="py-6 px-7 flex flex-col gap-[18px]">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold">Workspace Overview</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <InfoTip
            label="Hover Help (?)"
            detail="Press F while hovering to freeze this JS-timed tooltip with real pixels and source attribution."
          />
          {dismissed && (
            <button type="button" className={btnBase} onClick={resetBanner}>
              Restore Banner
            </button>
          )}
          <button
            type="button"
            className="border border-brand bg-brand text-white rounded-lg py-[7px] px-3 font-medium"
            data-testid="primary-cta"
            onClick={() => setModalOpen(true)}
          >
            New Review <span className="max-[760px]:hidden">Session</span>
          </button>
        </div>
      </header>

      {!dismissed && (
        <div
          className="bg-brand-soft border border-line rounded-[10px] py-3 px-4 flex items-center justify-between gap-3"
          data-testid="onboarding-strip"
        >
          <span>
            <strong>Onboarding Tip:</strong> Dismissing this strip stores state in <code>localStorage</code>. Side-by-side
            panes isolate storage keys via <code>__zj_ns</code>.
          </span>
          <button type="button" className={btnBase} data-testid="dismiss-onboarding" onClick={dismissBanner}>
            Dismiss
          </button>
        </div>
      )}

      <section className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5" data-testid="workspace-cards">
        <article className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2" data-testid="card-coverage">
          <strong>Component Coverage</strong>
          <span className="text-muted">14 of 18 views verified</span>
          <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
            <div className="h-full bg-brand rounded-full w-[78%]" />
          </div>
        </article>

        <article className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2" data-testid="card-latency">
          <strong>Frame Budget</strong>
          <span className="text-muted">11.4 ms avg frame capture</span>
          <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
            <div className="h-full bg-ok rounded-full w-[64%]" />
          </div>
        </article>

        <article className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2" data-testid="card-open-notes">
          <strong>Pending Annotations</strong>
          <span className="text-muted">2 layout adjustments queued</span>
          <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
            <div className="h-full bg-warn rounded-full w-[35%]" />
          </div>
        </article>
      </section>

      <ActionPortalModal open={modalOpen} onOpen={() => setModalOpen(true)} onClose={() => setModalOpen(false)} />
    </div>
  );
};
