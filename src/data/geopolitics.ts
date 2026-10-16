export interface CountryGeopolitics {
  country: string;
  iso: string;
  regime: {
    type: 'democracy' | 'authoritarian' | 'dictatorship' | 'junta' | 'hybrid' | 'theocracy' | 'civil_war';
    labelFr: string;
    labelEn: string;
    leader: string;
    freedomScore: string; // e.g. "1.9/10 (Non libre)" or "8.2/10 (Démocratie pleine)"
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

export const GEOPOLITICS_DATABASE: Record<string, CountryGeopolitics> = {
  "Ukraine": {
    country: "Ukraine",
    iso: "UKR",
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
    regime: {
      type: "democracy",
      labelFr: "Démocratie parlementaire sous état de guerre",
      labelEn: "Parliamentary democracy in state of war",
      leader: "Benyamin Netanyahou",
      freedomScore: "7.8/10 (Démocratie sous fortes tensions)",
    },
    economy: {
      gdpNominal: "520 Mds $",
      inflation: "3.2%",
      strategicResourcesFr: ["Haute technologie / Cyberdéfense", "Gaz offshore (Leviathan)", "Armement de pointe"],
      strategicResourcesEn: ["High-tech / Cyber defense", "Offshore natural gas (Leviathan)", "Advanced defense systems"],
      sanctionsFr: "Aucune sanction formelle (pressions diplomatiques croissantes)",
      sanctionsEn: "No formal sanctions (increasing diplomatic friction)",
      alliances: ["Accords d'Abraham", "Allié majeur hors-OTAN des USA"],
    },
    geopolitics: {
      summaryFr: "Opérations militaires intenses multi-fronts (bande de Gaza contre le Hamas, frontière libanaise contre le Hezbollah, ripostes contre les Houthis et l'Iran).",
      summaryEn: "Intense multi-front military campaign (Gaza against Hamas, northern border against Hezbollah, retaliatory exchanges with Houthis and Iran).",
      driversFr: ["Éradication des structures armées du Hamas", "Neutralisation des roquettes du Hezbollah", "Défense aérienne multicouches (Iron Dome, Arrow)", "Crise humanitaire régionale aiguë"],
      driversEn: ["Eradication of Hamas military apparatus", "Neutralization of Hezbollah rocket arsenal", "Multi-tier missile defense (Iron Dome, Arrow)", "Severe regional humanitarian crisis"],
    },
  },
  "Palestine": {
    country: "Palestine",
    iso: "PSE",
    regime: {
      type: "civil_war",
      labelFr: "Territoires occupés / Gouvernance fragmentée (Hamas / Autorité Palestinienne)",
      labelEn: "Occupied territories / Fragmented governance (Hamas / Palestinian Authority)",
      leader: "Mahmoud Abbas (Cisjordanie) / Commandement Hamas (Gaza)",
      freedomScore: "1.5/10 (Non libre / Zone de guerre totale)",
    },
    economy: {
      gdpNominal: "18 Mds $ (effondrement à Gaza)",
      inflation: "Incalculable (> 50%)",
      strategicResourcesFr: ["Main-d'œuvre", "Agriculture locale", "Aide humanitaire internationale"],
      strategicResourcesEn: ["Human capital", "Local horticulture", "International humanitarian relief"],
      sanctionsFr: "Hamas désigné organisation terroriste internationale",
      sanctionsEn: "Hamas designated terrorist group by US, EU, and allies",
      alliances: ["Soutien diplomatique Ligue Arabe", "Financement & armes de l'Axe de la Résistance (Iran)"],
    },
    geopolitics: {
      summaryFr: "Destruction quasi-totale des infrastructures à Gaza suite aux opérations de riposte israéliennes post-7 octobre. Crise humanitaire, famine et déplacements forcés massifs.",
      summaryEn: "Near-total destruction of civilian infrastructure in Gaza following Israeli military response after October 7th attacks. Massive displacement, extreme humanitarian catastrophe.",
      driversFr: ["Guerre urbaine et bombardements aériens", "Blocus des frontières et de l'aide humanitaire", "Tensions et incursions militaires en Cisjordanie", "Absence d'horizon politique à deux États"],
      driversEn: ["Urban combat and heavy aerial bombardment", "Border blockade & restricted humanitarian aid", "Escalating raids in West Bank", "Absence of viable two-state peace horizon"],
    },
  },
  "Sudan": {
    country: "Soudan",
    iso: "SDN",
    regime: {
      type: "civil_war",
      labelFr: "Guerre civile entre juntes militaires (SAF vs RSF)",
      labelEn: "Civil war between rival military factions (SAF vs RSF)",
      leader: "Gen. Abdel Fattah al-Burhan (SAF) vs Gen. Hemedti (RSF)",
      freedomScore: "1.0/10 (État failli / Zone de conflit absolu)",
    },
    economy: {
      gdpNominal: "32 Mds $ (en contraction libre)",
      inflation: "180%",
      strategicResourcesFr: ["Or", "Pétrole brut", "Gomme arabique", "Cheptel"],
      strategicResourcesEn: ["Gold", "Crude oil", "Gum arabic", "Livestock"],
      sanctionsFr: "Sanctions ciblées USA/ONU contre les commandants des deux factions",
      sanctionsEn: "Targeted US & UN sanctions on generals and front companies",
      alliances: ["SAF soutenue par l'Égypte/Iran", "RSF soutenues par les réseaux d'or et influences du Golfe"],
    },
    geopolitics: {
      summaryFr: "La pire crise de déplacement et de famine de la planète. Affrontements brutaux entre l'armée régulière et les forces paramilitaires de soutien rapide (RSF) à Khartoum et au Darfour.",
      summaryEn: "World's largest displacement and starvation emergency. Brutal warfare between Sudanese Armed Forces and Rapid Support Forces paramilitary across Khartoum and Darfur.",
      driversFr: ["Nettoyage ethnique au Darfour", "Destruction des hôpitaux et réseaux d'eau", "Pillage systématique des mines d'or", "Guerre par procuration des puissances régionales"],
      driversEn: ["Ethnic cleansing and atrocities in Darfur", "Destruction of healthcare and water grids", "Systematic looting of gold resources", "Regional proxy interference"],
    },
  },
  "Yemen": {
    country: "Yémen",
    iso: "YEM",
    regime: {
      type: "civil_war",
      labelFr: "Gouvernement fragmenté / Insurrection houthie théocratique",
      labelEn: "Fragmented government / Theocratic Houthi insurgency",
      leader: "Abdul-Malik al-Houthi (Nord) / Rashad al-Alimi (Conseil présidentiel)",
      freedomScore: "1.2/10 (Non libre / État failli)",
    },
    economy: {
      gdpNominal: "21 Mds $",
      inflation: "45%",
      strategicResourcesFr: ["Détroit de Bab-el-Mandeb (route maritime)", "Pétrole modeste"],
      strategicResourcesEn: ["Bab-el-Mandeb strait (chokepoint)", "Modest oil reserves"],
      sanctionsFr: "Houthis inscrits sur la liste des organisations terroristes par Washington",
      sanctionsEn: "Houthis designated Specially Designated Global Terrorists by US",
      alliances: ["Axe de la Résistance (Iran)", "Conseil présidentiel soutenu par l'Arabie Saoudite & EAU"],
    },
    geopolitics: {
      summaryFr: "Les rebelles houthis perturbent le commerce maritime mondial en mer Rouge par des attaques de drones et missiles balistiques, provoquant des frappes de représailles de la coalition occidentale.",
      summaryEn: "Houthi movement disrupts global commercial maritime trade in the Red Sea using anti-ship ballistic missiles and suicide drones, triggering Western coalition strikes.",
      driversFr: ["Attaques régulières de cargos en mer Rouge", "Frappes ciblées USA / UK sur les arsenaux houthis", "Blocus économique et précarité extrême de la population", "Livraisons de missiles iraniens avancés"],
      driversEn: ["Anti-ship ballistic attacks in Red Sea", "US/UK coalition retaliatory airstrikes", "Severe economic impoverishment", "Iranian advanced weaponry supply chains"],
    },
  },
  "Syria": {
    country: "Syrie",
    iso: "SYR",
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
  "Myanmar": {
    country: "Birmanie (Myanmar)",
    iso: "MMR",
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
  "Lebanon": {
    country: "Liban",
    iso: "LBN",
    regime: {
      type: "hybrid",
      labelFr: "Régime confessionnel en vacance de pouvoir institutionnel",
      labelEn: "Confessional system / Severe constitutional deadlock",
      leader: "Najib Mikati (Gouvernement démissionnaire)",
      freedomScore: "4.2/10 (Régime hybride paralysé)",
    },
    economy: {
      gdpNominal: "20 Mds $ (effondrement bancaire)",
      inflation: "70%",
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
  "Iran": {
    country: "Iran",
    iso: "IRN",
    regime: {
      type: "theocracy",
      labelFr: "Théocratie islamique autoritaire",
      labelEn: "Authoritarian Islamic Theocracy",
      leader: "Ali Khamenei (Guide Suprême) / Masoud Pezeshkian",
      freedomScore: "1.4/10 (Répression systématique)",
    },
    economy: {
      gdpNominal: "410 Mds $",
      inflation: "42%",
      strategicResourcesFr: ["Pétrole brut (exporté via 'flotte fantôme')", "Gaz naturel", "Détroit d'Ormuz", "Drones Shahed"],
      strategicResourcesEn: ["Crude oil ('dark fleet' exports)", "Natural gas", "Strait of Hormuz chokepoint", "Shahed drones"],
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
};

export function getCountryGeopolitics(nameOrIso: string): CountryGeopolitics {
  if (!nameOrIso) return getGenericFallback("Inconnu", "UNK");

  const clean = nameOrIso.trim();
  // Recherche directe
  if (GEOPOLITICS_DATABASE[clean]) {
    return GEOPOLITICS_DATABASE[clean];
  }

  // Recherche par sous-chaîne ou ISO
  const entry = Object.values(GEOPOLITICS_DATABASE).find(
    (g) =>
      g.country.toLowerCase() === clean.toLowerCase() ||
      g.iso.toLowerCase() === clean.toLowerCase() ||
      clean.toLowerCase().includes(g.country.toLowerCase())
  );

  if (entry) return entry;

  return getGenericFallback(clean, clean.slice(0, 3).toUpperCase());
}

function getGenericFallback(country: string, iso: string): CountryGeopolitics {
  return {
    country,
    iso,
    regime: {
      type: "hybrid",
      labelFr: "Souveraineté nationale / Statut en cours d'évaluation",
      labelEn: "National sovereignty / Status under assessment",
      leader: "Chef d'État / Gouvernement en exercice",
      freedomScore: "Données OSINT en cours d'indexation",
    },
    economy: {
      gdpNominal: "Donnée régionale",
      inflation: "Taux variable",
      strategicResourcesFr: ["Ressources locales", "Marchés régionaux"],
      strategicResourcesEn: ["Domestic resources", "Regional trade"],
      sanctionsFr: "Statut commercial standard",
      sanctionsEn: "Standard trade status",
      alliances: ["ONU", "Organisations régionales"],
    },
    geopolitics: {
      summaryFr: `Territoire souverain indexé dans le système ORBITAL. Les indicateurs géopolitiques détaillés sont synthétisés à partir des flux de renseignement ouverts (OSINT).`,
      summaryEn: `Sovereign territory tracked in the ORBITAL system. Detailed geopolitical indicators are synthesized from open source intelligence streams (OSINT).`,
      driversFr: ["Stabilité institutionnelle", "Sécurité frontalière", "Développement économique"],
      driversEn: ["Institutional stability", "Border security", "Economic development"],
    },
  };
}
