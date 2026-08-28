/** One project per working directory. `rev` guards a stale window's write. */
export interface Project {
  rev: number;
  cwd: string;
  objects: StoredObject[];
}

/**
 * A known object, or one of a kind this build does not know. Project files are
 * hand-editable and outlive the plugin set that wrote them, so an unclaimed kind
 * is kept exactly as found rather than dropped.
 */
export type StoredObject = ProjectObject;

export type ProjectObject = Session | Asset | Edge;

/** Everything on the canvas. `width`/`height` only where the kind is sizable. */
export interface Placed {
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
}

/**
 * A harness session as the board authors it. `sessionId` is null until the
 * session is launched, so a goal can sit on the canvas before it has a run.
 */
export interface Session extends Placed {
  kind: "session";
  id: string;
  goal: string;
  sessionId: string | null;
  /** The session this one was branched out of. */
  parentId: string | null;
  /** When the user last marked it read; null while it still wants attention. */
  reviewedAt: number | null;
  annotations: TurnAnnotation[];
}

export interface Asset extends Placed {
  kind: "asset";
  id: string;
  createdAt: number;
  payload: AssetPayload;
  annotations: AssetAnnotation[];
}

export type AssetPayload =
  | BlobPayload
  | NotePayload
  | LinkPayload
  | StrokePayload;

/** Bytes live in the blob store, content-addressed; only the reference is stored. */
export interface BlobPayload {
  type: "image" | "video" | "model3d" | "document";
  blobId: string;
  mime: string;
  name?: string;
}

export interface NotePayload {
  type: "note";
  text: string;
}

export interface LinkPayload {
  type: "link";
  url: string;
  title?: string;
  description?: string;
  /** Preview image and favicon are blobs, never remote urls. */
  imageBlobId?: string;
  faviconBlobId?: string;
}

export interface StrokePayload {
  type: "stroke";
  /** Flat `[x, y, x, y, …]`, relative to the stroke's own origin. */
  points: number[];
  color: string;
  size: number;
}

/** The one object with no position of its own: its endpoints give it one. */
export interface Edge {
  kind: "edge";
  id: string;
  from: string;
  to: string;
  relation: "branch" | "join" | "ref";
  label?: string;
}

export interface Annotation {
  id: string;
  /** The user's comment. Empty when a target was pinned without one. */
  note: string;
  /** Staged into the next prompt sent to the owning session. */
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * A comment on one turn. Turns are derived from the event log and have no stored
 * id, so the turn is named by the user message that opens it — stable across
 * replay. `excerpt` is carried rather than re-quoted because `session.cleared`
 * drops the messages it came from.
 */
export interface TurnAnnotation extends Annotation {
  messageId: string;
  excerpt: string;
}

/** A comment on an asset. The asset is the excerpt, so none is carried. */
export type AssetAnnotation = Annotation;
