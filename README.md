# Biblio, du code à la supervision (BC3)

Biblio est une application web de gestion de bibliothèque. Elle permet de consulter un catalogue, d'emprunter et de réserver des livres, et envoie des rappels automatiques. Le projet couvre toute la chaîne d'exploitation demandée par le sujet BC3, avec les conteneurs, Kubernetes, la CI/CD, Terraform, la supervision, la sécurité et le suivi des coûts.

La documentation se trouve dans docs/DOCUMENTATION.md. Le déroulé complet et les captures d'écran sont dans le compte rendu remis avec le dépôt.

## Lancer le projet en local

Il faut copier le fichier .env.example en .env, remplacer les valeurs "change-me", puis lancer Docker Compose.

```bash
cp .env.example .env
docker compose up --build -d
```

L'application est ensuite disponible sur http://localhost:8080 et les courriels envoyés sont visibles sur http://localhost:8025. Un catalogue d'exemple à importer se trouve dans samples/catalogue-exemple.csv.

## Fonctionnement de l'application

Un membre peut chercher un livre, l'emprunter pour 21 jours (5 livres au maximum), réserver un livre déjà emprunté et exporter son historique en PDF. Un bibliothécaire peut en plus gérer le catalogue, ajouter des couvertures, importer un fichier CSV et enregistrer les retours. Un administrateur peut aussi gérer les rôles des utilisateurs.

Un programme séparé, le worker, s'occupe des tâches longues en arrière-plan. Il envoie les courriels, importe les catalogues, crée les PDF, sauvegarde la base et lance chaque matin à 8 h les rappels et les relances de retard.

## Organisation du dépôt

- frontend, backend et worker contiennent le code de l'application, ses Dockerfiles et ses tests.
- docker-compose.yml lance toute l'application en local.
- k8s contient la configuration Kubernetes pour le local, le dev et la prod.
- infra/terraform crée l'infrastructure sur Azure.
- .github contient le pipeline CI/CD et l'arrêt planifié du cluster.
- docs contient la documentation du projet.
- scripts, tests/load et samples contiennent les scripts utiles, le test de charge et le catalogue d'exemple.
