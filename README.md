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
