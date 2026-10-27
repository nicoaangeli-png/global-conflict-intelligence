/** A camera view, not necessarily a live stream. Unknown source fields stay null. */
export type CameraMediaType = "live_video" | "near_live_image" | "periodic_snapshot";
export type CameraStatus = "live" | "recent" | "stale" | "offline" | "error" | "unknown";

export interface Camera {
  id: string;
  providerId: string;
  providerName: string;
  name: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  direction: string | null;
  mediaType: CameraMediaType;
  streamProtocol: "hls" | "mjpeg" | "webrtc" | null;
  streamUrl: string | null;
  imageUrl: string | null;
  capturedAt: string | null;
  updatedAt: string | null;
  fetchedAt: string;
  expectedRefreshSeconds: number | null;
  officialPageUrl: string | null;
  providerHomepageUrl: string | null;
  providerApiUrl: string | null;
  attribution: string;
  license: string | null;
  status: CameraStatus;
  health: "ok" | "stale" | "unknown";
}

/** The globe receives metadata only; media URLs are resolved when a view is selected. */
export type CameraMarker = Omit<Camera, "streamUrl" | "imageUrl" | "providerApiUrl">;

export interface CameraCatalogResponse {
  cameras: CameraMarker[];
  total: number;
  counts: { liveVideo: number; nearLiveImage: number; periodicSnapshot: number };
  status: "ok" | "stale" | "error";
  message: string | null;
  fetchedAt: string | null;
  nextCursor: string | null;
}
