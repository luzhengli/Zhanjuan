import React from "react";

export const CardGridProposal: React.FC = () => {
  return (
    <div className="py-6 px-7 flex flex-col gap-[18px]" data-testid="proposal-card-grid">
      <header className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-[22px] font-bold">Workspace · 2-Column Grid</h1>
      </header>
      <div className="grid grid-cols-2 gap-3.5">
        <article className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2">
          <strong>Coverage Ratio</strong>
          <div className="text-2xl font-bold">78%</div>
          <span className="text-ok">On target</span>
        </article>
        <article className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2">
          <strong>Open Notes</strong>
          <div className="text-2xl font-bold">2</div>
          <span className="text-warn">Needs review</span>
        </article>
      </div>
    </div>
  );
};

export default CardGridProposal;
