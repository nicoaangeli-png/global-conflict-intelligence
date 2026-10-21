import { describe, expect, it } from "vitest";
import type { Signal, SignalKind } from "@/types/detection";
import { DetectionEngine } from "@/server/detection/engine";
import { classify, normalized, words } from "@/server/detection/normalize";
import { canonicalPlaceKey, extractPlaces } from "@/server/detection/lexicon/places";
import { cleanUnicode } from "@/server/detection/language/unicode";
import { detectScripts, isMultiScript } from "@/server/detection/language/scripts";
import { SqliteDetectionStore } from "@/server/detection/store";
import { semanticSimilarity, getEmbeddingMetrics, resetEmbeddingCache } from "@/server/detection/similarity/embedding";

const NOW = Date.parse("2026-10-21T10:00:00Z");

function setup() {
  const store = new SqliteDetectionStore(":memory:");
  return { store, engine: new DetectionEngine(store) };
}

function mkSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "sig-base",
    provider: "provider-base",
    sourceName: "Source Base",
    url: "https://news.example/1",
    title: "Explosion signalée à Odessa près du port",
    text: null,
    kind: "explosion",
    nature: "press",
    occurredAt: new Date(NOW).toISOString(),
    publishedAt: null,
    receivedAt: new Date(NOW).toISOString(),
    position: { lat: 46.48, lon: 30.73, precision: "city" },
    place: "Odessa",
    countries: ["UKR"],
    entities: [],
    upstreamAgency: null,
    confirmsOccurrence: false,
    severity: null,
    metric: null,
    caveat: null,
    ...overrides,
  };
}

describe("Architecture multilingue ORBITAL — 15 langues prioritaires", async () => {
  // 1. Classification & Lexiques dans les 15 langues
  describe("1. Classification multilingue des 15 langues prioritaires", async () => {
    const testCases: { text: string; expected: SignalKind; lang: string }[] = [
      // English
      { text: "Massive blast reported at Odesa harbor", expected: "explosion", lang: "en" },
      { text: "Earthquake of magnitude 5.8 strikes near coast", expected: "earthquake", lang: "en" },
      { text: "Rioters clash with police during anti-government protest", expected: "protest", lang: "en" },
      { text: "Power outage leaves downtown district in the dark", expected: "outage", lang: "en" },
      // French
      { text: "Forte détonation entendue dans le centre-ville", expected: "explosion", lang: "fr" },
      { text: "Séisme de magnitude 6 ressenti sur tout le littoral", expected: "earthquake", lang: "fr" },
      { text: "Manifestation massive contre la réforme", expected: "protest", lang: "fr" },
      { text: "Panne générale d'électricité sur le réseau", expected: "outage", lang: "fr" },
      // Spanish
      { text: "Fuerte explosión en un almacén de municiones", expected: "explosion", lang: "es" },
      { text: "Terremoto de magnitud 6.2 sacude la región", expected: "earthquake", lang: "es" },
      { text: "Disturbios violentos en el centro tras la manifestación", expected: "protest", lang: "es" },
      { text: "Apagón masivo afecta a tres provincias", expected: "outage", lang: "es" },
      // Portuguese
      { text: "Forte explosão ouvida perto da refinaria", expected: "explosion", lang: "pt" },
      { text: "Tremor de terra de magnitude 5.4 assusta moradores", expected: "earthquake", lang: "pt" },
      { text: "Protestos populares fecham principais avenidas", expected: "protest", lang: "pt" },
      { text: "Apagão atinge milhares de residências", expected: "outage", lang: "pt" },
      // German
      { text: "Heftige Detonation erschüttert das Hafengebiet", expected: "explosion", lang: "de" },
      { text: "Erdbeben der Stärke 5.1 im Süden registriert", expected: "earthquake", lang: "de" },
      { text: "Demonstration von Tausenden Menschen gegen Teuerung", expected: "protest", lang: "de" },
      { text: "Großflächiger Stromausfall legt U-Bahn lahm", expected: "outage", lang: "de" },
      // Italian
      { text: "Forte esplosione avvertita nella zona industriale", expected: "explosion", lang: "it" },
      { text: "Scossa di terremoto magnitudo 4.9 al largo", expected: "earthquake", lang: "it" },
      { text: "Scontri tra manifestanti e polizia durante il corteo", expected: "protest", lang: "it" },
      { text: "Blackout improvviso lascia la città al buio", expected: "outage", lang: "it" },
      // Russian
      { text: "Мощный взрыв прогремел в районе порта", expected: "explosion", lang: "ru" },
      { text: "Землетрясение магнитудой 6.0 зафиксировано на глубине", expected: "earthquake", lang: "ru" },
      { text: "Массовые протесты и митинги на центральной площади", expected: "protest", lang: "ru" },
      { text: "Блэкаут: отключение электроэнергии в пяти районах", expected: "outage", lang: "ru" },
      // Ukrainian
      { text: "Потужний вибух біля набережної", expected: "explosion", lang: "uk" },
      { text: "Землетрус магнітудою 5.2 сколихнув регіон", expected: "earthquake", lang: "uk" },
      { text: "Масові протести та заворушення перед мерією", expected: "protest", lang: "uk" },
      { text: "Блекаут: аварійне відключення світла у місті", expected: "outage", lang: "uk" },
      // Arabic
      { text: "انفجار عنيف يهز محيط الميناء التجاري", expected: "explosion", lang: "ar" },
      { text: "زلزال بقوة 5.7 درجات ريختر يضرب الساحل", expected: "earthquake", lang: "ar" },
      { text: "احتجاجات حاشدة واشتباكات مع قوات الأمن", expected: "protest", lang: "ar" },
      { text: "انقطاع الكهرباء بشكل كامل عن العاصمة", expected: "outage", lang: "ar" },
      // Persian
      { text: "انفجار مهیب در یک مرکز صنعتی", expected: "explosion", lang: "fa" },
      { text: "زمین لرزه به بزرگی ۵.۵ ریشتر این منطقه را لرزاند", expected: "earthquake", lang: "fa" },
      { text: "تظاهرات و اعتراضات گسترده در خیابان‌ها", expected: "protest", lang: "fa" },
      { text: "قطعی برق گسترده در بخش‌های وسیعی از پایتخت", expected: "outage", lang: "fa" },
      // Turkish
      { text: "Liman yakınlarında şiddetli patlama meydana geldi", expected: "explosion", lang: "tr" },
      { text: "Ege Denizi açıklarında 5.4 büyüklüğünde deprem", expected: "earthquake", lang: "tr" },
      { text: "Hükümet karşıtı protesto gösterileri ve çatışmalar", expected: "protest", lang: "tr" },
      { text: "Büyük çaplı elektrik kesintisi hayatı felç etti", expected: "outage", lang: "tr" },
      // Hebrew
      { text: "פיצוץ עז נשמע באזור הנמל הימי", expected: "explosion", lang: "he" },
      { text: "רעידת אדמה בעוצמה 5.3 הורגשה היטב בצפון", expected: "earthquake", lang: "he" },
      { text: "מחאה סוערת והפגנות המונים ברחבי העיר", expected: "protest", lang: "he" },
      { text: "הפסקת חשמל נרחבת בעקבות תקלה ברשת", expected: "outage", lang: "he" },
      // Chinese Simplified
      { text: "港口附近发生剧烈爆炸并引发大火", expected: "explosion", lang: "zh" },
      { text: "中国地震台网测定发生6.1级地震", expected: "earthquake", lang: "zh" },
      { text: "数千人举行示威游行抗议新政策", expected: "protest", lang: "zh" },
      { text: "电网故障导致全城大面积停电", expected: "outage", lang: "zh" },
      // Japanese
      { text: "港湾地区で大規模な爆発が発生", expected: "explosion", lang: "ja" },
      { text: "マグニチュード6.3の地震を観測", expected: "earthquake", lang: "ja" },
      { text: "都心部で大規模な抗議デモが発生", expected: "protest", lang: "ja" },
      { text: "送電トラブルにより各地で大規模停電", expected: "outage", lang: "ja" },
      // Korean
      { text: "항구 인근에서 강력한 폭발 발생", expected: "explosion", lang: "ko" },
      { text: "해역에서 규모 5.6 지진 발생", expected: "earthquake", lang: "ko" },
      { text: "도심에서 대규모 항의 시위와 충돌", expected: "protest", lang: "ko" },
      { text: "변전소 고장으로 대규모 정전 사태", expected: "outage", lang: "ko" },
    ];

    for (const { text, expected, lang } of testCases) {
      it(`[${lang}] classifie correctement: "${text.slice(0, 35)}..." -> ${expected}`, async () => {
        expect(classify(text)).toBe(expected);
      });
    }
  });

  // 2. Rapprochement cross-lingue : même événement rapporté dans différentes langues
  describe("2. Rapprochement cross-lingue du même événement", async () => {
    it("regroupe dans le même cluster un événement décrit en français, anglais, ukrainien, russe, arabe et chinois", async () => {
      const { engine, store } = setup();

      const signals: Signal[] = [
        mkSignal({ id: "sig-fr", provider: "afp", url: "https://afp.example/1", title: "Explosion signalée à Odessa près du port", place: "Odessa" }),
        mkSignal({ id: "sig-en", provider: "reuters", url: "https://reuters.example/1", title: "Blast reported near Odesa harbor", place: "Odesa" }),
        mkSignal({ id: "sig-uk", provider: "ukrinform", url: "https://ukrinform.example/1", title: "Потужний вибух біля порту в Одесі", place: "Одеса" }),
        mkSignal({ id: "sig-ru", provider: "tass", url: "https://tass.example/1", title: "Взрыв в районе порта в Одессе", place: "Одесса" }),
        mkSignal({ id: "sig-ar", provider: "aljazeera", url: "https://aljazeera.example/1", title: "انفجار عنيف بالقرب من ميناء أوديسا", place: "أوديسا" }),
        mkSignal({ id: "sig-zh", provider: "xinhua", url: "https://xinhua.example/1", title: "敖德萨港口附近发生爆炸", place: "敖德萨" }),
      ];

      await engine.ingest(signals, NOW);
      const snapshot = await engine.snapshot(NOW);

      expect(snapshot.events).toHaveLength(1);
      const event = snapshot.events[0];
      expect(event.evidenceCount).toBe(6);
      expect(event.independentSourceCount).toBeGreaterThanOrEqual(4);
      await store.close();
    });

    it("regroupe un séisme décrit en japonais, anglais et coréen", async () => {
      const { engine, store } = setup();

      const signals: Signal[] = [
        mkSignal({ id: "quake-ja", kind: "earthquake", title: "東京沖で地震観測 マグニチュード6.0", place: "東京", position: { lat: 35.68, lon: 139.76, precision: "city" }, countries: ["JPN"] }),
        mkSignal({ id: "quake-en", kind: "earthquake", title: "Magnitude 6.0 earthquake strikes off Tokyo", place: "Tokyo", position: { lat: 35.69, lon: 139.75, precision: "city" }, countries: ["JPN"] }),
        mkSignal({ id: "quake-ko", kind: "earthquake", title: "도쿄 인근 해역 규모 6.0 지진 발생", place: "도쿄", position: { lat: 35.67, lon: 139.74, precision: "city" }, countries: ["JPN"] }),
      ];

      await engine.ingest(signals, NOW);
      const snapshot = await engine.snapshot(NOW);

      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0].kind).toBe("earthquake");
      await store.close();
    });
  });

  // 3. Variations toponymiques majeures (Point 11)
  describe("3. Transcriptions toponymiques internationales (Kyiv, Odesa, Moscow, Tehran, Beijing)", async () => {
    it("reconnaît et fusionne Kyiv / Kiev / Київ / Киев / كييف / קייב / 基辅 sans remappage géopolitique", async () => {
      expect(canonicalPlaceKey("Kyiv")).toBe("kyiv");
      expect(canonicalPlaceKey("Kiev")).toBe("kyiv");
      expect(canonicalPlaceKey("Київ")).toBe("kyiv");
      expect(canonicalPlaceKey("в Києві")).toBe("kyiv");
      expect(canonicalPlaceKey("Киев")).toBe("kyiv");
      expect(canonicalPlaceKey("в Киеве")).toBe("kyiv");
      expect(canonicalPlaceKey("كييف")).toBe("kyiv");
      expect(canonicalPlaceKey("קייב")).toBe("kyiv");
      expect(canonicalPlaceKey("基辅")).toBe("kyiv");

      const { engine, store } = setup();
      await engine.ingest([
        mkSignal({ id: "k-en", title: "Missile strike in Kyiv near airport", place: "Kyiv", position: { lat: 50.45, lon: 30.52, precision: "city" }, countries: ["UKR"] }),
        mkSignal({ id: "k-uk", title: "Ракетний удар у Києві біля аеропорту", place: "Київ", position: { lat: 50.44, lon: 30.51, precision: "city" }, countries: ["UKR"] }),
      ], NOW);
      expect((await engine.snapshot(NOW)).events).toHaveLength(1);
      await store.close();
    });

    it("reconnaît et fusionne Odesa / Odessa / Одеса / Одесса / أوديسا / אודסה / 敖德萨", async () => {
      expect(canonicalPlaceKey("Odesa")).toBe("odesa");
      expect(canonicalPlaceKey("Odessa")).toBe("odesa");
      expect(canonicalPlaceKey("Одеса")).toBe("odesa");
      expect(canonicalPlaceKey("Одессе")).toBe("odesa");
      expect(canonicalPlaceKey("أوديسا")).toBe("odesa");
      expect(canonicalPlaceKey("אודסה")).toBe("odesa");
      expect(canonicalPlaceKey("敖德萨")).toBe("odesa");
    });

    it("reconnaît et fusionne Moscow / Moskva / Moscou / Moskau / Москва / موسكو / 莫斯科", async () => {
      expect(canonicalPlaceKey("Moscow")).toBe("moscow");
      expect(canonicalPlaceKey("Moskva")).toBe("moscow");
      expect(canonicalPlaceKey("Москва")).toBe("moscow");
      expect(canonicalPlaceKey("в Москве")).toBe("moscow");
      expect(canonicalPlaceKey("موسكو")).toBe("moscow");
      expect(canonicalPlaceKey("莫斯科")).toBe("moscow");
    });

    it("reconnaît et fusionne Tehran / Teheran / Téhéran / Тегеран / تهران / 德黑兰", async () => {
      expect(canonicalPlaceKey("Tehran")).toBe("tehran");
      expect(canonicalPlaceKey("Teheran")).toBe("tehran");
      expect(canonicalPlaceKey("Тегеран")).toBe("tehran");
      expect(canonicalPlaceKey("تهران")).toBe("tehran");
      expect(canonicalPlaceKey("德黑兰")).toBe("tehran");
    });

    it("reconnaît et fusionne Beijing / Pékin / Peking / Пекин / بكين / 北京", async () => {
      expect(canonicalPlaceKey("Beijing")).toBe("beijing");
      expect(canonicalPlaceKey("Pékin")).toBe("beijing");
      expect(canonicalPlaceKey("Peking")).toBe("beijing");
      expect(canonicalPlaceKey("Пекин")).toBe("beijing");
      expect(canonicalPlaceKey("بكين")).toBe("beijing");
      expect(canonicalPlaceKey("北京")).toBe("beijing");
    });
  });

  // 4. Bruit journalistique et dépêches
  describe("4. Bruit journalistique et bandeaux d'urgence", async () => {
    it("nettoie le bruit 'BREAKING', 'URGENT', 'Срочно', 'عاجل', '速报' sans altérer la classification", async () => {
      const texts = [
        "BREAKING: Blast reported in central Odesa",
        "URGENT / ALERTE : Explosion constatée dans le centre d'Odessa",
        "Срочно! Взрыв в центре Одессы",
        "عاجل: انفجار في وسط أوديسا",
        "速报：敖德萨市中心发生爆炸",
        "속보: 오데사 도심에서 폭발 발생",
      ];

      for (const text of texts) {
        expect(classify(text)).toBe("explosion");
      }
    });
  });

  // 5. Titres très courts
  describe("5. Titres très courts", async () => {
    it("traite correctement les titres de 2 ou 3 mots", async () => {
      expect(classify("Kyiv explosion")).toBe("explosion");
      expect(classify("Вибух Київ")).toBe("explosion");
      expect(classify("زلزال دمشق")).toBe("earthquake");
      expect(classify("قطع برق تهران")).toBe("outage");
      expect(classify("北京 停电")).toBe("outage");
    });
  });

  // 6. Faux amis linguistiques et désambiguïsation
  describe("6. Faux amis linguistiques et séparation thématique", async () => {
    it("distingue 'labor strike' (grève/manifestation) et 'missile strike' (explosion/frappe)", async () => {
      expect(classify("General strike halts public transit in Athens")).toBe("protest");
      expect(classify("Drone strike hits ammunition depot")).toBe("explosion");
    });

    it("ne regroupe pas deux événements dans la même ville mais de nature différente", async () => {
      const { engine, store } = setup();

      await engine.ingest([
        mkSignal({ id: "sig-protest", kind: "protest", title: "Manifestation pacifique dans le centre de Kyiv", place: "Kyiv" }),
        mkSignal({ id: "sig-explosion", kind: "explosion", title: "Frappe de missile sur une base près de Kyiv", place: "Kyiv" }),
      ], NOW);

      expect((await engine.snapshot(NOW)).events).toHaveLength(2);
      await store.close();
    });

    it("ne regroupe pas deux événements avec vocabulaire identique mais villes différentes", async () => {
      const { engine, store } = setup();

      await engine.ingest([
        mkSignal({ id: "port-odesa", title: "Blast reported near harbor terminal", place: "Odesa", position: { lat: 46.48, lon: 30.73, precision: "city" } }),
        mkSignal({ id: "port-beirut", title: "Blast reported near harbor terminal", place: "Beirut", position: { lat: 33.90, lon: 35.51, precision: "city" } }),
      ], NOW);

      expect((await engine.snapshot(NOW)).events).toHaveLength(2);
      await store.close();
    });
  });

  // 7. Titres multi-alphabets et préservation Unicode
  describe("7. Titres contenant plusieurs alphabets et intégrité Unicode", async () => {
    it("détecte les scripts mixtes (Cyrillique + Latin, Arabe + Latin, Han + Latin)", async () => {
      expect(isMultiScript("Взрыв в Одессе (Odesa) near harbor")).toBe(true);
      expect(isMultiScript("عاجل: انفجار في تل أبيب (Tel Aviv)")).toBe(true);
      expect(isMultiScript("M6.5 地震 - Off the coast of Fukushima")).toBe(true);
      expect(isMultiScript("Simple English headline")).toBe(false);
    });

    it("ne détruit pas les caractères non-latins (Cyrillique, Arabe, Hébreu, Hanzi)", async () => {
      const original = "Потужний вибух біля порту в Одесі ; انفجار في أوديسا ; פיצוץ בנמל אודסה";
      const cleaned = cleanUnicode(original);

      expect(cleaned).toContain("вибух");
      expect(cleaned).toContain("انفجار");
      expect(cleaned).toContain("פיצוץ");
    });
  });

  // 8. Contradictions multilingues
  describe("8. Contradictions multilingues (Arme vs Industriel, Démentis)", async () => {
    it("détecte une contradiction entre arme et accident industriel en russe / ukrainien", async () => {
      const { engine, store } = setup();

      await engine.ingest([
        mkSignal({ id: "ru-weapon", title: "Взрыв и ракетный удар возле порта в Одессе", place: "Odessa" }),
        mkSignal({ id: "ru-industrial", title: "Взрыв на заводе из-за утечки газа возле порта в Одессе", place: "Odessa" }),
      ], NOW);

      const event = (await engine.snapshot(NOW)).events[0];
      expect(event.contradictions.join(" ")).toContain("incertaine");
      await store.close();
    });

    it("détecte un démenti officiel en arabe", async () => {
      const { engine, store } = setup();

      await engine.ingest([
        mkSignal({ id: "ar-signal", title: "دوي انفجار في ميناء أوديسا", place: "Odessa" }),
        mkSignal({ id: "ar-denial", title: "السلطات تنفي وقوع أي انفجار في أوديسا وتؤكد أنه تقرير كاذب", place: "Odessa" }),
      ], NOW);

      const event = (await engine.snapshot(NOW)).events[0];
      expect(event.contradictions.join(" ")).toContain("démenti");
      await store.close();
    });
  });

  // 9. Séparation stricte de l'indépendance des sources (Point 12)
  describe("9. Indépendance des sources préservée lors de la traduction", async () => {
    it("ne multiplie pas les sources indépendantes si deux dépêches dans deux langues viennent de Reuters", async () => {
      const { engine, store } = setup();

      await engine.ingest([
        mkSignal({ id: "wire-en", provider: "feed-en", upstreamAgency: "reuters", title: "Blast reported near Odesa port", place: "Odesa" }),
        mkSignal({ id: "wire-fr", provider: "feed-fr", upstreamAgency: "reuters", title: "Explosion signalée près du port d'Odessa", place: "Odessa" }),
      ], NOW);

      const event = (await engine.snapshot(NOW)).events[0];
      expect(event.evidenceCount).toBe(2);
      expect(event.independentSourceCount).toBe(1); // Une seule source indépendante !
      await store.close();
    });
  });

  // 10. Niveau 3 : Embeddings / Fallback local déterministe
  describe("10. Niveau 3 hybride (Fallback déterministe 100% local, métriques de coût)", async () => {
    it("utilise le vectoriseur local déterministe par défaut avec un coût nul ($0.00)", async () => {
      resetEmbeddingCache();
      const sim = semanticSimilarity("Explosion in Odesa port", "Blast at Odessa harbor");

      expect(sim).toBeGreaterThan(0.3);
      const metrics = getEmbeddingMetrics();
      expect(metrics.estimatedCostUsd).toBe(0);
      expect(metrics.activeProvider).toBe("local_deterministic");
    });
  });

  // 11. Performance & Latence (Point 14)
  describe("11. Performance et absence d'explosion de latence", async () => {
    it("borne la latence de 100 signaux multilingues diversifiés", async () => {
      const { engine, store } = setup();

      const sampleBatch: Signal[] = [];
      const cities = ["Odessa", "Kyiv", "Tokyo", "Seoul", "Beijing", "Tehran", "Moscow", "Damascus", "Beirut", "Gaza"];
      const titles = [
        "Blast near port",
        "Explosion près du port",
        "Вибух біля порту",
        "Взрыв возле порта",
        "انفجار بالقرب من الميناء",
        "港口附近发生爆炸",
        "港近くで爆発",
        "항구 근처 폭발",
        "Liman yakınlarında patlama",
        "פיצוץ ליד הנמל",
      ];

      for (let i = 0; i < 100; i++) {
        const city = cities[i % cities.length];
        sampleBatch.push(
          mkSignal({
            id: "bench-" + i,
            provider: "bench-source-" + i,
            title: titles[i % titles.length],
            place: city,
          })
        );
      }

      // Warm-up SQLite & JIT with separate dummy signals
      await engine.ingest([
        mkSignal({ id: "warm-1", provider: "warm-1", title: "Warmup explosion in port", place: "Odessa" }),
        mkSignal({ id: "warm-2", provider: "warm-2", title: "Warmup blast in harbor", place: "Odessa" }),
      ], NOW);

      const start = performance.now();
      const result = await engine.ingest(sampleBatch, NOW);
      const duration = performance.now() - start;

      expect(result.accepted).toBe(100);
      // Mesure locale : ~0,8 s. Seuil volontairement large pour la CI parallèle ;
      // il détecte toujours une régression quadratique (l'ancienne version dépassait 4 s).
      expect(duration).toBeLessThan(4000);

      await store.close();
    });
  });
});
