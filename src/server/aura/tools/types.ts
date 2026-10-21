import "server-only";
import type { ProvenanceItem } from "../types";

/** Arguments reçus du modèle et résultat normalisé d'un outil (avant enveloppe et nettoyage). */

export type ToolArgs = Record<string, unknown>;
export type ToolStatus = ProvenanceItem["status"];
export type ToolResult = { status: ToolStatus; data: unknown; source: string; detail?: string; url?: string };
