import React, { useMemo, useState } from "react";
import { formatNoteForAgent } from "../../../src/shared/format.js";
import type { CanvasNote, NoteStatus } from "../../../src/shared/types.js";
import { CloseIcon, CopyIcon } from "./Icons.js";

interface NotesSidebarProps {
  open: boolean;
  projectName: string;
  notes: CanvasNote[];
  selectedNoteId: string | null;
  activeBoardId: string | null;
  onClose: () => void;
  onSelectNote: (note: CanvasNote) => void;
  onResolve: (noteId: string, summary?: string) => Promise<void>;
  onReopen: (noteId: string, body: string) => Promise<void>;
  onAddComment: (noteId: string, body: string) => Promise<void>;
  onJumpToBoard: (note: CanvasNote) => void;
}

const STATUS_LABEL: Record<NoteStatus, string> = {
  open: "待处理",
  working: "处理中",
  addressed: "待验收",
  resolved: "已解决",
};

const PIN_BG: Record<NoteStatus, string> = {
  open: "bg-pin-open",
  working: "bg-pin-working",
  addressed: "bg-pin-addressed",
  resolved: "bg-pin-resolved",
};

const STATUS_PILL_STYLE: Record<NoteStatus, string> = {
  open: "bg-subtle text-muted",
  working: "bg-pin-working/12 text-pin-working",
  addressed: "bg-pin-addressed/12 text-pin-addressed",
  resolved: "bg-subtle text-dim",
};

export const NotesSidebar: React.FC<NotesSidebarProps> = ({
  open,
  projectName,
  notes,
  selectedNoteId,
  activeBoardId,
  onClose,
  onSelectNote,
  onResolve,
  onReopen,
  onAddComment,
  onJumpToBoard,
}) => {
  const [statusFilter, setStatusFilter] = useState<NoteStatus | "all" | "pending">("pending");
  const [onlyCurrentBoard, setOnlyCurrentBoard] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      if (onlyCurrentBoard && activeBoardId && n.board !== activeBoardId) return false;
      if (statusFilter === "pending") return n.status !== "resolved";
      if (statusFilter !== "all") return n.status === statusFilter;
      return true;
    });
  }, [notes, statusFilter, onlyCurrentBoard, activeBoardId]);

  const selected = useMemo(() => {
    return notes.find((n) => n.shortId === selectedNoteId) ?? filteredNotes[0] ?? null;
  }, [notes, selectedNoteId, filteredNotes]);

  if (!open) {
    return null;
  }

  const copyForAgent = async (note: CanvasNote) => {
    const text = formatNoteForAgent(note, projectName);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(note.shortId);
      window.setTimeout(() => setCopiedId((cur) => (cur === note.shortId ? null : cur)), 1800);
    } catch {
      window.prompt("复制以下上下文给 Agent：", text);
    }
  };

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !replyText.trim() || busy) return;
    setBusy(true);
    try {
      if (selected.status === "addressed" || selected.status === "resolved") {
        await onReopen(selected.shortId, replyText.trim());
      } else {
        await onAddComment(selected.shortId, replyText.trim());
      }
      setReplyText("");
    } finally {
      setBusy(false);
    }
  };

  const shortFile = (src?: string | null) => (src ? src.split("/").pop() ?? src : null);

  return (
    <aside
      className="fixed top-[62px] right-4 bottom-[78px] w-[356px] z-[36] bg-chrome border border-hairline rounded-2xl shadow-float flex flex-col overflow-hidden"
      data-testid="notes-sidebar"
      aria-label="批注队列"
    >
      <div className="px-3.5 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-[7px] text-[14px]">
          <strong>批注</strong>
          <span className="px-[7px] py-px rounded-full bg-subtle text-muted text-[11.5px] font-semibold">
            {notes.filter((n) => n.status !== "resolved").length}
          </span>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center w-6 h-6 border-0 rounded-md bg-transparent text-dim hover:bg-black/6 hover:text-ink"
          onClick={onClose}
          aria-label="关闭批注抽屉"
        >
          <CloseIcon size={15} />
        </button>
      </div>

      <div className="px-3 pt-1 pb-2.5 border-b border-hairline flex flex-col gap-2">
        <div className="flex gap-1">
          {(
            [
              ["pending", "未归档"],
              ["open", "待处理"],
              ["addressed", "待验收"],
              ["all", "全部"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`flex-1 py-1 px-1.5 rounded-[7px] border-0 text-[11.5px] ${
                statusFilter === key ? "bg-ink text-white font-medium" : "bg-subtle text-muted hover:bg-hover"
              }`}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeBoardId && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={onlyCurrentBoard}
              onChange={(e) => setOnlyCurrentBoard(e.target.checked)}
            />
            <span>仅看当前画板</span>
          </label>
        )}
      </div>

      <div className="flex-1 min-h-[110px] overflow-y-auto px-2.5 py-2 flex flex-col gap-1.5">
        {filteredNotes.length === 0 ? (
          <div className="py-6 px-3 text-dim text-center text-[12.5px]">
            暂无批注。在底部工具栏选择评论图标（或按 <kbd>C</kbd>）即可点选页面元素落钉。
          </div>
        ) : (
          filteredNotes.map((note) => {
            const firstBody = note.thread[0]?.body ?? "";
            const isSelected = selected?.shortId === note.shortId;
            const fileName = shortFile(note.anchor.dataSource);
            return (
              <button
                key={note.shortId}
                type="button"
                className={`text-left border rounded-[10px] py-[9px] px-2.5 flex flex-col gap-1 transition-colors ${
                  isSelected
                    ? "border-ink bg-subtle"
                    : "border-hairline bg-chrome hover:bg-subtle"
                }`}
                onClick={() => onSelectNote(note)}
                data-note-id={note.shortId}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-1.5 py-px rounded-full text-[10.5px] font-bold text-white ${PIN_BG[note.status]}`}
                  >
                    {note.shortId}
                  </span>
                  <span className="font-semibold text-[12px]">{note.board}</span>
                  <span
                    className={`ml-auto text-[10.5px] px-[7px] py-px rounded-full ${STATUS_PILL_STYLE[note.status]}`}
                  >
                    {STATUS_LABEL[note.status]}
                  </span>
                </div>
                <div className="text-[12.5px] text-ink line-clamp-2">{firstBody}</div>
                {fileName && <div className="font-mono text-[11px] text-dim">{fileName}</div>}
              </button>
            );
          })
        )}
      </div>

      {selected && (
        <div
          className="border-t border-hairline p-3 flex flex-col gap-[9px] max-h-[58%] overflow-y-auto bg-chrome"
          data-testid="note-detail"
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className={`px-1.5 py-px rounded-full text-[10.5px] font-bold text-white ${PIN_BG[selected.status]}`}
              >
                {selected.shortId}
              </span>
              <span
                className={`text-[10.5px] px-[7px] py-px rounded-full ${STATUS_PILL_STYLE[selected.status]}`}
              >
                {STATUS_LABEL[selected.status]}
              </span>
              <button
                type="button"
                className="border-0 bg-transparent text-accent px-1 font-medium hover:underline"
                onClick={() => onJumpToBoard(selected)}
              >
                前往 {selected.board}
              </button>
            </div>
            <span className="font-mono text-[11px] text-dim">{selected.viewport.width}px</span>
          </div>

          {selected.anchor.textSnippet && (
            <div className="text-[12px] text-muted bg-subtle px-2 py-1.5 rounded-[7px]">
              目标元素：“{selected.anchor.textSnippet.slice(0, 64)}”
            </div>
          )}

          {selected.cropPath && (
            <div>
              <img
                src={`/__zhanjuan/assets/crops/${encodeURIComponent(selected.cropPath.split("/").pop() || "")}`}
                alt={`${selected.shortId} crop`}
                className="w-full max-h-[140px] object-contain rounded-lg border border-hairline bg-subtle"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {selected.thread.map((entry, idx) => (
              <div
                key={`${entry.at}-${idx}`}
                className={`py-[7px] px-[9px] rounded-[9px] border ${
                  entry.author === "agent"
                    ? "bg-[#f3f6ff] border-[#dce4ff]"
                    : "bg-subtle border-hairline"
                }`}
              >
                <div className="flex justify-between text-[11px] text-dim mb-0.5">
                  <span>{entry.author === "human" ? "你" : entry.author === "agent" ? "Agent" : "系统"}</span>
                  <span>{new Date(entry.at).toLocaleTimeString()}</span>
                </div>
                <div>{entry.body}</div>
              </div>
            ))}
          </div>

          {selected.resolution && (
            <div className="px-2.5 py-2 rounded-[9px] bg-pin-addressed/8 border border-pin-addressed/25 text-[12px]">
              <div>
                <strong>处理摘要：</strong>
                {selected.resolution.summary}
              </div>
              {selected.resolution.files && selected.resolution.files.length > 0 && (
                <div className="font-mono text-[11px] text-dim">
                  改动文件：{selected.resolution.files.join(", ")}
                </div>
              )}
              {selected.resolution.verification && (
                <div className="font-mono text-[11px] text-dim">验证结果：{selected.resolution.verification}</div>
              )}
            </div>
          )}

          <details className="text-[11.5px] text-dim">
            <summary className="cursor-pointer select-none">技术详情</summary>
            <div className="mt-1.5 bg-subtle rounded-[7px] p-[7px] flex flex-col gap-[3px] break-words">
              <div>
                <strong>源码：</strong>
                <code>{selected.anchor.dataSource ?? "未标记"}</code>
              </div>
              {selected.anchor.semanticId && (
                <div>
                  <strong>语义 ID：</strong>
                  <code>{selected.anchor.semanticId}</code>
                </div>
              )}
              {selected.anchor.cssSelector && (
                <div>
                  <strong>选择器：</strong>
                  <code>{selected.anchor.cssSelector}</code>
                </div>
              )}
              <div>
                <strong>全局 ID：</strong>
                <code>{selected.globalId}</code>
              </div>
            </div>
          </details>

          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 border-0 rounded-[9px] bg-ink hover:bg-[#27272a] text-white font-semibold"
              onClick={() => void copyForAgent(selected)}
              data-testid="copy-for-agent"
            >
              <CopyIcon size={14} />
              <span>{copiedId === selected.shortId ? "已复制给 Agent ✓" : "复制给 Agent"}</span>
            </button>

            {selected.status !== "resolved" && (
              <button
                type="button"
                className="rounded-lg py-1.5 px-2.5 border border-hairline bg-chrome text-muted hover:bg-subtle hover:text-ink whitespace-nowrap"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onResolve(selected.shortId);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                标记已解决
              </button>
            )}
          </div>

          <form className="flex gap-1.5" onSubmit={submitReply}>
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={
                selected.status === "addressed" || selected.status === "resolved"
                  ? "追评并打回重开..."
                  : "追加补充说明..."
              }
              className="flex-1 bg-subtle border border-hairline rounded-lg py-1.5 px-[9px] outline-none focus:border-accent focus:bg-white"
            />
            <button
              type="submit"
              className="rounded-lg py-[5px] px-2.5 border-0 bg-ink text-white font-medium text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={busy || !replyText.trim()}
            >
              {selected.status === "addressed" || selected.status === "resolved" ? "重开" : "发送"}
            </button>
          </form>
        </div>
      )}
    </aside>
  );
};
