"use client";

import { useEffect, useRef, useState } from "react";
import PoseOverlay from "./PoseOverlay";
import TelestratorCanvas from "./TelestratorCanvas";
import type { Handed } from "@/lib/metrics";
import type { PoseFrame } from "@/lib/pose";
import type { Shape, Tool } from "@/lib/types";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  src: string | null;
  /** Intrinsic video aspect ratio (width / height). */
  aspect: number;
  loading: boolean;
  error: string | null;
  onFile: (file: File) => void;
  onLoadSample: () => void;
  onLoadedMetadata: () => void;
  onVideoError: () => void;
  shapes: Shape[];
  setShapes: React.Dispatch<React.SetStateAction<Shape[]>>;
  checkpoint: () => void;
  tool: Tool;
  color: string;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Pose for the current frame (drawn beneath the telestrator). */
  pose: PoseFrame | null;
  handed: Handed;
  showSkeleton: boolean;
  /** Mirror the video + skeleton horizontally (display only; drawings stay in screen space). */
  flip?: boolean;
  /** Smaller empty state for split-screen. */
  compact?: boolean;
  emptyTitle?: string;
  /** Called on any pointer press inside the stage (compare mode: make this side active). */
  onActivate?: () => void;
  active?: boolean;
}

export default function VideoStage(props: Props) {
  const { videoRef, src, aspect, onFile } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [dragOver, setDragOver] = useState(false);

  // Track the stage size so the video+canvas box always fits without distortion or cropping.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStage({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // iOS Safari: React sets `muted` only as a property, and old WebKit needs `webkit-playsinline`.
  // Set the attributes explicitly so phone videos play and scrub inline instead of going fullscreen.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
  });

  // Contain-fit: largest box with the video's aspect ratio that fits the stage.
  const pad = props.compact ? 12 : 24;
  const availW = Math.max(0, stage.w - pad * 2);
  const availH = Math.max(0, stage.h - pad * 2);
  let boxW = availW;
  let boxH = aspect > 0 ? boxW / aspect : 0;
  if (boxH > availH) {
    boxH = availH;
    boxW = boxH * aspect;
  }
  boxW = Math.floor(boxW);
  boxH = Math.floor(boxH);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      ref={stageRef}
      className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl border bg-[radial-gradient(ellipse_at_center,_#0f172a_0%,_#020617_75%)] ${
        props.active ? "border-emerald-500/60" : "border-slate-800"
      }`}
      onPointerDownCapture={props.onActivate}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {/* Subtle studio grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {src && boxW > 0 && boxH > 0 && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none overflow-hidden rounded-lg bg-black shadow-2xl shadow-black/60 ring-1 ring-slate-700"
          style={{ width: boxW, height: boxH, WebkitTouchCallout: "none" }}
        >
          <video
            ref={videoRef}
            src={src}
            className="absolute inset-0 h-full w-full object-contain"
            style={props.flip ? { transform: "scaleX(-1)" } : undefined}
            playsInline
            preload="auto"
            muted
            controls={false}
            disablePictureInPicture
            onLoadedMetadata={props.onLoadedMetadata}
            onError={props.onVideoError}
          />
          {props.showSkeleton && (
            <div className="pointer-events-none absolute inset-0" style={props.flip ? { transform: "scaleX(-1)" } : undefined}>
              <PoseOverlay width={boxW} height={boxH} pose={props.pose} handed={props.handed} />
            </div>
          )}
          <TelestratorCanvas
            width={boxW}
            height={boxH}
            shapes={props.shapes}
            setShapes={props.setShapes}
            checkpoint={props.checkpoint}
            tool={props.tool}
            color={props.color}
            selectedId={props.selectedId}
            setSelectedId={props.setSelectedId}
          />
        </div>
      )}

      {!src && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div
            className={`flex w-full max-w-lg flex-col items-center rounded-2xl border-2 border-dashed text-center transition ${
              props.compact ? "gap-3 px-4 py-6" : "gap-5 px-8 py-12"
            } ${
              dragOver ? "border-emerald-400 bg-emerald-400/5" : "border-slate-700 bg-slate-900/40"
            }`}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-emerald-400">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-100">{props.emptyTitle ?? "Drop a swing video here"}</p>
              <p className="mt-1 text-sm text-slate-400">MP4, MOV or WebM · vertical or horizontal</p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Choose file
              </button>
              <button
                type="button"
                onClick={props.onLoadSample}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400 hover:bg-slate-800"
              >
                Load Sample Video
              </button>
            </div>
            {props.loading && <p className="text-sm text-slate-400">Loading…</p>}
            {props.error && <p className="max-w-sm text-sm text-rose-400">{props.error}</p>}
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      {src && dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-emerald-500/10 ring-2 ring-inset ring-emerald-400">
          <p className="rounded-lg bg-slate-950/80 px-4 py-2 text-sm font-semibold text-emerald-300">
            Drop to replace video
          </p>
        </div>
      )}

      {src && props.error && (
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
          <p className="rounded-lg bg-rose-950/90 px-4 py-2 text-sm text-rose-200 ring-1 ring-rose-800">{props.error}</p>
        </div>
      )}
    </div>
  );
}
