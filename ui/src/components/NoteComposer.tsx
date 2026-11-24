import React, { useEffect, useRef, useState } from "react";
import type { NoteAnchor, NoteIntent } from "../../../src/shared/types.js";
import { CloseIcon } from "./Icons.js";

export interface DraftPinState {
  board: string;
  route: string;
  viewport: { width: number; height: number };
  theme: "light" | "dark";
  anchor: NoteAnchor;
  cropDataUrl?: string | null;
  beforeSnapshotDataUrl?: string | null;
  screenX: number;
  screenY: number;
}

interface NoteComposerProps {
  draft: DraftPinState;
  submitting: boolean;
  onCancel: () => void;
  onAttachCrop: (dataUrl: string) => void;
  onSubmit: (payload: { intent: NoteIntent; body: string }) => Promise<void>;
}

const INTENTS: Array<{ value: NoteIntent; label: string }> = [
  { value: "layout", label: "布局" },
  { value: "visual", label: "视觉" },
  { value: "copy", label: "文案" },
  { value: "interaction", label: "交互" },
  { value: "bug", label: "问题" },
  { value: "question", label: "讨论" },
];

export const NoteComposer: React.FC<NoteComposerProps> = ({
  draft,
  submitting,
  onCancel,
  onAttachCrop,
  onSubmit,
}) => {
  const [intent, setIntent] = useState<NoteIntent>("layout");
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgItem = items.find((item) => item.type.startsWith("image/"));
    if (!imgItem) return;
    const blob = imgItem.getAsFile();
    if (!blob) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onAttachCrop(reader.result);
      }
    };
    reader.readAsDataURL(blob);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || submitting) return;
    await onSubmit({ intent, body: body.trim() });
  };

  const shortSource = draft.anchor.dataSource
    ? draft.anchor.dataSource.split("/").pop() ?? draft.anchor.dataSource
    : null;

  return (
    <div
      className="bg-chrome border border-hairline rounded-[14px] p-[13px] shadow-float flex flex-col gap-[9px]"
      data-testid="note-composer"
    >
      <div className="flex items-center justify-between text-[13px]">
        <strong>添加批注</strong>
        <button
          type="button"
          className="inline-flex items-center justify-center w-6 h-6 border-0 rounded-md bg-transparent text-dim hover:bg-black/6 hover:text-ink"
          onClick={onCancel}
          aria-label="取消"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        {shortSource ? (
          <code
            className="px-[7px] py-0.5 rounded-[5px] bg-accent-soft text-accent font-mono text-[11px]"
            title={draft.anchor.dataSource ?? undefined}
          >
            {shortSource}
          </code>
        ) : (
          <code className="px-[7px] py-0.5 rounded-[5px] bg-accent-soft text-accent font-mono text-[11px]">
            页面批注
          </code>
        )}
        {draft.anchor.textSnippet && (
          <span className="text-muted text-[11.5px]">“{draft.anchor.textSnippet.slice(0, 40)}”</span>
        )}
      </div>

      {draft.cropDataUrl && (
        <div>
          <img
            src={draft.cropDataUrl}
            alt="批注截图"
            className="w-full max-h-[120px] object-contain rounded-lg border border-hairline bg-subtle"
          />
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-1 mb-2">
          {INTENTS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`px-[9px] py-[3px] rounded-full border text-[11.5px] ${
                intent === item.value
                  ? "border-ink bg-ink text-white"
                  : "border-hairline bg-subtle text-muted hover:bg-hover"
              }`}
              onClick={() => setIntent(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={handlePaste}
          placeholder="写下你的修改意见（支持 ⌘V 粘贴截图）"
          className="w-full bg-subtle border border-hairline rounded-[9px] px-2.5 py-2 resize-y outline-none focus:border-accent focus:bg-white"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSubmit(e);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
        />

        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[11px] text-dim">⌘+Enter 保存</span>
          <button
            type="submit"
            className="rounded-lg px-3 py-1.5 border-0 bg-ink text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={submitting || !body.trim()}
          >
            {submitting ? "保存中..." : "落钉保存"}
          </button>
        </div>
      </form>
    </div>
  );
};
