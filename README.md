# BarStock Pro — Django

Panneau d'administration de stock pour bar (articles, mouvements, ventes, statistiques, tâches),
avec **base de données serveur** (SQLite) et API JSON.

## Lancer le projet

```bash
# (optionnel) environnement virtuel
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

pip install -r requirements.txt
python manage.py migrate      # crée la base + données de démo
python manage.py runserver
```

Pages :
- **http://127.0.0.1:8000/** — panneau d'administration complet (stock, ventes, stats, historique, archives…)
- **http://127.0.0.1:8000/gerant/** — page serveur / caisse (POS) : prise de commande rapide

## Administration Django

Pour gérer les données dans l'admin :

```bash
python manage.py createsuperuser
```

Puis **http://127.0.0.1:8000/admin/**

## Structure

```
barstock/        configuration du projet Django
inventory/       application (modèles, API, admin)
  models.py      Item, Movement, Todo
  views.py       endpoints JSON (/api/...)
  urls.py        routes
templates/
  index.html     l'interface (SPA)
static/
  style.css      styles
  app.js         logique front (appelle l'API)
db.sqlite3       base de données
```

## API (résumé)

| Méthode | URL | Rôle |
|---------|-----|------|
| GET  | `/api/state/` | état complet (articles, mouvements, tâches) |
| POST | `/api/items/` | créer / réapprovisionner un article |
| POST | `/api/items/<id>/move/` | entrée / sortie de stock |
| POST | `/api/items/<id>/price/` | modifier le prix |
| DELETE | `/api/items/<id>/` | supprimer un article |
| POST | `/api/reset/` | réinitialiser le stock |
| POST | `/api/history/clear/` | vider l'historique |
| POST | `/api/todos/` | créer une tâche |
| POST | `/api/todos/<id>/toggle/` | cocher / décocher |
| DELETE | `/api/todos/<id>/` | supprimer une tâche |

Chaque action renvoie le nouvel état complet, que le front applique directement.

## Fonctionnement hors ligne (PWA)

Les deux pages (**admin** et **caisse/POS**) continuent de fonctionner sans connexion.

- **Installation** : ouvrez l'app dans le navigateur puis « Ajouter à l'écran d'accueil »
  (le `manifest` et le service worker `/sw.js` sont déjà configurés).
- **Hors ligne** : le dernier état connu (articles, stock, prix) est servi depuis le cache du
  navigateur. On peut **prendre des commandes**, faire des mouvements de stock, etc. : le stock
  est décrémenté localement de façon optimiste.
- **File d'attente** : chaque écriture faite hors ligne est mise en file et **rejouée
  automatiquement** dès le retour du réseau, puis l'app se resynchronise sur l'état du serveur.
  Une pastille en bas à droite indique l'état (« Hors ligne — N en attente », « Synchronisé ✓ »).
- **Conflits** : la validation définitive reste côté serveur. Si une commande synchronisée est
  refusée (ex. stock épuisé entre-temps depuis un autre poste), elle est signalée après la synchro.

Côté code : tout passe par `static/offline.js` (`window.BarStock`), qui encapsule le cache
(localStorage), la file d'attente, le *reducer* local (miroir de `inventory/views.py`) et la
synchronisation. `app.js` et `gerant.js` appellent simplement `window.BarStock.api(...)`.

## Archives (inventaires de fin de journée)

- Onglet **Archives** : liste tous les inventaires archivés, téléchargeables en **CSV** (Excel).
- **Archivage automatique** : à chaque ouverture de l'app, toute journée passée non encore
  archivée est archivée automatiquement (déclenché dans `GET /api/state/`).
- Bouton **« Archiver aujourd'hui »** pour forcer l'archivage du jour en cours.
- Chaque archive contient l'historique de la journée **et** l'inventaire (stock) au moment de l'archivage.

### Archivage planifié (vraie fin de journée)

Une commande permet d'archiver via le planificateur de tâches Windows :

```bash
python manage.py archive_day              # archive aujourd'hui
python manage.py archive_day --yesterday  # archive hier
```

Exemple : créer une tâche planifiée Windows qui exécute, chaque soir à 23h59 :

```
python C:\Users\USER\Desktop\stock\manage.py archive_day
```
