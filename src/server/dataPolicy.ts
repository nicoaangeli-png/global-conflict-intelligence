import { REAL_DATASETS, type ConflictEvent } from "@/types/conflict";

export function hasDemoMarkers(record: { id?: string; sourceDataset?: string; confidence?: string; source?: string }): boolean {
  return record.confidence?.trim().toUpperCase() === "DEMO"
    || /^demo/i.test(record.sourceDataset?.trim() ?? "")
    || /^demo[-:]/i.test(record.id?.trim() ?? "")
    || /^demo\b/i.test(record.source?.trim() ?? "");
}

export function isRealSourceRecord(event: Pick<ConflictEvent, "id" | "sourceDataset" | "confidence" | "source">): boolean {
  return (REAL_DATASETS as readonly string[]).includes(event.sourceDataset)
    && !hasDemoMarkers(event);
}

export function assertRealSourceRecords(events: ConflictEvent[]): void {
  if (events.some((event) => !isRealSourceRecord(event))) {
    throw new Error("Persistence accepts real-source records only");
  }
}
