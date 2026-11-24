import React, { useState } from "react";
import { formatNoteForAgent } from "../../../src/shared/format.js";
import type { CanvasNote } from "../../../src/shared/types.js";
import type { CaptureStatus } from "../capture/screenCapture.js";
import {
  CheckIcon,
  ChevronDownIcon,
  CompareIcon,
  CopyIcon,
  CursorIcon,
  FreezeIcon,
  HandIcon,
  MarqueeIcon,
  PinIcon,
} from "./Icons.js";

export type DockToolMode = "interact" | "hand" | "pick" | "region";

interface CanvasDockProps {
  activeTool: DockToolMode;
  isFrozen: boolean;
  isCompareHeld: boolean;
  captureStatus: CaptureStatus;
  pendingCount: number;
  drawerOpen: boolean;
  selectedNote: CanvasNote | null;
  projectName: string;
  showFreezeAndCompare: boolean;
  onSelectTool: (tool: DockToolMode) => void;
  onToggleFreeze: () => void;
  onToggleCompareB: () => void;
  onToggleDrawer: () => void;
}

const dockBtnBase =
  "relative inline-flex items-center justify-center w-[34px] h-[34px] border-0 rounded-[11px] transition-colors";
const dockBtnIdle = "bg-transparent text-muted hover:bg-subtle hover:text-ink";
const dockBtnActive = "bg-accent-soft text-accent";

export const CanvasDock: React.FC<CanvasDockProps> = ({
  activeTool,
  isFrozen,
  isCompareHeld,
  captureStatus,
  pendingCount,
  drawerOpen,
  selectedNote,
  projectName,
  showFreezeAndCompare,
  onSelectTool,
  onToggleFreeze,
  onToggleCompareB,
  onToggleDrawer,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleQuickCopy = async () => {
    if (!selectedNote) {
      onToggleDrawer();
      return;
    }
    const text = formatNoteForAgent(selectedNote, projectName);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(selectedNote.shortId);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      onToggleDrawer();
    }
  };

  return (
    <div
      className="fixed bottom-[18px] left-1/2 -translate-x-1/2 z-[35] flex items-center gap-[3px] p-[5px_6px] rounded-2xl bg-chrome/96 border border-hairline shadow-float backdrop-blur-md"
      role="toolbar"
      aria-label="画布工具栏"
      data-testid="floating-dock"
    >
      <button
        type="button"
        className={`${dockBtnBase} ${activeTool === "interact" && !isFrozen ? dockBtnActive : dockBtnIdle}`}
        onClick={() => onSelectTool("interact")}
        title="选择 / 交互 (V · ⌥+点击快选)"
      >
        <CursorIcon />
      </button>

      <button
        type="button"
        className={`${dockBtnBase} ${activeTool === "hand" ? dockBtnActive : dockBtnIdle}`}
        onClick={() => onSelectTool("hand")}
        title="抓手平移画布 (H · 拖拽空白)"
      >
        <HandIcon />
      </button>

      <button
        type="button"
        className={`${dockBtnBase} ${activeTool === "pick" && !isFrozen ? dockBtnActive : dockBtnIdle}`}
        onClick={() => onSelectTool(activeTool === "pick" ? "interact" : "pick")}
        title="点选元素打批注 (C)"
        data-testid="tool-pick-btn"
      >
        <PinIcon />
      </button>

      <button
        type="button"
        className={`${dockBtnBase} ${activeTool === "region" ? dockBtnActive : dockBtnIdle}`}
        onClick={() => onSelectTool(activeTool === "region" ? "interact" : "region")}
        title="框选局部裁图 (R)"
      >
        <MarqueeIcon />
      </button>

      {showFreezeAndCompare && (
        <>
          <button
            type="button"
            className={`${dockBtnBase} ${
              isFrozen ? "bg-pin-open/14 text-pin-open" : dockBtnIdle
            }`}
            onClick={onToggleFreeze}
            title={
              captureStatus === "active"
                ? "定格真实画面 (F)"
                : "定格瞬态气泡与菜单 (F · 首次需授权当前标签页)"
            }
            data-testid="tool-freeze-btn"
          >
            <FreezeIcon />
            {captureStatus === "active" && !isFrozen && (
              <span className="absolute top-[6px] right-[6px] w-[5px] h-[5px] rounded-full bg-pin-addressed" />
            )}
          </button>

          <button
            type="button"
            className={`${dockBtnBase} ${isCompareHeld ? dockBtnActive : dockBtnIdle}`}
            onClick={onToggleCompareB}
            title="改前 / 改后对照 (按住 B 或点击切换)"
          >
            <CompareIcon />
          </button>
        </>
      )}

      <div className="w-px h-5 mx-1 bg-hairline" />

      {selectedNote ? (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-[34px] px-3.5 border-0 rounded-[11px] bg-[#f0f0ed] hover:bg-[#e6e6e2] text-ink font-medium text-[13px] whitespace-nowrap"
          onClick={() => void handleQuickCopy()}
          title={`复制 ${selectedNote.shortId} 结构化上下文给 Agent`}
        >
          {copiedId === selectedNote.shortId ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          <span>{copiedId === selectedNote.shortId ? "已复制 ✓" : `复制给 Agent (${selectedNote.shortId})`}</span>
        </button>
      ) : (
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 h-[34px] px-3.5 border-0 rounded-[11px] font-medium text-[13px] whitespace-nowrap ${
            drawerOpen ? "bg-ink text-white" : "bg-[#f0f0ed] hover:bg-[#e6e6e2] text-ink"
          }`}
          onClick={onToggleDrawer}
        >
          <span>批注队列</span>
          {pendingCount > 0 && (
            <span className="px-1.5 h-[18px] rounded-full bg-pin-open text-white text-[11px] font-bold inline-flex items-center">
              {pendingCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

interface ZoomPillProps {
  zoom: number;
  onChangeZoom: (next: number) => void;
  onReset: () => void;
}

export const ZoomPill: React.FC<ZoomPillProps> = ({ zoom, onChangeZoom, onReset }) => {
  const [open, setOpen] = useState(false);
  const presets = [0.5, 0.75, 1, 1.25, 1.5];

  return (
    <div className="fixed bottom-[18px] right-[18px] z-[35]" data-pan-ignore="true">
      {open && (
        <div
          className="absolute bottom-[calc(100%+8px)] right-0 min-w-[120px] p-[5px] rounded-[11px] bg-chrome border border-hairline shadow-float flex flex-col gap-0.5"
          role="menu"
        >
          <button
            type="button"
            className="text-left border-0 bg-transparent px-[9px] py-1.5 rounded-[7px] text-[12px] hover:bg-subtle"
            onClick={() => {
              onReset();
              setOpen(false);
            }}
          >
            适应画布
          </button>
          <div className="h-px bg-hairline my-[3px]" />
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className={`text-left border-0 px-[9px] py-1.5 rounded-[7px] text-[12px] hover:bg-subtle ${
                Math.abs(zoom - p) < 0.02 ? "bg-hover font-semibold" : "bg-transparent"
              }`}
              onClick={() => {
                onChangeZoom(p);
                setOpen(false);
              }}
            >
              {Math.round(p * 100)}%
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-[5px] h-[34px] px-3 rounded-[11px] border border-hairline bg-chrome/96 shadow-float font-medium hover:bg-chrome"
        onClick={() => setOpen((v) => !v)}
        aria-label="缩放比例"
      >
        <span>{Math.round(zoom * 100)}%</span>
        <ChevronDownIcon size={13} />
      </button>
    </div>
  );
};
