export type CaptureStatus = "idle" | "requesting" | "active" | "unsupported" | "denied";

export interface CapturedFrame {
  fullDataUrl: string;
  videoWidth: number;
  videoHeight: number;
  cropRect: (rectInViewport: { x: number; y: number; w: number; h: number }) => string | null;
}

class ScreenCaptureManager {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private status: CaptureStatus = detectSupport() ? "idle" : "unsupported";
  private listeners = new Set<(status: CaptureStatus) => void>();

  getStatus(): CaptureStatus {
    return this.status;
  }

  subscribe(fn: (status: CaptureStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setStatus(next: CaptureStatus): void {
    this.status = next;
    for (const fn of this.listeners) {
      fn(next);
    }
  }

  async ensureSession(): Promise<boolean> {
    if (this.stream && this.video && this.stream.getVideoTracks().some((t) => t.readyState === "live")) {
      return true;
    }
    if (!detectSupport()) {
      this.setStatus("unsupported");
      return false;
    }
    this.setStatus("requesting");
    try {
      const constraints = {
        video: {
          displaySurface: "browser",
        },
        audio: false,
        preferCurrentTab: true,
      } as MediaStreamConstraints & { preferCurrentTab?: boolean };

      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      const track = stream.getVideoTracks()[0];
      if (!track) {
        this.setStatus("denied");
        return false;
      }
      track.addEventListener("ended", () => {
        this.cleanup();
        this.setStatus("idle");
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      this.stream = stream;
      this.video = video;
      this.setStatus("active");
      return true;
    } catch {
      this.cleanup();
      this.setStatus("denied");
      return false;
    }
  }

  captureElementFrame(element: HTMLElement): CapturedFrame | null {
    if (!this.video || !this.stream || this.video.videoWidth === 0 || this.video.videoHeight === 0) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const scaleX = this.video.videoWidth / vw;
    const scaleY = this.video.videoHeight / vh;

    const sx = Math.max(0, Math.round(rect.left * scaleX));
    const sy = Math.max(0, Math.round(rect.top * scaleY));
    const sw = Math.min(this.video.videoWidth - sx, Math.max(1, Math.round(rect.width * scaleX)));
    const sh = Math.min(this.video.videoHeight - sy, Math.max(1, Math.round(rect.height * scaleY)));

    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = sw;
    fullCanvas.height = sh;
    const ctx = fullCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, sw, sh);
    const fullDataUrl = fullCanvas.toDataURL("image/png");

    return {
      fullDataUrl,
      videoWidth: sw,
      videoHeight: sh,
      cropRect: (localRect) => {
        const lx = Math.max(0, Math.round(localRect.x * scaleX));
        const ly = Math.max(0, Math.round(localRect.y * scaleY));
        const lw = Math.min(sw - lx, Math.max(4, Math.round(localRect.w * scaleX)));
        const lh = Math.min(sh - ly, Math.max(4, Math.round(localRect.h * scaleY)));
        if (lw <= 0 || lh <= 0) return null;
        const c = document.createElement("canvas");
        c.width = lw;
        c.height = lh;
        const cctx = c.getContext("2d");
        if (!cctx) return null;
        cctx.drawImage(fullCanvas, lx, ly, lw, lh, 0, 0, lw, lh);
        return c.toDataURL("image/png");
      },
    };
  }

  cleanup(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
    }
    this.stream = null;
    this.video = null;
  }
}

function detectSupport(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    return false;
  }
  const ua = navigator.userAgent;
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
  return !isSafari;
}

export const screenCapture = new ScreenCaptureManager();
