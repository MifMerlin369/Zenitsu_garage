# Zenitsu Garage 🔧

Logiciel de gestion d'atelier automobile — Flask + SQLite + JS Vanilla.

## Structure

```
Zenitsu_garage/
├── app.py              # Backend Flask
├── requirements.txt    # Dépendances Python
├── render.yaml         # Config déploiement Render
├── .gitignore
└── frontend/
    ├── index.html
    ├── app.js
    └── style.css
```

## Lancer en local (Termux / PC)

```bash
pip install -r requirements.txt
python app.py
# → http://localhost:5000
```

Identifiants par défaut :
- `admin` / `admin123`
- `technicien1` / `tech123`

> ⚠️ Changer les mots de passe dès la première connexion.

## Déployer sur Render (gratuit)

### 1. Pousser sur GitHub

```bash
cd Zenitsu_garage
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TON_USER/zenitsu-garage.git
git push -u origin main
```

### 2. Créer le service sur Render

1. Aller sur [render.com](https://render.com) → **New → Blueprint**
2. Connecter ton repo GitHub
3. Render lit `render.yaml` et configure tout automatiquement
4. Cliquer **Apply**

Render va :
- Installer les dépendances
- Lancer avec Gunicorn
- Générer une `SECRET_KEY` sécurisée automatiquement
- Monter un disque persistant `/data` pour la DB et les photos

### 3. Variables d'environnement (optionnel)

Dans Render → ton service → **Environment** :

| Variable | Valeur |
|----------|--------|
| `SECRET_KEY` | (généré auto) |
| `DATA_DIR` | `/data` |

### URL finale

```
https://zenitsu-garage.onrender.com
```

## Notes importantes

- **Plan gratuit Render** : le service s'endort après 15 min d'inactivité.
  Premier chargement ~30 secondes. Normal.
- **Disk persistant** : la DB et les photos survivent aux redémarrages.
- **HTTPS** : inclus automatiquement par Render.

## Sécurité avant mise en production

- [ ] Changer le mot de passe `admin`
- [ ] Changer le mot de passe `technicien1`  
- [ ] Supprimer la ligne `login-hint` dans `index.html`
- [ ] Vérifier que `SECRET_KEY` est bien une valeur générée (pas la valeur par défaut)
