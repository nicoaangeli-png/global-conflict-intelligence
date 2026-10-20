"use client";

import { useEffect, useState } from "react";
import type { DetectionResponse } from "@/types/detection";

export const DETECTION_POLL_MS = 30_000;
export const DETECTION_TIMEOUT_MS = 12_000;

export function useDetection() {
  const [data, setData] = useState<DetectionResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (disposed || document.hidden || active) return;
      const controller = new AbortController();
      active = controller;
      const timeout = setTimeout(() => controller.abort(), DETECTION_TIMEOUT_MS);
      try {
        const response = await fetch("/api/detection", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Detection unavailable");
        const body: DetectionResponse = await response.json();
        if (!body || !Array.isArray(body.events) || !Array.isArray(body.live) ||
          typeof body.generatedAt !== "string" || (body.status !== "ok" && body.status !== "unavailable")) {
          throw new Error("Invalid detection response");
        }
        if (!disposed && !controller.signal.aborted) { setData(body); setFailed(body.status !== "ok"); }
      } catch {
        if (!disposed && !document.hidden) setFailed(true);
      } finally {
        clearTimeout(timeout);
        active = null;
        if (!disposed && !document.hidden) timer = setTimeout(() => void poll(), DETECTION_POLL_MS);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) active?.abort();
      else void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      active?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  return { data, failed };
}
