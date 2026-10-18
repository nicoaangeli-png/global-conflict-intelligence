import { inflateRawSync } from "node:zlib";
import { decodeEntities } from "./util";

/**
 * Lecteur minimal de classeur .xlsx (zip + XML), sans dépendance : suffit pour l'export du GEIPAN
 * (une feuille, chaînes partagées). Retourne les lignes de la première feuille, indexées par lettre de colonne.
 */

/** Taille décompressée maximale d'une entrée XML du classeur GEIPAN : 16 Mio. */
export const XLSX_ENTRY_MAX_BYTES = 16 * 1024 * 1024;

function readZipEntries(buf: Uint8Array): Map<string, Buffer> {
  const data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip invalide");
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip invalide");
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet1\.xml)$/.test(name)) continue;
    const localName = data.readUInt16LE(localOffset + 26);
    const localExtra = data.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const raw = data.subarray(start, start + compressedSize);
    if (method === 0) {
      if (raw.byteLength > XLSX_ENTRY_MAX_BYTES) throw new Error("entrée xlsx trop volumineuse");
      entries.set(name, raw);
    } else if (method === 8) {
      try {
        entries.set(name, inflateRawSync(raw, { maxOutputLength: XLSX_ENTRY_MAX_BYTES }));
      } catch {
        throw new Error("entrée xlsx invalide ou trop volumineuse");
      }
    } else {
      throw new Error(`compression xlsx non gérée (${method})`);
    }
  }
  return entries;
}

export function readFirstSheet(buf: Uint8Array): Array<Record<string, string>> {
  const entries = readZipEntries(buf);
  const sheet = entries.get("xl/worksheets/sheet1.xml")?.toString("utf8");
  if (!sheet) throw new Error("feuille introuvable");
  const shared = (entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").split(/<si>|<si\s[^>]*>/).slice(1).map((chunk) => {
    const body = chunk.split("</si>")[0];
    return decodeEntities([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
  });
  const rows: Array<Record<string, string>> = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: Record<string, string> = {};
    for (const cell of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const value = cell[3] ? /<v>([\s\S]*?)<\/v>/.exec(cell[3])?.[1] : undefined;
      if (value === undefined) continue;
      cells[cell[1]] = /\bt="s"/.test(cell[2]) ? (shared[Number(value)] ?? "") : decodeEntities(value);
    }
    rows.push(cells);
  }
  return rows;
}
