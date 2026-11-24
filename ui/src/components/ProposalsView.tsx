import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardConfig, NoteAnchor, NoteIntent, ProposalItem } from "../../../src/shared/types.js";
import { saveSnapshotApi } from "../api.js";
import { buildPaneUrl, sendBridgeRequest } from "../bridgeClient.js";
import type { DockToolMode } from "./CanvasDock.js";
import { LockIcon, RefreshIcon } from "./Icons.js";
import { NoteComposer, type DraftPinState } from "./NoteComposer.js";

interface ProposalsViewProps {
  proposals: ProposalItem[];
  boards: BoardConfig[];
  initialProposalId?: string | null;
  toolMode: DockToolMode;
  onChangeToolMode: (mode: DockToolMode) => void;
  onCreateNote: (payload: {
    board: string;
    route: string;
    viewport: { width: number; height: number };
    theme: "light" | "dark";
    anchor: NoteAnchor;
    intent: NoteIntent;
    body: string;
    cropDataUrl?: string | null;
  }) => Promise<void>;
}

export const ProposalsView: React.FC<ProposalsViewProps> = ({
  proposals,
  boards,
  initialProposalId,
  toolMode,
  onChangeToolMode,
  onCreateNote,
}) => {
  const [selectedId, setSelectedId] = useState<string>(initialProposalId ?? proposals[0]?.id ?? "");
  const [compareBoardId, setCompareBoardId] = useState<string>("");
  const [frozenSnapshotUrl, setFrozenSnapshotUrl] = useState<string | null>(null);
  const [freezing, setFreezing] = useState(false);
  const [hoverAnchor, setHoverAnchor] = useState<NoteAnchor | null>(null);
  const [draft, setDraft] = useState<DraftPinState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const proposalIframeRef = useRef<HTMLIFrameElement | null>(null);
  const helperBaselineIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (initialProposalId) {
      setSelectedId(initialProposalId);
    }
  }, [initialProposalId]);

  const activeProposal = useMemo(
    () => proposals.find((p) => p.id === selectedId) ?? proposals[0] ?? null,
    [proposals, selectedId],
  );

  const baseBoard = useMemo(() => {
    const wanted = compareBoardId || activeProposal?.baseBoard;
    return boards.find((b) => b.id === wanted) ?? boards[0] ?? null;
  }, [boards, compareBoardId, activeProposal?.baseBoard]);

  const freezeBaseline = useCallback(async () => {
    if (!baseBoard) return;
    setFreezing(true);
    setFrozenSnapshotUrl(null);
  }, [baseBoard]);

  const handleHelperBaselineLoad = useCallback(async () => {
    if (!baseBoard) return;
    setFreezing(true);
    try {
      await new Promise((r) => setTimeout(r, 380));
      const snap = await sendBridgeRequest<{ html: string }>(
        helperBaselineIframeRef.current,
        "zj:snapshot-dom",
        {},
        3000,
      );
      if (snap.html) {
        const saved = await saveSnapshotApi(`baseline-${baseBoard.id}`, { html: snap.html });
        setFrozenSnapshotUrl(saved.assetUrl);
      }
    } catch {
      // Fallback handled cleanly in UI.
    } finally {
      setFreezing(false);
    }
  }, [baseBoard]);

  useEffect(() => {
    setFrozenSnapshotUrl(null);
  }, [baseBoard?.id, activeProposal?.id]);

  if (proposals.length === 0) {
    return (
      <div className="p-12 text-center text-muted" data-testid="proposals-view">
        <h3 className="text-ink font-semibold text-base mb-2">当前项目暂无方案提案</h3>
        <p>在 <code>.harness/canvas.json</code> 配置提案目录后，探索稿会自动出现在这里与现行页面并排对照。</p>
      </div>
    );
  }

  const pickActive = toolMode === "pick" || toolMode === "region";

  return (
    <div className="flex-1 min-h-0 flex flex-col pt-2.5" data-testid="proposals-view">
      <div className="pt-0.5 pr-[18px] pb-2.5 pl-[188px] min-h-11 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex gap-1.5">
          {proposals.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`py-[5px] px-3 rounded-full border text-[12.5px] font-medium ${
                activeProposal?.id === p.id
                  ? "bg-ink border-ink text-white"
                  : "border-hairline bg-chrome text-muted hover:bg-subtle hover:text-ink"
              }`}
              onClick={() => setSelectedId(p.id)}
            >
              {p.title}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {activeProposal?.description && (
            <span className="text-dim text-[12px]">{activeProposal.description}</span>
          )}
          {boards.length > 0 && (
            <select
              className="inline-flex items-center gap-1.5 h-[30px] px-[11px] rounded-[9px] border border-hairline bg-chrome text-ink text-[12.5px] font-medium cursor-pointer"
              value={baseBoard?.id ?? ""}
              onChange={(e) => setCompareBoardId(e.target.value)}
              aria-label="选择对照基准页面"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  对比: {b.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-2 gap-5 pt-1.5 px-6 pb-[86px]">
        <section className="min-h-0 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2.5 min-h-6">
            <div className="flex items-center gap-[7px] text-[13px] font-medium text-muted">
              <span>现行版本 · {baseBoard?.title ?? "基准页"}</span>
              <span
                className="inline-flex items-center gap-1 py-0.5 px-2 rounded-full text-[11px] bg-pin-open/12 text-[#c2410c]"
                title="已锁定为无脚本静态快照，修改共享组件时不会误改对照基准"
              >
                <LockIcon size={11} />
                {freezing ? "正在锁定..." : "已锁定基准"}
              </span>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center w-6 h-6 border-0 rounded-md bg-transparent text-dim hover:bg-black/6 hover:text-ink"
              onClick={() => void freezeBaseline()}
              title="重新锁定现行版本快照"
            >
              <RefreshIcon size={13} />
            </button>
          </div>

          {baseBoard && !frozenSnapshotUrl && (
            <iframe
              key={`prop-base-${baseBoard.id}`}
              ref={helperBaselineIframeRef}
              src={buildPaneUrl(baseBoard.route, {
                theme: baseBoard.defaultTheme ?? "light",
                ns: "proposal-helper",
              })}
              title="Baseline freeze sampler"
              className="fixed -left-[9999px] top-0 w-[1280px] h-[800px] invisible"
              onLoad={() => void handleHelperBaselineLoad()}
            />
          )}

          <div className="flex-1 min-h-0 relative border border-black/8 rounded-[14px] overflow-hidden bg-white shadow-artboard">
            {frozenSnapshotUrl ? (
              <iframe
                sandbox=""
                src={frozenSnapshotUrl}
                title="Frozen baseline"
                className="w-full h-full min-h-[600px] border-0 block"
                data-testid="frozen-baseline-iframe"
              />
            ) : (
              <div className="h-full min-h-[520px] p-[26px] flex flex-col gap-3.5 bg-gradient-to-b from-white to-[#fafaf9]">
                <div className="h-[22px] w-[45%] rounded-md bg-[#efefec]" />
                <div className="h-3.5 w-[70%] rounded-md bg-[#efefec]" />
                <div className="mt-2 grid grid-cols-2 gap-3 flex-1">
                  <div className="rounded-[10px] bg-[#f5f5f2] border border-[#ecece8]" />
                  <div className="rounded-[10px] bg-[#f5f5f2] border border-[#ecece8]" />
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="min-h-0 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2.5 min-h-6">
            <div className="flex items-center gap-[7px] text-[13px] font-medium text-muted">
              <span>{activeProposal?.title}</span>
              <span className="py-0.5 px-2 rounded-full text-[11px] bg-accent-soft text-accent">
                方案活页
              </span>
            </div>
            {pickActive && (
              <span className="text-[12px] text-accent font-medium">点击提案内任意元素添加批注</span>
            )}
          </div>

          <div className="flex-1 min-h-0 relative border border-black/8 rounded-[14px] overflow-hidden bg-white shadow-artboard">
            {activeProposal && (
              <iframe
                ref={proposalIframeRef}
                src={buildPaneUrl(activeProposal.route, {
                  theme: baseBoard?.defaultTheme ?? "light",
                  ns: `proposal-${activeProposal.id}`,
                })}
                title={activeProposal.title}
                className="w-full h-full min-h-[600px] border-0 block"
                data-testid="live-proposal-iframe"
              />
            )}

            {pickActive && activeProposal && (
              <div
                className="absolute inset-0 z-[8] cursor-pointer"
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  void sendBridgeRequest<{ anchor: NoteAnchor | null }>(
                    proposalIframeRef.current,
                    "zj:hit-test",
                    { x, y },
                  )
                    .then((res) => setHoverAnchor(res.anchor ?? null))
                    .catch(() => undefined);
                }}
                onMouseDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  setDraft({
                    board: `proposal:${activeProposal.id}`,
                    route: activeProposal.route,
                    viewport: { width: Math.round(rect.width), height: Math.round(rect.height) },
                    theme: baseBoard?.defaultTheme ?? "light",
                    anchor: hoverAnchor ?? { bbox: { x: Math.round(x), y: Math.round(y), w: 80, h: 40 } },
                    screenX: x,
                    screenY: y,
                  });
                }}
              >
                {hoverAnchor?.bbox && (
                  <div
                    className="absolute border-2 border-accent bg-accent/8 rounded-[5px] pointer-events-none"
                    style={{
                      left: `${hoverAnchor.bbox.x}px`,
                      top: `${hoverAnchor.bbox.y}px`,
                      width: `${hoverAnchor.bbox.w}px`,
                      height: `${hoverAnchor.bbox.h}px`,
                    }}
                  >
                    <div className="absolute -top-[26px] -left-0.5 py-0.5 px-2 rounded-md bg-ink text-white font-mono text-[11px] whitespace-nowrap shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                      {(hoverAnchor.dataSource?.split("/").pop() ?? hoverAnchor.tagName) || "元素"}
                    </div>
                  </div>
                )}
              </div>
            )}

            {draft && (
              <div className="absolute z-20 w-[332px] left-5 top-5">
                <NoteComposer
                  draft={draft}
                  submitting={submitting}
                  onCancel={() => setDraft(null)}
                  onAttachCrop={(dataUrl) => setDraft((prev) => (prev ? { ...prev, cropDataUrl: dataUrl } : null))}
                  onSubmit={async ({ intent, body }) => {
                    setSubmitting(true);
                    try {
                      await onCreateNote({
                        board: draft.board,
                        route: draft.route,
                        viewport: draft.viewport,
                        theme: draft.theme,
                        anchor: draft.anchor,
                        intent,
                        body,
                        cropDataUrl: draft.cropDataUrl,
                      });
                      setDraft(null);
                      onChangeToolMode("interact");
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
