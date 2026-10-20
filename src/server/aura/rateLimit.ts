import "server-only";

/**
 * Limitation de débit d'AURA : compteurs à fenêtre fixe et jetons de concurrence.
 *
 * Les routes ne manipulent que l'interface `RateLimitStore`. Le seul magasin fourni
 * aujourd'hui est en mémoire : **non distribué**, ses compteurs sont propres au
 * processus Node (plusieurs processus ou instances = plusieurs budgets). Un magasin
 * partagé (Redis, PostgreSQL…) n'a qu'à implémenter les trois opérations ci-dessous,
 * qui correspondent à des primitives atomiques usuelles (INCRBY + EXPIRE, INCR/DECR).
 *
 * Les fenêtres sont fixes (minute, jour UTC) : simples à partager entre processus,
 * au prix d'une rafale possible à la frontière de deux fenêtres (au plus 2× la limite).
 */

export type ConsumeResult = { ok: true; used: number } | { ok: false; used: number; retryAfterMs: number };

export interface RateLimitStore {
  /** Identifiant affiché dans l'état de santé (ex. « memory »). */
  readonly kind: string;
  /** Vrai seulement si les compteurs sont partagés entre processus et instances. */
  readonly distributed: boolean;
  /**
   * Ajoute `cost` au compteur `key` (créé pour `ttlMs`) si le total reste ≤ `limit`.
   * Refusé sans modifier le compteur sinon. `limit = Infinity` : simple enregistrement.
   */
  consume(key: string, cost: number, limit: number, ttlMs: number, now?: number): Promise<ConsumeResult>;
  /** Valeur courante du compteur (0 s'il n'existe pas ou a expiré). */
  peek(key: string, now?: number): Promise<number>;
  /** Prend un jeton de concurrence si moins de `limit` sont pris. */
  acquire(key: string, limit: number): Promise<boolean>;
  /** Rend un jeton pris par `acquire`. */
  release(key: string): Promise<void>;
}

type Counter = { value: number; expiresAt: number };

/** Magasin en mémoire du processus — NON DISTRIBUÉ. */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly kind = "memory";
  readonly distributed = false;
  private readonly counters = new Map<string, Counter>();
  private readonly leases = new Map<string, number>();
  private operations = 0;

  private live(key: string, now: number): Counter | null {
    const counter = this.counters.get(key);
    if (!counter) return null;
    if (counter.expiresAt <= now) {
      this.counters.delete(key);
      return null;
    }
    return counter;
  }

  /** Purge périodique : la mémoire reste bornée par le nombre de clés actives. */
  private sweep(now: number) {
    if (++this.operations % 500 !== 0 && this.counters.size < 20_000) return;
    for (const [key, counter] of this.counters) if (counter.expiresAt <= now) this.counters.delete(key);
  }

  async consume(key: string, cost: number, limit: number, ttlMs: number, now = Date.now()): Promise<ConsumeResult> {
    this.sweep(now);
    const counter = this.live(key, now);
    const used = counter?.value ?? 0;
    if (used + cost > limit) return { ok: false, used, retryAfterMs: Math.max(0, (counter?.expiresAt ?? now) - now) };
    if (counter) counter.value += cost;
    else this.counters.set(key, { value: cost, expiresAt: now + ttlMs });
    return { ok: true, used: used + cost };
  }

  async peek(key: string, now = Date.now()): Promise<number> {
    return this.live(key, now)?.value ?? 0;
  }

  async acquire(key: string, limit: number): Promise<boolean> {
    const held = this.leases.get(key) ?? 0;
    if (held >= limit) return false;
    this.leases.set(key, held + 1);
    return true;
  }

  async release(key: string): Promise<void> {
    const held = this.leases.get(key) ?? 0;
    if (held <= 1) this.leases.delete(key);
    else this.leases.set(key, held - 1);
  }
}

const holder = globalThis as unknown as { __orbitalRateLimitStore?: RateLimitStore; __orbitalRateLimitWarned?: boolean };

/** Magasin partagé par les routes AURA (analyse et voix) du processus. */
export function rateLimitStore(): RateLimitStore {
  const store = (holder.__orbitalRateLimitStore ??= new MemoryRateLimitStore());
  if (!store.distributed && process.env.NODE_ENV === "production" && !holder.__orbitalRateLimitWarned) {
    holder.__orbitalRateLimitWarned = true;
    console.warn("[aura] limitation de débit en mémoire : non distribuée (un seul processus Node attendu).");
  }
  return store;
}

/** Remplace le magasin (tests, ou futur magasin distribué). */
export function setRateLimitStore(store: RateLimitStore) {
  holder.__orbitalRateLimitStore = store;
}

export const MINUTE_MS = 60_000;

/** Clé de fenêtre fixe d'une minute. */
export const minuteWindow = (now = Date.now()) => Math.floor(now / MINUTE_MS);

/** Jour UTC (AAAA-MM-JJ) et durée restante jusqu'à minuit UTC. */
export function utcDay(now = Date.now()): { day: string; remainingMs: number } {
  const day = new Date(now).toISOString().slice(0, 10);
  const nextMidnight = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
  return { day, remainingMs: Math.max(1, nextMidnight - now) };
}
