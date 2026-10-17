# Mobilité Angoulême — version web responsive

Application web mobile-first pour afficher :
- les 4 stations Vélo Modalis les plus proches dans un rayon de 10 min à pied ;
- tous les arrêts Möbius dans ce même rayon ;
- les prochains passages par ligne ;
- un seul sens affiché par arrêt, avec bouton pour changer de direction ;
- l'heure conseillée « Pars à » selon le temps de marche et la marge choisie.

L'adresse du domicile est modifiable dans l'application et reste stockée uniquement dans le navigateur.

## Lancer en local

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000

## Déploiement gratuit recommandé : Render

Le dépôt contient `render.yaml`, prêt pour Render.

1. Créer un dépôt GitHub et y déposer ce dossier.
2. Sur Render : **New > Blueprint** (ou Web Service), connecter le dépôt GitHub.
3. Render détecte `render.yaml`.
4. Valider le plan **Free** et lancer le déploiement.
5. L'application reçoit une URL publique en `*.onrender.com` avec HTTPS.

Pour un Web Service créé manuellement :
- Runtime : Node
- Build command : `npm install`
- Start command : `npm start`
- Health check : `/healthz`
- Plan : Free

> Le plan gratuit Render peut mettre le service en veille après une période d'inactivité. Le premier affichage après veille peut donc être plus lent.

## Installation sur téléphone

L'application est une PWA :
- Android / Chrome : utiliser le bouton **Installer** lorsqu'il apparaît ;
- iPhone / iPad : Safari > Partager > **Sur l'écran d'accueil**.

Les données temps réel restent récupérées sur le réseau ; le service worker ne met pas en cache les réponses `/api/`.

## Responsive

L'interface est optimisée pour desktop, tablette et smartphone, avec :
- boutons tactiles d'au moins 44 px ;
- cartes en une colonne sur mobile ;
- horaires adaptés aux petits écrans ;
- prise en charge des zones sûres des iPhone (safe areas).
