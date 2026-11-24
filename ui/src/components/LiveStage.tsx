import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardConfig, CanvasNote, NoteAnchor, NoteIntent, NoteStatus } from "../../../src/shared/types.js";
import {
  buildPaneUrl,
  hitTestFrozenGeometry,
  sendBridgeRequest,
  type BridgeLocateResult,
  type GeometryMapItem,
} from "../bridgeClient.js";
import { screenCapture, type CaptureStatus, type CapturedFrame } from "../capture/screenCapture.js";
import type { DockToolMode } from "./CanvasDock.js";
import { ChevronDownIcon, CompareIcon, MoonIcon, RefreshIcon, SlidersIcon, SunIcon } from "./Icons.js";
import { NoteComposer, type DraftPinState } from "./NoteComposer.js";
import type { ComparePreset } from "./OverviewCanvas.js";

interface LiveStageProps {
  boards: BoardConfig[];
  activeBoardId: string;
  isVisible: boolean;
  compareMode: ComparePreset;
  notes: CanvasNote[];
  selectedNoteId: string | null;
  captureStatus: CaptureStatus;
  toolMode: DockToolMode;
  holdCompareB: boolean;
  onChangeBoard: (boardId: string) => void;
  onChangeCompareMode: (mode: ComparePreset) => void;
  onChangeToolMode: (mode: DockToolMode) => void;
  onFrozenChange?: (frozen: boolean) => void;
  onExitFocus: () => void;
  onAliveBoardsChange: (boardIds: string[]) => void;
  onSelectNote: (note: CanvasNote) => void;
  onSaveThumb: (boardId: string, theme: "light" | "dark", payload: { dataUrl?: string; html?: string }) => Promise<void>;
  onCreateNote: (payload: {
    board: string;
    route: string;
    viewport: { width: number; height: number };
    theme: "light" | "dark";
    anchor: NoteAnchor;
    intent: NoteIntent;
    body: string;
    cropDataUrl?: string | null;
    beforeSnapshotDataUrl?: string | null;
  }) => Promise<void>;
  onUpdateDraftCrop?: (fn: (dataUrl: string) => void) => void;
}

interface FrozenState {
  frame: CapturedFrame;
  geometry: GeometryMapItem[];
  viewport: { width: number; height: number };
}

interface BeforeCompareState {
  note: CanvasNote;
  mode: "overlay" | "side-by-side";
  reason: string;
  liveBbox: { x: number; y: number; w: number; h: number } | null;
}

const COMPARE_LABELS: Record<ComparePreset, string> = {
  single: "单页审阅",
  theme: "浅 / 深对照",
  viewport: "宽 / 窄对照",
  dual: "双页对照",
};

const PIN_MARKER_BG: Record<NoteStatus, string> = {
  open: "bg-pin-open",
  working: "bg-pin-working animate-pin-pulse",
  addressed: "bg-pin-addressed",
  resolved: "bg-pin-resolved",
};

const pillSelectCls =
  "inline-flex items-center gap-1.5 h-[30px] px-[11px] rounded-[9px] border border-hairline bg-chrome text-ink text-[12.5px] font-medium cursor-pointer";
const popoverBoxCls =
  "absolute top-[calc(100%+6px)] min-w-[220px] p-2.5 rounded-xl bg-chrome border border-hairline shadow-float z-50 flex flex-col gap-2.5";

export const LiveStage: React.FC<LiveStageProps> = ({
  boards,
  activeBoardId,
  isVisible,
  compareMode,
  notes,
  selectedNoteId,
  captureStatus,
  toolMode,
  holdCompareB,
  onChangeBoard,
  onChangeCompareMode,
  onChangeToolMode,
  onFrozenChange,
  onExitFocus,
  onAliveBoardsChange,
  onSelectNote,
  onSaveThumb,
  onCreateNote,
  onUpdateDraftCrop,
}) => {
  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? boards[0]!,
    [boards, activeBoardId],
  );
  const secondaryBoardDefault = useMemo(
    () => boards.find((b) => b.id !== activeBoard.id) ?? activeBoard,
    [boards, activeBoard.id],
  );

  const [viewportWidth, setViewportWidth] = useState<number>(activeBoard.viewports?.[0] ?? 1440);
  const [theme, setTheme] = useState<"light" | "dark">(activeBoard.defaultTheme ?? "light");
  const [secondaryBoardId, setSecondaryBoardId] = useState<string>(secondaryBoardDefault.id);
  const [narrowWidth, setNarrowWidth] = useState<number>(760);

  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const [compareMenuOpen, setCompareMenuOpen] = useState(false);

  const [poolIds, setPoolIds] = useState<string[]>([activeBoard.id]);
  const primaryIframeRef = useRef<HTMLIFrameElement | null>(null);
  const primaryBoxRef = useRef<HTMLDivElement | null>(null);
  const secondaryIframeRef = useRef<HTMLIFrameElement | null>(null);

  const [hoverAnchor, setHoverAnchor] = useState<NoteAnchor | null>(null);
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const [frozen, setFrozen] = useState<FrozenState | null>(null);
  const [draft, setDraft] = useState<DraftPinState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bCompare, setBCompare] = useState<BeforeCompareState | null>(null);

  const hoverRafRef = useRef<number | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setViewportWidth(activeBoard.viewports?.[0] ?? 1440);
    setTheme(activeBoard.defaultTheme ?? "light");
    setFrozen(null);
    setHoverAnchor(null);
    setDraft(null);
  }, [activeBoard.id]);

  useEffect(() => {
    onFrozenChange?.(Boolean(frozen));
  }, [frozen, onFrozenChange]);

  useEffect(() => {
    const cap = compareMode === "single" ? 1 : 2;
    const secondary = compareMode === "dual" ? secondaryBoardId : activeBoard.id;
    const nextIds: string[] = [activeBoard.id];
    if (cap === 2 && !nextIds.includes(secondary)) {
      nextIds.push(secondary);
    }
    setPoolIds((prev) => {
      const merged = [...nextIds];
      for (const oldId of prev) {
        if (merged.length >= cap) break;
        if (!merged.includes(oldId)) {
          const hasPending = notes.some((n) => n.board === oldId && n.status !== "resolved");
          if (hasPending) merged.push(oldId);
        }
      }
      return merged.slice(0, cap);
    });
  }, [activeBoard.id, compareMode, secondaryBoardId, notes]);

  useEffect(() => {
    onAliveBoardsChange(poolIds);
  }, [poolIds, onAliveBoardsChange]);

  useEffect(() => {
    const win = primaryIframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ __zhanjuan: true, type: "zj:set-theme", theme }, window.location.origin);
    }
  }, [theme]);

  useEffect(() => {
    if (!onUpdateDraftCrop) return;
    onUpdateDraftCrop((dataUrl: string) => {
      setDraft((prev) => (prev ? { ...prev, cropDataUrl: dataUrl } : prev));
    });
  }, [onUpdateDraftCrop]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => {
      setNotice((cur) => (cur === msg ? null : cur));
    }, 3500);
  }, []);

  const captureLiveThumb = useCallback(async () => {
    const boxEl = primaryBoxRef.current;
    if (captureStatus === "active" && boxEl) {
      const frame = screenCapture.captureElementFrame(boxEl);
      if (frame) {
        await onSaveThumb(activeBoard.id, theme, { dataUrl: frame.fullDataUrl });
        showNotice(`已刷新 ${activeBoard.title} 预览图`);
        return;
      }
    }
    try {
      const snap = await sendBridgeRequest<{ html: string }>(primaryIframeRef.current, "zj:snapshot-dom");
      if (snap.html) {
        await onSaveThumb(activeBoard.id, theme, { html: snap.html });
        showNotice(`已刷新 ${activeBoard.title} 画板快照`);
      }
    } catch {
      showNotice("页面尚未就绪，稍后再试");
    }
  }, [captureStatus, activeBoard.id, activeBoard.title, theme, onSaveThumb, showNotice]);

  const triggerFreeze = useCallback(async () => {
    if (frozen) {
      setFrozen(null);
      setHoverAnchor(null);
      return;
    }

    let ok = captureStatus === "active";
    if (!ok) {
      ok = await screenCapture.ensureSession();
    }

    const boxEl = primaryBoxRef.current;
    if (!ok || !boxEl) {
      showNotice("当前为纯语义批注模式（未启用截帧授权或非 Chromium 浏览器，可直接点选或 ⌘V 贴图）");
      onChangeToolMode("pick");
      return;
    }

    try {
      const [geomRes, frame] = await Promise.all([
        sendBridgeRequest<{ items: GeometryMapItem[]; viewport: { width: number; height: number } }>(
          primaryIframeRef.current,
          "zj:capture-geometry-map",
        ).catch(() => ({ items: [], viewport: { width: viewportWidth, height: 760 } })),
        Promise.resolve(screenCapture.captureElementFrame(boxEl)),
      ]);

      if (!frame) {
        showNotice("未能截取当前标签页画面，已切换至直接点选");
        return;
      }

      setFrozen({
        frame,
        geometry: geomRes.items ?? [],
        viewport: geomRes.viewport ?? { width: viewportWidth, height: 760 },
      });
      onChangeToolMode("pick");
    } catch {
      showNotice("定格画面失败，已切换至直接点选");
    }
  }, [frozen, captureStatus, viewportWidth, showNotice, onChangeToolMode]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isVisible) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.__zhanjuan !== true || typeof data.type !== "string") return;

      if (data.type === "zj:exit-focus") {
        onExitFocus();
      } else if (data.type === "zj:quick-pick") {
        const anchor = (data.anchor as NoteAnchor) ?? {};
        const clientX = Number(data.clientX ?? 200);
        const clientY = Number(data.clientY ?? 200);
        const boxEl = primaryBoxRef.current;
        let cropDataUrl: string | null = null;
        let beforeSnapshotDataUrl: string | null = null;
        if (captureStatus === "active" && boxEl) {
          const frame = screenCapture.captureElementFrame(boxEl);
          if (frame) {
            beforeSnapshotDataUrl = frame.fullDataUrl;
            const targetBox = anchor.bbox ?? { x: Math.max(0, clientX - 60), y: Math.max(0, clientY - 30), w: 120, h: 60 };
            cropDataUrl = frame.cropRect({
              x: Math.max(0, targetBox.x - 16),
              y: Math.max(0, targetBox.y - 16),
              w: targetBox.w + 32,
              h: targetBox.h + 32,
            });
          }
        }
        setDraft({
          board: activeBoard.id,
          route: activeBoard.route,
          viewport: { width: viewportWidth, height: boxEl?.clientHeight || 780 },
          theme,
          anchor,
          cropDataUrl,
          beforeSnapshotDataUrl,
          screenX: clientX,
          screenY: clientY,
        });
      } else if (data.type === "zj:hotkey") {
        const key = String(data.key ?? "");
        const phase = String(data.phase ?? "keydown");
        if (phase === "keydown") {
          if (key === "f") void triggerFreeze();
          else if (key === "c") onChangeToolMode(toolMode === "pick" ? "interact" : "pick");
          else if (key === "r") onChangeToolMode("region");
          else if (key === "v") onChangeToolMode("interact");
        }
      } else if (data.type === "zj:ready") {
        window.setTimeout(() => {
          void sendBridgeRequest<{ html: string }>(primaryIframeRef.current, "zj:snapshot-dom")
            .then((res) => {
              if (res.html) return onSaveThumb(activeBoard.id, theme, { html: res.html });
              return undefined;
            })
            .catch(() => undefined);
        }, 400);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isVisible, activeBoard.id, activeBoard.route, captureStatus, onChangeToolMode, onExitFocus, onSaveThumb, theme, toolMode, triggerFreeze, viewportWidth]);

  useEffect(() => {
    const onCustomFreeze = () => {
      if (isVisible) void triggerFreeze();
    };
    window.addEventListener("zhanjuan:toggle-freeze", onCustomFreeze);
    return () => window.removeEventListener("zhanjuan:toggle-freeze", onCustomFreeze);
  }, [isVisible, triggerFreeze]);

  useEffect(() => {
    if (!holdCompareB) {
      setBCompare(null);
      return;
    }
    const targetNote =
      notes.find((n) => n.shortId === selectedNoteId) ??
      notes.find((n) => n.board === activeBoard.id && (n.beforeSnapshotPath || n.cropPath));

    if (!targetNote || (!targetNote.beforeSnapshotPath && !targetNote.cropPath)) {
      showNotice("当前批注暂无修改前截图可用于对照");
      return;
    }

    const sameContext =
      targetNote.board === activeBoard.id &&
      targetNote.theme === theme &&
      targetNote.viewport.width === viewportWidth;

    if (!sameContext) {
      setBCompare({
        note: targetNote,
        mode: "side-by-side",
        reason: `视口或主题有差异（原记录于 ${targetNote.viewport.width}px · ${targetNote.theme}），已切换并排对照`,
        liveBbox: null,
      });
      return;
    }

    void sendBridgeRequest<BridgeLocateResult>(primaryIframeRef.current, "zj:locate-anchor", {
      anchor: targetNote.anchor,
    })
      .then((res) => {
        if (res.found && res.bbox && (res.shiftedPx ?? 0) <= 4) {
          setBCompare({
            note: targetNote,
            mode: "overlay",
            reason: "位置与画板环境一致，已叠回改前快照",
            liveBbox: res.bbox,
          });
        } else {
          const reason = !res.found
            ? "目标元素已调整或移除，自动切换为左右并排对照"
            : `目标位置移动了 ${res.shiftedPx}px，自动切换为左右并排对照`;
          setBCompare({
            note: targetNote,
            mode: "side-by-side",
            reason,
            liveBbox: res.bbox,
          });
        }
      })
      .catch(() => {
        setBCompare({
          note: targetNote,
          mode: "side-by-side",
          reason: "无法直接叠图，已切换为左右并排对照",
          liveBbox: null,
        });
      });
  }, [holdCompareB, notes, selectedNoteId, activeBoard.id, theme, viewportWidth, showNotice]);

  const runHitTest = useCallback(
    (localX: number, localY: number) => {
      if (frozen) {
        const anchor = hitTestFrozenGeometry(frozen.geometry, localX, localY);
        setHoverAnchor(anchor);
        return;
      }
      void sendBridgeRequest<{ anchor: NoteAnchor | null }>(primaryIframeRef.current, "zj:hit-test", {
        x: localX,
        y: localY,
      })
        .then((res) => setHoverAnchor(res.anchor ?? null))
        .catch(() => undefined);
    },
    [frozen],
  );

  const handleOverlayMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (marquee) {
      setMarquee((prev) => (prev ? { ...prev, curX: x, curY: y } : null));
      return;
    }

    latestPointerRef.current = { x, y };
    if (hoverRafRef.current === null) {
      hoverRafRef.current = window.requestAnimationFrame(() => {
        hoverRafRef.current = null;
        if (latestPointerRef.current) {
          runHitTest(latestPointerRef.current.x, latestPointerRef.current.y);
        }
      });
    }
  };

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (toolMode === "region") {
      setMarquee({ startX: x, startY: y, curX: x, curY: y });
      return;
    }

    void (async () => {
      let anchor = hoverAnchor;
      if (!anchor) {
        if (frozen) {
          anchor = hitTestFrozenGeometry(frozen.geometry, x, y);
        } else {
          const res = await sendBridgeRequest<{ anchor: NoteAnchor | null }>(
            primaryIframeRef.current,
            "zj:hit-test",
            { x, y },
          ).catch(() => ({ anchor: null }));
          anchor = res.anchor;
        }
      }

      const fallbackAnchor: NoteAnchor = anchor ?? {
        bbox: { x: Math.max(0, Math.round(x - 40)), y: Math.max(0, Math.round(y - 20)), w: 80, h: 40 },
      };

      let cropDataUrl: string | null = null;
      let beforeSnapshotDataUrl: string | null = null;
      const boxEl = primaryBoxRef.current;

      const frame = frozen
        ? frozen.frame
        : captureStatus === "active" && boxEl
          ? screenCapture.captureElementFrame(boxEl)
          : null;

      if (frame) {
        beforeSnapshotDataUrl = frame.fullDataUrl;
        const b = fallbackAnchor.bbox ?? { x: Math.max(0, x - 50), y: Math.max(0, y - 30), w: 100, h: 60 };
        cropDataUrl = frame.cropRect({
          x: Math.max(0, b.x - 16),
          y: Math.max(0, b.y - 16),
          w: b.w + 32,
          h: b.h + 32,
        });
      }

      setDraft({
        board: activeBoard.id,
        route: activeBoard.route,
        viewport: { width: viewportWidth, height: boxEl?.clientHeight || 780 },
        theme,
        anchor: fallbackAnchor,
        cropDataUrl,
        beforeSnapshotDataUrl,
        screenX: x,
        screenY: y,
      });
    })();
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!marquee) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    const rx = Math.round(Math.min(marquee.startX, endX));
    const ry = Math.round(Math.min(marquee.startY, endY));
    const rw = Math.round(Math.abs(endX - marquee.startX));
    const rh = Math.round(Math.abs(endY - marquee.startY));
    setMarquee(null);

    if (rw < 8 || rh < 8) return;

    const cx = rx + rw / 2;
    const cy = ry + rh / 2;

    void (async () => {
      const anchorRes = frozen
        ? { anchor: hitTestFrozenGeometry(frozen.geometry, cx, cy) }
        : await sendBridgeRequest<{ anchor: NoteAnchor | null }>(primaryIframeRef.current, "zj:hit-test", {
            x: cx,
            y: cy,
          }).catch(() => ({ anchor: null }));

      const anchor: NoteAnchor = {
        ...(anchorRes.anchor ?? {}),
        bbox: { x: rx, y: ry, w: rw, h: rh },
      };

      const boxEl = primaryBoxRef.current;
      const frame = frozen
        ? frozen.frame
        : captureStatus === "active" && boxEl
          ? screenCapture.captureElementFrame(boxEl)
          : null;

      let cropDataUrl: string | null = null;
      let beforeSnapshotDataUrl: string | null = null;
      if (frame) {
        beforeSnapshotDataUrl = frame.fullDataUrl;
        cropDataUrl = frame.cropRect({ x: rx, y: ry, w: rw, h: rh });
      }

      setDraft({
        board: activeBoard.id,
        route: activeBoard.route,
        viewport: { width: viewportWidth, height: boxEl?.clientHeight || 780 },
        theme,
        anchor,
        cropDataUrl,
        beforeSnapshotDataUrl,
        screenX: rx,
        screenY: ry,
      });
    })();
  };

  const primaryUrl = useMemo(
    () =>
      buildPaneUrl(activeBoard.route, {
        theme,
        ns: compareMode === "single" ? "primary" : "pane-left",
      }),
    [activeBoard.route, theme, compareMode],
  );

  const secondaryConfig = useMemo(() => {
    if (compareMode === "theme") {
      const altTheme = theme === "light" ? "dark" : "light";
      return {
        label: `${activeBoard.title} (${altTheme === "dark" ? "深色" : "浅色"})`,
        width: viewportWidth,
        url: buildPaneUrl(activeBoard.route, { theme: altTheme, ns: "pane-right-theme" }),
      };
    }
    if (compareMode === "viewport") {
      return {
        label: `窄屏对照 (${narrowWidth}px)`,
        width: narrowWidth,
        url: buildPaneUrl(activeBoard.route, { theme, ns: "pane-right-viewport" }),
      };
    }
    if (compareMode === "dual") {
      const target = boards.find((b) => b.id === secondaryBoardId) ?? secondaryBoardDefault;
      return {
        label: target.title,
        width: target.viewports?.[0] ?? viewportWidth,
        url: buildPaneUrl(target.route, { theme: target.defaultTheme ?? theme, ns: "pane-right-dual" }),
      };
    }
    return null;
  }, [compareMode, activeBoard, theme, viewportWidth, narrowWidth, boards, secondaryBoardId, secondaryBoardDefault]);

  const boardNotes = useMemo(
    () => notes.filter((n) => n.board === activeBoard.id && n.status !== "resolved" && n.anchor.bbox),
    [notes, activeBoard.id],
  );

  const viewportChoices = useMemo(() => {
    const base = activeBoard.viewports ?? [1440, 960, 760];
    return Array.from(new Set([...base, 1440, 960, 760, 600])).sort((a, b) => b - a);
  }, [activeBoard.viewports]);

  const overlayActive = toolMode === "pick" || toolMode === "region" || Boolean(frozen);

  const shortSourceLabel = (source: string | null | undefined, tagName?: string | null): string => {
    if (!source) return tagName ?? "元素";
    return source.split("/").pop() ?? source;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col pt-2.5" data-testid="live-stage">
      <div className="pt-0.5 pr-[18px] pb-2.5 pl-[188px] min-h-11 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <select
            className={pillSelectCls}
            value={activeBoard.id}
            onChange={(e) => onChangeBoard(e.target.value)}
            aria-label="选择页面画板"
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>

          <div className="relative inline-flex items-center">
            <button
              type="button"
              className={pillSelectCls}
              onClick={() => {
                setDisplayMenuOpen((v) => !v);
                setCompareMenuOpen(false);
              }}
            >
              <SlidersIcon size={14} />
              <span>
                {viewportWidth}px · {theme === "light" ? "浅色" : "深色"}
              </span>
              <ChevronDownIcon size={12} />
            </button>

            {displayMenuOpen && (
              <div className={`${popoverBoxCls} left-0`}>
                <div className="flex flex-col gap-1.5">
                  <div className="text-[11px] font-semibold text-dim">视口宽度</div>
                  <div className="flex flex-wrap gap-1">
                    {viewportChoices.map((w) => (
                      <button
                        key={w}
                        type="button"
                        className={`inline-flex items-center gap-1 py-1 px-[9px] rounded-[7px] border text-[12px] ${
                          viewportWidth === w
                            ? "bg-ink border-ink text-white"
                            : "border-hairline bg-subtle text-muted hover:bg-hover"
                        }`}
                        onClick={() => setViewportWidth(w)}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="text-[11px] font-semibold text-dim">外观主题</div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 py-1 px-[9px] rounded-[7px] border text-[12px] ${
                        theme === "light"
                          ? "bg-ink border-ink text-white"
                          : "border-hairline bg-subtle text-muted hover:bg-hover"
                      }`}
                      onClick={() => setTheme("light")}
                    >
                      <SunIcon size={13} /> 浅色
                    </button>
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 py-1 px-[9px] rounded-[7px] border text-[12px] ${
                        theme === "dark"
                          ? "bg-ink border-ink text-white"
                          : "border-hairline bg-subtle text-muted hover:bg-hover"
                      }`}
                      onClick={() => setTheme("dark")}
                    >
                      <MoonIcon size={13} /> 深色
                    </button>
                  </div>
                </div>

                <div className="border-t border-hairline pt-2">
                  <button
                    type="button"
                    className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-hairline bg-subtle hover:bg-hover text-[12px] font-medium"
                    onClick={() => {
                      setDisplayMenuOpen(false);
                      void captureLiveThumb();
                    }}
                  >
                    <RefreshIcon size={13} /> 更新总览画板快照
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {notice && (
            <span className="py-1 px-2.5 rounded-full bg-chrome border border-hairline text-muted text-[12px]">
              {notice}
            </span>
          )}
          {frozen && (
            <span className="py-1 px-[11px] rounded-full bg-pin-open/12 border border-pin-open/35 text-[#c2410c] text-[12px] font-medium">
              画面已定格 · 点击或框选添加批注（按 <kbd>F</kbd> 恢复）
            </span>
          )}

          <div className="relative inline-flex items-center">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 h-[30px] px-[11px] rounded-[9px] border text-[12.5px] font-medium ${
                compareMode !== "single"
                  ? "bg-ink border-ink text-white"
                  : "border-hairline bg-chrome text-ink hover:bg-subtle"
              }`}
              onClick={() => {
                setCompareMenuOpen((v) => !v);
                setDisplayMenuOpen(false);
              }}
            >
              <CompareIcon size={14} />
              <span>{COMPARE_LABELS[compareMode]}</span>
              <ChevronDownIcon size={12} />
            </button>

            {compareMenuOpen && (
              <div className={`${popoverBoxCls} right-0`}>
                <div className="flex flex-col gap-1.5">
                  <div className="text-[11px] font-semibold text-dim">画板对照方式</div>
                  <div className="flex flex-col gap-0.5">
                    {(Object.keys(COMPARE_LABELS) as ComparePreset[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`w-full text-left border-0 py-1.5 px-2 rounded-[7px] text-ink text-[12.5px] hover:bg-subtle ${
                          compareMode === mode ? "bg-hover font-semibold" : "bg-transparent"
                        }`}
                        onClick={() => {
                          onChangeCompareMode(mode);
                          if (mode === "single" || mode === "theme") {
                            setCompareMenuOpen(false);
                          }
                        }}
                      >
                        {COMPARE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                </div>

                {compareMode === "dual" && (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-semibold text-dim">右侧对比页面</div>
                    <select
                      className={`${pillSelectCls} w-full`}
                      value={secondaryBoardId}
                      onChange={(e) => setSecondaryBoardId(e.target.value)}
                    >
                      {boards.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {compareMode === "viewport" && (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-semibold text-dim">右侧窄屏宽度</div>
                    <div className="flex flex-wrap gap-1">
                      {[960, 760, 600, 390].map((w) => (
                        <button
                          key={w}
                          type="button"
                          className={`inline-flex items-center gap-1 py-1 px-[9px] rounded-[7px] border text-[12px] ${
                            narrowWidth === w
                              ? "bg-ink border-ink text-white"
                              : "border-hairline bg-subtle text-muted hover:bg-hover"
                          }`}
                          onClick={() => setNarrowWidth(w)}
                        >
                          {w}px
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pt-1 px-7 pb-[90px] flex justify-start gap-6 items-stretch">
        <div className={`flex flex-col gap-2 min-h-0 ${!secondaryConfig ? "mx-auto" : ""}`}>
          <div className="flex items-center justify-between gap-2.5 min-h-6">
            <div className="flex items-center gap-[7px] text-[13px] font-medium text-muted">
              <span>{activeBoard.title}</span>
              <span className="text-[12px] text-dim">{viewportWidth}px</span>
            </div>
            {toolMode === "pick" && !frozen && (
              <span className="text-[12px] text-accent font-medium">点击页面任意位置添加批注</span>
            )}
            {toolMode === "region" && (
              <span className="text-[12px] text-accent font-medium">拖拽框选局部区域添加批注</span>
            )}
          </div>

          <div
            ref={primaryBoxRef}
            className="relative flex-1 min-h-[600px] bg-white border border-black/8 rounded-[14px] overflow-hidden shadow-artboard"
            style={{ width: `${viewportWidth}px` }}
          >
            <iframe
              ref={primaryIframeRef}
              src={primaryUrl}
              title={activeBoard.title}
              className="w-full h-full min-h-[600px] border-0 block"
            />

            {frozen && (
              <img
                src={frozen.frame.fullDataUrl}
                alt="Frozen frame"
                className="absolute inset-0 w-full h-full object-fill z-[4] pointer-events-none"
              />
            )}

            <div className="absolute inset-0 pointer-events-none z-[6]">
              {boardNotes.map((n) => {
                const box = n.anchor.bbox;
                if (!box) return null;
                const isSelected = n.shortId === selectedNoteId;
                return (
                  <button
                    key={n.shortId}
                    type="button"
                    className={`absolute pointer-events-auto border-2 border-white rounded-full py-px px-[7px] text-[11px] font-bold text-white shadow-[0_3px_10px_rgba(0,0,0,0.22)] ${
                      PIN_MARKER_BG[n.status]
                    } ${isSelected ? "scale-110 outline-2 outline-ink" : ""}`}
                    style={{
                      left: `${Math.max(8, Math.min(viewportWidth - 42, box.x + box.w - 10))}px`,
                      top: `${Math.max(8, box.y - 10)}px`,
                    }}
                    onClick={() => onSelectNote(n)}
                    title={`${n.shortId}: ${n.thread[0]?.body ?? ""}`}
                  >
                    {n.shortId}
                  </button>
                );
              })}
            </div>

            {overlayActive && (
              <div
                className={`absolute inset-0 z-[8] ${toolMode === "region" ? "cursor-crosshair" : "cursor-pointer"}`}
                data-testid="pick-overlay"
                onMouseMove={handleOverlayMouseMove}
                onMouseLeave={() => setHoverAnchor(null)}
                onMouseDown={handleOverlayMouseDown}
                onMouseUp={handleOverlayMouseUp}
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
                    <div className="absolute -top-[26px] -left-0.5 py-0.5 px-2 rounded-md bg-ink text-white font-mono text-[11px] whitespace-nowrap flex gap-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                      <span>{shortSourceLabel(hoverAnchor.dataSource, hoverAnchor.tagName)}</span>
                      {hoverAnchor.textSnippet && (
                        <span className="text-[#d4d4d8] font-sans">“{hoverAnchor.textSnippet.slice(0, 24)}”</span>
                      )}
                    </div>
                  </div>
                )}

                {marquee && (
                  <div
                    className="absolute border-2 border-dashed border-accent bg-accent/12 pointer-events-none"
                    style={{
                      left: `${Math.min(marquee.startX, marquee.curX)}px`,
                      top: `${Math.min(marquee.startY, marquee.curY)}px`,
                      width: `${Math.abs(marquee.curX - marquee.startX)}px`,
                      height: `${Math.abs(marquee.curY - marquee.startY)}px`,
                    }}
                  />
                )}
              </div>
            )}

            {bCompare && bCompare.mode === "overlay" && (
              <div className="absolute inset-0 z-15 bg-white/90 flex items-center justify-center pointer-events-none">
                <div className="absolute top-3 left-3 py-1 px-2.5 rounded-full bg-ink text-white font-semibold text-[12px]">
                  改前画面叠图 · 按住 B 对照
                </div>
                <img
                  src={
                    bCompare.note.beforeSnapshotPath
                      ? `/__zhanjuan/assets/crops/${encodeURIComponent(bCompare.note.beforeSnapshotPath.split("/").pop() || "")}`
                      : `/__zhanjuan/assets/crops/${encodeURIComponent((bCompare.note.cropPath || "").split("/").pop() || "")}`
                  }
                  alt="Before overlay"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            )}

            {draft && (
              <div
                className="absolute z-20 w-[332px]"
                style={{
                  left: `${Math.min(Math.max(16, draft.screenX), Math.max(16, viewportWidth - 360))}px`,
                  top: `${Math.max(16, Math.min(draft.screenY + 12, 420))}px`,
                }}
              >
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
                        beforeSnapshotDataUrl: draft.beforeSnapshotDataUrl,
                      });
                      setDraft(null);
                      setFrozen(null);
                      onChangeToolMode("interact");
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {secondaryConfig && (
          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between gap-2.5 min-h-6">
              <div className="flex items-center gap-[7px] text-[13px] font-medium text-muted">
                <span>{secondaryConfig.label}</span>
                <span className="text-[12px] text-dim">{secondaryConfig.width}px</span>
              </div>
            </div>
            <div
              className="relative flex-1 min-h-[600px] bg-white border border-black/8 rounded-[14px] overflow-hidden shadow-artboard"
              style={{ width: `${secondaryConfig.width}px` }}
            >
              <iframe
                ref={secondaryIframeRef}
                src={secondaryConfig.url}
                title={secondaryConfig.label}
                className="w-full h-full min-h-[600px] border-0 block"
              />
            </div>
          </div>
        )}
      </div>

      {bCompare && bCompare.mode === "side-by-side" && (
        <div
          className="fixed left-6 right-6 bottom-[72px] z-30 border border-hairline rounded-[14px] bg-chrome shadow-float py-3.5 px-4 max-h-[260px] overflow-auto"
          data-testid="b-side-by-side"
        >
          <div className="flex items-center justify-between mb-2.5 text-ink">
            <strong>{bCompare.note.shortId} 改前 / 改后对照</strong>
            <span>{bCompare.reason}</span>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className="text-[11px] font-semibold text-dim mb-1">改前快照</div>
              <img
                src={
                  bCompare.note.beforeSnapshotPath
                    ? `/__zhanjuan/assets/crops/${encodeURIComponent(bCompare.note.beforeSnapshotPath.split("/").pop() || "")}`
                    : `/__zhanjuan/assets/crops/${encodeURIComponent((bCompare.note.cropPath || "").split("/").pop() || "")}`
                }
                alt="Before snapshot"
                className="max-w-full max-h-[165px] border border-hairline rounded-lg"
              />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-dim mb-1">当前状态</div>
              <div className="text-muted flex flex-col gap-1.5">
                <p>
                  当前位置：
                  {bCompare.liveBbox
                    ? `${bCompare.liveBbox.x}, ${bCompare.liveBbox.y} (${bCompare.liveBbox.w}×${bCompare.liveBbox.h})`
                    : "目标节点已重构或移除"}
                </p>
                <p>调整摘要：{bCompare.note.resolution?.summary ?? "尚无修改记录"}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
