/* eslint-disable no-var */
interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AnchorPayload {
  dataSource: string | null;
  sourceStack: string[];
  semanticId: string | null;
  ariaLabel: string | null;
  cssSelector: string | null;
  textSnippet: string | null;
  tagName: string | null;
  bbox: BBox | null;
}

(function initZhanjuanBridge() {
  if (typeof window === "undefined" || (window as unknown as { __zhanjuanBridgeLoaded?: boolean }).__zhanjuanBridgeLoaded) {
    return;
  }
  (window as unknown as { __zhanjuanBridgeLoaded?: boolean }).__zhanjuanBridgeLoaded = true;

  const params = new URLSearchParams(window.location.search);

  // 1. Apply explicit theme override early in <head> before paint.
  const initialTheme = params.get("__zj_theme");
  applyTheme(initialTheme);

  // 2. Isolate localStorage per compare pane namespace (?__zj_ns=pane-1).
  let paneNamespace = params.get("__zj_ns") || "";
  if (!paneNamespace && window.name && window.name.startsWith("__zj_ns:")) {
    paneNamespace = window.name.slice("__zj_ns:".length);
  } else if (paneNamespace && !window.name) {
    window.name = `__zj_ns:${paneNamespace}`;
  }

  if (paneNamespace) {
    installStorageIsolation(paneNamespace);
  }

  function applyTheme(theme: string | null): void {
    const root = document.documentElement;
    if (!root) return;
    if (theme === "dark" || theme === "light") {
      root.setAttribute("data-theme", theme);
    } else if (theme === "system") {
      root.removeAttribute("data-theme");
    }
  }

  function installStorageIsolation(ns: string): void {
    const prefix = `__zj:${ns}:`;
    let nativeStorage: Storage;
    try {
      nativeStorage = window.localStorage;
    } catch {
      return;
    }
    const proto = Storage.prototype;
    const origGet = proto.getItem;
    const origSet = proto.setItem;
    const origRemove = proto.removeItem;
    const origClear = proto.clear;
    const origKey = proto.key;
    const origLengthDesc = Object.getOwnPropertyDescriptor(proto, "length");

    function scopedKeys(): string[] {
      const keys: string[] = [];
      const total = origLengthDesc?.get ? origLengthDesc.get.call(nativeStorage) : nativeStorage.length;
      for (let i = 0; i < total; i += 1) {
        const k = origKey.call(nativeStorage, i);
        if (k && k.startsWith(prefix)) {
          keys.push(k);
        }
      }
      return keys;
    }

    proto.getItem = function getItem(key: string): string | null {
      if (this === nativeStorage) {
        return origGet.call(this, prefix + String(key));
      }
      return origGet.call(this, key);
    };

    proto.setItem = function setItem(key: string, value: string): void {
      if (this === nativeStorage) {
        origSet.call(this, prefix + String(key), String(value));
        return;
      }
      origSet.call(this, key, value);
    };

    proto.removeItem = function removeItem(key: string): void {
      if (this === nativeStorage) {
        origRemove.call(this, prefix + String(key));
        return;
      }
      origRemove.call(this, key);
    };

    proto.clear = function clear(): void {
      if (this === nativeStorage) {
        for (const k of scopedKeys()) {
          origRemove.call(this, k);
        }
        return;
      }
      origClear.call(this);
    };

    proto.key = function key(index: number): string | null {
      if (this === nativeStorage) {
        const keys = scopedKeys();
        const found = keys[index];
        return found ? found.slice(prefix.length) : null;
      }
      return origKey.call(this, index);
    };

    if (origLengthDesc && origLengthDesc.configurable) {
      try {
        Object.defineProperty(proto, "length", {
          configurable: true,
          enumerable: origLengthDesc.enumerable ?? false,
          get() {
            if (this === nativeStorage) {
              return scopedKeys().length;
            }
            return origLengthDesc.get ? origLengthDesc.get.call(this) : 0;
          },
        });
      } catch {
        // Ignore if environment prevents redefining Storage.prototype.length.
      }
    }
  }

  function roundBox(rect: DOMRect): BBox {
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  }

  function getAriaLabel(el: Element): string | null {
    const direct = el.getAttribute("aria-label");
    if (direct && direct.trim()) return direct.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() || "")
        .filter(Boolean);
      if (parts.length > 0) return parts.join(" ");
    }
    return null;
  }

  function buildCssSelector(el: Element): string {
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${cssEscape(testId)}"]`;
    if (el.id) return `#${cssEscape(el.id)}`;

    const segments: string[] = [];
    let cur: Element | null = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== "html" && depth < 4) {
      const tid = cur.getAttribute("data-testid");
      if (tid) {
        segments.unshift(`[data-testid="${cssEscape(tid)}"]`);
        break;
      }
      if (cur.id) {
        segments.unshift(`#${cssEscape(cur.id)}`);
        break;
      }
      const tag = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c: Element) => c.tagName === cur!.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          segments.unshift(`${tag}:nth-of-type(${idx})`);
        } else {
          segments.unshift(tag);
        }
      } else {
        segments.unshift(tag);
      }
      cur = parent;
      depth += 1;
    }
    return segments.join(" > ");
  }

  function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replaceAll(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function extractAnchor(el: Element): AnchorPayload {
    const sourceStack: string[] = [];
    let semanticId: string | null = null;
    let ariaLabel: string | null = null;

    let cur: Element | null = el;
    while (cur && cur.nodeType === 1) {
      const ds = cur.getAttribute("data-source");
      if (ds && !sourceStack.includes(ds) && sourceStack.length < 6) {
        sourceStack.push(ds);
      }
      if (!semanticId) {
        semanticId = cur.getAttribute("data-testid") || (cur.id ? cur.id : null);
      }
      if (!ariaLabel) {
        ariaLabel = getAriaLabel(cur);
      }
      cur = cur.parentElement;
    }

    const rawText = (el.textContent || "").replaceAll(/\s+/g, " ").trim();
    const textSnippet = rawText ? rawText.slice(0, 120) : ariaLabel;

    return {
      dataSource: sourceStack[0] ?? null,
      sourceStack,
      semanticId,
      ariaLabel,
      cssSelector: buildCssSelector(el),
      textSnippet,
      tagName: el.tagName.toLowerCase(),
      bbox: roundBox(el.getBoundingClientRect()),
    };
  }

  function pickElementAt(x: number, y: number): Element | null {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      const tag = el.tagName.toLowerCase();
      if (tag === "html" || tag === "body") continue;
      if (el.hasAttribute("data-zhanjuan-ignore")) continue;
      return el;
    }
    return stack[0] ?? null;
  }

  function captureGeometryMap(): Array<{ bbox: BBox; anchor: AnchorPayload }> {
    const candidates = Array.from(
      document.querySelectorAll(
        "[data-source], [data-testid], [role='tooltip'], [role='dialog'], button, a, input, select, textarea, [aria-label]",
      ),
    );

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const items: Array<{ bbox: BBox; anchor: AnchorPayload; area: number; depth: number }> = [];

    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) continue;

      let depth = 0;
      let p: Element | null = el;
      while (p) {
        depth += 1;
        p = p.parentElement;
      }
      const bbox = roundBox(rect);
      items.push({
        bbox,
        anchor: extractAnchor(el),
        area: bbox.w * bbox.h,
        depth,
      });
    }

    // Smallest / deepest elements first so hit-testing frozen frames prefers concrete controls/tooltips over wrappers.
    items.sort((a, b) => a.area - b.area || b.depth - a.depth);
    return items.slice(0, 600).map(({ bbox, anchor }) => ({ bbox, anchor }));
  }

  function locateAnchor(anchor: Partial<AnchorPayload>): { found: boolean; bbox: BBox | null; shiftedPx: number | null } {
    let el: Element | null = null;
    if (anchor.semanticId) {
      el =
        document.querySelector(`[data-testid="${cssEscape(anchor.semanticId)}"]`) ||
        document.getElementById(anchor.semanticId);
    }
    if (!el && anchor.cssSelector) {
      try {
        el = document.querySelector(anchor.cssSelector);
      } catch {
        el = null;
      }
    }
    if (!el && anchor.dataSource) {
      const matches = Array.from(document.querySelectorAll(`[data-source="${cssEscape(anchor.dataSource)}"]`));
      if (matches.length === 1) {
        el = matches[0] ?? null;
      } else if (matches.length > 1) {
        el =
          matches.find((m) => {
            if (anchor.textSnippet && (m.textContent || "").includes(anchor.textSnippet.slice(0, 24))) return true;
            if (anchor.ariaLabel && m.getAttribute("aria-label") === anchor.ariaLabel) return true;
            return false;
          }) ??
          matches[0] ??
          null;
      }
    }

    if (!el) {
      return { found: false, bbox: null, shiftedPx: null };
    }
    const bbox = roundBox(el.getBoundingClientRect());
    if (bbox.w === 0 && bbox.h === 0) {
      return { found: false, bbox: null, shiftedPx: null };
    }

    let shiftedPx: number | null = null;
    if (anchor.bbox) {
      const dx = Math.abs(bbox.x - anchor.bbox.x);
      const dy = Math.abs(bbox.y - anchor.bbox.y);
      const dw = Math.abs(bbox.w - anchor.bbox.w);
      const dh = Math.abs(bbox.h - anchor.bbox.h);
      shiftedPx = Math.max(dx, dy, dw, dh);
    }
    return { found: true, bbox, shiftedPx };
  }

  function buildStaticSnapshotHtml(): string {
    const docEl = document.documentElement;
    const clone = docEl.cloneNode(true) as HTMLElement;

    // Preserve canvas drawings as static images.
    const liveCanvases = Array.from(document.querySelectorAll("canvas"));
    const cloneCanvases = Array.from(clone.querySelectorAll("canvas"));
    for (let i = 0; i < liveCanvases.length && i < cloneCanvases.length; i += 1) {
      const liveCanvas = liveCanvases[i];
      const cloneCanvas = cloneCanvases[i];
      if (!liveCanvas || !cloneCanvas) continue;
      try {
        const img = document.createElement("img");
        img.src = liveCanvas.toDataURL("image/png");
        img.className = cloneCanvas.className;
        const styleAttr = cloneCanvas.getAttribute("style");
        if (styleAttr) img.setAttribute("style", styleAttr);
        img.width = liveCanvas.width;
        img.height = liveCanvas.height;
        cloneCanvas.replaceWith(img);
      } catch {
        // Ignore tainted canvas.
      }
    }

    // Preserve form input visual values.
    const liveInputs = Array.from(document.querySelectorAll("input, textarea, select"));
    const cloneInputs = Array.from(clone.querySelectorAll("input, textarea, select"));
    for (let i = 0; i < liveInputs.length && i < cloneInputs.length; i += 1) {
      const src = liveInputs[i];
      const dst = cloneInputs[i];
      if (!src || !dst) continue;
      if (src instanceof HTMLInputElement && dst instanceof HTMLInputElement) {
        if (src.type === "checkbox" || src.type === "radio") {
          if (src.checked) dst.setAttribute("checked", "");
          else dst.removeAttribute("checked");
        } else {
          dst.setAttribute("value", src.value);
        }
      } else if (src instanceof HTMLTextAreaElement && dst instanceof HTMLTextAreaElement) {
        dst.textContent = src.value;
      } else if (src instanceof HTMLSelectElement && dst instanceof HTMLSelectElement) {
        const options = Array.from(dst.options);
        options.forEach((opt, idx) => {
          if (idx === src.selectedIndex) opt.setAttribute("selected", "");
          else opt.removeAttribute("selected");
        });
      }
    }

    // Remove scripts & inline event attributes so snapshots cannot run JS or HMR.
    for (const node of Array.from(clone.querySelectorAll("script, noscript"))) {
      node.remove();
    }
    for (const el of Array.from(clone.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith("on")) {
          el.removeAttribute(attr.name);
        }
      }
    }

    // Inline computed stylesheet rules so snapshot renders even offline/sandboxed.
    const cssChunks: string[] = [];
    let inlinedAll = true;
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = Array.from(sheet.cssRules || []);
        cssChunks.push(rules.map((r) => r.cssText).join("\n"));
      } catch {
        inlinedAll = false;
      }
    }

    let head = clone.querySelector("head");
    if (!head) {
      head = document.createElement("head");
      clone.prepend(head);
    }

    if (inlinedAll && cssChunks.length > 0) {
      for (const node of Array.from(clone.querySelectorAll('link[rel="stylesheet"], style'))) {
        node.remove();
      }
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-zhanjuan-inlined", "true");
      styleEl.textContent = cssChunks.join("\n");
      head.appendChild(styleEl);
    }

    const existingBase = head.querySelector("base");
    if (!existingBase) {
      const base = document.createElement("base");
      base.setAttribute("href", `${window.location.origin}/`);
      head.prepend(base);
    }

    return `<!doctype html>\n${clone.outerHTML}`;
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return (target as HTMLElement).isContentEditable === true;
  }

  function postToParent(payload: Record<string, unknown>): void {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __zhanjuan: true, ...payload }, window.location.origin);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.__zhanjuan !== true || typeof data.type !== "string") return;

    const reqId = typeof data.reqId === "string" ? data.reqId : undefined;
    switch (data.type) {
      case "zj:ping":
        postToParent({ type: "zj:pong", reqId, url: window.location.href });
        break;
      case "zj:set-theme":
        applyTheme(typeof data.theme === "string" ? data.theme : null);
        postToParent({ type: "zj:theme-applied", reqId });
        break;
      case "zj:hit-test": {
        const x = Number(data.x ?? 0);
        const y = Number(data.y ?? 0);
        const el = pickElementAt(x, y);
        const anchor = el ? extractAnchor(el) : null;
        postToParent({ type: "zj:hit-result", reqId, anchor });
        break;
      }
      case "zj:capture-geometry-map": {
        const items = captureGeometryMap();
        postToParent({
          type: "zj:geometry-map",
          reqId,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          items,
        });
        break;
      }
      case "zj:locate-anchor": {
        const anchor = (data.anchor as Partial<AnchorPayload>) ?? {};
        const result = locateAnchor(anchor);
        postToParent({ type: "zj:locate-result", reqId, ...result });
        break;
      }
      case "zj:snapshot-dom": {
        const html = buildStaticSnapshotHtml();
        postToParent({ type: "zj:snapshot-result", reqId, html, title: document.title });
        break;
      }
      case "zj:get-scroll":
        postToParent({ type: "zj:scroll-result", reqId, x: window.scrollX, y: window.scrollY });
        break;
      case "zj:set-scroll":
        window.scrollTo(Number(data.x ?? 0), Number(data.y ?? 0));
        break;
      default:
        break;
    }
  });

  // Alt+Click inside live page triggers instant element pick without activating app buttons.
  window.addEventListener(
    "click",
    (event) => {
      if (!event.altKey || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const el = pickElementAt(event.clientX, event.clientY);
      const anchor = el ? extractAnchor(el) : null;
      postToParent({
        type: "zj:quick-pick",
        clientX: event.clientX,
        clientY: event.clientY,
        anchor,
      });
    },
    true,
  );

  // Never intercept Escape so first Esc always goes to the target app (e.g. closing modals/tooltips).
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || event.keyCode === 229) return;

      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        event.stopPropagation();
        postToParent({ type: "zj:exit-focus" });
        return;
      }

      if (event.key === "Escape") {
        return;
      }

      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const lower = event.key.toLowerCase();
      if (lower === "f" || lower === "b" || lower === "c" || lower === "r" || lower === "v") {
        event.preventDefault();
        postToParent({ type: "zj:hotkey", key: lower, phase: "keydown" });
      }
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() === "b") {
        postToParent({ type: "zj:hotkey", key: "b", phase: "keyup" });
      }
    },
    true,
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      postToParent({ type: "zj:ready", url: window.location.href });
    });
  } else {
    postToParent({ type: "zj:ready", url: window.location.href });
  }
})();
