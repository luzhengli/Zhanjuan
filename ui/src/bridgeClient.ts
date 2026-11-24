import type { NoteAnchor } from "../../src/shared/types.js";

export interface GeometryMapItem {
  bbox: { x: number; y: number; w: number; h: number };
  anchor: NoteAnchor;
}

export interface BridgeLocateResult {
  found: boolean;
  bbox: { x: number; y: number; w: number; h: number } | null;
  shiftedPx: number | null;
}

let reqCounter = 0;

export function sendBridgeRequest<T>(
  iframe: HTMLIFrameElement | null,
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const win = iframe?.contentWindow;
    if (!win) {
      reject(new Error("Target iframe window not ready."));
      return;
    }
    const reqId = `req-${++reqCounter}-${Date.now()}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error(`Bridge timeout for ${type}`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== win) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.__zhanjuan !== true || data.reqId !== reqId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data as T);
    };

    window.addEventListener("message", onMessage);
    win.postMessage({ __zhanjuan: true, type, reqId, ...payload }, window.location.origin);
  });
}

export function hitTestFrozenGeometry(
  items: GeometryMapItem[],
  x: number,
  y: number,
): NoteAnchor | null {
  for (const item of items) {
    const { bbox } = item;
    if (x >= bbox.x && x <= bbox.x + bbox.w && y >= bbox.y && y <= bbox.y + bbox.h) {
      return item.anchor;
    }
  }
  return null;
}

export function buildPaneUrl(
  route: string,
  opts: { theme?: "light" | "dark" | "system"; ns?: string },
): string {
  const hashIdx = route.indexOf("#");
  const basePath = hashIdx === -1 ? route : route.slice(0, hashIdx);
  const hashPart = hashIdx === -1 ? "" : route.slice(hashIdx);

  const url = new URL(basePath || "/", window.location.origin);
  if (opts.theme) {
    url.searchParams.set("__zj_theme", opts.theme);
  }
  if (opts.ns) {
    url.searchParams.set("__zj_ns", opts.ns);
  }
  return `${url.pathname}${url.search}${hashPart}`;
}
