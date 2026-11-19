export type CameraAngle = "DTL" | "FO";

export type Tool = "move" | "line" | "circle" | "angle" | "pen";

export type ShapeKind = "line" | "circle" | "angle" | "pen" | "rect";

/** A point in normalized video coordinates: (0,0) = top-left, (1,1) = bottom-right of the video frame. */
export interface Point {
  x: number;
  y: number;
}

export interface Shape {
  id: string;
  kind: ShapeKind;
  color: string;
  /**
   * line:   [start, end]
   * circle: [center, edge]
   * angle:  [armA, vertex, armB]
   * rect:   [cornerA, cornerB]
   * pen:    freehand path
   */
  points: Point[];
  presetId?: string;
  label?: string;
}

export type CheckpointKey = "A" | "T" | "I" | "F";

export type Bookmarks = Partial<Record<CheckpointKey, number>>;

export interface VideoMeta {
  name: string;
  width: number;
  height: number;
  duration: number;
}

export type Fps = 30 | 60;
