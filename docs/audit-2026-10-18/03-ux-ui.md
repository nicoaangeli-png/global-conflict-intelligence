# Audit UX/UI & Schéma Directeur — ORBITAL Intelligence

> **Rôle :** Lead UX/UI Designer (systèmes d'information géopolitique, salles de crise & dashboards de renseignement).  
> **Périmètre :** Audit ergonomique, refonte de l'architecture de l'information et spécifications de l'expérience utilisateur.

---

## 1. Audit Heuristique (Nielsen & Bonnes Pratiques Dashboards de Crise)

| Réf. Problème & Capture | Sévérité | Constat & Impact Utilisateur | Solution Prescrite |
| :--- | :---: | :--- | :--- |
| **P0-1 : Double fiche pays & données contradictoires**<br>*(Screenshot propriétaire attachment-40632dcb)* | **P0** | Au clic sur la France, `CountryProfile` s'ouvre dans la colonne gauche tandis que `CountryCard` flotte au centre. L'une affiche *"Population N/A, Régime Inconnu, Nucléaire Inconnu"*, l'autre affiche *"68,7 M hab., PIB $3,36 T, Emmanuel Macron"*. Rupture critique de crédibilité. | **Sélection unifiée & Fiche unique :** Supprimer l'état local `chosenCountry` dans le panneau gauche. N'autoriser qu'un seul panneau latéral rétractable pour le pays sélectionné. Fusionner les sources (Wikidata + Banque Mondiale + AURA) avec hiérarchie stricte. |
| **P0-2 : Biais sémantique alarmiste (GDELT / FIRMS)**<br>*(Captures 0-home.png & 6-SOURCES_AUDIT.png)* | **P0** | "Foyers d'affrontements : 524" et "Incidents 24h : 5 719" affichés sans morts. ACLED n'étant pas configuré, 98% des données sont des dépêches de presse (GDELT) et des anomalies thermiques satellite (FIRMS). L'utilisateur croit à une 3e guerre mondiale. | **Distinction claire Événements vs Signaux :** Remplacer le terme "Incidents" par "Signaux de veille (24h)". Scinder le KPI global en 2 compteurs : *Événements vérifiés (ACLED/UCDP)* vs *Dépêches & signaux presse (GDELT)*. |
| **P0-3 : Pollution de traduction Chrome (`<html lang="en">`)**<br>*(Code `src/app/layout.tsx`)* | **P0** | Le document HTML déclare `lang="en"` alors que l'interface par défaut est en français. Chrome propose automatiquement de traduire le site et corrompt les libellés militaires et politiques en charabia. | Dynamiser `<html lang={locale}>` ou forcer `lang="fr"` par défaut avec balise `<meta name="google" content="notranslate">`. |
| **P1-1 : Événements sans titre ni contexte**<br>*(Capture 2-_V_NEMENTS_EN_DIRECT.png)* | **P1** | Le flux en direct affiche : *"Media signal · N/A · 1 dépêche · lemonde.fr"*. Aucun titre d'article, aucun résumé. L'analyste ne sait absolument pas de quoi il s'agit. | Extraire et afficher le titre réel de la dépêche (`headline`/`title`), le chapeau de 2 lignes, l'heure exacte et l'axe thématique (Social, Défense, Diplomatie). |
| **P1-2 : Collisions visuelles & masquage HUD**<br>*(Captures 0-home.png, 1-VUE_GLOBALE.png)* | **P1** | Le bloc "Fiabilité" en bas du panneau droit est masqué par le launcher AURA et les boutons de zoom (`bottom-[128px] right-5`). La bannière de provenance chevauche les en-têtes des panneaux. | Définir une grille de zones d'ancrage strictes (Dock latéral droit, barre supérieure d'alertes dégagée, contrôles caméra intégrés au viewport sans collision). |
| **P1-3 : Redondance massive des listes pays & onglets**<br>*(Captures 3, 4, 5)* | **P1** | 5 endroits listent les pays/foyers : Top 6 (gauche), Explorer les pays (gauche), Onglet Géopolitique (tiroir), Onglet Conflits (tiroir), Live Conflict (droite). L'onglet Chronologie duplique la barre temporelle basse. | Supprimer les onglets redondants (Conflits, Chronologie, Géopolitique). Réduire à un menu d'actions focalisé et structurer la navigation selon les 3 niveaux d'échelle. |
| **P2-1 : Multiplication des mentions "N/A" et "Inconnu"**<br>*(Capture attachment-40632dcb)* | **P2** | Les pays hors zone de guerre active (France, Allemagne, etc.) affichent des pavés entiers de "N/A", donnant l'impression d'un logiciel défaillant ou vide. | Remplacer les valeurs nulles par des mentions de renseignement qualifiées : *"Aucun incident armé recensé"*, *"Marché stable"*, *"Démocratie parlementaire (source Wikidata)"*. |

---

## 2. Architecture de l'Information (3 Niveaux & Modèle de Sélection Unique)

### Les 3 Niveaux de Granularité

```
[ NIVEAU 1 : MONDE (Vue Globale) ]
├── Globe 3D avec couches thématiques actives (Chaleur / Événements)
├── En-tête : État du réseau, synthèse mondiale, bouton "Bilan du Jour"
├── Panneau Gauche : Situation Planétaire (Signaux 24h, Fronts actifs, Indicateurs macro)
└── Panneau Droit (Repliable) : Flux d'actualités mondiales en direct

             │  (Clic sur un Pays ou recherche dans l'Explorer)
             ▼
[ NIVEAU 2 : PAYS (Fiche Pays en Direct) ]
├── Recentrage caméra sur le pays & surbrillance de ses frontières
├── Panneau Gauche/Centre : Remplacé par la Fiche Pays Unifiée (Largeur 420px)
├── AURA contextualisée sur la nation sélectionnée
└── Globe filtré sur les foyers et infrastructures du pays

             │  (Clic sur un Foyer / Marqueur précis sur le globe)
             ▼
[ NIVEAU 3 : ÉVÉNEMENT / FOYER (Analyse Tactique) ]
├── Zoom caméra sur la cellule géographique (Locality / Région)
├── Tiroir d'inspection tactique : chronologie locale, acteurs, bilan humain
└── Imagerie satellite & reconnaissance du site (Sentinel / Street View)
```

### Fusion et Élagage des Écrans
- **Suppression du tiroir `ViewPanel` flottant :** Les onglets `CONFLITS ARMÉS`, `GÉOPOLITIQUE` et `CHRONOLOGIE` sont retirés de la barre haute.
- **Barre supérieure simplifiée :**
  1. `MONDE` (Vue d'ensemble par défaut)
  2. `FLUX DIRECT` (Ouvre le volet latéral d'actualités sans masquer le globe)
  3. `SOURCES & COUVERTURE` (Statut des connecteurs, modal discret)
  4. CTA central mis en valeur : `🎙️ BILAN DU JOUR` (Lancement du briefing vocal AURA)
- **Modèle de sélection unique :**
  - Un seul état actif à la fois dans le store : `selection = { type: 'country', iso: 'FRA' }` OU `{ type: 'cluster', id: 'xyz' }` OU `null`.
  - Sélectionner un pays désélectionne le cluster individuel (et vice-versa).
  - Élimination immédiate de tout panneau doublon au centre de l'écran.

---

## 3. Spécification Détaillée : « Fiche Pays en Direct » (Drawer Droit / 420px)

Lors d'un clic sur n'importe quel pays du globe ou via la recherche :

### 1. En-tête Identitaire & Statut
- Drapeau, Nom officiel en français, Code ISO3, Capitale.
- **Badge d'Activité Globale :** `🟢 CALME / STABLE` | `🟡 VIGILANCE SOCIALE` | `🔴 ALERTE CONFLIT ACTIF`.
- Heure locale du pays & Date/Heure de synchronisation (`Synchro il y a 4 min`).
- Bouton fermeture `✕ / Échap`.

### 2. Synthèse Express par AURA (Génération IA Live)
- 2 à 3 phrases concises rédigées au ton analyste de crise.
- *Exemple France :* *"Tensions sociales intérieures marquées par des manifestations interprofessionnelles à Paris et Lyon. Stabilité macroéconomique préservée, marchés stables. Aucune menace cinétique extérieure détectée."*
- Bouton audio : `Écouter la synthèse (15s)`.

### 3. Actualités & Événements en Direct (Classés par Domaines avec Titres)
Onglets filtrants ou sections accordéons (avec compteur d'événements) :
- **🔥 Conflits & Sécurité Nationale :** Tirs, frappes, opérations militaires.
- **📢 Mouvements Sociaux & Émeutes :** Grèves, blocages, manifestations, violences urbaines.
- **⚖️ Politique & Gouvernance :** Votes parlementaires majeurs, déclarations du chef de l'État, remaniements.
- **🌪️ Catastrophes & Climat :** Incendies (FIRMS), inondations, séismes, tempêtes.
- *Chaque item affiche :* Titre explicite de la dépêche, Source reconnue (ex. *AFP*, *Le Monde*, *Reuters*), Horodatage relatif (`il y a 32m`), Badge de confiance (`Confirmé` ou `Source presse`).
- *Règle d'état vide :* Si 0 événement, ne jamais afficher "Inconnu" mais : *"Aucun incident sécuritaire ou mouvement de foule majeur documenté au cours des dernières 24h."*

### 4. Marchés Financiers & Indicateurs Économiques
- **Indice Boursier National :** Cours et variation 24h (ex. `CAC 40 : 7 540 pts (+0,42%)` | `S&P 500` | `DAX`).
- **Devise & Parité :** (ex. `EUR/USD : 1.085`).
- **Indicateurs Macro (Banque Mondiale / FMI) :** PIB nominal actualisé, Taux d'inflation annuel, Taux directeur.

### 5. Gouvernance, Institutions & Défense
- **Dirigeants en exercice :** Chef de l'État et Chef du Gouvernement (issus de Wikidata, synchronisés, avec durée du mandat).
- **Régime politique :** Démocratie parlementaire / République présidentielle / Régime autoritaire.
- **Posture Militaire & Nucléaire :** Puissance nucléaire reconnue / Membre de l'OTAN / Effectifs des forces armées actives et budget annuel de la défense.

### 6. Bloc d'Action : « Approfondir avec AURA »
- Suggestions dynamiques en 1 clic :
  - `› Quels sont les points chauds des manifestations prévues aujourd'hui ?`
  - `› Quel est l'impact de l'inflation sur le climat politique actuel ?`
  - `› Analyse de la position diplomatique sur le conflit ukrainien.`
- Champ de saisie direct ou activation micro.

---

## 4. Interactions avec la Carte & Visualisation Spatiale

### Calques Thématiques Commutables (Dock Bas-Gauche du Globe)
L'utilisateur peut activer/désactiver les calques d'affichage d'un clic :
1. **Conflits armés & Frappes** (Rouge vif `#ff4a3f`)
2. **Contestations & Mouvements sociaux** (Orange ambré `#ff9f1c`)
3. **Catastrophes naturelles & Alertes thermiques** (Jaune feu `#ffd166`)
4. **Surveillance maritime & frontières** (Bleu cyan `#00e5ff`)

### Rendu du « Live » & Fraîcheur Temporelle
- **Effet de pulsation dynamique :** Les événements enregistrés il y a moins de 2 heures émettent un halo concentrique pulsant (onde radar).
- **Atténuation temporelle :** 
  - `< 6h` : Éclat maximal (100% luminosité).
  - `6h - 24h` : Éclat moyen (70%).
  - `> 24h` : Point fixe sans halo (40% d'opacité).

### Légende Flottante & Interaction
- **Au survol (Hover) :** Réticule tactique affichant nom de la ville/pays, type exact de l'événement et source principale.
- **Au clic Pays :** La caméra effectue une rotation fluide vers la zone géographique, les frontières s'illuminent en surbrillance discrète, la Fiche Pays s'ouvre.
- **Fenêtre temporelle par défaut :** Fixée sur **24h** pour refléter fidèlement le "direct", avec bascule rapide `24h / 48h / 7j / 30j`.

---

## 5. Spécification UX : « Bilan Mondial du Jour » (Briefing Vocal AURA)

### Point d'Entrée & Déclencheur
- Bouton premium dans l'en-tête : `[ 🎙️ BILAN MONDIAL DU JOUR · 3 MIN ]` avec pulsation lumineuse cyan.
- Raccourci clavier dédié : Touche `B` ou commande vocale *"AURA, lance le bilan du jour"*.

### Interface du Lecteur Audio Immersif
- Barre de lecture élégante ancrée au-dessus de la chronologie basse :
  - Boutons : Lecture/Pause, Précédent (Chapitre), Suivant (Chapitre), Vitesse (1x, 1.25x), Fermer.
  - Onde vocale (spectrogramme audio) synchronisée en direct avec la voix de synthèse.
  - Sous-titrage télégraphique déroulant en français soigné au bas de l'écran.

### Chapitrage Thématique (Parcours en 8 Étapes)
1. **Théâtres de conflits majeurs** (Ukraine, Proche-Orient, Soudan).
2. **Décisions politiques & sommets diplomatiques** (ONU, UE, accords bilatéraux).
3. **Climat, catastrophes naturelles & anomalies thermiques**.
4. **Économie mondiale, bourses & cours des matières premières** (Pétrole, Gaz, Or).
5. **Espace & technologies stratégiques** (Lancements de satellites, constellations de défense).
6. **Nucléaire civil et militaire** (AIEA, mouvements de dissuasion).
7. **Mouvements sociaux & contestations nationales**.
8. **Santé mondiale & alertes humanitaires**.

### Chorégraphie Spatiale du Globe
- À chaque changement de chapitre, la caméra du globe pivote automatiquement vers le théâtre concerné (interpolation fluide de coordonnées sphériques).
- Les foyers d'événements cités s'illuminent en séquence pendant qu'AURA prononce l'analyse.
- L'utilisateur peut interrompre à tout moment pour cliquer sur un pays et poser une question complémentaire.

---

## 6. Glossaire Terminologique : Remplacement du Jargon Technique

| Terme Actuel (Développeur / Jargon) | Nouveau Libellé Métier (Clair & Accessible) | Justification Ergonomique |
| :--- | :--- | :--- |
| `MEDIA_SIGNAL` | **Dépêche de presse** / **Signal média** | Évite l'anglicisme brut en lettres capitales qui ressemble à une variable de code. |
| `Foyers d'affrontements (524)` | **Zones sous surveillance active** | 90% des points ne sont pas des champs de bataille mais des zones de veille. |
| `Incidents (24h) (5719)` | **Signaux d'actualité recensés (24h)** | Évite de faire croire à 5 700 attaques armées en une seule journée. |
| `Théâtres majeurs` | **Zones de crise prioritaire** | Plus adapté aux analyses géopolitiques civiles et militaires combinées. |
| `DEMO / demo:seed` | **Mode simulation** / **Données d'exercice** | Vocabulaire standard des centres de commandement et de formation. |
| `Incidents documentés ≠ fictifs` | **Sources vérifiées vs signaux de veille** | Règle les doutes sur l'intégrité de la plateforme sans afficher de disclaimer anxiogène. |
| `Indice interne ORBITAL : N/A` | *Retiré si non pertinent* ou **Indice non calculé** | Ne pas afficher de mention négative interne inutile sur les fiches pays. |
| `Inconnu` / `N/A` | **Non recensé à cette date** / **Donnée stable** | Élimine la sensation de bug ou de système incomplet. |

---

## 7. Feuille de Route Priorisée (Roadmap)

### Phase 1 : Quick Wins Immédiats (< 1 Jour)
1. **Correction HTML :** Basculer `<html lang="fr">` et injecter `notranslate` dans `layout.tsx` pour neutraliser le traducteur Chrome parasite.
2. **Correction du Bug Double Panneau France :** Supprimer l'affichage inline de `CountryProfile` dans le panneau gauche pour ne conserver que la fiche centrale/latérale unique.
3. **Dégagement des Collisions :** Réhausser le dock de zoom et décaler le launcher AURA pour libérer le pavé de fiabilité.
4. **Toilettage Sémantique :** Remplacer les chaînes brutes `MEDIA_SIGNAL` par "Dépêche" et afficher le domaine source en clair.

### Phase 2 : Refonte Moyenne (2 à 4 Jours)
1. **Unification de la Fiche Pays :** Assembler le drawer latéral unifié (Wikidata + Banque Mondiale + flux RSS d'actualités par pays).
2. **Titres réels dans le Flux Direct :** Intégrer les vrais titres d'articles dans l'API `/api/latest` et le composant de flux.
3. **Filtrage Thématique par Calques :** Ajouter les toggles de couches (Conflits / Social / Climat) sur la vue 3D.
4. **Enrichissement Économique Pays :** Intégrer les flux des principaux indices boursiers (API financière publique gratuite).

### Phase 3 : Chantiers Stratégiques Majeurs (1 à 2 Semaines)
1. **Expérience « Bilan du Jour » AURA :** Génération quotidienne du script en 8 chapitres et synchronisation caméra Three.js avec la synthèse vocale.
2. **Couverture Multidomaine Étendue :** Connecteurs pour les mouvements sociaux mondiaux (GDELT Protests & News RSS localisés par pays).
3. **Mode Hors Conflit Intelligent :** Profils riches automatiques pour les 195 pays reconnus par l'ONU avec actualité générale, même en l'absence de guerre.
