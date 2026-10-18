# Implémentation — identité pays et sélection

## Contrat retenu

- Le référentiel Natural Earth, la recherche et la sélection utilisent un ISO3 canonique. `src/lib/geo/country.ts` centralise les alias courants, les codes ISO3, les rares replis Natural Earth connus (`FR1`, `US1`) et des tables provider distinctes. Les codes FIPS connus sont traduits par table explicite; la table CAMEO est volontairement vide tant qu'aucun code de pays numérique n'est vérifié. Les codes CAMEO ne sont pas assimilés à ISO/FIPS.
- L'identité métier retenue est distincte des coordonnées. La sélection d'un pays dans l'explorateur est publiée dans le store Zustand (`country`, ISO3, nom et coordonnées de focus); l'explorateur lit ensuite ce même état. `source: "explorer"` garde la fiche centrale du globe hors du chemin de l'explorateur. Les consommateurs existants continuent de lire `name` et `iso`.
- Les changements de grille gardent la cellule correspondante la plus proche du même pays et niveau de confiance. Si aucune cellule ne convient, la sélection existante reste visible. Les réponses détail et actualisations précédentes sont ignorées après une nouvelle requête.
- Les tuiles 24 h et 7 jours consomment `periodCounts.absolute` uniquement. Si ce champ additif manque sur une ancienne réponse API, l'interface affiche `—` plutôt que de réutiliser les anciennes intersections `events24h/events7d`.
- Le point de focus est un point intérieur du plus grand polygone, vérifié contre anneau extérieur et trous; il ne remplace ni les propriétés d'identité Natural Earth ni le calcul caméra du globe.

## Données de profil

Les tableaux historiques de `src/data/geopolitics.ts` sont conservés intacts. Ils sont marqués statiques, sans source et sans date. L'interface n'affiche plus leurs assertions non vérifiées concernant dirigeants, régime, population, économie ou situation géopolitique. Une fiche indique clairement cette limite; les observations de `CountryIndicators` restent séparées et présentent leurs sources/années disponibles. Une valeur manquante ne signifie ni calme ni stabilité.

Les événements historiques et leurs sources ne sont ni purgés ni réécrits par cette implémentation. Aucun nouvel enregistrement fictif n'est ajouté. Le contrat visé par le chantier partagé est réel uniquement : retirer l'amorçage seed et exclure la démo côté API sans effacer l'historique conservé. Cette implémentation UI n'altère pas ce pipeline.

## Fichiers

- `src/lib/geo/country.ts` : alias et résolution d'identité vers ISO3.
- `src/lib/geo/world.ts` : ISO3 canonique du référentiel et point intérieur de focus.
- `src/store/useIntelStore.ts` : sélection pays partagée, sélection de grille conservée, garde contre les réponses asynchrones périmées.
- `src/components/ui/GlobalSituationPanel.tsx` : recherche/référentiel et fiche liée au pays sélectionné globalement.
- `src/components/ui/Overlays.tsx` et `src/components/ui/CountryProfile.tsx` : regroupement par identité canonique et retrait des affirmations statiques non vérifiées de l'affichage.
- `src/data/geopolitics.ts` : résolution des profils par ISO3/alias; contenu historique conservé.

## Limites

La table de correspondance de codes provider reste volontairement explicite et partielle : elle ne prétend pas convertir arbitrairement tout code FIPS/CAMEO. Les territoires contestés et géométries absentes ou généralisées en Natural Earth 110m exigent une politique produit/référentiel dédiée. Les indicateurs externes et dirigeants publiés par leurs endpoints n'ont pas été revalidés dans ce chantier.
