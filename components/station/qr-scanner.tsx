"use client";

import { Camera, CameraOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface Detector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (options: { formats: string[] }) => Detector;
type JsQr = typeof import("jsqr").default;

const SCAN_EVERY_MS = 180;
const SAME_CODE_COOLDOWN_MS = 4000;

/**
 * Rear-camera QR scanner. Uses the native BarcodeDetector where available (Chrome on Android)
 * and falls back to jsQR on a downscaled canvas elsewhere. Detection pauses while `paused`.
 */
export function QrScanner({ paused, onDetect }: { paused: boolean; onDetect: (code: string) => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  const onDetectRef = useRef(onDetect);
  const [state, setState] = useState<"idle" | "starting" | "running" | "error">("idle");

  useEffect(() => {
    pausedRef.current = paused;
    onDetectRef.current = onDetect;
  }, [paused, onDetect]);

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setState("running");
    } catch {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      setState("error");
    }
  }, []);

  // Release the camera when leaving the page.
  useEffect(
    () => () => {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    },
    [],
  );

  useEffect(() => {
    if (state !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detector: Detector | null = null;
    let jsqr: JsQr | null = null;
    const canvas = document.createElement("canvas");
    const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (Native) {
      try {
        detector = new Native({ formats: ["qr_code"] });
      } catch {
        detector = null;
      }
    }
    let last = "";
    let lastAt = 0;

    const read = async (video: HTMLVideoElement): Promise<string | null> => {
      if (detector) {
        const found = await detector.detect(video);
        return found[0]?.rawValue ?? null;
      }
      jsqr ??= (await import("jsqr")).default;
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsqr(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
    };

    const tick = async () => {
      const video = videoRef.current;
      if (video && !pausedRef.current && video.readyState >= 2 && video.videoWidth > 0) {
        let code: string | null = null;
        try {
          code = await read(video);
        } catch {
          code = null;
        }
        const now = Date.now();
        if (!cancelled && code && (code !== last || now - lastAt > SAME_CODE_COOLDOWN_MS)) {
          last = code;
          lastAt = now;
          onDetectRef.current(code.trim());
        }
      }
      if (!cancelled) timer = setTimeout(() => void tick(), SCAN_EVERY_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [state]);

  const running = state === "running";
  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-card bg-ink">
        <video ref={videoRef} className="size-full object-cover" playsInline muted aria-label={t("station.scanner.title")} />
        {running ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <div className="relative size-60 overflow-hidden rounded-card border-2 border-white/80">
              {paused ? null : <div className="scan-line absolute inset-x-3 top-2.5 h-0.5 rounded-full bg-success" />}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
            <Camera className="size-10 text-neutral-400" aria-hidden />
            <p className="text-sm text-neutral-300">{state === "error" ? t("station.scanner.cameraError") : t("station.scanner.hint")}</p>
            <Button variant="inverse" size="lg" loading={state === "starting"} onClick={() => void start()}>
              {t("station.scanner.startCamera")}
            </Button>
          </div>
        )}
      </div>
      {running ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={stop}>
            <CameraOff aria-hidden />
            {t("station.scanner.stopCamera")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
