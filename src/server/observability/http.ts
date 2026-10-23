import "server-only";
import { randomUUID } from "node:crypto";
import { inFlight, increment, normalizedMethod, normalizedRoute, observe, type Route } from "./metrics";
import { log, requestContext } from "./logger";

/** Durée jusqu'à la réponse/en-têtes ; les flux longs ont leurs métriques de cycle de vie. */
export function instrumentRoute<T extends Request = Request>(route: Route, handler: (request: T) => Promise<Response>) {
  return async function instrumented(request: T): Promise<Response> {
    const input = request ?? new Request(`http://localhost${route}`) as T;
    const method = normalizedMethod(input.method);
    const normalized = normalizedRoute(route);
    // Ignorer les IDs entrants empêche toute injection, donnée personnelle ou identité détournée.
    const requestId = randomUUID();
    return requestContext.run({ requestId, route: normalized, method }, async () => {
      const started = performance.now();
      inFlight(normalized, method, 1);
      let status = 500;
      try {
        const response = await handler(input);
        status = response.status;
        try { response.headers.set("X-Request-Id", requestId); } catch { /* Réponse immuable : conserver le contrat. */ }
        return response;
      } catch (error) {
        log("error", "http_failed", { subsystem: "http", status: 500, errorCode: "server_error" });
        throw error;
      } finally {
        const duration = (performance.now() - started) / 1000;
        increment("http_requests_total", { route: normalized, method, status: String(status) });
        observe("http_duration_seconds", { route: normalized, method }, duration);
        inFlight(normalized, method, -1);
        log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "http_completed", { subsystem: "http", status, durationMs: duration * 1000 });
      }
    });
  };
}
