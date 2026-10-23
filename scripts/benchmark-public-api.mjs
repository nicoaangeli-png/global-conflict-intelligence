/** Charge légère et bornée, uniquement sur un serveur local explicitement lancé. */
import { execFileSync } from "node:child_process";
const base = new URL(process.env.ORBITAL_BENCH_URL || "http://127.0.0.1:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("Benchmark local uniquement");
const requests = Math.min(300, Math.max(1, Number(process.env.ORBITAL_BENCH_REQUESTS || 100)));
const concurrency = Math.min(30, Math.max(1, Number(process.env.ORBITAL_BENCH_CONCURRENCY || 10)));
const sseCount = Math.min(30, Math.max(1, Number(process.env.ORBITAL_BENCH_SSE || 12)));
const percentile = (values, p) => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] ?? 0;
const serverPid = process.env.ORBITAL_BENCH_SERVER_PID;
if (serverPid && !/^\d+$/.test(serverPid)) throw new Error("PID serveur invalide");
const serverRss = () => {
  if (!serverPid) return null;
  try { return Number(execFileSync("ps", ["-o", "rss=", "-p", serverPid], { encoding: "utf8" }).trim()) * 1024; }
  catch { return null; }
};
const memoryBefore = process.memoryUsage().rss;
const serverBefore = serverRss();
const latencies = [];
let rejected429 = 0;
let failed = 0;
let next = 0;
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < requests) {
    next++;
    const at = performance.now();
    try {
      const response = await fetch(new URL("/api/stats", base), { signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
      if (response.status === 429) rejected429++;
      else if (!response.ok) failed++;
    } catch { failed++; }
    latencies.push(performance.now() - at);
  }
}));
const durationSec = (performance.now() - started) / 1000;
latencies.sort((a, b) => a - b);

let sseAccepted = 0;
const beforeSse = process.memoryUsage().rss;
const serverBeforeSse = serverRss();
const streams = await Promise.all(Array.from({ length: sseCount }, async () => {
  const controller = new AbortController();
  try {
    const response = await fetch(new URL("/api/stream", base), { signal: controller.signal });
    if (response.ok) sseAccepted++;
    return { controller, response };
  } catch { return { controller, response: null }; }
}));
let reportedActive = null;
try { reportedActive = (await (await fetch(new URL("/api/health", base))).json()).publicApi?.sse?.active ?? null; } catch { /* santé facultative */ }
for (const { controller, response } of streams) {
  controller.abort();
  await response?.body?.cancel().catch(() => undefined);
}
let reconnectAccepted = 0;
await Promise.all(Array.from({ length: sseCount }, async () => {
  const controller = new AbortController();
  try {
    const response = await fetch(new URL("/api/stream", base), { signal: controller.signal });
    if (response.ok) reconnectAccepted++;
    controller.abort();
    await response.body?.cancel().catch(() => undefined);
  } catch { controller.abort(); }
}));
await new Promise((resolve) => setTimeout(resolve, 200));
console.log(JSON.stringify({
  requests, concurrency, requestsPerSecond: Math.round(requests / durationSec * 10) / 10,
  latencyMs: { p50: percentile(latencies, .5), p95: percentile(latencies, .95), p99: percentile(latencies, .99) },
  rejected429, failed, sseAttempted: sseCount, sseAccepted, sseActiveAtPeak: reportedActive,
  reconnectAttempted: sseCount, reconnectAccepted,
  clientRssBytes: { before: memoryBefore, beforeSse, afterSse: process.memoryUsage().rss },
  serverRssBytes: { before: serverBefore, beforeSse: serverBeforeSse, afterSse: serverRss() },
  note: "RSS serveur si ORBITAL_BENCH_SERVER_PID est fourni; SSE actif issu du health local.",
}, null, 2));
