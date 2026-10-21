/**
 * International category and semantic concept lexicons.
 * Supports deterministic keyword detection across 15 priority languages:
 * en, fr, es, pt, de, it, ru, uk, ar, fa, tr, he, zh, ja, ko.
 */

import type { SignalKind } from "@/types/detection";
import { cleanUnicode } from "../language/unicode";

interface CategoryDefinition {
  kind: SignalKind;
  concepts: string[];
  patterns: RegExp[];
}

function compilePattern(patternStr: string): RegExp {
  const converted = patternStr
    .replace(/(^|[(|])\\b/g, "$1(?<![\\p{L}\\p{N}])")
    .replace(/\\b([)|]|$)/g, "(?![\\p{L}\\p{N}])$1");
  return new RegExp(converted, "iu");
}

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  // 1. Earthquake
  {
    kind: "earthquake",
    concepts: ["concept:earthquake"],
    patterns: [
      compilePattern("\\b(earthquakes?|quakes?|tremors?|aftershocks?|seismic|magnitude)\\b"),
      compilePattern("\\b(seismes?|tremblement(?:s)?(?:\\s+de\\s+terre)?|secousses?)\\b"),
      compilePattern("\\b(terremotos?|sismos?|temblores?|magnitud(?:es)?)\\b"),
      compilePattern("\\b(abalo(?:s)?\\s+sismico(?:s)?)\\b"),
      compilePattern("\\b(erdbeben|beben|erschutterung(?:en)?|nachbeben)\\b"),
      compilePattern("\\b(terremoti?|sismi?|scosse?|magnitudo)\\b"),
      compilePattern("\\b(землетрясени[ея]|подземн(?:ые|ых)\\s+толчк(?:и|ов)|магнитуд[аы])\\b"),
      compilePattern("\\b(землетрус(?:и)?|підземн(?:і|их)\\s+поштовх(?:и|ів)|магнітуд[аи])\\b"),
      /(زلزال|زلزلة|هزة\s+ارضية|درجات\s+ريختر)/i,
      /(زلزله|زمین\s*لرزه|پس\s*لرزه)/i,
      compilePattern("\\b(deprem(?:ler)?|sarsinti|sismik)\\b"),
      /(רעידת\s+אדמה|רעש\s+אדמה|מוקד\s+הרעש|מגניטודה)/i,
      /(地震|震源|震级|余震|强震)/,
      /(マグニチュード|震度)/,
      /(지진|진도|지진\s*규모|진앙|여진)/,
    ],
  },

  // 2. Outage / Blackout
  {
    kind: "outage",
    concepts: ["concept:outage"],
    patterns: [
      compilePattern("\\b(outages?|blackouts?|power\\s+cuts?|grid\\s+failures?)\\b"),
      compilePattern("\\b(pannes?(?:\\s+generales?)?|coupures?(?:\\s+de\\s+courant|\\s+d'electricite)?)\\b"),
      compilePattern("\\b(apag(?:on|ones|ao|oes)|cortes?\\s+de\\s+luz|cortes?\\s+de\\s+energia|falla\\s+electrica)\\b"),
      compilePattern("\\b(stromausfall|stromausfalle|netzausfall)\\b"),
      compilePattern("\\b(interruzioni?\\s+di\\s+corrente|guasti?\\s+elettric[oi])\\b"),
      compilePattern("\\b(блэкаут(?:ы)?|отключени[ея]\\s+(?:света|электроэнергии|электричества)|обесточивани[ея])\\b"),
      compilePattern("\\b(блекаут(?:и)?|відключенн[яі]\\s+(?:світла|електроенергії)|знеструмленн[яі])\\b"),
      /(انقطاع\s+الكهرباء|انقطاع\s+التيار|اظلام|عطل\s+كهربائي)/i,
      /(قطع(?:ي|ی)?\s+برق|خاموشي\s+سراسري)/i,
      compilePattern("\\b(elektrik\\s+kesintisi|sebeke\\s+arizasi)\\b"),
      /(הפסקת\s+חשמל|עלטה|קריסת\s+רשת\s+החשמל)/i,
      /(停电|断电|电网故障|大面积停电)/,
      /(停電|送電停止)/,
      /(정전|전력\s*차단|전력망\s*마비)/,
    ],
  },

  // 3. Protest / Riot / Civil unrest
  {
    kind: "protest",
    concepts: ["concept:protest"],
    patterns: [
      compilePattern("\\b(protests?|protesters?|riots?|demonstrations?|unrest|rallies|rally|general\\s+strike|labor\\s+strike|workers?\\s+strike|walkouts?)\\b"),
      compilePattern("\\b(manifestations?|manifestants?|emeutes?|rassemblements?|affrontements?|greves?)\\b"),
      compilePattern("\\b(manifestaci(?:on|ones)|disturbios?|protestas?|revueltas?|huelgas?)\\b"),
      compilePattern("\\b(protestos?|manifestacoes|disturbios|motins?|greves?)\\b"),
      compilePattern("\\b(demonstration(?:en)?|unruhen|ausschreitungen|aufruhr|streik(?:s)?)\\b"),
      compilePattern("\\b(manifestazioni?|cortei?|scontri|rivolte?|scioper(?:o|i))\\b"),
      compilePattern("\\b(протест(?:ы|ов)?|протестующ(?:ие|их)|митинг(?:и|ов)?|беспорядк(?:и|ов)|демонстраци[ия]|забастовк[аи])\\b"),
      compilePattern("\\b(протест(?:и|ів)?|протестувальн(?:ики|иків)|мітинг(?:и|ів)?|заворушенн[яі]|демонстраці[їя]|страйк(?:и|ів)?)\\b"),
      /(احتجاجات|متظاهرون|مظاهرة|مظاهرات|اضطرابات|شغب|اضراب)/i,
      /(اعتراضات|تظاهرات|معترضان|ناارامی|اعتصاب)/i,
      compilePattern("\\b(protesto(?:lar)?|gosteri(?:ler)?|eylem(?:ler)?|kargasa|isyan|grev(?:ler)?)\\b"),
      /(מחאה|הפגנה|מפגינים|מהומות|הפרות\s+סדר|שביתה)/i,
      /(抗议|示威|游行|骚乱|暴乱|罢工)/,
      /(デモ|抗議|暴動|ストライキ)/,
      /(항의|시위|폭동|파업)/,
    ],
  },

  // 4. Weather / Flood / Hurricane
  {
    kind: "weather",
    concepts: ["concept:weather"],
    patterns: [
      compilePattern("\\b(floods?|flooding|hurricanes?|typhoons?|cyclones?|storms?|tornadoes?)\\b"),
      compilePattern("\\b(inondations?|crues?|ouragans?|typhons?|cyclones?|tempetes?)\\b"),
      compilePattern("\\b(inundaci(?:on|ones)|huracan(?:es)?|tifon(?:es)?|cicl(?:on|ones)|tormentas?)\\b"),
      compilePattern("\\b(enchentes?|furac(?:ao|oes)|tempestades?)\\b"),
      compilePattern("\\b(uberschwemmung(?:en)?|hochwasser|hurrikan(?:e)?|taifun(?:e)?|sturm|sturme)\\b"),
      compilePattern("\\b(inondazioni?|alluvioni?|uragani?|tifoni?|tempeste?)\\b"),
      compilePattern("\\b(наводнени[ея]|павод(?:ок|ки)|ураган(?:ы)?|тайфун(?:ы)?|шторм(?:ы)?)\\b"),
      compilePattern("\\b(повін[ьі]|павод(?:ок|ки)|ураган(?:и)?|тайфун(?:и)?|шторм(?:и)?)\\b"),
      /(فيضان|فيضانات|سيول|اعصار|عاصفة)/i,
      /(سیل|طوفان|گردباد)/i,
      compilePattern("\\b(sel|su\\s+baskini|kasirga|tayfun|firtina)\\b"),
      /(שיטפון|הצפה|סופה|הוריקן|סופת\s+טייפון)/i,
      /(洪水|内涝|飓风|台风|暴风雨)/,
      /(洪水|浸水|台風|暴風雨)/,
      /(홍수|침수|허리케인|태풍|폭풍우)/,
    ],
  },

  // 5. Fire / Thermal
  {
    kind: "thermal",
    concepts: ["concept:fire"],
    patterns: [
      compilePattern("\\b(wildfires?|infernos?|conflagrations?|forest\\s+fires?|huge\\s+blaze)\\b"),
      compilePattern("\\b(incendies?(?:\\s+de\\s+foret)?|feux?\\s+de\\s+foret|embrasements?)\\b"),
      compilePattern("\\b(incendios?(?:\\s+forestales?)?|fuegos?\\s+forestales?)\\b"),
      compilePattern("\\b(incendios?\\s+florestais)\\b"),
      compilePattern("\\b(grossbrand|waldbrand|feuersbrunst)\\b"),
      compilePattern("\\b(incendi(?:o)?(?:\\s+boschiv[oi])?|roghi?)\\b"),
      compilePattern("\\b(лесной\\s+пожар|лесные\\s+пожары|масштабный\\s+пожар|возгорани[ея])\\b"),
      compilePattern("\\b(лісова\\s+пожежа|лісові\\s+пожежі|масштабна\\s+пожежа)\\b"),
      /(حرائق\s+الغابات|اندلاع\s+حريق|حريق\s+هائل)/i,
      /(اتش\s*سوزی\s*جنگل|حریق\s*گسترده)/i,
      compilePattern("\\b(orman\\s+yangini|buyuk\\s+yangin)\\b"),
      /(שריפת\s+יער|דליקת\s+ענק)/i,
      /(森林火灾|森林大火)/,
      /(森林火災|山火事)/,
      /(산불|대형\s*화재)/,
    ],
  },

  // 6. Explosion / Missile / Shelling (broad category)
  {
    kind: "explosion",
    concepts: ["concept:explosion"],
    patterns: [
      compilePattern("\\b(explosions?|detonations?|blasts?|shelling|airstrikes?|bombings?|bombardments?|drone\\s+strikes?|missile\\s+strikes?|air\\s+strikes?)\\b"),
      compilePattern("\\b(explosions?|detonations?|souffles?|bombardements?|frappes?(?:\\s+aeriennes?)?|tirs?\\s+d'artillerie|frappes?\\s+de\\s+drone)\\b"),
      compilePattern("\\b(explosiones?|detonaciones?|estallidos?|bombardeos?|ataques?\\s+aereos?|ataques?\\s+con\\s+drones?)\\b"),
      compilePattern("\\b(explosao|explosoes|detonacao|detonacoes|bombardeios?|ataques?\\s+aereos?)\\b"),
      compilePattern("\\b(explosionen?|detonationen?|sprengungen?|bombardements?|luftangriffe?|beschuss|drohnenangriff(?:e)?)\\b"),
      compilePattern("\\b(esplosion[ei]|detonazion[ei]|scoppi(?:o)?|bombardamenti?|raid\\s+aerei?)\\b"),
      compilePattern("\\b(взрыв(?:ы|ов)?|детонаци[ия]|обстрел(?:ы|ов)?|авиаудар(?:ы|ов)?|бомбардировк[аи]|прилет(?:ы|ов)?|удар(?:ы)?\\s+дронов?)\\b"),
      compilePattern("\\b(вибух(?:и|ів)?|детонаці[їя]|обстріл(?:и|ів)?|авіаудар(?:и|ів)?|бомбардуванн[яі]|приліт(?:и|ів)?|удар(?:и)?\\s+дронів?)\\b"),
      /(انفجار|انفجارات|دوي\s+انفجار|قصف|غارة\s+جوية|ضربة\s+جوية|قذيفة|ضربة\s+طيران)/i,
      /(انفجار|انفجارها|حمله\s+هوایی|گلوله\s+باران)/i,
      compilePattern("\\b(patlama(?:lar)?|infilak|bombardiman|hava\\s+saldirisi|siha\\s+saldirisi)\\b"),
      /(פיצוץ|פיצוצים|הפצצה|תקיפה\s+אווירית|הפגזה|תקיפת\s+מל"ט)/i,
      /(爆炸|炸弹|轰炸|空袭|炮击)/,
      /(爆発|爆弾|空爆|砲撃)/,
      /(폭발|폭탄|공습|포격)/,
    ],
  },
];

// Specific sub-concepts for fine-grained alignment and cross-lingual matching
const CONCEPT_PATTERNS: { concept: string; pattern: RegExp }[] = [
  // Missile / rocket specific concept
  {
    concept: "concept:missile",
    pattern: compilePattern(
      [
        "\\b(missiles?|rockets?|cruise\\s+missiles?|drone\\s+strikes?|uav|ballistic)\\b",
        "\\b(missiles?|roquettes?|missiles?\\s+balistiques?|frappes?\\s+de\\s+drone)\\b",
        "\\b(misil(?:es)?|cohetes?|drones?|balisticos?)\\b",
        "\\b(misseis|foguetes?|misseis\\s+balisticos?)\\b",
        "\\b(raketen?|flugkorper|marschflugkorper|drohnenangriff(?:e)?|ballistische\\s+raketen?)\\b",
        "\\b(missili?|razzi?|droni?|balistici?)\\b",
        "\\b(ракет[аы]|ракетн(?:ый|ые)\\s+удар(?:ы)?|крылат(?:ая|ые)\\s+ракет[аы]|шахед(?:ы)?|беспилотник(?:и)?)\\b",
        "\\b(ракет[аи]|ракетн(?:ий|і)\\s+удар(?:и)?|крилат(?:а|і)\\s+ракет[аи]|шахед(?:и)?|дрон(?:и)?)\\b",
        "(صاروخ|صواريخ|ضربة\\s+صاروخية|مسيرة|مسيرات|باليستي)",
        "(موشک|موشکها|حمله\\s+موشکی|پهپاد)",
        "\\b(fuze(?:ler)?|roket(?:ler)?|siha|iha|balistik\\s+fuze)\\b",
        '(טיל|טילים|רקטה|רקטות|כטב"ם|טיל\\s+בליסטי)',
        "(导弹|火箭弹|巡航导弹|无人机袭击|弹道导弹)",
        "(ミサイル|ロケット弾|ドローン攻撃|弾道ミサイル)",
        "(미사일|로켓|순항미사일|드론\\s*공격|탄도미사일)",
      ].join("|")
    ),
  },

  // Harbor / port concept
  {
    concept: "concept:harbor",
    pattern: compilePattern(
      [
        "\\b(harbor|harbour|port|ports|docks?|quays?|pier)\\b",
        "\\b(ports?|quais?|darse)\\b",
        "\\b(puertos?|muelles?|darsenas?)\\b",
        "\\b(portos?|cais)\\b",
        "\\b(hafen|hafengebiet|dockanlagen)\\b",
        "\\b(porti?|banchine?)\\b",
        "\\b(порт(?:а|у|ом|е)?|причал(?:а|у|е)?|набережн(?:ая|ой))\\b",
        "\\b(порт(?:у|ом|і)?|причал(?:у|і)?|набережн(?:а|ій))\\b",
        "(ميناء|موانئ|ارصفة|رصيف)",
        "(بندر|اسکله)",
        "\\b(liman(?:i|da|lar)?|iskeleye)\\b",
        "(נמל|רציף)",
        "(港口|码头|海港)",
        "(港|埠頭|ハーバー)",
        "(항구|부두)",
      ].join("|")
    ),
  },

  // Airport / airfield concept
  {
    concept: "concept:airport",
    pattern: compilePattern(
      [
        "\\b(airports?|airfields?|airbases?|runway)\\b",
        "\\b(aeroports?|aerodromes?|bases?\\s+aeriennes?)\\b",
        "\\b(aeropuertos?|aerodromos?|bases?\\s+aereas?)\\b",
        "\\b(flughafen|flughafe|flugplatz|militärflugplatz)\\b",
        "\\b(aeroporti?|basi?\\s+aeree?)\\b",
        "\\b(аэропорт(?:а|у|е)?|аэродром(?:а|у|е)?|авиабаз[аеы])\\b",
        "\\b(аеропорт(?:у|і)?|аеродром(?:у|і)?|авіабаз[аіи])\\b",
        "(مطار|مطارات|قاعدة\\s+جوية)",
        "(فرودگاه|پایگاه\\s+هوایی)",
        "\\b(havalimani|havaalani|hava\\s+ussu)\\b",
        "(נמל\\s+תעופה|שדה\\s+תעופה|בסיס\\s+חיל\\s+האוויר)",
        "(机场|航站楼|空军基地)",
        "(空港|飛行場|空軍基地)",
        "(공항|비행장|공군기지)",
      ].join("|")
    ),
  },

  // Industrial / factory concept
  {
    concept: "concept:factory",
    pattern: compilePattern(
      [
        "\\b(factory|factories|plant|plants|refinery|industrial|chemical\\s+plant)\\b",
        "\\b(usine|usines|industriel(?:le)?|raffinerie|site\\s+industriel)\\b",
        "\\b(fabrica|fabricas|industrial|refineria|planta\\s+quimica)\\b",
        "\\b(fabrik(?:en)?|industrieanlage(?:n)?|raffinerie)\\b",
        "\\b(fabbric[ah]e?|impianto\\s+industriale|raffineria)\\b",
        "\\b(завод(?:а|у|е|ом)?|фабрик[аеи]|предприяти[ея]|нефтеперерабатывающ(?:ий|его))\\b",
        "\\b(завод(?:у|і|ом)?|фабрик[аіи]|підприємств[оаі])\\b",
        "(مصنع|معمل|منشأة\\s+صناعية|مصفاة)",
        "(کارخانه|پالایشگاه|مجتمع\\s+صنعتی)",
        "\\b(fabrika(?:lar)?|sanayi\\s+tesisi|rafineri)\\b",
        "(מפעל|מתקן\\s+תעשייתי|בית\\s+זיקוק)",
        "(工厂|车间|化工厂|炼油厂|工业区)",
        "(工場|コンビナート|製油所)",
        "(공장|정유소|산업단지)",
      ].join("|")
    ),
  },

  // Gas / pipeline concept
  {
    concept: "concept:gas",
    pattern: compilePattern(
      [
        "\\b(gas\\s+leak|gas\\s+pipeline|gas\\s+explosion)\\b",
        "\\b(fuite\\s+de\\s+gaz|gazoduc|explosion\\s+de\\s+gaz)\\b",
        "\\b(fuga\\s+de\\s+gas|gasoducto)\\b",
        "\\b(gasleck|gaspipeline|gasexplosion)\\b",
        "\\b(fuga\\s+di\\s+gas|gasdotto)\\b",
        "\\b(утечк[аи]\\s+газа|газопровод|взрыв\\s+бытового\\s+газа)\\b",
        "\\b(витік\\s+газу|газопровід)\\b",
        "(تسرب\\s+غاز|خط\\s+انابيب\\s+الغاز)",
        "(نشت\\s+گاز|خط\\s+لوله\\s+گاز)",
        "\\b(gaz\\s+kacagi|dogalgaz\\s+borusu)\\b",
        "(דליפת\\s+גז|צינור\\s+גז)",
        "(燃气泄漏|瓦斯爆炸|天然气管道)",
        "(ガス漏れ|ガス爆発)",
        "(가스\\s*누출|가스\\s*폭발)",
      ].join("|")
    ),
  },
];

/**
 * Classifies signal text into a SignalKind deterministically.
 */
export function classifySignalText(text: string): SignalKind {
  const cleaned = cleanUnicode(text);
  if (!cleaned) return "other";

  for (const def of CATEGORY_DEFINITIONS) {
    for (const pat of def.patterns) {
      if (pat.test(cleaned)) {
        return def.kind;
      }
    }
  }

  // Check if it matches missile patterns (maps to explosion kind)
  const missileDef = CONCEPT_PATTERNS.find((c) => c.concept === "concept:missile");
  if (missileDef && missileDef.pattern.test(cleaned)) {
    return "explosion";
  }

  return "other";
}

/**
 * Extracts semantic concept tokens from text across languages.
 */
export function extractConcepts(text: string): string[] {
  const cleaned = cleanUnicode(text);
  if (!cleaned) return [];

  const concepts: string[] = [];

  for (const def of CATEGORY_DEFINITIONS) {
    for (const pat of def.patterns) {
      if (pat.test(cleaned)) {
        concepts.push(...def.concepts);
        break;
      }
    }
  }

  for (const { concept, pattern } of CONCEPT_PATTERNS) {
    if (pattern.test(cleaned)) {
      concepts.push(concept);
    }
  }

  return [...new Set(concepts)];
}
