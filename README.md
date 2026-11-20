# Révise apps

Appli web gratuite pour ranger, réviser et partager ses fiches de révision.
En ligne : https://revisapp-bcc73.web.app (s'ajoute à l'écran d'accueil de l'iPhone).

## Fonctions

- Comptes : inscription, connexion, mot de passe oublié, suppression du compte et de toutes ses données
- Fiches classées classe › matière › cours : dépôt d'un PDF ou de plusieurs photos réunies en un seul PDF
  (photos réduites, 5 Mo max par fiche), miniatures, favoris, modification
- Partage par lien d'une fiche ou d'un dossier, avec QR code et partage natif de l'iPhone
- Cartes de révision avec répétition espacée (boîtes de Leitner), en mode cartes ou QCM
- Lecture hors connexion (site, liste des fiches, fiches déjà ouvertes)
- Interface « Liquid Glass » façon iOS 26, clair / sombre automatique
- Pages légales : confidentialité, conditions d'utilisation, mentions légales, contact

## Comment ça marche

Site sans serveur, dans `firebase/` : le navigateur parle directement à Firebase (Google), gratuitement
(forfait Spark, sans carte bancaire) :

- **Authentication** : comptes (e-mail / mot de passe)
- **Firestore** : fiches, fichiers (découpés en morceaux de moins de 1 Mo), cartes, partages
- **Hosting** : diffusion du site

La sécurité est dans `firebase/firestore.rules` : chaque fiche est privée ; un lien de partage rend lisible une
fiche ou un dossier ; supprimer le lien referme l'accès. Le SDK Firebase est embarqué dans
`firebase/public/vendor/firebase.js` (pas de CDN) ; après une mise à jour de ses dépendances :
`cd firebase && npm install && npm run build:vendor`.

## Mise en ligne

**Automatique** : `.github/workflows/firebase-hosting.yml` publie le site à chaque mise à jour de
`firebase/public/` sur `main` ou `claude/new-session-3z4dvs` (secret GitHub
`FIREBASE_SERVICE_ACCOUNT_REVISAPP_BCC73`). Lancement manuel : onglet *Actions* → *Déployer le site* → *Run workflow*.
Le numéro de version est affiché en bas de l'appli.

**À la main** (nécessaire pour publier les règles Firestore après un changement de `firestore.rules`) :

```bash
cd firebase && npm install
npx firebase login
npx firebase deploy
```

## Développement et tests

Depuis `localhost`, le site parle aux émulateurs Firebase (jamais aux vraies données) :
`cd firebase && npx firebase emulators:start --only auth,firestore,hosting`.
Test des règles de sécurité (Java requis) : `cd firebase && npm run test:rules`.

## Licence

Tous droits réservés : voir [LICENSE](LICENSE). Le code est visible mais ne peut pas être copié ni réutilisé
sans autorisation écrite.
