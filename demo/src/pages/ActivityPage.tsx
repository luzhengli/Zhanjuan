import React, { useState } from "react";

interface TimelineEntry {
  id: string;
  kind: "build" | "review";
  title: string;
  detail: string;
  at: string;
}

const ENTRIES: TimelineEntry[] = [
  { id: "1", kind: "review", title: "Pinned layout note", detail: "Aligned progress meter edge", at: "10:14" },
  { id: "2", kind: "build", title: "Verified responsive breakpoints", detail: "1440px, 960px, 760px", at: "10:22" },
  { id: "3", kind: "review", title: "Frozen proposal baseline", detail: "Compact Header vs Workspace", at: "10:40" },
];

export const ActivityPage: React.FC = () => {
  const [filter, setFilter] = useState<"all" | "review" | "build">("all");
  const visible = ENTRIES.filter((e) => filter === "all" || e.kind === filter);

  return (
    <div data-page="activity" className="py-6 px-7 flex flex-col gap-[18px]">
      <header className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-[22px] font-bold">Activity Timeline</h1>
        <div className="flex items-center gap-2.5">
          {(["all", "review", "build"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`border rounded-lg py-[7px] px-3 font-medium ${
                filter === f
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-ink"
              }`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-col gap-2.5">
        {visible.map((item) => (
          <div
            key={item.id}
            className="bg-surface border border-line rounded-[10px] py-3 px-3.5 flex items-center justify-between"
          >
            <div>
              <strong>{item.title}</strong>
              <div className="text-muted text-xs">{item.detail}</div>
            </div>
            <code>{item.at}</code>
          </div>
        ))}
      </div>
    </div>
  );
};
