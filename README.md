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

## Mise en ligne (Firebase : Auth + Firestore + Storage + Hosting)

Version sans serveur dans `firebase/` : le navigateur parle directement à Firebase, la sécurité est dans
`firestore.rules` et `storage.rules` (chaque fiche n'est lisible que par son propriétaire ; un lien de partage
rend lisible une seule fiche ; supprimer le lien la referme).

1. Console Firebase → **Créer un projet**. Puis :
   - **Authentication** → Méthode de connexion → activer **E-mail/Mot de passe**
   - **Firestore Database** → Créer (mode production)
   - **Storage** → Commencer. Cloud Storage demande le plan **Blaze** (carte bancaire, quota gratuit inclus) :
     active une alerte de budget.
   - **Paramètres du projet → Tes applications → Web (`</>`)** → copier la configuration dans
     `firebase/public/firebase-config.js`.
2. Mettre l'id du projet dans `firebase/.firebaserc`.
3. Déployer :
   ```bash
   cd firebase && npm install
   npx firebase login
   npx firebase deploy        # hosting + règles Firestore + règles Storage
   ```
   Au premier déploiement, Firebase peut demander d'autoriser les règles Storage à lire Firestore : accepter
   (c'est ce qui permet au lien de partage d'ouvrir le fichier).

Test des règles de sécurité avec l'émulateur (Java requis) : `cd firebase && npm run test:rules`.
