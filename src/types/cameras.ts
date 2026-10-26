/** An image preset is one camera view. `live` is reserved for genuine streams. */
export interface Camera {
  id: string;
  providerId: string;
  providerName: string;
  name: string | null;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  direction: string | null;
  feedType: "image" | "video" | "unknown";
  sourceUrl: string | null;
  capturedAt: string | null;
  fetchedAt: string;
  status: "live" | "recent" | "stale" | "offline" | "error";
  attribution: string;
  license: string | null;
}

export interface CameraCatalogResponse {
  cameras: Camera[];
  total: number;
  status: "ok" | "stale" | "error";
  message: string | null;
  fetchedAt: string | null;
}
