import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApprovedReferenceItem,
  BoardAssetSummary,
  BoardConfig,
  CanvasNote,
  DesignSystemBoardConfig,
} from "../../../src/shared/types.js";
import { buildPaneUrl, sendBridgeRequest } from "../bridgeClient.js";
import { ZoomPill, type DockToolMode } from "./CanvasDock.js";
import { CloseIcon, CompareIcon, PlayIcon, RefreshIcon } from "./Icons.js";

export type ComparePreset = "single" | "theme" | "viewport" | "dual";

interface OverviewCanvasProps {
  designSystemBoard: DesignSystemBoardConfig | null;
  boards: BoardConfig[];
  assets: BoardAssetSummary[];
  approvedReferences: ApprovedReferenceItem[];
  notes: CanvasNote[];
  aliveBoardIds: string[];
  activeTool: DockToolMode;
  onFocusBoard: (boardId: string, opts?: { compare?: ComparePreset }) => void;
  onSaveThumb: (
    boardId: string,
    theme: "light" | "dark",
    payload: { dataUrl?: string; html?: string },
  ) => Promise<void>;
}

const iconActionBtn =
  "inline-flex items-center justify-center w-6 h-6 border-0 rounded-md bg-transparent text-dim hover:bg-black/6 hover:text-ink";

export const OverviewCanvas: React.FC<OverviewCanvasProps> = ({
  designSystemBoard,
  boards,
  assets,
  approvedReferences,
  notes,
  aliveBoardIds,
  activeTool,
  onFocusBoard,
  onSaveThumb,
}) => {
  const [pan, setPan] = useState({ x: 56, y: 54 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [refPreview, setRefPreview] = useState<ApprovedReferenceItem | null>(null);
  const [attemptedIds, setAttemptedIds] = useState<Set<string>>(() => new Set());
  const [resamplingBoard, setResamplingBoard] = useState<BoardConfig | null>(null);

  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const samplerIframeRef = useRef<HTMLIFrameElement | null>(null);
  const manualSamplerRef = useRef<HTMLIFrameElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const assetMap = useMemo(() => {
    const map = new Map<string, BoardAssetSummary>();
    for (const a of assets) map.set(a.boardId, a);
    return map;
  }, [assets]);

  const noteCountsByBoard = useMemo(() => {
    const map = new Map<string, { open: number; working: number; addressed: number }>();
    for (const n of notes) {
      const cur = map.get(n.board) ?? { open: 0, working: 0, addressed: 0 };
      if (n.status === "open") cur.open += 1;
      else if (n.status === "working") cur.working += 1;
      else if (n.status === "addressed") cur.addressed += 1;
      map.set(n.board, cur);
    }
    return map;
  }, [notes]);

  const allBoards = useMemo<BoardConfig[]>(() => {
    const list: BoardConfig[] = [];
    if (designSystemBoard) list.push(designSystemBoard);
    list.push(...boards);
    return list;
  }, [designSystemBoard, boards]);

  const samplingBoard = useMemo<BoardConfig | null>(() => {
    for (const b of allBoards) {
      if (attemptedIds.has(b.id)) continue;
      const asset = assetMap.get(b.id);
      const hasPreview = Boolean(
        asset?.thumbLight || asset?.thumbDark || asset?.baselineUrl || asset?.snapshotLight || asset?.snapshotDark,
      );
      if (!hasPreview) {
        return b;
      }
    }
    return null;
  }, [allBoards, assetMap, attemptedIds]);

  const handleSamplerLoad = async () => {
    const target = samplingBoard;
    if (!target) return;
    const theme = target.defaultTheme ?? "light";
    try {
      await new Promise((r) => setTimeout(r, 380));
      const snap = await sendBridgeRequest<{ html: string }>(
        samplerIframeRef.current,
        "zj:snapshot-dom",
        {},
        3000,
      );
      if (snap.html) {
        await onSaveThumb(target.id, theme, { html: snap.html });
      }
    } catch {
      // Fall back cleanly if target route failed to snapshot.
    } finally {
      setAttemptedIds((prev) => {
        const next = new Set(prev);
        next.add(target.id);
        return next;
      });
    }
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w > 0 && w < 1140) {
      const targetZoom = Math.max(0.62, Number(((w - 80) / 1040).toFixed(2)));
      setZoom(targetZoom);
      setPan({ x: 32, y: 48 });
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const forcePan = activeTool === "hand" || e.button === 1;
    if (!forcePan && target.closest("[data-pan-ignore]")) {
      return;
    }
    setDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragRef.current) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoom((prev) => Math.min(1.75, Math.max(0.4, Number((prev * factor).toFixed(2)))));
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  const fitCanvas = () => {
    const w = viewportRef.current?.clientWidth ?? 1280;
    const fitZoom = w < 1140 ? Math.max(0.62, Number(((w - 80) / 1040).toFixed(2))) : 1;
    setZoom(fitZoom);
    setPan({ x: w < 1140 ? 32 : 56, y: 54 });
  };

  const refreshBoardPreview = (boardId: string) => {
    setAttemptedIds((prev) => {
      const next = new Set(prev);
      next.delete(boardId);
      return next;
    });
    const target = allBoards.find((b) => b.id === boardId);
    if (target) setResamplingBoard(target);
  };

  const handleManualResampleLoad = async () => {
    if (!resamplingBoard) return;
    const theme = resamplingBoard.defaultTheme ?? "light";
    try {
      await new Promise((r) => setTimeout(r, 380));
      const snap = await sendBridgeRequest<{ html: string }>(
        manualSamplerRef.current,
        "zj:snapshot-dom",
        {},
        3000,
      );
      if (snap.html) {
        await onSaveThumb(resamplingBoard.id, theme, { html: snap.html });
      }
    } catch {
      // Ignore transient error.
    } finally {
      setResamplingBoard(null);
    }
  };

  const renderArtboard = (board: BoardConfig, variant: "design-system" | "screen") => {
    const theme = board.defaultTheme ?? "light";
    const asset = assetMap.get(board.id);
    const thumbUrl =
      theme === "dark" ? asset?.thumbDark || asset?.thumbLight : asset?.thumbLight || asset?.thumbDark;
    const snapUrl =
      theme === "dark" ? asset?.snapshotDark || asset?.snapshotLight : asset?.snapshotLight || asset?.snapshotDark;
    const previewImage = thumbUrl || asset?.baselineUrl || null;
    const counts = noteCountsByBoard.get(board.id) ?? { open: 0, working: 0, addressed: 0 };
    const totalPending = counts.open + counts.working;
    const isAlive = aliveBoardIds.includes(board.id);
    const isDs = variant === "design-system";

    return (
      <div key={board.id} className="flex flex-col gap-2" data-board-card={board.id}>
        <div className="flex items-center justify-between gap-2.5 min-h-6" data-pan-ignore="true">
          <div className="flex items-center gap-[7px] text-[13px] font-medium text-muted">
            <span>{board.title}</span>
            {isAlive && <span className="w-1.5 h-1.5 rounded-full bg-pin-working" title="活页状态保活中" />}
            {totalPending > 0 && (
              <span
                className="min-w-[18px] h-[18px] px-[5px] rounded-full text-[11px] font-semibold text-white inline-flex items-center justify-center bg-pin-open"
                title={`${totalPending} 条待处理批注`}
              >
                {totalPending}
              </span>
            )}
            {counts.addressed > 0 && (
              <span
                className="min-w-[18px] h-[18px] px-[5px] rounded-full text-[11px] font-semibold text-white inline-flex items-center justify-center bg-pin-addressed"
                title={`${counts.addressed} 条待验收`}
              >
                {counts.addressed}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className={iconActionBtn}
              onClick={() => refreshBoardPreview(board.id)}
              title="刷新画板快照"
            >
              <RefreshIcon size={13} />
            </button>
            <button
              type="button"
              className={iconActionBtn}
              onClick={() => onFocusBoard(board.id, { compare: "theme" })}
              title="浅色 / 深色并排对照"
            >
              <CompareIcon size={13} />
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-full border border-strong bg-chrome text-ink text-[10.5px] font-bold tracking-[0.03em] hover:bg-ink hover:border-ink hover:text-white transition-colors"
              onClick={() => onFocusBoard(board.id)}
              aria-label="进入活页"
              title="进入可交互活页"
            >
              <PlayIcon size={10} />
              <span>PLAY</span>
            </button>
          </div>
        </div>

        <div
          data-pan-ignore="true"
          className={`bg-chrome rounded-[10px] border border-black/6 shadow-artboard overflow-hidden relative cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.08),0_18px_40px_rgba(0,0,0,0.08)] ${
            isDs ? "w-[430px] h-[680px]" : "w-[540px] h-[330px]"
          }`}
          onClick={() => {
            if (activeTool === "hand") return;
            onFocusBoard(board.id);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onFocusBoard(board.id);
            }
          }}
        >
          {previewImage ? (
            <img src={previewImage} alt={board.title} className="w-full h-full object-cover object-top-left block" />
          ) : snapUrl ? (
            <iframe
              sandbox=""
              src={snapUrl}
              title={`${board.title} preview`}
              className={`border-0 pointer-events-none block origin-top-left bg-white ${
                isDs
                  ? "w-[960px] h-[1518px] scale-[0.447916]"
                  : "w-[1280px] h-[782px] scale-[0.421875]"
              }`}
            />
          ) : (
            <div className="h-full p-[26px] flex flex-col gap-3.5 bg-gradient-to-b from-white to-[#fafaf9]">
              <div className="h-[22px] w-[45%] rounded-md bg-[#efefec]" />
              <div className="h-3.5 w-[70%] rounded-md bg-[#efefec]" />
              <div className="mt-2 grid grid-cols-2 gap-3 flex-1">
                <div className="rounded-[10px] bg-[#f5f5f2] border border-[#ecece8]" />
                <div className="rounded-[10px] bg-[#f5f5f2] border border-[#ecece8]" />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={viewportRef}
      className={`flex-1 relative overflow-hidden bg-studio z-[1] select-none ${
        dragging ? "cursor-grabbing" : activeTool === "hand" ? "cursor-grab" : ""
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      data-testid="overview-canvas"
    >
      {samplingBoard && (
        <iframe
          key={`auto-${samplingBoard.id}`}
          ref={samplerIframeRef}
          src={buildPaneUrl(samplingBoard.route, {
            theme: samplingBoard.defaultTheme ?? "light",
            ns: "overview-sampler",
          })}
          title="Background artboard preview sampler"
          className="fixed -left-[9999px] top-0 w-[1280px] h-[800px] invisible"
          onLoad={() => void handleSamplerLoad()}
        />
      )}

      {resamplingBoard && (
        <iframe
          key={`manual-${resamplingBoard.id}`}
          ref={manualSamplerRef}
          src={buildPaneUrl(resamplingBoard.route, {
            theme: resamplingBoard.defaultTheme ?? "light",
            ns: "overview-sampler",
          })}
          title="Manual artboard refresh sampler"
          className="fixed -left-[9999px] top-0 w-[1280px] h-[800px] invisible"
          onLoad={() => void handleManualResampleLoad()}
        />
      )}

      <div
        className="absolute top-0 left-0 pb-[120px]"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <div className="flex items-start gap-[44px]">
          {designSystemBoard && (
            <section className="flex flex-col gap-3.5">
              <h2 className="m-0 text-[15px] font-semibold text-ink tracking-[-0.01em]">设计系统</h2>
              {renderArtboard(designSystemBoard, "design-system")}
            </section>
          )}

          <section className="flex flex-col gap-3.5">
            <h2 className="m-0 text-[15px] font-semibold text-ink tracking-[-0.01em]">页面画板</h2>
            <div className="flex flex-col gap-7">
              {boards.map((board) => renderArtboard(board, "screen"))}
            </div>

            {approvedReferences.length > 0 && (
              <div className="mt-4 flex flex-col gap-3.5">
                <h2 className="m-0 text-[15px] font-semibold text-ink tracking-[-0.01em]">批准参考图</h2>
                <div className="flex flex-col gap-7">
                  {approvedReferences.map((refItem) => (
                    <div key={refItem.path} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2.5 min-h-6" data-pan-ignore="true">
                        <div className="flex items-center gap-[7px] text-[13px] font-medium text-muted">
                          <span>{refItem.title}</span>
                          <span className="text-[11px] px-1.5 py-px rounded-full bg-pin-addressed/12 text-pin-addressed">
                            只读参考
                          </span>
                        </div>
                      </div>
                      <div
                        data-pan-ignore="true"
                        className="w-[540px] h-[330px] bg-chrome rounded-[10px] border border-black/6 shadow-artboard overflow-hidden relative cursor-pointer"
                        onClick={() => setRefPreview(refItem)}
                      >
                        <img
                          src={refItem.url}
                          alt={refItem.title}
                          className="w-full h-full object-cover object-top-left block"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <ZoomPill zoom={zoom} onChangeZoom={setZoom} onReset={fitCanvas} />

      {refPreview && (
        <div
          className="fixed inset-0 bg-black/45 flex items-center justify-center z-[60]"
          onClick={() => setRefPreview(null)}
        >
          <div
            className="max-w-[90vw] max-h-[90vh] bg-chrome border border-hairline rounded-[14px] p-3.5 shadow-float flex flex-col gap-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between">
              <strong>{refPreview.title}（只读批准参考）</strong>
              <button type="button" className={iconActionBtn} onClick={() => setRefPreview(null)}>
                <CloseIcon />
              </button>
            </header>
            <img src={refPreview.url} alt={refPreview.title} className="max-w-[85vw] max-h-[80vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  );
};
