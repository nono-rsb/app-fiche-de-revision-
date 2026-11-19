# Révise apps

Appli de fiches de révision, construite d'après le schéma :

1. **Création de compte** (email + mot de passe)
2. **Dépôt des fiches** : PDF ou photo (JPG/PNG/WEBP/GIF, 20 Mo max ; sur mobile le champ propose l'appareil photo)
3. **Classement** par classe → matière → cours (suggestions basées sur l'existant, recherche et filtres)
4. **Partage par lien** : un lien public par fiche, consultable sans compte, désactivable à tout moment

## Lancer

```bash
npm install
npm start          # http://localhost:3000  (PORT=... pour changer)
npm test           # parcours complet compte → dépôt → classement → partage
```

Node ≥ 22.13 requis (SQLite intégré). Les données sont dans `data/` (`DATA_DIR` pour changer) :
base `app.db` et fichiers dans `uploads/`. En production, mettre `NODE_ENV=production`
(cookie `Secure`) derrière HTTPS.

## Mise en ligne (Render)

1. Sur https://render.com : **New → Blueprint**, choisir ce dépôt (le fichier `render.yaml` configure tout).
2. Valider : Render construit l'image `Dockerfile` et monte un disque persistant sur `/data` (base + fichiers).
3. L'appli est disponible sur `https://revise-apps.onrender.com` (ou l'URL affichée). Les liens de partage utilisent cette adresse.

Le `Dockerfile` marche aussi tel quel sur Fly.io, Railway, etc. : il faut juste un volume monté sur `/data`.

## Mise en ligne (Cloudflare : Workers + D1 + R2)

Alternative sans serveur, avec un palier gratuit. Le code est dans `cloudflare/worker.js` (même API que `server.js`, même front `public/`).

```bash
npm install
npx wrangler login
npx wrangler d1 create revise-apps            # copier le database_id dans wrangler.toml
npx wrangler r2 bucket create revise-apps-fichiers
npm run cf:db                                 # crée les tables
npm run cf:deploy                             # publie sur https://revise-apps.<ton-compte>.workers.dev
```

Test local de la version Cloudflare : `npx wrangler d1 execute revise-apps --local --file=cloudflare/schema.sql`,
`npm run cf:dev`, puis `BASE_URL=http://127.0.0.1:8787 npm test`.

Limites du palier gratuit à connaître : 100 000 requêtes/jour et 10 ms de CPU par requête (Workers) ;
5 Go et 100 000 écritures/jour (D1) ; 10 Go de fichiers (R2, qui demande une carte bancaire enregistrée
sans facturation tant qu'on reste sous le quota).

## Mise en ligne (Firebase : Auth + Firestore + Hosting, gratuit sans carte bancaire)

Version sans serveur dans `firebase/` : le navigateur parle directement à Firebase, la sécurité est dans
`firestore.rules` (chaque fiche est privée ; un lien de partage rend lisible une fiche ou un dossier ; supprimer le
lien referme l'accès).

**Fonctions** : comptes (inscription, connexion, mot de passe oublié, suppression du compte et de toutes ses données) ·
fiches classées classe › matière › cours · dépôt d'un PDF ou de plusieurs photos réunies en un seul PDF ·
miniatures, favoris, modification · partage d'une fiche ou d'un dossier par lien (partage natif iPhone, QR code) ·
cartes de révision avec répétition espacée (boîtes de Leitner) en mode cartes ou QCM · lecture hors connexion
(site, liste des fiches et fiches déjà ouvertes).

Pas de Cloud Storage (qui demande le forfait payant Blaze) : les fichiers sont rangés dans Firestore, découpés en
morceaux de moins de 1 Mo. Les photos sont réduites (JPEG) avant l'envoi ; **limite de 5 Mo par fiche**.
Forfait Spark : 1 Go de stockage, 50 000 lectures et 20 000 écritures par jour.

1. Console Firebase → projet. Activer **Authentication → E-mail/Mot de passe** et **Firestore Database** (mode production).
2. Copier la configuration de l'application Web dans `firebase/public/firebase-config.js` et l'id du projet dans
   `firebase/.firebaserc`.
3. Déployer :
   ```bash
   cd firebase && npm install
   npx firebase login
   npx firebase deploy        # site + règles Firestore
   ```

Le SDK Firebase est embarqué dans `public/vendor/firebase.js` (pas de CDN). Après une mise à jour de ses
dépendances : `npm run build:vendor`.

**Développer en local** : depuis `localhost`, le site parle aux émulateurs Firebase (jamais aux vraies données) :
`npx firebase emulators:start --only auth,firestore,hosting`. Test des règles de sécurité (Java requis) :
`npm run test:rules`.

### Déploiement automatique du site (GitHub Actions)

`.github/workflows/firebase-hosting.yml` publie le site à chaque mise à jour de `firebase/public/` sur `main` ou
`claude/new-session-3z4dvs`. Réglage unique, sur ton PC :

```bash
cd firebase
npx firebase login
npx firebase init hosting:github
```
Réponses : dépôt `nono-rsb/app-fiche-de-revision-` ; script de build avant déploiement : **non** ; déploiement
automatique à la fusion : **non** ; aperçu des pull requests : **non** (ce workflow-ci s'en charge).
La commande crée le secret `FIREBASE_SERVICE_ACCOUNT_REVISAPP_BCC73` dans le dépôt. Les règles Firestore restent à
publier à la main après un changement : `cd firebase && npx firebase deploy --only firestore`.
