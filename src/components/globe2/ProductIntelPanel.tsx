import { useState } from "react";
import type { ConflictCluster, ConflictEvent, EventsResponse } from "@/types/conflict";
import type { FeedSourceState, LiveItem } from "@/types/feeds";
import { absoluteDateTime, relativeTime } from "@/lib/format";
import { itemTime, NATURE_LABELS, THEME_LABELS } from "@/components/feeds/feedModel";
import { selectConflictSignals, validPosition } from "./productIntel";
import styles from "./CameraLab.module.css";

type Props = {
  events: EventsResponse | null;
  feeds: LiveItem[];
  sources: FeedSourceState[];
  selectedId: string | null;
  selectedConflict: ConflictCluster | null;
  selectedConflictEvents: ConflictEvent[];
  error: string | null;
  loading: boolean;
  open: boolean;
  onToggle: () => void;
  onSelect: (item: LiveItem) => void;
  onSelectConflict: (cluster: ConflictCluster) => void;
};

function eventLocation(item: LiveItem): string {
  if (item.countries.length) return item.countries.join(", ");
  if (item.lat !== null && item.lon !== null && validPosition(item.lat, item.lon)) return `${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°`;
  return "Localisation non fournie";
}

export function ProductIntelPanel({ events, feeds, sources, selectedId, selectedConflict, selectedConflictEvents,
  error, loading, open, onToggle, onSelect, onSelectConflict }: Props) {
  const selected = feeds.find(item => item.id === selectedId) ?? null;
  const [feedFilter, setFeedFilter] = useState<"all" | "disaster" | "weather" | "un">("all");
  const shownFeeds = feedFilter === "all" ? feeds : feeds.filter(item => item.category === feedFilter);
  const conflicts = selectConflictSignals(events?.clusters ?? []);
  const failures = sources.filter(source => source.status === "error" || source.status === "stale");
  return <>
    <button type="button" className={styles.feedToggle} onClick={onToggle} aria-expanded={open}
      data-testid="product-feed-toggle">LIVE INTELLIGENCE FEED {open ? "−" : "+"}</button>
    {open && <aside className={styles.feedPanel} aria-label="Live Intelligence Feed" data-testid="product-feed-panel">
      <div className={styles.feedSummary}>
        <span><b>{conflicts.length}</b> SIGNAUX VIOLENCE</span>
        <span><b>{feeds.length}</b> ACTUALITÉS</span>
        <span><b>{feeds.filter(item => item.category === "disaster").length}</b> CATASTROPHES</span>
      </div>
      <div className={styles.feedBody}>
        {selectedConflict && <section className={styles.feedDetail} data-testid="product-conflict-detail">
          <div className={styles.label}>ZONE SIGNALÉE · {selectedConflict.confidence === "MEDIA_SIGNAL" ? "PRESSE NON CONFIRMÉE" : selectedConflict.confidence}</div>
          <h2>{selectedConflict.locality || selectedConflict.region || selectedConflict.country}</h2>
          <dl>
            <dt>TYPE</dt><dd>{selectedConflict.topType}</dd>
            <dt>DATE</dt><dd>{absoluteDateTime(selectedConflict.lastEventAt, "fr")} · {relativeTime(selectedConflict.lastEventAt, "fr")}</dd>
            <dt>PRÉCISION</dt><dd>{selectedConflict.geoPrecision ?? "Non fournie"}</dd>
            <dt>CONFIANCE</dt><dd>{selectedConflict.confidence}</dd>
            <dt>ENREGISTREMENTS</dt><dd>{selectedConflict.eventCount}</dd>
          </dl>
          {selectedConflictEvents.length > 0 && <p>Sources du détail : {Array.from(new Set(selectedConflictEvents.map(event => `${event.sourceDataset} / ${event.source}`))).slice(0, 3).join(" ; ")}</p>}
          {selectedConflict.confidence === "MEDIA_SIGNAL" && <p className={styles.feedCaveat}>Mentions de presse géolocalisées ; elles ne prouvent pas autant d’incidents indépendants.</p>}
        </section>}
        {selected && <section className={styles.feedDetail} data-testid="product-feed-detail">
          <div className={styles.label}>SÉLECTION GÉOGRAPHIQUE <button type="button" onClick={() => onSelect(selected)} aria-label="Recentrer sur la sélection">↗</button></div>
          <h2>{selected.title}</h2>
          <p>{selected.summary}</p>
          <dl>
            <dt>SOURCE</dt><dd>{selected.sourceName}</dd>
            <dt>TYPE</dt><dd>{NATURE_LABELS[selected.nature].fr}</dd>
            <dt>DATE SOURCE</dt><dd>{itemTime(selected) ? absoluteDateTime(itemTime(selected), "fr") : "Non fournie"}</dd>
            <dt>FRAÎCHEUR</dt><dd>{itemTime(selected) ? relativeTime(itemTime(selected), "fr") : "Inconnue"}</dd>
            <dt>COLLECTE</dt><dd>{absoluteDateTime(selected.fetchedAt, "fr")}</dd>
            <dt>ZONE</dt><dd>{eventLocation(selected)}</dd>
            <dt>STATUT</dt><dd>{selected.severity ?? "Non qualifié"}</dd>
          </dl>
          {selected.caveat && <p className={styles.feedCaveat}>{selected.caveat}</p>}
          {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer">VOIR LA SOURCE ↗</a>}
        </section>}
        {error && <p className={styles.feedWarning} role="status">Certaines données indisponibles : {error}</p>}
        {failures.length > 0 && <p className={styles.feedWarning}>Sources dégradées : {failures.map(source => source.sourceName).join(", ")}</p>}
        {loading && <p className={styles.feedEmpty}>Chargement des sources ORBITAL…</p>}
        {!loading && feeds.length === 0 && <p className={styles.feedEmpty}>Aucune actualité reçue. Les sources restent consultables dans ORBITAL.</p>}
        {conflicts.length > 0 && <div className={styles.conflictList}>
          <div className={styles.label}>SIGNAUX ROUGES · CONFLITS / VIOLENCES</div>
          {conflicts.slice(0, 3).map(cluster => <button key={cluster.id} type="button" onClick={() => onSelectConflict(cluster)}
            data-testid={`product-conflict-${cluster.id}`}>
            <span>● {cluster.locality || cluster.region || cluster.country}</span>
            <small>{cluster.confidence === "MEDIA_SIGNAL" ? "PRESSE NON CONFIRMÉE" : cluster.confidence} · {relativeTime(cluster.lastEventAt, "fr")}</small>
          </button>)}
        </div>}
        <div className={styles.feedFilters} aria-label="Filtrer le flux">
          {([ ["all", "TOUT"], ["disaster", "CATASTROPHES"], ["weather", "MÉTÉO"], ["un", "ONU"] ] as const)
            .map(([key, title]) => <button key={key} type="button" aria-pressed={feedFilter === key}
              onClick={() => setFeedFilter(key)}>{title}</button>)}
        </div>
        <div className={styles.feedRows}>
          {shownFeeds.slice(0, 60).map(item => {
            const located = validPosition(item.lat, item.lon);
            const date = itemTime(item);
            return <button key={item.id} type="button" onClick={() => onSelect(item)}
              className={`${styles.feedRow} ${selectedId === item.id ? styles.feedRowSelected : ""}`}
              data-testid={`product-feed-item-${item.id}`}>
              <span className={`${styles.feedDot} ${item.nature === "official_alert" && (item.severity === "severe" || item.severity === "extreme") ? styles.feedDotCritical : ""}`} />
              <span className={styles.feedRowContent}>
                <span className={styles.feedMeta}>{THEME_LABELS[item.category].fr.toUpperCase()} · {NATURE_LABELS[item.nature].fr.toUpperCase()} · {date ? relativeTime(date, "fr") : "DATE INCONNUE"}</span>
                <strong>{item.title}</strong>
                <span className={styles.feedSource}>{item.sourceName} · {eventLocation(item)} {located ? "· CIBLE GÉO ↗" : ""}</span>
              </span>
            </button>;
          })}
        </div>
        {events && <p className={styles.feedNote}>Violences signalées : {typeof events.totalEvents === "number" ? events.totalEvents.toLocaleString("fr-FR") : "—"} enregistrements réels / 30 j. {conflicts.filter((cluster: ConflictCluster) => cluster.confidence === "MEDIA_SIGNAL").length} foyers issus de mentions presse, non confirmés comme incidents indépendants.</p>}
      </div>
    </aside>}
  </>;
}
