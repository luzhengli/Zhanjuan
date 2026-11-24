import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addCommentApi,
  ApiError,
  createNoteApi,
  fetchBootstrap,
  fetchNotes,
  reopenNoteApi,
  resolveNoteApi,
  saveThumbApi,
  subscribeEvents,
  type BootstrapPayload,
} from "./api.js";
import { screenCapture, type CaptureStatus } from "./capture/screenCapture.js";
import { CanvasDock, type DockToolMode } from "./components/CanvasDock.js";
import {
  ChatIcon,
  ChevronDownIcon,
  FrameIcon,
  GridIcon,
  PlayOutlineIcon,
  SlidersIcon,
  SparkleScrollIcon,
} from "./components/Icons.js";
import { LiveStage } from "./components/LiveStage.js";
import { NotesSidebar } from "./components/NotesSidebar.js";
import { OverviewCanvas, type ComparePreset } from "./components/OverviewCanvas.js";
import { ProposalsView } from "./components/ProposalsView.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import type { BoardConfig, CanvasNote, NoteAnchor, NoteIntent } from "../../src/shared/types.js";

const topIconBtn =
  "relative inline-flex items-center justify-center w-8 h-8 border-0 rounded-lg transition-colors";
const popoverPanel =
  "absolute top-[calc(100%+6px)] min-w-[220px] p-2.5 rounded-xl bg-chrome border border-hairline shadow-float z-50 flex flex-col gap-2.5";

export const App: React.FC = () => {
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [notes, setNotes] = useState<CanvasNote[]>([]);
  const [rev, setRev] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const [tab, setTab] = useState<"live" | "proposals">("live");
  const [focusedBoardId, setFocusedBoardId] = useState<string | null>(null);
  const [isFocusView, setIsFocusView] = useState(false);
  const [compareMode, setCompareMode] = useState<ComparePreset>("single");
  const [aliveBoardIds, setAliveBoardIds] = useState<string[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [focusedProposalId, setFocusedProposalId] = useState<string | null>(null);

  const [toolMode, setToolMode] = useState<DockToolMode>("interact");
  const [isFrozen, setIsFrozen] = useState(false);
  const [holdCompareB, setHoldCompareB] = useState(false);
  const [peekCompareB, setPeekCompareB] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>(screenCapture.getStatus());

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

  const draftPasteHandlerRef = useRef<((dataUrl: string) => void) | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const data = await fetchBootstrap();
      setBoot(data);
      setNotes(data.notes);
      setRev(data.rev);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    const unsubCapture = screenCapture.subscribe(setCaptureStatus);
    const unsubEvents = subscribeEvents(
      (event) => {
        if (event.type === "notes:updated") {
          void fetchNotes().then((res) => {
            setNotes(res.notes);
            setRev(res.rev);
          });
        } else if (event.type === "assets:updated") {
          void fetchBootstrap().then((data) => {
            setBoot(data);
          });
        } else if (event.type === "board:focus") {
          if (event.tab === "proposals") {
            setTab("proposals");
            if (event.proposalId) setFocusedProposalId(event.proposalId);
          } else {
            setTab("live");
            setFocusedBoardId(event.boardId);
            setIsFocusView(true);
          }
          if (event.noteId) {
            setSelectedNoteId(event.noteId);
            setDrawerOpen(true);
          }
        }
      },
      setSseConnected,
    );
    return () => {
      unsubCapture();
      unsubEvents();
    };
  }, [loadAll]);

  const allBoards = useMemo<BoardConfig[]>(() => {
    if (!boot) return [];
    const list: BoardConfig[] = [];
    if (boot.config.designSystemBoard) list.push(boot.config.designSystemBoard);
    list.push(...boot.config.boards);
    return list;
  }, [boot]);

  const handleSelectTool = useCallback(
    (nextTool: DockToolMode) => {
      setToolMode(nextTool);
      if (tab === "live" && !isFocusView && (nextTool === "pick" || nextTool === "region")) {
        const targetId = focusedBoardId ?? boot?.config.boards[0]?.id ?? allBoards[0]?.id ?? null;
        if (targetId) {
          setFocusedBoardId(targetId);
          setIsFocusView(true);
        }
      }
    },
    [tab, isFocusView, focusedBoardId, boot, allBoards],
  );

  useHotkeys({
    onToolKey: (key) => {
      if (key === "h") {
        setToolMode("hand");
        return;
      }
      if (key === "v") {
        setToolMode("interact");
        return;
      }
      if (key === "c") {
        handleSelectTool(toolMode === "pick" ? "interact" : "pick");
        return;
      }
      if (key === "r") {
        handleSelectTool(toolMode === "region" ? "interact" : "region");
        return;
      }
      if (key === "f" && tab === "live" && isFocusView && focusedBoardId) {
        window.dispatchEvent(new CustomEvent("zhanjuan:toggle-freeze"));
      }
    },
    onCompareHold: (held) => {
      if (tab === "live" && isFocusView && focusedBoardId) {
        setHoldCompareB(held);
      } else {
        setHoldCompareB(false);
      }
    },
    onExitFocus: () => {
      if (tab === "live" && isFocusView) {
        setIsFocusView(false);
        setToolMode("interact");
        setHoldCompareB(false);
        setPeekCompareB(false);
      }
    },
    onPasteImage: (dataUrl) => {
      draftPasteHandlerRef.current?.(dataUrl);
    },
  });

  const withRevRetry = useCallback(
    async <T extends { rev: number; note: CanvasNote }>(
      action: (currentRev: number) => Promise<T>,
    ): Promise<T> => {
      try {
        const res = await action(rev);
        setRev(res.rev);
        return res;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const latest = await fetchNotes();
          setNotes(latest.notes);
          setRev(latest.rev);
          const res = await action(latest.rev);
          setRev(res.rev);
          return res;
        }
        throw err;
      }
    },
    [rev],
  );

  const handleCreateNote = useCallback(
    async (payload: {
      board: string;
      route: string;
      viewport: { width: number; height: number };
      theme: "light" | "dark";
      anchor: NoteAnchor;
      intent: NoteIntent;
      body: string;
      cropDataUrl?: string | null;
      beforeSnapshotDataUrl?: string | null;
    }) => {
      const res = await withRevRetry((r) => createNoteApi({ ...payload, expectedRev: r }));
      setNotes((prev) => [...prev, res.note]);
      setSelectedNoteId(res.note.shortId);
      setDrawerOpen(true);
    },
    [withRevRetry],
  );

  const handleResolve = useCallback(
    async (noteId: string, summary?: string) => {
      const res = await withRevRetry((r) => resolveNoteApi(noteId, { summary, expectedRev: r }));
      setNotes((prev) => prev.map((n) => (n.shortId === res.note.shortId ? res.note : n)));
    },
    [withRevRetry],
  );

  const handleReopen = useCallback(
    async (noteId: string, body: string) => {
      const res = await withRevRetry((r) => reopenNoteApi(noteId, { body, expectedRev: r }));
      setNotes((prev) => prev.map((n) => (n.shortId === res.note.shortId ? res.note : n)));
    },
    [withRevRetry],
  );

  const handleAddComment = useCallback(
    async (noteId: string, body: string) => {
      const res = await withRevRetry((r) => addCommentApi(noteId, { body, expectedRev: r }));
      setNotes((prev) => prev.map((n) => (n.shortId === res.note.shortId ? res.note : n)));
    },
    [withRevRetry],
  );

  const handleSaveThumb = useCallback(
    async (boardId: string, theme: "light" | "dark", payload: { dataUrl?: string; html?: string }) => {
      await saveThumbApi(boardId, theme, payload);
      const data = await fetchBootstrap();
      setBoot(data);
    },
    [],
  );

  const pendingCount = useMemo(
    () => notes.filter((n) => n.status === "open" || n.status === "working").length,
    [notes],
  );

  const selectedNote = useMemo(
    () => notes.find((n) => n.shortId === selectedNoteId) ?? notes.find((n) => n.status !== "resolved") ?? null,
    [notes, selectedNoteId],
  );

  if (error) {
    return (
      <div className="p-12 text-center text-muted">
        <h2 className="text-ink font-semibold text-lg mb-2">展卷服务连接异常</h2>
        <p className="mb-4">{error}</p>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 border-0 bg-ink text-white font-medium"
          onClick={() => void loadAll()}
        >
          重试连接
        </button>
      </div>
    );
  }

  if (!boot) {
    return <div className="p-12 text-center text-muted">正在打开画布...</div>;
  }

  const defaultPlayBoardId = focusedBoardId ?? boot.config.boards[0]?.id ?? allBoards[0]?.id ?? null;

  return (
    <div className="flex flex-col w-full h-full">
      <header className="h-12 shrink-0 flex items-center justify-between px-4 bg-chrome border-b border-hairline z-30">
        <div className="relative inline-flex items-center">
          <button
            type="button"
            className="inline-flex items-center gap-2 border-0 bg-transparent py-[5px] px-2 -ml-2 rounded-lg font-semibold text-[14px] text-ink hover:bg-subtle"
            onClick={() => {
              setProjectMenuOpen((v) => !v);
              setSettingsMenuOpen(false);
              setModeMenuOpen(false);
            }}
          >
            <SparkleScrollIcon size={18} />
            <span>{boot.config.projectName}</span>
            <ChevronDownIcon size={13} />
          </button>

          {projectMenuOpen && (
            <div className={`${popoverPanel} left-0 min-w-[270px]`}>
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold text-dim">当前工作树</div>
                <div className="flex items-center gap-1.5 text-[12px]">
                  <span
                    className={`w-[7px] h-[7px] rounded-full ${
                      sseConnected ? "bg-pin-addressed" : "bg-pin-open"
                    }`}
                  />
                  <span>{sseConnected ? "画布已实时同步" : "正在重新连接"}</span>
                </div>
                <div className="font-mono text-[11px] text-dim truncate">
                  {boot.git.branch} @ {boot.git.gitFingerprint}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold text-dim">快捷键</div>
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-[5px] text-[12px] text-muted">
                  <span><kbd>V</kbd> 选择</span>
                  <span><kbd>H</kbd> 平移</span>
                  <span><kbd>C</kbd> 批注</span>
                  <span><kbd>R</kbd> 框选</span>
                  <span><kbd>F</kbd> 冻帧</span>
                  <span><kbd>B</kbd> 对照</span>
                  <span><kbd>⌘.</kbd> 总览</span>
                  <span><kbd>⌥+点</kbd> 快选</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`${topIconBtn} ${
              tab === "live" && isFocusView
                ? "bg-hover text-ink"
                : "bg-transparent text-muted hover:bg-subtle hover:text-ink"
            }`}
            onClick={() => {
              setTab("live");
              if (isFocusView) {
                setIsFocusView(false);
              } else if (defaultPlayBoardId) {
                setFocusedBoardId(defaultPlayBoardId);
                setIsFocusView(true);
              }
            }}
            title={isFocusView ? "返回画布总览 (⌘.)" : "进入活页预览"}
          >
            <PlayOutlineIcon size={16} />
          </button>

          <div className="relative inline-flex items-center">
            <button
              type="button"
              className={`${topIconBtn} ${
                settingsMenuOpen
                  ? "bg-hover text-ink"
                  : "bg-transparent text-muted hover:bg-subtle hover:text-ink"
              }`}
              onClick={() => {
                setSettingsMenuOpen((v) => !v);
                setProjectMenuOpen(false);
                setModeMenuOpen(false);
              }}
              title="画面捕捉与偏好"
            >
              <SlidersIcon size={16} />
            </button>

            {settingsMenuOpen && (
              <div className={`${popoverPanel} right-0`}>
                <div className="flex flex-col gap-1.5">
                  <div className="text-[11px] font-semibold text-dim">瞬态画面捕捉 (F 键)</div>
                  {captureStatus === "active" ? (
                    <div className="flex items-center gap-1.5 text-[12px]">
                      <span className="w-[7px] h-[7px] rounded-full bg-pin-addressed" />
                      <span>已就绪 · 按 F 可瞬间定格气泡/菜单</span>
                    </div>
                  ) : captureStatus === "idle" || captureStatus === "requesting" ? (
                    <button
                      type="button"
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-hairline bg-subtle hover:bg-hover text-[12px] font-medium"
                      onClick={() => void screenCapture.ensureSession()}
                    >
                      {captureStatus === "requesting" ? "正在请求授权..." : "授权当前标签页真实截帧"}
                    </button>
                  ) : (
                    <div className="font-mono text-[11px] text-dim">当前浏览器仅支持语义批注与 ⌘V 粘贴截图</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`${topIconBtn} ${
              drawerOpen
                ? "bg-hover text-ink"
                : "bg-transparent text-muted hover:bg-subtle hover:text-ink"
            }`}
            onClick={() => setDrawerOpen((v) => !v)}
            title="批注队列"
            data-testid="toggle-comments-btn"
          >
            <ChatIcon size={16} />
            {pendingCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-pin-open text-white text-[10px] font-bold inline-flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 relative flex">
        <main className="flex-1 min-w-0 min-h-0 flex flex-col relative bg-studio">
          <div className="absolute top-3 left-4 z-22 flex items-center gap-2">
            <div className="relative inline-flex items-center">
              <button
                type="button"
                className="inline-flex items-center gap-[5px] h-[30px] px-2.5 border-0 rounded-lg bg-transparent text-[13px] font-medium text-ink hover:bg-black/5"
                onClick={() => {
                  setModeMenuOpen((v) => !v);
                  setProjectMenuOpen(false);
                  setSettingsMenuOpen(false);
                }}
              >
                <span>{tab === "live" ? "原型" : `方案提案 (${boot.proposals.length})`}</span>
                <ChevronDownIcon size={13} />
              </button>

              {modeMenuOpen && (
                <div className={`${popoverPanel} left-0`}>
                  <button
                    type="button"
                    className={`w-full text-left border-0 py-1.5 px-2 rounded-[7px] text-ink text-[12.5px] hover:bg-subtle ${
                      tab === "live" ? "bg-hover font-semibold" : "bg-transparent"
                    }`}
                    onClick={() => {
                      setTab("live");
                      setModeMenuOpen(false);
                    }}
                  >
                    原型画布
                  </button>
                  <button
                    type="button"
                    className={`w-full text-left border-0 py-1.5 px-2 rounded-[7px] text-ink text-[12.5px] hover:bg-subtle ${
                      tab === "proposals" ? "bg-hover font-semibold" : "bg-transparent"
                    }`}
                    onClick={() => {
                      setTab("proposals");
                      setModeMenuOpen(false);
                    }}
                  >
                    Proposals 提案 ({boot.proposals.length})
                  </button>
                </div>
              )}
            </div>

            {tab === "live" && (
              <div
                className="inline-flex items-center p-0.5 rounded-[9px] bg-white/72 border border-hairline backdrop-blur-sm"
                role="group"
                aria-label="视图切换"
              >
                <button
                  type="button"
                  className={`inline-flex items-center justify-center w-7 h-6 border-0 rounded-[7px] ${
                    !isFocusView
                      ? "bg-chrome text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                      : "bg-transparent text-dim hover:text-ink"
                  }`}
                  onClick={() => {
                    setIsFocusView(false);
                    setToolMode("interact");
                    setHoldCompareB(false);
                    setPeekCompareB(false);
                  }}
                  title="画布总览 (⌘.)"
                  data-testid="exit-focus-btn"
                >
                  <GridIcon size={15} />
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center justify-center w-7 h-6 border-0 rounded-[7px] ${
                    isFocusView
                      ? "bg-chrome text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                      : "bg-transparent text-dim hover:text-ink"
                  }`}
                  onClick={() => {
                    if (defaultPlayBoardId) {
                      setFocusedBoardId(defaultPlayBoardId);
                      setIsFocusView(true);
                    }
                  }}
                  title="活页聚焦"
                >
                  <FrameIcon size={15} />
                </button>
              </div>
            )}
          </div>

          {tab === "live" ? (
            <>
              {focusedBoardId && (
                <div
                  className={
                    isFocusView
                      ? "flex-1 min-h-0 flex flex-col"
                      : "absolute inset-0 invisible pointer-events-none -z-10 flex flex-col"
                  }
                >
                  <LiveStage
                    boards={allBoards}
                    activeBoardId={focusedBoardId}
                    isVisible={isFocusView}
                    compareMode={compareMode}
                    notes={notes}
                    selectedNoteId={selectedNoteId}
                    captureStatus={captureStatus}
                    toolMode={toolMode}
                    holdCompareB={holdCompareB || peekCompareB}
                    onChangeBoard={(id) => setFocusedBoardId(id)}
                    onChangeCompareMode={setCompareMode}
                    onChangeToolMode={setToolMode}
                    onFrozenChange={setIsFrozen}
                    onExitFocus={() => {
                      setIsFocusView(false);
                      setToolMode("interact");
                      setHoldCompareB(false);
                      setPeekCompareB(false);
                    }}
                    onAliveBoardsChange={setAliveBoardIds}
                    onSelectNote={(n) => {
                      setSelectedNoteId(n.shortId);
                      setDrawerOpen(true);
                    }}
                    onSaveThumb={handleSaveThumb}
                    onCreateNote={handleCreateNote}
                    onUpdateDraftCrop={(fn) => {
                      draftPasteHandlerRef.current = fn;
                    }}
                  />
                </div>
              )}
              {!isFocusView && (
                <OverviewCanvas
                  designSystemBoard={boot.config.designSystemBoard}
                  boards={boot.config.boards}
                  assets={boot.assets}
                  approvedReferences={boot.approvedReferences}
                  notes={notes}
                  aliveBoardIds={aliveBoardIds}
                  activeTool={toolMode}
                  onFocusBoard={(boardId, opts) => {
                    setCompareMode(opts?.compare ?? "single");
                    setFocusedBoardId(boardId);
                    setIsFocusView(true);
                  }}
                  onSaveThumb={handleSaveThumb}
                />
              )}
            </>
          ) : (
            <ProposalsView
              proposals={boot.proposals}
              boards={allBoards}
              initialProposalId={focusedProposalId}
              toolMode={toolMode}
              onChangeToolMode={setToolMode}
              onCreateNote={handleCreateNote}
            />
          )}

          <CanvasDock
            activeTool={toolMode}
            isFrozen={isFrozen}
            isCompareHeld={holdCompareB || peekCompareB}
            captureStatus={captureStatus}
            pendingCount={pendingCount}
            drawerOpen={drawerOpen}
            selectedNote={selectedNote}
            projectName={boot.config.projectName}
            showFreezeAndCompare={tab === "live" && isFocusView}
            onSelectTool={handleSelectTool}
            onToggleFreeze={() => window.dispatchEvent(new CustomEvent("zhanjuan:toggle-freeze"))}
            onToggleCompareB={() => setPeekCompareB((v) => !v)}
            onToggleDrawer={() => setDrawerOpen((v) => !v)}
          />
        </main>

        <NotesSidebar
          open={drawerOpen}
          projectName={boot.config.projectName}
          notes={notes}
          selectedNoteId={selectedNoteId}
          activeBoardId={isFocusView ? focusedBoardId : null}
          onClose={() => setDrawerOpen(false)}
          onSelectNote={(n) => setSelectedNoteId(n.shortId)}
          onResolve={handleResolve}
          onReopen={handleReopen}
          onAddComment={handleAddComment}
          onJumpToBoard={(n) => {
            setSelectedNoteId(n.shortId);
            if (n.board.startsWith("proposal:")) {
              setTab("proposals");
              setFocusedProposalId(n.board.slice("proposal:".length));
            } else {
              setTab("live");
              setFocusedBoardId(n.board);
              setIsFocusView(true);
            }
          }}
        />
      </div>
    </div>
  );
};
