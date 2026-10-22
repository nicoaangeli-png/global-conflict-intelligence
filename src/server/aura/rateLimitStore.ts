import "server-only";
import { PostgresRateLimitStore } from "./postgresRateLimit";
import {
  MemoryRateLimitStore,
  RateLimitBackendError,
  type Consumption,
  type ConsumeManyResult,
  type ConsumeResult,
  type RateLimitHealth,
  type RateLimitStore,
} from "./rateLimit";

class UnavailableRateLimitStore implements RateLimitStore {
  readonly kind = "postgres" as const;
  readonly distributed = true;
  constructor(private readonly code: "rate_limit_unavailable" | "rate_limit_config") {}
  health(): RateLimitHealth {
    return { backend: "postgres", distributed: true, status: "unavailable" };
  }
  private fail(): never { throw new RateLimitBackendError(this.code); }
  async consumeMany(_items: readonly Consumption[]): Promise<ConsumeManyResult> { return this.fail(); }
  async consume(): Promise<ConsumeResult> { return this.fail(); }
  async peek(): Promise<number> { return this.fail(); }
  async acquire(): Promise<string | null> { return this.fail(); }
  async release(): Promise<void> { return this.fail(); }
}

type Holder = {
  __orbitalRateLimitStore?: RateLimitStore;
  __orbitalRateLimitWarned?: boolean;
};
const holder = globalThis as unknown as Holder;

export type RateLimitBackend = "auto" | "memory" | "postgres";

export function configuredRateLimitBackend(): RateLimitBackend {
  const value = (process.env.AURA_RATE_LIMIT_BACKEND ?? "auto").trim().toLowerCase();
  return value === "memory" || value === "postgres" || value === "auto" ? value : "auto";
}

function createStore(): RateLimitStore {
  const configured = (process.env.AURA_RATE_LIMIT_BACKEND ?? "auto").trim().toLowerCase();
  if (!["auto", "memory", "postgres"].includes(configured)) return new UnavailableRateLimitStore("rate_limit_config");
  const url = process.env.DATABASE_URL?.trim();
  if (configured === "memory") return new MemoryRateLimitStore();
  if (configured === "postgres" || url) {
    if (!url) return new UnavailableRateLimitStore("rate_limit_config");
    try {
      return new PostgresRateLimitStore(url);
    } catch {
      return new UnavailableRateLimitStore("rate_limit_config");
    }
  }
  // En production, le mode implicite ne doit jamais devenir une protection locale.
  if (process.env.NODE_ENV === "production") return new UnavailableRateLimitStore("rate_limit_config");
  return new MemoryRateLimitStore();
}

/** Store partagé par AURA texte et voix. Aucun repli automatique après une panne. */
export function rateLimitStore(): RateLimitStore {
  const store = (holder.__orbitalRateLimitStore ??= createStore());
  if (!store.distributed && process.env.NODE_ENV === "production" && !holder.__orbitalRateLimitWarned) {
    holder.__orbitalRateLimitWarned = true;
    console.warn("[aura] backend rate-limit memory explicitement sélectionné : protection mono-instance.");
  }
  return store;
}

/** Injection réservée aux tests. */
export function setRateLimitStore(store: RateLimitStore) {
  holder.__orbitalRateLimitStore = store;
  holder.__orbitalRateLimitWarned = false;
}

/** Réévalue la configuration d'environnement au prochain accès (tests). */
export async function resetRateLimitStore() {
  const store = holder.__orbitalRateLimitStore;
  delete holder.__orbitalRateLimitStore;
  holder.__orbitalRateLimitWarned = false;
  await store?.close?.();
}
