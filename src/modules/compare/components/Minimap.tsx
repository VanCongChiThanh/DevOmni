import { useEffect, useRef, type PointerEvent } from "react";
import type { Hunk, Row, RowKind } from "../types";

export const MINIMAP_W = 14;

const COLORS: Partial<Record<RowKind, string>> = {
  changed: "rgba(210, 153, 34, 0.95)",
  deleted: "rgba(248, 81, 73, 0.95)",
  inserted: "rgba(63, 185, 80, 0.95)",
};

/** Canvas overview of the whole diff: one draw per result, O(change blocks). */
export function Minimap({ rows, hunks, scroller }: { rows: Row[]; hunks: Hunk[]; scroller: HTMLElement | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!wrap || !canvas || !viewport || !scroller) return;

    const draw = () => {
      const h = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = MINIMAP_W * dpr;
      canvas.height = Math.max(1, h * dpr);
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx || !rows.length) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MINIMAP_W, h);
      const scale = h / rows.length;
      // Only change blocks need painting: walk hunks, split runs by kind.
      for (const hunk of hunks) {
        let i = hunk.start;
        while (i < hunk.end) {
          const kind = rows[i].kind;
          let j = i + 1;
          while (j < hunk.end && rows[j].kind === kind) j++;
          const color = COLORS[kind];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(3, i * scale, MINIMAP_W - 6, Math.max(2, (j - i) * scale));
          }
          i = j;
        }
      }
    };

    const updateViewport = () => {
      const h = wrap.clientHeight;
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      if (!scrollHeight) return;
      viewport.style.top = `${(scrollTop / scrollHeight) * h}px`;
      viewport.style.height = `${Math.max(10, (clientHeight / scrollHeight) * h)}px`;
    };

    draw();
    updateViewport();
    const ro = new ResizeObserver(() => {
      draw();
      updateViewport();
    });
    ro.observe(wrap);
    scroller.addEventListener("scroll", updateViewport, { passive: true });
    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", updateViewport);
    };
  }, [rows, hunks, scroller]);

  const jump = (clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap || !scroller) return;
    const rect = wrap.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    scroller.scrollTop = ratio * scroller.scrollHeight - scroller.clientHeight / 2;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    jump(e.clientY);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 1) jump(e.clientY);
  };

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      className="relative shrink-0 cursor-pointer border-l border-line bg-surface-1"
      style={{ width: MINIMAP_W }}
      title="Overview — click or drag to navigate"
    >
      <canvas ref={canvasRef} className="absolute left-0 top-0" style={{ width: MINIMAP_W }} />
      <div ref={viewportRef} className="pointer-events-none absolute left-0 right-0 border-y border-fg/25 bg-fg/10" />
    </div>
  );
}
