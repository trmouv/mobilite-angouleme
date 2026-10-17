# Mobilité multi-réseaux — v19

Application responsive/PWA de mobilité autour de la position ou de l'adresse choisie.

## v19

- Vélo Modalis GrandAngoulême via GBFS officiel selon la position.
- Le Vélo TBM Bordeaux Métropole via GBFS officiel selon la position.
- Correction des noms de stations GBFS multilingues (TBM / Modalis).
- Regroupement des destinations d’une même ligne TBM dans un seul bloc, sans déplacer la ligne de son emplacement initial.
- Arrêts urbains sans passage regroupés dans un bloc repliable.
- Horaires SNCF affichés sans vert ni point de temps réel.
- Bus/tram/bateau TBM, Möbius, TAD contextuel, trains, cars interurbains et longue distance, covoiturage, parkings/P+R et IRVE.

## Render

Le service démarre avec `npm start`. Le fichier `server.js` assemble les sources v19 stockées dans `.v19parts/`, puis lance le serveur Express. Cette organisation conserve la version complète malgré les limites d’écriture des gros fichiers via le connecteur GitHub.

## Installation locale

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000.
