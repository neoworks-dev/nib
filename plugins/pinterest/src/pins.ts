/** A board of the connected account, as the server hands it over. */
export interface PinterestBoard {
  id: string;
  name: string;
  pinCount: number;
  coverUrl?: string;
}

/**
 * One saved pin. Pinterest has no favourites — likes were removed from the
 * product — so a pin is always something saved to one of the user's boards.
 */
export interface PinterestPin {
  id: string;
  /** The pin's page on Pinterest. */
  url: string;
  title: string;
  description?: string;
  /** Where the pin points off Pinterest, when it points anywhere. */
  link?: string;
  imageUrl: string;
  width: number;
  height: number;
}

/** Drag data type carrying `PinterestPin[]` as JSON. */
export const pinTransferType = "application/x-nib-pinterest-pin";

export function parsePinTransfer(raw: string): PinterestPin[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const pins: PinterestPin[] = [];
  for (const entry of parsed) {
    const pin = entry as Partial<PinterestPin>;
    if (typeof pin?.id !== "string" || pin.id.length === 0) continue;
    if (typeof pin.imageUrl !== "string" || pin.imageUrl.length === 0) continue;
    if (typeof pin.url !== "string" || pin.url.length === 0) continue;
    pins.push({
      id: pin.id,
      url: pin.url,
      title: typeof pin.title === "string" ? pin.title : pin.url,
      ...(typeof pin.description === "string" && { description: pin.description }),
      ...(typeof pin.link === "string" && { link: pin.link }),
      imageUrl: pin.imageUrl,
      width: typeof pin.width === "number" ? pin.width : 0,
      height: typeof pin.height === "number" ? pin.height : 0,
    });
  }
  return pins;
}

/**
 * The name the placed picture carries into the board and into a prompt. A pin's
 * title is free text the user wrote on Pinterest, so it is trimmed to something
 * file-like rather than used as it stands.
 */
export function pinFileName(pin: PinterestPin): string {
  const stem = pin.title
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^\w.-]/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : `pin-${pin.id}`;
}
