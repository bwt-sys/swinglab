"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clamp01, distPx, hitHandle, hitShape, newId } from "@/lib/geometry";
import { renderScene, simplifyPath } from "@/lib/render";
import type { Point, Shape, Tool } from "@/lib/types";

interface Props {
  /** Displayed (CSS px) size of the video frame; the canvas matches it exactly. */
  width: number;
  height: number;
  shapes: Shape[];
  setShapes: React.Dispatch<React.SetStateAction<Shape[]>>;
  /** Save the current shapes to the undo history before a change. */
  checkpoint: () => void;
  tool: Tool;
  color: string;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

type Drag =
  | { type: "handle"; shapeId: string; index: number; moved: boolean }
  | { type: "shape"; shapeId: string; start: Point; orig: Point[]; moved: boolean }
  | { type: "draw" }
  | null;

export default function TelestratorCanvas({
  width,
  height,
  shapes,
  setShapes,
  checkpoint,
  tool,
  color,
  selectedId,
  setSelectedId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [angleClicks, setAngleClicks] = useState<Point[]>([]);
  const [hoverHandle, setHoverHandle] = useState<{ shapeId: string; index: number } | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  // ── Rendering ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const bw = Math.round(width * dpr);
    const bh = Math.round(height * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderScene(ctx, shapes, {
      width,
      height,
      draft,
      selectedId,
      hoverHandle,
      showHandles: tool === "move",
    });
  }, [shapes, draft, width, height, selectedId, hoverHandle, tool]);

  // Cancel any in-progress angle when switching tools.
  useEffect(() => {
    setAngleClicks([]);
    setDraft(null);
  }, [tool]);

  const toNorm = useCallback((e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  }, []);

  // ── Keyboard: Escape cancels, Delete removes the selected shape ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") {
        setAngleClicks([]);
        setDraft(null);
        dragRef.current = null;
        setSelectedId(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        checkpoint();
        setShapes((prev) => prev.filter((s) => s.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, checkpoint, setShapes, setSelectedId]);

  // ── Pointer handling ─────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = toNorm(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    // Handles are draggable from any tool (unless an angle is mid-construction).
    if (angleClicks.length === 0) {
      const hh = hitHandle(shapes, p, width, height, e.pointerType === "touch" ? 20 : 12);
      if (hh) {
        dragRef.current = { type: "handle", shapeId: hh.shapeId, index: hh.index, moved: false };
        setSelectedId(hh.shapeId);
        setCursor("grabbing");
        return;
      }
    }

    switch (tool) {
      case "move": {
        const id = hitShape(shapes, p, width, height);
        setSelectedId(id);
        if (id) {
          const s = shapes.find((x) => x.id === id)!;
          dragRef.current = { type: "shape", shapeId: id, start: p, orig: s.points, moved: false };
          setCursor("grabbing");
        }
        break;
      }
      case "line":
      case "circle":
        setSelectedId(null);
        setDraft({ id: newId(), kind: tool, color, points: [p, p] });
        dragRef.current = { type: "draw" };
        break;
      case "pen":
        setSelectedId(null);
        setDraft({ id: newId(), kind: "pen", color, points: [p] });
        dragRef.current = { type: "draw" };
        break;
      case "angle": {
        setSelectedId(null);
        const clicks = [...angleClicks, p];
        if (clicks.length >= 3) {
          const shape: Shape = { id: newId(), kind: "angle", color, points: clicks.slice(0, 3) };
          checkpoint();
          setShapes((prev) => [...prev, shape]);
          setAngleClicks([]);
          setDraft(null);
        } else {
          setAngleClicks(clicks);
          setDraft({ id: "angle-draft", kind: "angle", color, points: [...clicks, p] });
        }
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toNorm(e);
    const drag = dragRef.current;

    if (drag?.type === "handle") {
      if (!drag.moved) {
        checkpoint();
        drag.moved = true;
      }
      setShapes((prev) =>
        prev.map((s) =>
          s.id === drag.shapeId ? { ...s, points: s.points.map((q, i) => (i === drag.index ? p : q)) } : s,
        ),
      );
      return;
    }
    if (drag?.type === "shape") {
      if (!drag.moved) {
        checkpoint();
        drag.moved = true;
      }
      // Clamp translation so the whole shape stays in frame.
      let dx = p.x - drag.start.x;
      let dy = p.y - drag.start.y;
      const xs = drag.orig.map((q) => q.x);
      const ys = drag.orig.map((q) => q.y);
      dx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), dx));
      dy = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), dy));
      setShapes((prev) =>
        prev.map((s) =>
          s.id === drag.shapeId ? { ...s, points: drag.orig.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : s,
        ),
      );
      return;
    }
    if (drag?.type === "draw") {
      setDraft((d) => {
        if (!d) return d;
        if (d.kind === "pen") return { ...d, points: [...d.points, p] };
        return { ...d, points: [d.points[0], p] };
      });
      return;
    }

    // Live preview for the protractor.
    if (tool === "angle" && angleClicks.length > 0) {
      setDraft({ id: "angle-draft", kind: "angle", color, points: [...angleClicks, p] });
    }

    // Hover feedback.
    if (angleClicks.length === 0) {
      const hh = hitHandle(shapes, p, width, height);
      setHoverHandle(hh);
      if (hh) setCursor("grab");
      else if (tool === "move") setCursor(hitShape(shapes, p, width, height) ? "move" : "default");
      else setCursor("crosshair");
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);

    if (drag?.type === "draw" && draft) {
      let shape = draft;
      let keep = true;
      if (shape.kind === "pen") {
        shape = { ...shape, points: simplifyPath(shape.points, width, height) };
        keep = shape.points.length > 1;
      } else {
        keep = distPx(shape.points[0], shape.points[1], width, height) > 4;
      }
      if (keep) {
        checkpoint();
        setShapes((prev) => [...prev, shape]);
      }
      setDraft(null);
    }
    if (drag?.type === "handle" || drag?.type === "shape") {
      setCursor(tool === "move" ? "move" : "crosshair");
    }
  };

  const onPointerLeave = () => {
    setHoverHandle(null);
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid="telestrator"
      className="absolute inset-0 h-full w-full touch-none select-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
    />
  );
}
