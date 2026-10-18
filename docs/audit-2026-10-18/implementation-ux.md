# ORBITAL — Implémentation UX & Accessibilité (audit 18 octobre 2026)

Périmètre exclusif : `src/app/layout.tsx`, `src/components/ui/Header.tsx`, `src/components/ui/SettingsPanel.tsx`, `src/components/IntelApp.tsx`, `docs/audit-2026-10-18/implementation-ux.md`.  
Aucun composant de store, backend, Overlays, profils pays ou AURA/AgentPanel n'a été modifié (propriété d'autres agents). Aucune donnée fictive ajoutée, aucun formulaire de clé, aucun commit ni redémarrage de serveur.

---

## 1. Langue du document HTML (`src/app/layout.tsx`)
- **Problème résolu (P0-1 / P0-3)** : Le document déclarait historiquement `<html lang="en">` alors que l'interface par défaut et ses flux textuels sont en français. Les navigateurs (notamment Chrome) déclenchaient intempestivement un bandeau de traduction automatique qui altérait le vocabulaire militaire, géopolitique et tactique.
- **Modification** : Déclaration de `<html lang="fr" className="dark bg-[#010409]">`.
- **Impact** : Préservation du libellé exact des dépêches et des indicateurs, suppression de l'incohérence document/contenu.

---

## 2. Dialog accessible Paramètres & exclusion démo (`src/components/ui/SettingsPanel.tsx`)
- **Conformité WAI-ARIA Dialog (Modal)** :
  - Balise conteneur dotée de `role="dialog"`, `aria-modal="true"`, `aria-labelledby="settings-dialog-title"`, `id="settings-dialog"`.
  - Titre structuré avec balise `<h2>` portant `id="settings-dialog-title"`.
  - Bouton de fermeture avec `aria-label` explicite bilingue (`Fermer les paramètres` / `Close settings`).
- **Gestion du focus & Touche Échap** :
  - **Capture & Restauration** : À l'ouverture, capture de `document.activeElement` (ou ciblage du bouton déclencheur `#settings-trigger-button`) ; à la fermeture ou au démontage, restauration automatique du focus sur le déclencheur.
  - **Auto-focus** : Focus immédiat sur le bouton de fermeture lors du montage.
  - **Piège de tabulation (Focus Trap)** : Gestion de la touche `Tab` / `Shift+Tab` confinant le focus à l'intérieur des éléments interactifs du dialogue.
  - **Touche Échap** : Fermeture directe via `keydown` avec `stopPropagation()` et `preventDefault()`.
- **Données réelles uniquement & Hygiène** :
  - Filtrage strict de la liste `stats.connectors` : exclusion immédiate de tout connecteur portant `id="demo"` ou dont le libellé évoque la démonstration.
  - Absence stricte de formulaire d'ajout de clés (conformité consigne utilisateur et sécurité des secrets).
  - Clarification textuelle : affirmation que seules les sources réelles et vérifiées (ACLED, UCDP, GDELT, FIRMS, Banque Mondiale) sont traitées.

---

## 3. Navigation Header & Accessibilité (`src/components/ui/Header.tsx`)
- **Accès mobile à la navigation (`md:hidden`)** :
  - Ajout d'un bouton de menu compact `NAV` / `FERMER` (`chip md:hidden`) doté des attributs `aria-expanded` et `aria-controls="mobile-navigation-drawer"`.
  - Déploiement d'un tiroir de navigation mobile (`#mobile-navigation-drawer`) reprenant l'ensemble des 6 vues applicatives (`OVERVIEW`, `LIVE EVENTS`, `CONFLICTS`, `TIMELINE`, `REGIONS`, `SOURCES`), le commutateur bilingue FR/EN, et le sélecteur d'affichage mobile.
  - Fermeture automatique du menu au clic sur un lien ou par pression de la touche Échap.
- **Déclencheur Paramètres accessible** :
  - Bouton `PARAMÈTRES` doté de `id="settings-trigger-button"`, `aria-haspopup="dialog"`, `aria-controls="settings-dialog"`, et `aria-expanded={view === "SETUP"}`.
- **Préservation desktop** :
  - La barre de navigation desktop (`hidden md:flex`) et le style HUD holographique sont conservés à 100% à l'identique.

---

## 4. IntelApp : Isolation des raccourcis & Tiroir unique mobile (`src/components/IntelApp.tsx`)
- **Protection absolue de la saisie (Raccourcis 1–6 & Échap)** :
  - Fonction sentinelle `isTypingContext(e)` : vérifie `e.isComposing` (IME), l'appartenance de la cible à `input`, `textarea`, `select`, `[contenteditable='true']`, `[role='textbox']`, ainsi que l'état de `document.activeElement`.
  - **Raccourcis 1–6** : strictement neutralisés dès lors qu'un champ ou une zone de saisie est actif. Empêche toute bascule accidentelle de vue lors de la recherche de pays ou de la frappe d'un prompt.
  - **Touche Échap** : si un champ est actif, Échap provoque la défocalisation (`blur()`) du champ sans fermer la vue globale ni désélectionner le pays/cluster.
- **Accès mobile aux panneaux sans collision ("Tiroir unique")** :
  - Sur écran étroit (< 768px), les colonnes gauche (268px) et droite (300px) entraient en collision et masquaient entièrement le globe 3D.
  - Implémentation du mode tiroir mobile : `mobileDrawer` (`"globe"` | `"situation"` | `"conflict"`).
    - Mode `"globe"` (par défaut) : panneaux rétractés, permettant une manipulation tactile libre et fluide du globe 3D.
    - Mode `"situation"` : affiche la colonne gauche (`GlobalSituationPanel` + `FiltersPanel`) adaptée à la largeur mobile (`left-3 right-3 w-[min(300px,calc(100vw-24px))]`).
    - Mode `"conflict"` : affiche la colonne droite (`LiveConflictPanel`).
  - Commutateur mobile discret à trois boutons au-dessus de la frise temporelle basse : `[ 🌐 GLOBE ] [ 📊 SITUATION ] [ ⚡ CONFLITS ]`.
  - Bascule automatique vers `"conflict"` lors de la sélection tactile d'un pays ou d'un cluster sur le globe.
- **Positionnement des vues secondaires** :
  - Sur mobile, `openView !== "OVERVIEW"` est désormais centré et borné (`left-3 right-3 max-w-[340px] mx-auto`) au lieu d'un `left-[305px]` rigide qui tronquait les panneaux en dehors du viewport.
  - Sur desktop, positionnement inchangé (`md:left-[305px] md:right-auto md:mx-0`).

---

## 5. Preuves et vérifications

| Contrôle | Commande / Méthode | Résultat |
|---|---|---|
| **Typecheck fichiers périmètre** | Compilation isolée des 4 fichiers modifiés | **Succès (0 erreur)** sur `layout.tsx`, `Header.tsx`, `SettingsPanel.tsx`, `IntelApp.tsx`. |
| **Langue document FR** | Inspection `src/app/layout.tsx` | Validé : `<html lang="fr" ...>`. |
| **WAI-ARIA Dialog Paramètres** | Script automatisé `/tmp/test-ux-target.mjs` | Validé : `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, auto-focus, focus trap, Échap. |
| **Filtrage démo Paramètres** | Script automatisé `/tmp/test-ux-target.mjs` | Validé : exclusion stricte `c.id !== "demo"`. |
| **Navigation mobile** | Script automatisé `/tmp/test-ux-target.mjs` | Validé : tiroir mobile, sélecteur bilingue, déclencheur accessible. |
| **Garde de saisie raccourcis** | Simulation `isTypingContext` | Validé : touches 1-6 et Échap neutralisées sur `input`, `textarea`, `select`, `contenteditable`. |
| **Anti-collision mobile** | Inspection `IntelApp.tsx` | Validé : un seul tiroir affiché à la fois sur mobile, globe libéré. |
| **Inspection navigateur T3** | `preview_status` / `preview_open` / `preview_evaluate` / `t3_preview_close` | Cycle complet exécuté. Diagnostic serveur : voir limites ci-dessous. |

---

## 6. Limites constatées & État du serveur

1. **Serveur local en cours (PID 30863 sur port 3005)** :
   Le serveur en tâche de fond exécute un build Next.js pré-généré antérieur (`x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`).
   Conformément à la consigne formelle : *« Pas clés/env/payants/build/restart/commit/sousagent »*, **aucun `pnpm build` ni redémarrage de processus n'a été opéré**. Les modifications de code source sont compilées et validées, mais ne seront servies sur le port 3005 qu'au prochain redémarrage manuel du serveur par l'opérateur.
2. **Support WebGL en environnement headless** :
   La capture de rendu graphique (`preview_snapshot`) dans le navigateur partagé a rencontré un délai d'attente dû à la boucle d'animation Three.js/WebGL en rendu logiciel sans accélération matérielle GPU (constat déjà documenté dans le rapport d'arbitrage 05). L'évaluation DOM via `preview_evaluate` s'est quant à elle exécutée normalement.
3. **Périmètre et modifications concurrentes** :
   Le fichier `src/server/agent.ts` et `src/components/agent/AgentPanel.tsx` ont fait l'objet de modifications concurrentes par d'autres agents. Conformément à la règle de non-ingérence dans les fichiers détenus par d'autres agents, ces fichiers sont demeurés strictement intacts dans ce chantier.
