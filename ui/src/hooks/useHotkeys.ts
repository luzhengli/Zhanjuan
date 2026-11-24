import { useEffect, useRef } from "react";

export interface HotkeyHandlers {
  onToolKey?: (key: "v" | "h" | "c" | "r" | "f") => void;
  onCompareHold?: (held: boolean) => void;
  onExitFocus?: () => void;
  onPasteImage?: (dataUrl: string) => void;
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return (target as HTMLElement).isContentEditable === true;
}

export function useHotkeys(handlers: HotkeyHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;

      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        ref.current.onExitFocus?.();
        return;
      }

      if (isEditableElement(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const lower = e.key.toLowerCase();
      if (lower === "v" || lower === "h" || lower === "c" || lower === "r" || lower === "f") {
        e.preventDefault();
        ref.current.onToolKey?.(lower);
      } else if (lower === "b" && !e.repeat) {
        e.preventDefault();
        ref.current.onCompareHold?.(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key.toLowerCase() === "b") {
        ref.current.onCompareHold?.(false);
      }
    };

    const onBlur = () => {
      ref.current.onCompareHold?.(false);
    };

    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imgItem = items.find((item) => item.type.startsWith("image/"));
      if (!imgItem) return;
      const blob = imgItem.getAsFile();
      if (!blob) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          ref.current.onPasteImage?.(reader.result);
        }
      };
      reader.readAsDataURL(blob);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}
