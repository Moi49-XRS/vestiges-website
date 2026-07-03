# Vestiges — Site officiel

Site web complet pour le jeu **Vestiges** : présentation, téléchargement, lecteur de musique, commentaires, formulaire de contact, et un espace admin protégé par code.

## 1. Installation (dans VS Code)

1. Ouvrez le dossier `vestiges-website` dans VS Code.
2. Ouvrez un terminal (`Terminal > Nouveau terminal`).
3. Installez les dépendances :
   ```
   npm install
   ```
4. Copiez le fichier `.env.example` en `.env` :
   ```
   cp .env.example .env
   ```
   (sous Windows : copiez-collez manuellement le fichier et renommez-le `.env`)
5. Ouvrez `.env` et modifiez si besoin :
   - `ADMIN_CODE` → le code du menu admin (par défaut `Paul123`)
   - `SMTP_...` → vos identifiants d'e-mail (voir section 3 ci-dessous) pour pouvoir répondre aux messages des joueurs

## 2. Lancer le site

```
npm start
```

Puis ouvrez votre navigateur à l'adresse : **http://localhost:3000**

Le site se recharge à chaque redémarrage du serveur (`Ctrl+C` puis `npm start` pour relancer après une modification du code serveur).

## 3. Configurer l'envoi d'e-mails (pour répondre aux messages)

Sans configuration, le site fonctionne mais le bouton "Envoyer la réponse" dans l'admin affichera une erreur. Pour l'activer avec une adresse Gmail :

1. Activez la validation en 2 étapes sur votre compte Google.
2. Rendez-vous sur https://myaccount.google.com/apppasswords et créez un "mot de passe d'application".
3. Dans `.env`, renseignez :
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=votre.adresse@gmail.com
   SMTP_PASS=le_mot_de_passe_application_généré
   ```
4. Redémarrez le serveur.

Vous pouvez utiliser un autre fournisseur (Outlook, OVH, etc.) en adaptant `SMTP_HOST` et `SMTP_PORT`.

## 4. Utiliser l'espace admin

- Sur le site, cliquez sur le bouton **Admin** (en haut de la page, ou en bas de page "Accès développeur").
- Entrez le code (`Paul123` par défaut, modifiable dans `.env`).
- Vous accédez au tableau de bord avec 4 sections :
  - **Fichier du jeu** : mettre en ligne / remplacer le fichier téléchargeable par les joueurs.
  - **Messages** : voir tous les messages reçus via le formulaire de contact, et y répondre directement par e-mail.
  - **Musique** : ajouter ou supprimer des morceaux disponibles dans le lecteur du site.
  - **Commentaires** : modérer (supprimer) les commentaires publiés par les visiteurs.

⚠️ Le code admin est vérifié côté serveur à chaque action sensible. Ne partagez jamais le contenu du fichier `.env`.

## 5. Structure du projet

```
vestiges-website/
  server.js              → serveur Express (toutes les routes)
  package.json
  .env                   → vos réglages (à créer, non partagé)
  data/                  → "base de données" en fichiers JSON
    messages.json
    comments.json
    music.json
    settings.json
  uploads/
    game/                → fichier du jeu envoyé par l'admin
    music/                → musiques envoyées par l'admin
  public/
    index.html           → page principale du site
    admin.html           → tableau de bord admin
    css/style.css
    js/main.js            → logique de la page principale
    js/admin.js           → logique du tableau de bord admin
```

## 6. Limites de taille des fichiers

- Fichier du jeu : jusqu'à 2 Go (modifiable dans `server.js`, variable `uploadGame`).
- Musique : jusqu'à 50 Mo par morceau (modifiable dans `server.js`, variable `uploadMusic`).

## 7. Aller plus loin

- Les données sont stockées dans de simples fichiers JSON (`data/`), pratique pour démarrer sans base de données. Si le site grossit beaucoup, on peut migrer vers SQLite ou une autre base plus tard.
- Le code admin est simple (comparaison directe) : suffisant pour un usage personnel/local, mais à renforcer (hashage, sessions signées) avant une mise en ligne publique à grande échelle.
