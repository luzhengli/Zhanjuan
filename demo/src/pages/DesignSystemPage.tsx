import React from "react";

export const DesignSystemPage: React.FC = () => {
  const neutralSwatches = [
    { name: "--bg", hex: "#F7F8FA" },
    { name: "--surface", hex: "#FFFFFF" },
    { name: "--surface-subtle", hex: "#F1F3F7" },
    { name: "--border", hex: "#DFE3EC" },
    { name: "--text-main", hex: "#151923" },
    { name: "--text-muted", hex: "#5B6475" },
  ];

  const semanticSwatches = [
    { name: "--accent", label: "Primary Accent", color: "var(--accent)" },
    { name: "--ok", label: "Verified / Addressed", color: "var(--ok)" },
    { name: "--warn", label: "Needs Review", color: "var(--warn)" },
  ];

  return (
    <div data-studio-ready="design-system" className="py-8 px-9 flex flex-col gap-7 bg-surface min-h-screen">
      <header className="grid grid-cols-[1.2fr_1fr] gap-5 items-start pb-5 border-b border-line">
        <div>
          <span className="text-[11px] tracking-[0.08em] font-bold text-brand">DESIGN SYSTEM STUDIO</span>
          <h1 className="mt-1.5 mb-2 text-[28px] font-bold tracking-[-0.02em]">先看清，再迭代。</h1>
          <p className="m-0 text-muted">
            Live CSS token & component specimen reading directly from the running app tokens across light & dark modes.
          </p>
        </div>
        <div className="bg-surface-subtle border border-line rounded-[10px] p-3.5 flex flex-col gap-1.5 text-[12.5px] text-muted">
          <strong className="text-ink">Token Principles</strong>
          <span>Zero drift between prototype artboards and production components — every surface reads live CSS custom properties.</span>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-sm font-semibold text-muted">01 · Color Palette & Surfaces</h2>
        <div className="flex flex-wrap gap-3">
          {neutralSwatches.map((t) => (
            <div key={t.name} className="w-[140px] p-2.5 rounded-[10px] border border-line bg-surface">
              <div
                className="h-9 rounded-md mb-2 border border-line"
                style={{ background: `var(${t.name})` }}
              />
              <code>{t.name}</code>
              <span className="text-[11px] text-muted block">{t.hex}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mt-2.5">
          {semanticSwatches.map((t) => (
            <div key={t.name} className="w-[180px] p-2.5 rounded-[10px] border border-line bg-surface">
              <div className="h-9 rounded-md mb-2" style={{ background: t.color }} />
              <strong>{t.label}</strong>
              <code className="block text-[11px] text-muted">{t.name}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-sm font-semibold text-muted">02 · Typography & Metrics</h2>
        <div className="border border-line rounded-[10px] overflow-hidden">
          <div className="grid grid-cols-[120px_1fr_120px] items-center gap-3 py-2.5 px-3.5 border-b border-line text-[13px]">
            <span>Display / H1</span>
            <strong className="text-2xl tracking-[-0.02em]">Workspace Overview</strong>
            <code className="text-right text-muted text-[11.5px]">24px / 700</code>
          </div>
          <div className="grid grid-cols-[120px_1fr_120px] items-center gap-3 py-2.5 px-3.5 border-b border-line text-[13px]">
            <span>Metric Figure</span>
            <strong className="text-[22px] tabular-nums">11.4 ms · 78%</strong>
            <code className="text-right text-muted text-[11.5px]">tabular-nums</code>
          </div>
          <div className="grid grid-cols-[120px_1fr_120px] items-center gap-3 py-2.5 px-3.5 text-[13px]">
            <span>Body Copy</span>
            <span>Aligned spacing across responsive breakpoints</span>
            <code className="text-right text-muted text-[11.5px]">14px / 400</code>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-sm font-semibold text-muted">03 · Controls & Status Meters</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          <div className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2">
            <strong>Action Hierarchy</strong>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                className="border border-brand bg-brand text-white rounded-lg py-[7px] px-3 font-medium"
              >
                Confirm Changes
              </button>
              <button
                type="button"
                className="border border-line bg-surface text-ink rounded-lg py-[7px] px-3 font-medium"
              >
                Inspect
              </button>
            </div>
          </div>

          <div className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2">
            <strong>Progress Rails</strong>
            <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
              <div className="h-full bg-brand rounded-full w-[78%]" />
            </div>
            <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
              <div className="h-full bg-ok rounded-full w-[64%]" />
            </div>
            <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
              <div className="h-full bg-warn rounded-full w-[35%]" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
