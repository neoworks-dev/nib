import type {
  ApplicationIdentity,
  CanvasObject,
  DesktopRect,
  DetectedRegion,
  RegionSource,
} from "@nib-ui/ui-contracts";

/**
 * Board objects this plugin owns. A screenshot is not one of them — it is a `media`
 * object, so a board written here still draws on a host that has this plugin disabled.
 * What is left is the things `canvas-media` has no way to mean.
 */

export const REGIONS_KIND = "desktop-regions";
export const VIEW_KIND = "desktop-view";

/**
 * The regions detected inside one capture. It holds no image and no bytes: it names the
 * `media` object it belongs to, so deleting the capture leaves an orphan the layer skips
 * rather than a card pointing at nothing.
 */
export interface DesktopRegionsObject extends CanvasObject {
  kind: typeof REGIONS_KIND;
  /** The `media` object these were detected in. */
  captureObjectId: string;
  /** The capture's intrinsic pixel size; region rects are in this space. */
  imageWidth: number;
  imageHeight: number;
  regions: DetectedRegion[];
  detectedAt: number;
  /** Who owned the window when the shutter fired, for routing at send time. */
  application?: ApplicationIdentity;
  /**
   * The desktop-layout box the capture covered. Kept so a region found in the picture
   * can be pointed at on the screen; absent when the compositor could not say, and then
   * the overlay is not offered for this capture.
   */
  layout?: DesktopRect;
}

/** A live view of one output. A placeholder card until the ScreenCast path lands. */
export interface DesktopViewObject extends CanvasObject {
  kind: typeof VIEW_KIND;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Connector name as the compositor reports it, e.g. `DP-1`. */
  outputName: string;
}

export const VIEW_MIN_SIZE = 160;

const SOURCES = new Set<RegionSource>(["atspi", "pixel"]);

function parseRect(raw: unknown): DesktopRect | null {
  if (!raw || typeof raw !== "object") return null;
  const { x, y, width, height } = raw as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  )
    return null;
  return { x, y, width, height };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseIdentity(raw: unknown): ApplicationIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  const pid = candidate.pid;
  return {
    appId: optionalString(candidate.appId),
    atspiName: optionalString(candidate.atspiName),
    desktopEntry: optionalString(candidate.desktopEntry),
    title: optionalString(candidate.title),
    pid: typeof pid === "number" && Number.isFinite(pid) ? pid : null,
  };
}

/** A malformed region is dropped; one bad entry must not cost the whole detection. */
export function parseRegions(raw: unknown): DetectedRegion[] {
  if (!Array.isArray(raw)) return [];
  const regions: DetectedRegion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const rect = parseRect(candidate.rect);
    const { id, source, confidence } = candidate;
    if (!rect || typeof id !== "string" || id.length === 0) continue;
    if (typeof source !== "string" || !SOURCES.has(source as RegionSource)) continue;
    regions.push({
      id,
      rect,
      source: source as RegionSource,
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0,
      ...(typeof candidate.label === "string" && { label: candidate.label }),
      ...(typeof candidate.role === "string" && { role: candidate.role }),
      ...(candidate.sensitive === true && { sensitive: true }),
    });
  }
  return regions;
}

export function parseDesktopRegions(raw: unknown): DesktopRegionsObject | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<DesktopRegionsObject> & Record<string, unknown>;
  if (candidate.kind !== REGIONS_KIND || typeof candidate.id !== "string") return null;
  if (typeof candidate.captureObjectId !== "string" || candidate.captureObjectId.length === 0)
    return null;

  const { imageWidth, imageHeight } = candidate;
  if (typeof imageWidth !== "number" || typeof imageHeight !== "number") return null;
  if (imageWidth <= 0 || imageHeight <= 0) return null;

  const application = parseIdentity(candidate.application);
  const layout = parseRect(candidate.layout);
  return {
    kind: REGIONS_KIND,
    id: candidate.id,
    captureObjectId: candidate.captureObjectId,
    imageWidth,
    imageHeight,
    regions: parseRegions(candidate.regions),
    detectedAt: typeof candidate.detectedAt === "number" ? candidate.detectedAt : 0,
    ...(application && { application }),
    ...(layout && { layout }),
  };
}

export function parseDesktopView(raw: unknown): DesktopViewObject | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<DesktopViewObject> & Record<string, unknown>;
  if (candidate.kind !== VIEW_KIND || typeof candidate.id !== "string") return null;
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") return null;
  if (typeof candidate.outputName !== "string" || candidate.outputName.length === 0) return null;

  return {
    kind: VIEW_KIND,
    id: candidate.id,
    x: candidate.x,
    y: candidate.y,
    w: Math.max(VIEW_MIN_SIZE, typeof candidate.w === "number" ? candidate.w : VIEW_MIN_SIZE * 3),
    h: Math.max(VIEW_MIN_SIZE, typeof candidate.h === "number" ? candidate.h : VIEW_MIN_SIZE * 2),
    outputName: candidate.outputName,
  };
}

/** The regions belonging to one capture, for the layer that draws over it. */
export function regionsFor(
  objects: readonly CanvasObject[],
  captureObjectId: string,
): DesktopRegionsObject | null {
  for (const object of objects) {
    const parsed = parseDesktopRegions(object);
    if (parsed?.captureObjectId === captureObjectId) return parsed;
  }
  return null;
}
