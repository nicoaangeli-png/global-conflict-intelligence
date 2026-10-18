import { normalizeCountryName, resolveCountryIdentity } from "@/lib/geo/country";

export interface CountryGeopolitics {
  country: string;
  iso: string;
  provenance: { kind: "static-unverified" | "unavailable"; source: null; asOf: null };
  demographics: {
    population: string;
    populationNumeric: number | null;
    density: string;
    capital: string;
  };
  military: {
    activeArmedForces: string;
    reservePersonnel: string;
    defenseBudget: string;
    nuclearStatusFr: string;
    nuclearStatusEn: string;
    defensePacts: string[];
    pentagonAlertFr: string;
    pentagonAlertEn: string;
  };
  regime: {
    type: 'unknown' | 'democracy' | 'authoritarian' | 'dictatorship' | 'junta' | 'hybrid' | 'theocracy' | 'civil_war';
    labelFr: string;
    labelEn: string;
    leader: string;
    freedomScore: string;
  };
  economy: {
    gdpNominal: string;
    inflation: string;
    strategicResourcesFr: string[];
    strategicResourcesEn: string[];
    sanctionsFr: string;
    sanctionsEn: string;
    alliances: string[];
  };
  geopolitics: {
    summaryFr: string;
    summaryEn: string;
    driversFr: string[];
    driversEn: string[];
  };
}

const STATIC_PROFILES: Record<string, Omit<CountryGeopolitics, "provenance">> = {
  "Ukraine": {
    country: "Ukraine",
    iso: "UKR",
    demographics: {
      population: "38,0 M hab.",
      populationNumeric: 38000000,
      density: "63 hab./km²",
      capital: "Kyiv (2,95 M)",
    },
    military: {
      activeArmedForces: "880 000 actifs",
      reservePersonnel: "1 200 000 réservistes",
      defenseBudget: "40,0 Mds $ (33% PIB)",
      nuclearStatusFr: "Non-nucléaire (mémorandum de Budapest)",
      nuclearStatusEn: "Non-nuclear (Budapest Memo signatory)",
      defensePacts: ["Accords bilatéraux de sécurité occidentaux", "Partenariat stratégique OTAN"],
      pentagonAlertFr: "ORBITAL 2 · Théâtre de haute intensité",
      pentagonAlertEn: "ORBITAL 2 · Active high-intensity conflict zone",
    },
    regime: {
      type: "democracy",
      labelFr: "Démocratie constitutionnelle sous loi martiale",
      labelEn: "Constitutional democracy under martial law",
      leader: "Volodymyr Zelensky",
      freedomScore: "6.1/10 (Régime hybride en guerre)",
    },
    economy: {
      gdpNominal: "180 Mds $",
      inflation: "9.8%",
      strategicResourcesFr: ["Céréales (blé/maïs)", "Minerai de fer", "Titane", "Terres arables fertiles"],
      strategicResourcesEn: ["Grains (wheat/corn)", "Iron ore", "Titanium", "Fertile arable land"],
      sanctionsFr: "Bénéficiaire d'aides massives occidentales",
      sanctionsEn: "Recipient of massive Western financial & defense aid",
      alliances: ["Candidat UE", "Partenariat stratégique OTAN"],
    },
    geopolitics: {
      summaryFr: "En guerre d'usure et de survie nationale contre l'invasion de la Fédération de Russie depuis 2022. Défense de son intégrité territoriale (Donbass, Crimée, Zaporijjia).",
      summaryEn: "Engaged in war of attrition and national survival against Russia's full-scale invasion since 2022. Defending territorial sovereignty across Donbas, Crimea, Zaporizhzhia.",
      driversFr: ["Guerre frontale de haute intensité", "Frappes sur infrastructures énergétiques", "Revendications territoriales russes", "Soutien logistique occidental"],
      driversEn: ["High-intensity industrial warfare", "Strikes on energy infrastructure", "Russian territorial expansionism", "Western military logistics & funding"],
    },
  },

  "Russia": {
    country: "Russie",
    iso: "RUS",
    demographics: {
      population: "144,2 M hab.",
      populationNumeric: 144200000,
      density: "8,5 hab./km²",
      capital: "Moscou (13,1 M)",
    },
    military: {
      activeArmedForces: "1 320 000 actifs",
      reservePersonnel: "2 000 000 réservistes",
      defenseBudget: "142 Mds $ (7,1% PIB)",
      nuclearStatusFr: "Puissance nucléaire majeure (~5 580 ogives)",
      nuclearStatusEn: "Major nuclear power (~5,580 warheads)",
      defensePacts: ["OTSC (Organisation du Traité de Sécurité Collective)", "Traité de défense mutuelle avec RPDC"],
      pentagonAlertFr: "ORBITAL 2 · Adversaire stratégique nucléaire",
      pentagonAlertEn: "ORBITAL 2 · Tier-1 Strategic Nuclear Adversary",
    },
    regime: {
      type: "dictatorship",
      labelFr: "Régime autocratique / Dictature personnaliste",
      labelEn: "Personalist autocracy / Hard authoritarian regime",
      leader: "Vladimir Poutine",
      freedomScore: "2.1/10 (Régime autoritaire non libre)",
    },
    economy: {
      gdpNominal: "2 050 Mds $",
      inflation: "8.4%",
      strategicResourcesFr: ["Gaz naturel", "Pétrole brut", "Nickel", "Blé", "Nucléaire civil & militaire"],
      strategicResourcesEn: ["Natural gas", "Crude oil", "Nickel", "Wheat", "Civil & military nuclear tech"],
      sanctionsFr: "Sous embargo sévère (UE, USA, G7, exclusion SWIFT)",
      sanctionsEn: "Under severe sanctions (EU, US, G7 export controls, SWIFT ban)",
      alliances: ["BRICS+", "OTSC", "Partenariat stratégique sans limites avec la Chine", "Axe avec l'Iran et la Corée du Nord"],
    },
    geopolitics: {
      summaryFr: "Puissance nucléaire révisionniste menant une guerre d'annexion en Ukraine, cherchant à déstabiliser l'architecture de sécurité européenne et l'hégémonie occidentale.",
      summaryEn: "Revisionist nuclear power waging conquest war in Ukraine, actively disrupting European security architecture and Western-led international order.",
      driversFr: ["Économie de guerre militarisée", "Mobilisation forcée & mercenariat", "Cyber-guerre & désinformation globale", "Dépendance commerciale accrue envers Pékin"],
      driversEn: ["Militarized war economy", "Forced conscription & asymmetric proxy forces", "Global cyber warfare & disinformation", "Growing trade dependency on Beijing"],
    },
  },

  "Israel": {
    country: "Israël",
    iso: "ISR",
    demographics: {
      population: "9,8 M hab.",
      populationNumeric: 9800000,
      density: "420 hab./km²",
      capital: "Jérusalem (980k) / Tel Aviv (460k)",
    },
    military: {
      activeArmedForces: "170 000 actifs",
      reservePersonnel: "465 000 réservistes mobilisables",
      defenseBudget: "30,5 Mds $ (5,3% PIB)",
      nuclearStatusFr: "Puissance nucléaire non déclarée (~90 ogives)",
      nuclearStatusEn: "Undeclared nuclear state (~90 warheads)",
      defensePacts: ["Allié majeur hors-OTAN des USA (MNNA)", "Accords d'Abraham"],
      pentagonAlertFr: "ORBITAL 2 · Conflit actif multi-fronts",
      pentagonAlertEn: "ORBITAL 2 · Multi-front active theater",
    },
    regime: {
      type: "democracy",
      labelFr: "Démocratie parlementaire sous état de guerre",
      labelEn: "Parliamentary democracy in state of war",
      leader: "Benyamin Netanyahou",
      freedomScore: "7.8/10 (Démocratie sous fortes tensions)",
    },
    economy: {
      gdpNominal: "510 Mds $",
      inflation: "3.2%",
      strategicResourcesFr: ["Cyberdéfense de pointe", "Dôme de Fer & Arrow 3", "Haute technologie", "Gaz offshore (Leviathan)"],
      strategicResourcesEn: ["Cutting-edge cybersecurity", "Iron Dome & Arrow 3 missile defense", "High-tech", "Leviathan gas field"],
      sanctionsFr: "Aucune (soutien militaire inconditionnel américain)",
      sanctionsEn: "None (US strategic military assistance umbrella)",
      alliances: ["Partenariat stratégique central avec les États-Unis"],
    },
    geopolitics: {
      summaryFr: "Opérations de haute intensité sur 7 fronts simultanés : bande de Gaza, frontière libanaise (Hezbollah), ripostes contre les Houthis au Yémen et frappes directes sur l'Iran.",
      summaryEn: "Conducting simultaneous military campaigns across 7 operational vectors: Gaza, southern Lebanon, Yemeni Houthi infrastructure, and direct exchanges with Iran.",
      driversFr: ["Neutralisation du Hamas", "Élimination des capacités balistiques du Hezbollah", "Endiguement de l'Axe de la Résistance iranien", "Pressions diplomatiques sur les otages"],
      driversEn: ["Destruction of Hamas military wings", "Rollback of Hezbollah missile stockpiles", "Containment of Iranian regional proxy network", "Domestic and hostage crisis strain"],
    },
  },

  "Palestine": {
    country: "Palestine",
    iso: "PSE",
    demographics: {
      population: "5,4 M hab. (Gaza: 2,1M · Cisjordanie: 3,3M)",
      populationNumeric: 5400000,
      density: "5 500 hab./km² (Gaza)",
      capital: "Ramallah (siège AP) / Gaza",
    },
    military: {
      activeArmedForces: "35 000 miliciens / forces sécurité AP",
      reservePersonnel: "Non applicable",
      defenseBudget: "< 1 Md $ (sources asymétriques)",
      nuclearStatusFr: "Non-nucléaire",
      nuclearStatusEn: "Non-nuclear",
      defensePacts: ["Soutien logistique et armement de l'Iran (Hamas/Jihad Islamique)"],
      pentagonAlertFr: "ORBITAL 1 · Zone de combat urbain dévastée",
      pentagonAlertEn: "ORBITAL 1 · Active devastated urban conflict zone",
    },
    regime: {
      type: "hybrid",
      labelFr: "Territoire occupé sous blocus / Autorité divisée",
      labelEn: "Occupied territory under siege / Divided leadership",
      leader: "Mahmoud Abbas (Cisjordanie) / Commandement militaire Hamas (Gaza)",
      freedomScore: "1.5/10 (Crise humanitaire extrême)",
    },
    economy: {
      gdpNominal: "18 Mds $ (effondrement à Gaza)",
      inflation: "> 120%",
      strategicResourcesFr: ["Main d'œuvre", "Ressources côtières de Gaza (inaccessibles)"],
      strategicResourcesEn: ["Labor force", "Offshore marine gas reserves (inaccessible)"],
      sanctionsFr: "Blocus israélien hermétique sur Gaza, gel des taxes douanières en Cisjordanie",
      sanctionsEn: "Comprehensive blockade of Gaza, withholding of clearance revenues",
      alliances: ["Ligue Arabe", "Axe de la Résistance (Hamas)"],
    },
    geopolitics: {
      summaryFr: "Dévastation totale des infrastructures à Gaza suite aux bombardements israéliens et combats urbains. Tensions extrêmes et raids quotidiens en Cisjordanie.",
      summaryEn: "Catastrophic infrastructure destruction across Gaza resulting from military siege. Escalating clashes and raids across the West Bank.",
      driversFr: ["Crise humanitaire absolue et famine", "Destruction des tunnels et stocks de roquettes", "Expansion des colonies en Cisjordanie", "Impasse totale du processus à deux États"],
      driversEn: ["Acute humanitarian catastrophe", "Subterranean tunnel clearance", "West Bank settler violence", "Collapse of two-state diplomatic framework"],
    },
  },

  "United States": {
    country: "États-Unis",
    iso: "USA",
    demographics: {
      population: "336,5 M hab.",
      populationNumeric: 336500000,
      density: "37 hab./km²",
      capital: "Washington, D.C. (710k / 6,3 M aire)",
    },
    military: {
      activeArmedForces: "1 390 000 actifs",
      reservePersonnel: "840 000 réservistes",
      defenseBudget: "886 Mds $ (3,4% PIB)",
      nuclearStatusFr: "Superpuissance nucléaire (~5 244 ogives)",
      nuclearStatusEn: "Nuclear superpower (~5,244 warheads)",
      defensePacts: ["OTAN (Article 5)", "AUKUS", "Traité ANZUS", "Pactes de défense mutuelle (Japon, Corée du Sud, Philippines)"],
      pentagonAlertFr: "Commandement mondial · Vigilance maximale",
      pentagonAlertEn: "Global Combatant Command · Elevated Readiness",
    },
    regime: {
      type: "democracy",
      labelFr: "République constitutionnelle fédérale présidentielle",
      labelEn: "Federal presidential constitutional republic",
      leader: "Commandant en chef des forces armées US",
      freedomScore: "8.3/10 (Démocratie établie)",
    },
    economy: {
      gdpNominal: "27 360 Mds $",
      inflation: "2.8%",
      strategicResourcesFr: ["Dollar (monnaie de réserve)", "Pétrole de schiste (1er producteur mondial)", "Semi-conducteurs de pointe", "Hégémonie technologique"],
      strategicResourcesEn: ["US Dollar reserve currency", "Shale oil & LNG (world leader)", "Advanced chips", "Tech supremacy"],
      sanctionsFr: "Émetteur primaire du régime mondial de sanctions",
      sanctionsEn: "Primary enforcer of global financial sanctions",
      alliances: ["OTAN", "G7", "AUKUS", "Five Eyes", "Quad"],
    },
    geopolitics: {
      summaryFr: "Première puissance militaire et économique mondiale. Fournisseur clé de renseignements et d'armements aux alliés (Ukraine, Israël, Taïwan) et garant des routes maritimes globales.",
      summaryEn: "World's foremost military superpower. Primary security guarantor and intelligence provider to allies (Ukraine, Israel, Taiwan) maintaining global maritime freedom of navigation.",
      driversFr: ["Dissuasion stratégique face à l'axe Chine-Russie-Iran-RPDC", "Sécurisation de l'Indo-Pacifique et détroit de Taïwan", "Commandement interarmées mondial (CENTCOM, EUCOM, INDOPACOM)", "Pivot technologique vers les drones et l'IA militaire"],
      driversEn: ["Strategic deterrence against Beijing-Moscow axis", "Indo-Pacific sea lane defense", "Unified Combatant Commands (CENTCOM, EUCOM)", "Next-gen autonomous and hypersonic weapons race"],
    },
  },

  "China": {
    country: "Chine",
    iso: "CHN",
    demographics: {
      population: "1 411 M hab.",
      populationNumeric: 1411000000,
      density: "150 hab./km²",
      capital: "Pékin (21,5 M)",
    },
    military: {
      activeArmedForces: "2 035 000 actifs (APL)",
      reservePersonnel: "510 000 réservistes",
      defenseBudget: "296 Mds $ (1,7% PIB officiel / ~400 Mds $ réel)",
      nuclearStatusFr: "Puissance nucléaire en forte expansion (~500 ogives, objectif 1000+)",
      nuclearStatusEn: "Rapidly expanding nuclear arsenal (~500 warheads, targeting 1,000+)",
      defensePacts: ["Traité d'amitié et de coopération avec la RPDC", "Partenariat stratégique global avec la Russie"],
      pentagonAlertFr: "ORBITAL 3 · Concurrent stratégique de premier rang",
      pentagonAlertEn: "ORBITAL 3 · Primary pacing challenge for US Armed Forces",
    },
    regime: {
      type: "dictatorship",
      labelFr: "Régime communiste à parti unique / Autoritarisme numérique",
      labelEn: "One-party authoritarian state / Digital surveillance autocracy",
      leader: "Xi Jinping (Secrétaire Général du PCC)",
      freedomScore: "1.0/10 (Répression totale)",
    },
    economy: {
      gdpNominal: "18 560 Mds $",
      inflation: "0.4%",
      strategicResourcesFr: ["Terres rares (70% du raffinage mondial)", "Capacité manufacturière industrielle", "Batteries & véhicules électriques", "Composants solaires"],
      strategicResourcesEn: ["Rare earth minerals processing (70% global)", "Massive industrial manufacturing base", "EVs and battery supply chains", "Green tech"],
      sanctionsFr: "Restrictions américaines sur les puces avancées (GPU, lithographie EUV)",
      sanctionsEn: "US export controls on high-end semiconductors & EUV lithography equipment",
      alliances: ["BRICS+", "OCS (Organisation de Coopération de Shanghai)", "Nouvelles Routes de la Soie (BRI)"],
    },
    geopolitics: {
      summaryFr: "Rivalité systémique avec les États-Unis. Modernisation navale ultra-rapide (flotte supérieure en nombre), militarisation de la mer de Chine méridionale et pression militaire constante sur Taïwan.",
      summaryEn: "Systemic rivalry with the US. Historic naval expansion (largest battle fleet by hull count), South China Sea militarization, and blockade rehearsals encircling Taiwan.",
      driversFr: ["Objectif de réunification de Taïwan", "Guerre technologique sur l'IA et les semi-conducteurs", "Expansion de l'influence dans le Sud global via les BRICS", "Renforcement de la triade nucléaire et armes hypersoniques"],
      driversEn: ["Taiwan cross-strait reunification push", "Advanced semiconductor decoupling", "Global South leverage through BRICS+", "Hypersonic missile arsenal deployment"],
    },
  },

  "Taiwan": {
    country: "Taïwan",
    iso: "TWN",
    demographics: {
      population: "23,9 M hab.",
      populationNumeric: 23900000,
      density: "650 hab./km²",
      capital: "Taipei (2,6 M / 7,1 M métropole)",
    },
    military: {
      activeArmedForces: "170 000 actifs",
      reservePersonnel: "1 660 000 réservistes",
      defenseBudget: "19,0 Mds $ (2,5% PIB)",
      nuclearStatusFr: "Non-nucléaire (parapluie stratégique US implicite)",
      nuclearStatusEn: "Non-nuclear (implicit US strategic ambiguity)",
      defensePacts: ["Taiwan Relations Act (engagement d'armement par les USA)"],
      pentagonAlertFr: "ORBITAL 2 · Risque de blocus naval et frappes missiles",
      pentagonAlertEn: "ORBITAL 2 · Elevated risk of naval blockade & cross-strait invasion",
    },
    regime: {
      type: "democracy",
      labelFr: "Démocratie pluraliste avancée",
      labelEn: "Advanced multi-party constitutional democracy",
      leader: "Lai Ching-te",
      freedomScore: "9.4/10 (Démocratie pleine et dynamique)",
    },
    economy: {
      gdpNominal: "790 Mds $",
      inflation: "2.1%",
      strategicResourcesFr: ["Fonderies TSMC (60% des puces mondiales, 90% des puces avancées)", "Électronique critique", "Position insulaire clé"],
      strategicResourcesEn: ["TSMC silicon foundries (60% global chips, 90% sub-5nm chips)", "Critical hardware supply chains", "First island chain geometry"],
      sanctionsFr: "Aucune (pression diplomatique et isolement par Pékin)",
      sanctionsEn: "None (subject to Beijing economic coercion & diplomatic isolation)",
      alliances: ["Partenariat de sécurité officieux avec les USA, le Japon et les démocraties occidentales"],
    },
    geopolitics: {
      summaryFr: "Point chaud géostratégique le plus critique de la planète. Cible de manœuvres militaires d'encerclement quotidiennes par l'APL chinoise et de cyber-attaques massives.",
      summaryEn: "World's most critical geostrategic flashpoint. Under constant encirclement drills, air defense incursions, and cyber bombardment by Beijing.",
      driversFr: ["Stratégie du porc-épic (asymétrique)", "Vulnérabilité maritime en cas de blocus", "Statut irremplaçable dans la chaîne de valeur des puces IA", "Renforcement des conscriptions à 1 an"],
      driversEn: ["Porcupine asymmetric defense posture", "Maritime chokepoint vulnerability", "Unmatched semiconductor leverage", "Conscription extension to 12 months"],
    },
  },

  "Iran": {
    country: "Iran",
    iso: "IRN",
    demographics: {
      population: "88,5 M hab.",
      populationNumeric: 88500000,
      density: "54 hab./km²",
      capital: "Téhéran (9,4 M / 15 M aire)",
    },
    military: {
      activeArmedForces: "610 000 actifs (dont 190 000 Pasdaran / CGRI)",
      reservePersonnel: "350 000 réservistes + milice Bassidj",
      defenseBudget: "10,5 Mds $ (officiel / >20 Mds $ avec réseaux CGRI)",
      nuclearStatusFr: "Seuil nucléaire critique (uranium enrichi à 60%+, capacité sous 2 semaines)",
      nuclearStatusEn: "Nuclear breakout state (60%+ enriched uranium, breakout within weeks)",
      defensePacts: ["Axe de la Résistance (Hezbollah, Houthis, milices irakiennes)", "Pacte militaire renforcé avec la Russie"],
      pentagonAlertFr: "ORBITAL 2 · Menace balistique et nucléaire imminente",
      pentagonAlertEn: "ORBITAL 2 · Elevated ballistic strike and nuclear threshold alert",
    },
    regime: {
      type: "theocracy",
      labelFr: "Théocratie islamique autoritaire (Velayat-e Faqih)",
      labelEn: "Authoritarian Islamic Theocracy",
      leader: "Ali Khamenei (Guide Suprême) / Masoud Pezeshkian",
      freedomScore: "1.4/10 (Répression systématique)",
    },
    economy: {
      gdpNominal: "410 Mds $",
      inflation: "42%",
      strategicResourcesFr: ["Pétrole brut (exporté via 'flotte fantôme')", "Gaz naturel", "Détroit d'Ormuz", "Drones Shahed-136", "Missiles balistiques Kheibar"],
      strategicResourcesEn: ["Crude oil ('dark fleet' exports)", "Natural gas", "Strait of Hormuz chokepoint", "Shahed-136 drones", "Kheibar ballistic missiles"],
      sanctionsFr: "Sous régime draconien de sanctions (USA, UE - nucléaire & drones)",
      sanctionsEn: "Comprehensive Western sanctions on nuclear, ballistic & drone programs",
      alliances: ["BRICS+", "Axe de la Résistance", "Partenariat stratégique militaire avec la Russie"],
    },
    geopolitics: {
      summaryFr: "Pivot de la confrontation avec Israël et l'Occident. Fournisseur clé de drones d'attaque à la Russie et superviseur de l'Axe de la Résistance (Hezbollah, Houthis, milices irakiennes).",
      summaryEn: "Central node in Middle Eastern power confrontation with Israel and the US. Primary drone supplier to Russia and coordinator of the Axis of Resistance.",
      driversFr: ["Enrichissement d'uranium proche du seuil militaire (60%+)", "Risque d'escalade balistique directe avec Israël", "Contestation sociétale interne réprimée", "Alliances militaires renforcées avec Moscou et Pékin"],
      driversEn: ["Near-weapons grade uranium enrichment (60%+)", "Direct ballistic missile exchanges with Israel", "Domestic civic dissent and harsh crackdowns", "Expanding military alignment with Moscow"],
    },
  },

  "Lebanon": {
    country: "Liban",
    iso: "LBN",
    demographics: {
      population: "5,5 M hab.",
      populationNumeric: 5500000,
      density: "530 hab./km²",
      capital: "Beyrouth (2,4 M aire)",
    },
    military: {
      activeArmedForces: "75 000 soldats réguliers (FAL démunies) + 30 000 combattants Hezbollah",
      reservePersonnel: "Non chiffré",
      defenseBudget: "< 1 Md $",
      nuclearStatusFr: "Non-nucléaire",
      nuclearStatusEn: "Non-nuclear",
      defensePacts: ["Parrainage militaire et financier de l'Iran sur le Hezbollah"],
      pentagonAlertFr: "ORBITAL 2 · Théâtre de combat ouvert",
      pentagonAlertEn: "ORBITAL 2 · Active war theater",
    },
    regime: {
      type: "hybrid",
      labelFr: "Confessionnalisme politique paralysé / État failli",
      labelEn: "Paralyzed confessional system / Dual state controlled by Hezbollah",
      leader: "Gouvernement démissionnaire / Présidence vacante",
      freedomScore: "3.5/10 (Crise institutionnelle totale)",
    },
    economy: {
      gdpNominal: "21 Mds $",
      inflation: "190%",
      strategicResourcesFr: ["Secteur bancaire ruiné", "Diaspora financière", "Gaz offshore potentiel"],
      strategicResourcesEn: ["Collapsed banking sector", "Financial diaspora", "Offshore gas exploration"],
      sanctionsFr: "Sanctions américaines sur les entités liées au Hezbollah",
      sanctionsEn: "US Treasury sanctions against Hezbollah financial networks",
      alliances: ["Influence prépondérante du Hezbollah / Iran"],
    },
    geopolitics: {
      summaryFr: "Théâtre de guerre ouvert entre Israël et le Hezbollah. Frappes intenses sur le Sud-Liban, la plaine de la Bekaa et la banlieue sud de Beyrouth.",
      summaryEn: "Active war theater between Israel and Hezbollah. Heavy aerial bombardment across South Lebanon, Bekaa Valley, and southern Beirut suburbs.",
      driversFr: ["Destruction de la chaîne de commandement du Hezbollah", "Déplacement massif de plus d'un million de civils", "Incursions terrestres de Tsahal au Sud", "Faillite complète de l'État libanais"],
      driversEn: ["Targeting of Hezbollah senior commanders", "Displacement of over 1 million Lebanese civilians", "IDF ground maneuvers along the Blue Line", "Complete Lebanese sovereign vacuum"],
    },
  },

  "Sudan": {
    country: "Soudan",
    iso: "SDN",
    demographics: {
      population: "48,1 M hab.",
      populationNumeric: 48100000,
      density: "26 hab./km²",
      capital: "Khartoum (5,3 M)",
    },
    military: {
      activeArmedForces: "FAS (~100 000) vs FSR (~80 000 combattants paramilitaires)",
      reservePersonnel: "Milices tribales mobilisées",
      defenseBudget: "Donnée non consolidée (financement via mines d'or)",
      nuclearStatusFr: "Non-nucléaire",
      nuclearStatusEn: "Non-nuclear",
      defensePacts: ["Soutien émirati aux FSR (or/armes) vs soutien iranien/égyptien aux FAS"],
      pentagonAlertFr: "ORBITAL 2 · Plus grande catastrophe humanitaire au monde",
      pentagonAlertEn: "ORBITAL 2 · World's worst active humanitarian catastrophe",
    },
    regime: {
      type: "civil_war",
      labelFr: "Guerre civile totale / Factionnalisme militaire",
      labelEn: "All-out civil war / Dual junta warlord fragmentation",
      leader: "Gen. Abdel Fattah al-Burhan (FAS) vs Gen. Hemedti (FSR)",
      freedomScore: "0.8/10 (Catastrophe humanitaire absolue)",
    },
    economy: {
      gdpNominal: "32 Mds $",
      inflation: "260%",
      strategicResourcesFr: ["Or du Darfour (contrôlé par les FSR)", "Port-Soudan (accès mer Rouge)", "Agriculture du Nil"],
      strategicResourcesEn: ["Darfur artisanal gold mines", "Port Sudan red sea access", "Nile agricultural belt"],
      sanctionsFr: "Sanctions ciblées des USA et de l'ONU sur les chefs de guerre",
      sanctionsEn: "Targeted US and UN sanctions on military generals and gold smuggling networks",
      alliances: ["FAS: Égypte, Iran / FSR: Émirats Arabes Unis, réseaux Wagner/Africa Corps"],
    },
    geopolitics: {
      summaryFr: "Guerre fratricide dévastatrice opposant l'armée régulière (FAS) aux Forces de soutien rapide (FSR). Plus de 10 millions de déplacés internes et famine de masse déclarée au Darfour.",
      summaryEn: "Brutal war for supremacy between SAF regular army and RSF paramilitaries. Over 10 million internally displaced persons, triggering widespread famine across Darfour.",
      driversFr: ["Siège et massacres ethniques à El Fasher", "Bataille pour le contrôle de Khartoum", "Trafic clandestin d'or vers les marchés du Golfe", "Livraisons de drones iraniens Mohajer aux FAS"],
      driversEn: ["Ethnic atrocities and siege of El Fasher", "Urban warfare partitioning Khartoum", "Gold smuggling corridors fueling arms purchases", "Iranian Mohajer drone transfers to SAF"],
    },
  },

  "Myanmar": {
    country: "Birmanie (Myanmar)",
    iso: "MMR",
    demographics: {
      population: "54,2 M hab.",
      populationNumeric: 54200000,
      density: "83 hab./km²",
      capital: "Naypyidaw (1,1 M) / Rangoun (5,4 M)",
    },
    military: {
      activeArmedForces: "Tatmadaw (~150 000, en forte érosion) vs PDF/Rebelles (~100 000)",
      reservePersonnel: "Conscription forcée imposée par la junte",
      defenseBudget: "3,2 Mds $",
      nuclearStatusFr: "Non-nucléaire",
      nuclearStatusEn: "Non-nuclear",
      defensePacts: ["Fourniture d'armements par la Russie et tolérance frontalière chinoise"],
      pentagonAlertFr: "ORBITAL 2 · Insurrection armée généralisée",
      pentagonAlertEn: "ORBITAL 2 · Country-wide armed revolution & territorial retreat",
    },
    regime: {
      type: "junta",
      labelFr: "Junte militaire putschiste (Conseil d'administration d'État)",
      labelEn: "Military Junta (State Administration Council)",
      leader: "Min Aung Hlaing",
      freedomScore: "1.2/10 (Répression totale)",
    },
    economy: {
      gdpNominal: "65 Mds $",
      inflation: "28%",
      strategicResourcesFr: ["Gaz naturel offshore", "Jade & pierres précieuses", "Terres rares", "Bois précieux de teck"],
      strategicResourcesEn: ["Offshore natural gas", "Jade & gemstones", "Heavy rare earths", "Teak timber"],
      sanctionsFr: "Sanctions financières et embargo sur les armes occidentales",
      sanctionsEn: "Severe Western sanctions on military conglomerates (MEC, MEHL)",
      alliances: ["Soutien d'armement par la Russie", "Relations économiques prudentes avec la Chine"],
    },
    geopolitics: {
      summaryFr: "Insurrection armée généralisée (Forces de défense populaire) et rébellions ethniques (Alliance des Trois Fraternités) infligeant de lourdes défaites territoriales à la junte.",
      summaryEn: "Widespread armed revolution by People's Defense Forces combined with ethnic rebel offensives causing historic territorial defeats for the ruling junta.",
      driversFr: ["Opération 1027 et pertes massives de bases militaires", "Bombardements aériens indiscriminés sur les villages", "Démantèlement des réseaux de cyber-escroquerie aux frontières", "Guerre asymétrique avec drones commerciaux"],
      driversEn: ["Operation 1027 rebel momentum", "Indiscriminate junta air raids on civilian zones", "Scam-center crackdowns along borders", "Commercial drone warfare innovation"],
    },
  },

  "Syria": {
    country: "Syrie",
    iso: "SYR",
    demographics: {
      population: "22,1 M hab.",
      populationNumeric: 22100000,
      density: "118 hab./km²",
      capital: "Damas (2,5 M)",
    },
    military: {
      activeArmedForces: "130 000 soldats loyalistes + bases russes et milices iraniennes",
      reservePersonnel: "Forces locales fragmentées",
      defenseBudget: "1,5 Md $",
      nuclearStatusFr: "Non-nucléaire (site d'Al-Kibar détruit en 2007)",
      nuclearStatusEn: "Non-nuclear (Al-Kibar reactor destroyed 2007)",
      defensePacts: ["Accords de défense militaire avec la Russie (Tartous/Hmeimim) et l'Iran"],
      pentagonAlertFr: "ORBITAL 2 · Zone de frappes aériennes quasi-quotidiennes",
      pentagonAlertEn: "ORBITAL 2 · Permanent airstrike & proxy clash corridor",
    },
    regime: {
      type: "dictatorship",
      labelFr: "Dictature autoritaire / Territoires morcelés",
      labelEn: "Authoritarian regime / Partitioned territorial control",
      leader: "Bachar al-Assad",
      freedomScore: "1.0/10 (Non libre)",
    },
    economy: {
      gdpNominal: "12 Mds $",
      inflation: "95%",
      strategicResourcesFr: ["Pétrole de l'Est", "Agriculture", "Position de transit géostratégique", "Captagon"],
      strategicResourcesEn: ["Eastern oil fields", "Agriculture", "Geostrategic transit corridor", "Captagon"],
      sanctionsFr: "Sanctions occidentales massives (Loi César américaine)",
      sanctionsEn: "Comprehensive US Caesar Act & EU sanctions",
      alliances: ["Axe Moscou - Téhéran - Hezbollah"],
    },
    geopolitics: {
      summaryFr: "Territoire fragmenté entre forces loyalistes pro-Assad, zones kurdes (FDS soutenues par Washington), enclaves pro-turques au Nord et poches djihadistes.",
      summaryEn: "Fragmented nation partitioned between Assad regime forces, Kurdish SDF backed by US, Turkish-controlled northern border zones, and Islamist pockets.",
      driversFr: ["Frappes aériennes israéliennes régulières sur cibles iraniennes", "Présence militaire russe (Tartous, Hmeimim)", "Contrebande industrielle de Captagon", "Instabilité économique critique"],
      driversEn: ["Frequent Israeli airstrikes targeting Iranian proxies", "Permanent Russian naval & airbases", "Captagon illicit narcotics trade", "Critical economic deterioration"],
    },
  },

  "Laos": {
    country: "Laos",
    iso: "LAO",
    demographics: {
      population: "7,5 M hab.",
      populationNumeric: 7500000,
      density: "32 hab./km²",
      capital: "Vientiane (825k)",
    },
    military: {
      activeArmedForces: "30 000 actifs",
      reservePersonnel: "100 000 miliciens régionaux",
      defenseBudget: "180 M $",
      nuclearStatusFr: "Non-nucléaire (Traité de Bangkok - ZOPFAN)",
      nuclearStatusEn: "Non-nuclear (Bangkok Treaty SEANWFZ signatory)",
      defensePacts: ["Traité d'amitié et de coopération avec le Viêt Nam", "Partenariat stratégique Chine-Laos"],
      pentagonAlertFr: "ORBITAL 4 · Surveillance de l'influence chinoise",
      pentagonAlertEn: "ORBITAL 4 · Baseline monitor / PRC belt-and-road leverage",
    },
    regime: {
      type: "dictatorship",
      labelFr: "République populaire démocratique à parti unique (PPRL)",
      labelEn: "Marxist-Leninist one-party state (LPRP)",
      leader: "Thongloun Sisoulith",
      freedomScore: "1.3/10 (Régime autoritaire)",
    },
    economy: {
      gdpNominal: "15,8 Mds $",
      inflation: "25%",
      strategicResourcesFr: ["Hydroélectricité (barrages du Mékong)", "Minerai de cuivre et d'or", "Ligne ferroviaire Boten-Vientiane"],
      strategicResourcesEn: ["Mekong hydropower export", "Copper & gold mining", "China-Laos high-speed railway corridor"],
      sanctionsFr: "Aucune sanction majeure (crise de la dette envers la Chine)",
      sanctionsEn: "None (severe sovereign debt distress to Chinese state banks)",
      alliances: ["ASEAN", "Partenariat privilégié Viêt Nam & Chine"],
    },
    geopolitics: {
      summaryFr: "État enclavé d'Asie du Sud-Est, étroitement dépendant de ses voisins vietnamiens et chinois. Positionné comme 'batterie de l'Asie' par ses barrages hydroélectriques sur le Mékong.",
      summaryEn: "Landlocked Southeast Asian nation strategically balanced between Vietnamese historical ties and dominant Chinese economic and infrastructure influence.",
      driversFr: ["Endettement critique envers Pékin", "Impact écologique des barrages sur le Mékong", "Réseaux transfrontaliers et zones économiques spéciales (Triangle d'Or)"],
      driversEn: ["High debt vulnerability to Beijing", "Mekong river hydrology and dam impacts", "Cross-border special economic zones in Golden Triangle"],
    },
  },
};

export const GEOPOLITICS_DATABASE: Record<string, CountryGeopolitics> = Object.fromEntries(
  Object.entries(STATIC_PROFILES).map(([name, profile]) => [name, {
    ...profile,
    provenance: { kind: "static-unverified", source: null, asOf: null },
    military: {
      ...profile.military,
      pentagonAlertFr: "Indice interne ORBITAL · Non officiel · Non vérifié · " + profile.military.pentagonAlertFr,
      pentagonAlertEn: "Internal ORBITAL index · Not official · Unverified · " + profile.military.pentagonAlertEn,
    },
  }]),
);

export function normalizeCountry(value: string): string {
  return normalizeCountryName(value);
}

const COUNTRY_ALIASES: Record<string, string> = {
  russie: "Russia", "russian federation": "Russia", "etats-unis": "United States",
  "united states of america": "United States", chine: "China", liban: "Lebanon",
  soudan: "Sudan", birmanie: "Myanmar", syrie: "Syria", "lao pdr": "Laos",
};

export function getCountryGeopolitics(nameOrIso?: string): CountryGeopolitics {
  const clean = nameOrIso?.trim() || "N/A";
  const normalized = normalizeCountry(clean);
  const identity = resolveCountryIdentity(clean);
  const alias = Object.entries(COUNTRY_ALIASES).find(([key]) => normalizeCountry(key) === normalized)?.[1];
  const entry = (alias ? GEOPOLITICS_DATABASE[alias] : undefined) ?? Object.entries(GEOPOLITICS_DATABASE).find(
    ([name, profile]) => profile.iso === identity?.iso3 || [name, profile.country, profile.iso].some((value) => normalizeCountry(value) === normalized),
  )?.[1];
  return entry ? hideUnverifiedAssertions(entry) : getGenericFallback(identity?.name ?? clean, identity?.iso3 ?? "N/A");
}

/** Keep the legacy snapshot in GEOPOLITICS_DATABASE, but never expose its unsourced claims as facts. */
function hideUnverifiedAssertions(profile: CountryGeopolitics): CountryGeopolitics {
  return {
    ...profile,
    demographics: { population: "N/A", populationNumeric: null, density: "N/A", capital: "N/A" },
    military: {
      activeArmedForces: "N/A", reservePersonnel: "N/A", defenseBudget: "N/A",
      nuclearStatusFr: "Inconnu", nuclearStatusEn: "Unknown", defensePacts: [],
      pentagonAlertFr: "Donnée historique non vérifiée",
      pentagonAlertEn: "Unverified historical data",
    },
    regime: { type: "unknown", labelFr: "Non vérifié", labelEn: "Unverified", leader: "N/A", freedomScore: "N/A" },
    economy: {
      gdpNominal: "N/A", inflation: "N/A", strategicResourcesFr: [], strategicResourcesEn: [],
      sanctionsFr: "Inconnu", sanctionsEn: "Unknown", alliances: [],
    },
    geopolitics: {
      summaryFr: "Assertions historiques conservées dans les données, mais non sourcées et non datées; elles ne sont pas présentées comme des faits.",
      summaryEn: "Historical claims are retained in the data, but are unsourced and undated; they are not presented as facts.",
      driversFr: [], driversEn: [],
    },
  };
}

function getGenericFallback(country: string, iso: string): CountryGeopolitics {
  return {
    country,
    iso,
    provenance: { kind: "unavailable", source: null, asOf: null },
    demographics: { population: "N/A", populationNumeric: null, density: "N/A", capital: "N/A" },
    military: {
      activeArmedForces: "N/A", reservePersonnel: "N/A", defenseBudget: "N/A",
      nuclearStatusFr: "Inconnu", nuclearStatusEn: "Unknown", defensePacts: [],
      pentagonAlertFr: "Indice interne ORBITAL : N/A · Non officiel",
      pentagonAlertEn: "Internal ORBITAL index: N/A · Not official",
    },
    regime: { type: "unknown", labelFr: "Inconnu", labelEn: "Unknown", leader: "N/A", freedomScore: "N/A" },
    economy: {
      gdpNominal: "N/A", inflation: "N/A", strategicResourcesFr: [], strategicResourcesEn: [],
      sanctionsFr: "Inconnu", sanctionsEn: "Unknown", alliances: [],
    },
    geopolitics: {
      summaryFr: "Aucune fiche documentée disponible. L’absence de données ne signifie pas l’absence de conflit.",
      summaryEn: "No documented profile available. Missing data does not mean there is no conflict.",
      driversFr: [], driversEn: [],
    },
  };
}
