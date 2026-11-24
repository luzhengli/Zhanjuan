import React from "react";

export const CompactHeaderProposal: React.FC = () => {
  return (
    <div className="py-6 px-7 flex flex-col gap-[18px]" data-testid="proposal-compact-header">
      <header className="flex items-center justify-between gap-3 py-2.5 px-3.5 bg-surface border border-line rounded-[10px]">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[17px] font-bold">Workspace · Compact</h1>
          <span className="text-muted text-xs">78% Verified · 11.4ms</span>
        </div>
        <button
          type="button"
          className="border border-brand bg-brand text-white rounded-lg py-[7px] px-3 font-medium"
        >
          New Review
        </button>
      </header>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
        <article className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2">
          <strong>Unified Summary</strong>
          <span className="text-muted">Combined KPI header leaves more vertical room for content.</span>
        </article>
      </div>
    </div>
  );
};

export default CompactHeaderProposal;
