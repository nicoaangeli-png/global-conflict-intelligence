"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * Artefact d'AURA, style HUD « JARVIS » : réacteur circulaire à anneaux
 * segmentés contrarotatifs, couronne de graduations, spectre vocal radial,
 * onde horizontale traversant le noyau et lectures techniques latérales.
 *
 * Canvas 2D en mélange additif : net à toute taille, sans WebGL.
 *  - idle     : rotation lente, noyau qui respire ;
 *  - thinking : balayage radar, anneaux qui accélèrent, accents ambrés ;
 *  - speaking : spectre radial et onde pilotés par `levelRef`.
 */

export type AuraState = "idle" | "thinking" | "speaking";

const CYAN = "127, 212, 255";
const ICE = "225, 245, 255";
const AMBER = "255, 160, 70";
const TAU = Math.PI * 2;

export function AuraCore({
  state,
  levelRef,
  width,
  height,
  className,
}: {
  state: AuraState;
  levelRef?: MutableRefObject<number>;
  width: number;
  height: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<AuraState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const compact = height < 100;
    const cx = width / 2;
    const cy = compact ? height / 2 : height / 2 + height * 0.07;
    const R = compact ? Math.min(width, height) * 0.46 : Math.min(width * 0.28, height * 0.37);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const BARS = compact ? 36 : 72;
    const bars = new Float32Array(BARS);
    const seeds = Array.from({ length: BARS }, () => Math.random() * 10);

    let frame = 0;
    let think = 0;
    let speak = 0;
    let energy = 0;
    let spin = 0;
    let last = performance.now();
    const start = last;

    const ring = (r: number, alpha: number, lw: number, color = CYAN) => {
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    };
    const arc = (r: number, a0: number, a1: number, alpha: number, lw: number, color = CYAN) => {
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
    };
    /** Lueur bon marché : trait large et diffus sous le trait net. */
    const glowArc = (r: number, a0: number, a1: number, alpha: number, lw: number, color = CYAN) => {
      arc(r, a0, a1, alpha * 0.18, lw * 3.5, color);
      arc(r, a0, a1, alpha, lw, color);
    };

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduced ? 0 : (now - start) / 1000;
      const s = stateRef.current;
      think += ((s === "thinking" ? 1 : 0) - think) * 0.06;
      speak += ((s === "speaking" ? 1 : 0) - speak) * 0.08;
      const level = s === "speaking" ? Math.min(1, levelRef?.current ?? 0.6) : 0;
      const syllable = 0.5 + 0.5 * Math.abs(Math.sin(t * 9.5) * Math.sin(t * 5.3 + 0.7));
      energy += (level * syllable - energy) * 0.25;
      spin += dt * (1 + think * 2.4 + speak * 0.5);
      const breath = 0.5 + 0.5 * Math.sin(t * 1.3);

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "butt";

      // Halo de fond.
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
      halo.addColorStop(0, `rgba(${CYAN}, ${0.16 + energy * 0.18 + think * 0.06})`);
      halo.addColorStop(0.55, `rgba(${CYAN}, 0.05)`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      // 1. Couronne de graduations (lente).
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin * 0.05);
      const TICKS = compact ? 60 : 120;
      const tickPaths = [new Path2D(), new Path2D(), new Path2D()];
      for (let i = 0; i < TICKS; i++) {
        const kind = i % 10 === 0 ? 0 : i % 5 === 0 ? 1 : 2;
        const r0 = R * 0.97;
        const r1 = R * (kind === 0 ? 0.87 : kind === 1 ? 0.91 : 0.935);
        const a = (i / TICKS) * TAU;
        tickPaths[kind].moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        tickPaths[kind].lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      }
      ([[0.8, 1.4], [0.5, 0.8], [0.25, 0.8]] as const).forEach(([alpha, lw], k) => {
        ctx.strokeStyle = `rgba(${CYAN}, ${alpha})`;
        ctx.lineWidth = lw;
        ctx.stroke(tickPaths[k]);
      });
      ctx.restore();
      ring(R, 0.35, 0.8);

      // 2. Anneau segmenté (contrarotatif).
      const seg = 8;
      for (let i = 0; i < seg; i++) {
        const a0 = -spin * 0.22 + (i / seg) * TAU;
        arc(R * 0.82, a0, a0 + (TAU / seg) * 0.72, 0.55 + think * 0.2, compact ? 1.5 : 2.4);
      }

      // 3. Crochets épais (rapides) — ambrés en réflexion.
      for (let i = 0; i < 3; i++) {
        const a0 = spin * 0.6 + (i / 3) * TAU;
        const color = think > 0.3 && i === 0 ? AMBER : CYAN;
        glowArc(R * 0.72, a0, a0 + 0.55, 0.9, compact ? 2.2 : 4, color);
      }
      ring(R * 0.68, 0.25, 0.7);

      // 4. Spectre vocal radial.
      const inner = R * 0.47;
      const maxLen = R * 0.19;
      const normal = new Path2D();
      const bright = new Path2D();
      let avg = 0;
      for (let i = 0; i < BARS; i++) {
        const mirror = i < BARS / 2 ? i : BARS - 1 - i;
        const n =
          0.5 + 0.5 * Math.sin(t * (6 + seeds[i]) + mirror * 0.7) * Math.sin(t * 3.1 + seeds[i]);
        const target = 0.08 + breath * 0.04 + think * 0.25 * (0.5 + 0.5 * Math.sin(t * 8 + i)) + energy * (0.35 + 0.65 * n);
        bars[i] += (target - bars[i]) * 0.3;
        avg += bars[i] / BARS;
        const a = (i / BARS) * TAU - Math.PI / 2;
        const len = maxLen * Math.min(1.2, bars[i]);
        const path = energy > 0.5 && n > 0.75 ? bright : normal;
        path.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        path.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
      }
      const barW = compact ? 1.2 : 2;
      ctx.lineWidth = barW * 3;
      ctx.strokeStyle = `rgba(${CYAN}, ${0.1 + avg * 0.15})`;
      ctx.stroke(normal);
      ctx.stroke(bright);
      ctx.lineWidth = barW;
      ctx.strokeStyle = `rgba(${CYAN}, ${0.55 + avg * 0.4})`;
      ctx.stroke(normal);
      ctx.strokeStyle = `rgba(${ICE}, 0.95)`;
      ctx.stroke(bright);

      // 5. Anneau interne pointillé + balayage radar en réflexion.
      ctx.setLineDash(compact ? [2, 3] : [3, 4]);
      arc(R * 0.42, spin * 0.3, spin * 0.3 + TAU, 0.45, 1);
      ctx.setLineDash([]);
      if (think > 0.02) {
        const sweepA = spin * 1.6;
        const sweep = ctx.createConicGradient ? ctx.createConicGradient(sweepA, cx, cy) : null;
        if (sweep) {
          sweep.addColorStop(0, `rgba(${CYAN}, ${0.35 * think})`);
          sweep.addColorStop(0.12, "rgba(0,0,0,0)");
          sweep.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = sweep;
          ctx.beginPath();
          ctx.arc(cx, cy, R * 0.97, 0, TAU);
          ctx.fill();
        }
      }

      // 6. Noyau : réacteur à segments trapézoïdaux.
      const coreR = R * (0.3 + breath * 0.012 + energy * 0.05);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 1.5);
      core.addColorStop(0, `rgba(255,255,255, ${0.85 + energy * 0.15})`);
      core.addColorStop(0.3, `rgba(${ICE}, ${0.6 + energy * 0.3})`);
      core.addColorStop(0.65, `rgba(${CYAN}, ${0.22 + energy * 0.2})`);
      core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 1.5, 0, TAU);
      ctx.fill();
      const SEGS = 10;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-spin * 0.15);
      for (let i = 0; i < SEGS; i++) {
        const a0 = (i / SEGS) * TAU + 0.06;
        const a1 = ((i + 1) / SEGS) * TAU - 0.06;
        ctx.fillStyle = `rgba(${ICE}, ${0.22 + energy * 0.35 + (Math.sin(t * 4 + i) > 0.6 ? 0.15 : 0)})`;
        ctx.beginPath();
        ctx.arc(0, 0, coreR, a0, a1);
        ctx.arc(0, 0, coreR * 0.72, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ring(coreR * 0.6, 0.9, compact ? 1 : 1.5, ICE);

      // 7. Onde horizontale qui traverse le noyau.
      const span = R * (0.92 + energy * 0.25);
      const amp = R * (0.015 + think * 0.05 + energy * 0.32);
      const samples = compact ? 50 : 140;
      for (const [color, phase, weight, lw] of [[ICE, 0, 1, 1.4], [CYAN, 2.1, 0.7, 1], [AMBER, 4.2, 0.4 * (think + energy), 0.8]] as const) {
        if (weight < 0.02) continue;
        const path = new Path2D();
        for (let i = 0; i <= samples; i++) {
          const u = (i / samples) * 2 - 1;
          const env = Math.exp(-u * u * 4);
          const k = t * (3 + speak * 5 + think * 3);
          const y = (Math.sin(u * 14 + k + phase) * 0.65 + Math.sin(u * 31 - k * 1.4 + phase) * 0.35 * (0.3 + energy)) * env * amp * weight;
          const x = cx + u * span;
          if (i === 0) path.moveTo(x, cy + y);
          else path.lineTo(x, cy + y);
        }
        const vivid = 0.35 + Math.min(0.6, energy * 1.2 + think * 0.3);
        ctx.strokeStyle = `rgba(${color}, ${0.16 * vivid})`;
        ctx.lineWidth = lw * 4;
        ctx.stroke(path);
        ctx.strokeStyle = `rgba(${color}, ${vivid})`;
        ctx.lineWidth = lw;
        ctx.stroke(path);
      }

      // 8. Lectures techniques latérales.
      if (!compact) {
        ctx.globalCompositeOperation = "source-over";
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";
        const status = s === "speaking" ? "VOX TX" : s === "thinking" ? "ANALYSE" : "STANDBY";
        // Uniquement des lectures réelles : état de l'agente, niveau vocal mesuré,
        // sources consultables, heure UTC (aucune métrique décorative inventée).
        const left = [
          ["MODE", status],
          ["VOX", `${Math.round(energy * 100).toString().padStart(3, "0")}`],
        ];
        const right = [
          ["SRC", "WEB·WD·WB"],
          ["UTC", new Date().toISOString().slice(11, 19)],
        ];
        const lx = Math.max(6, cx - R - 78);
        const rx = cx + R + 14;
        left.forEach(([k, v], i) => {
          const y = cy - 12 + i * 26;
          ctx.fillStyle = `rgba(${CYAN}, 0.45)`;
          ctx.fillText(k, lx, y - 6);
          ctx.fillStyle = `rgba(${s === "thinking" && k === "MODE" ? AMBER : ICE}, 0.85)`;
          ctx.fillText(v, lx, y + 6);
        });
        right.forEach(([k, v], i) => {
          const y = cy - 12 + i * 26;
          ctx.fillStyle = `rgba(${CYAN}, 0.45)`;
          ctx.fillText(k, rx, y - 6);
          ctx.fillStyle = `rgba(${ICE}, 0.85)`;
          ctx.fillText(v, rx, y + 6);
        });
        // Traits de liaison vers le réacteur.
        ctx.strokeStyle = `rgba(${CYAN}, 0.3)`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(lx, cy + 38); ctx.lineTo(cx - R - 6, cy + 38); ctx.lineTo(cx - R * 0.96, cy + 18);
        ctx.moveTo(rx + 50, cy + 38); ctx.lineTo(cx + R + 6, cy + 38); ctx.lineTo(cx + R * 0.96, cy + 18);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "source-over";
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [width, height, levelRef]);

  return <canvas ref={canvasRef} className={className} style={{ width, height, display: "block" }} aria-hidden="true" />;
}
