const { open, readFile, rename, unlink } = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const hash = (content) => createHash("sha256").update(content).digest("hex");
const isDemonstration = (event) => event.confidence?.trim().toUpperCase() === "DEMO"
  || /^demo/i.test((event.sourceDataset ?? "").trim())
  || /^demo[-:]/i.test((event.id ?? "").trim())
  || /^demo\b/i.test((event.source ?? "").trim());

async function writeExclusive(filename, content) {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function quarantineDemo(filename, apply = false) {
  const resolved = path.resolve(filename);
  const lockPath = `${resolved}.lock`;
  let lock;
  let temporary;
  try {
    if (apply) lock = await open(lockPath, "wx", 0o600);
    const original = await readFile(resolved);
    const events = JSON.parse(original.toString("utf8"));
    if (!Array.isArray(events) || events.some((event) => !event || typeof event !== "object" || Array.isArray(event))) {
      throw new Error("Invalid store: expected an array of event objects");
    }
    const retained = events.filter((event) => !isDemonstration(event));
    const report = { apply, before: events.length, quarantined: events.length - retained.length, retained: retained.length };
    if (!apply || report.quarantined === 0) return report;
    const identifier = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
    const backup = `${resolved}.before-real-only-${identifier}.bak`;
    await writeExclusive(backup, original);
    if (hash(await readFile(backup)) !== hash(original)) throw new Error("Backup verification failed; store unchanged");
    const replacement = Buffer.from(JSON.stringify(retained));
    temporary = `${resolved}.${identifier}.tmp`;
    await writeExclusive(temporary, replacement);
    if (hash(await readFile(temporary)) !== hash(replacement)) throw new Error("Replacement verification failed; store unchanged");
    if (hash(await readFile(resolved)) !== hash(original)) throw new Error("Concurrent store modification detected; store unchanged");
    await rename(temporary, resolved);
    temporary = undefined;
    const directory = await open(path.dirname(resolved), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return { ...report, backup, originalSha256: hash(original), retainedSha256: hash(replacement) };
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

module.exports = { quarantineDemo };

if (require.main === module) {
  const args = process.argv.slice(2);
  let apply = false;
  let storeProvided = false;
  let valid = true;
  let filename = process.env.INTEL_STORE_PATH ?? "data/intel-events.json";
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply" && !apply) {
      apply = true;
    } else if (argument === "--store" && !storeProvided) {
      const candidate = args[++index];
      if (!candidate || candidate.startsWith("-")) {
        valid = false;
        break;
      }
      storeProvided = true;
      filename = candidate;
    } else {
      valid = false;
      break;
    }
  }
  if (!valid || !filename) {
    console.error("Usage: node scripts/quarantine-demo.cjs [--store filename] [--apply]");
    process.exitCode = 1;
  } else {
    quarantineDemo(filename, apply).then((report) => console.log(JSON.stringify(report, null, 2))).catch(() => {
      console.error("Quarantine failed. Inspect the store, backup and lock before retrying; no automatic retry was attempted.");
      process.exitCode = 1;
    });
  }
}
