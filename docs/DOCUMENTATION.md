# Documentation du projet Biblio

Ce document résume les choix du projet. Le détail des tests et les captures d'écran se trouvent dans le compte rendu.

## Architecture

L'application est composée de cinq éléments. Le frontend (React) affiche le site, l'API (Node.js) traite les demandes, PostgreSQL enregistre les données, Redis sert de file d'attente et le worker exécute les tâches longues en arrière-plan (courriels, import CSV, export PDF, rappels quotidiens, sauvegardes). Les fichiers sont rangés dans MinIO en local et dans Azure Blob Storage dans le cloud.

L'API ne garde aucune session en mémoire, ce qui permet à Kubernetes d'en lancer plusieurs copies. La base tourne dans le cluster avec un disque persistant, ce qui est moins cher qu'une base gérée par Azure mais provoque une courte coupure si elle redémarre.

Le projet est déployé sur AKS, dans la région Belgium Central, avec deux machines D2as_v4. Ce choix est imposé par les règles de l'abonnement étudiant. Les environnements dev et prod partagent le même cluster mais restent séparés.

## Supervision

Prometheus collecte les métriques, Loki les journaux, et Grafana affiche un tableau de bord. Trois objectifs sont suivis sur 30 jours.

- Au moins 99,5 % des requêtes doivent réussir.
- 95 % des requêtes doivent répondre en moins de 300 ms.
- La tâche quotidienne doit réussir chaque jour.

Des alertes préviennent par courriel si un objectif est menacé ou si l'API ne répond plus depuis 2 minutes.

## Sécurité

Les principales mesures suivent la norme ISO 27001.

- Les données sont chiffrées sur les disques et pendant leur transport (HTTPS, TLS vers la base).
- Chaque composant a ses propres droits, réduits au minimum.
- Les mots de passe sont générés par Terraform et rangés dans Key Vault, jamais dans le code.
- Les conteneurs ne tournent pas en administrateur et le réseau bloque tout échange non prévu.
- La base est sauvegardée chaque nuit et la restauration a été testée.
- La branche main est protégée et chaque mise en prod demande une approbation.

## Coûts

Avec les machines allumées en permanence, le projet coûterait environ 186 $ par mois. En arrêtant le cluster en dehors des heures de travail, le coût estimé tombe à environ 74 $ par mois. Les ressources réservées par les conteneurs ont aussi été réduites au strict nécessaire, ce qui évite de payer deux machines de plus. Un budget de 25 € par mois envoie une alerte en cas de dépassement.

Pour arrêter le cluster après une séance de travail, il suffit de lancer `az aks stop -g rg-biblio -n aks-biblio-gzx4h`.
