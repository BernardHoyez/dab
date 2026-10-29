# dab — Distributeurs automatiques de billets

PWA statique (Leaflet vendorisé, OSM / IGN Plan V2, Overpass API).

## Déploiement GitHub Pages
1. Créer le dépôt `dab` sur GitHub et y pousser tout le contenu de ce dossier à la racine.
2. Settings → Pages → Source : branche `main`, dossier `/ (root)`.
3. L'app sera disponible sur https://bernardhoyez.github.io/dab/

## Mise à jour
À chaque modification de fichier statique, incrémenter `CACHE_NAME` dans `sw.js`
(`dab-cache-v1` → `dab-cache-v2`…) et `APP_VERSION` dans `app.js`.
