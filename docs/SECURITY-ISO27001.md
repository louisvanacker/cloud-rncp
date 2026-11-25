# Sécurité — contrôles ISO/IEC 27001:2022 (Annexe A) et déclaration d'applicabilité

Ce document reprend chaque mesure demandée en section 5 du sujet, la relie au(x) contrôle(s) de l'Annexe A et indique **où elle est implémentée** et **comment le prouver**. La dernière partie est la mini « déclaration d'applicabilité » (SoA) facultative.

## 1. Mesures → contrôles → preuves

| Mesure mise en place | Contrôle(s) Annexe A | Où dans le dépôt | Preuve à montrer |
|---|---|---|---|
| **Chiffrement au repos** : disques AKS et PVC chiffrés par Azure (SSE, AES-256) ; Blob avec double chiffrement (`infrastructure_encryption_enabled`) ; Key Vault | A.8.24 Utilisation de la cryptographie | `infra/terraform/storage.tf`, `aks.tf` | `az storage account show -n <st> --query encryption` |
| **Chiffrement en transit** : HTTPS Let's Encrypt à l'Ingress (TLS ≥ 1.2, redirection forcée) ; PostgreSQL en TLS obligatoire (`hostssl` + vérification du certificat par les clients) ; Blob en HTTPS uniquement, TLS 1.2 min | A.8.24 | `k8s/components/azure/issuer-letsencrypt.yaml`, `k8s/components/pg-tls/`, `backend/src/db.js` | `curl -vI https://<hôte>` ; `SELECT ssl, version FROM pg_stat_ssl;` |
| **Moindre privilège — Azure** : une identité par rôle et par environnement (app / data / CI), rôles minimaux (`Key Vault Secrets User`, `Storage Blob Data Contributor` **sur un conteneur**, `AcrPull`, `AcrPush`) | A.5.15 Contrôle d'accès · A.8.2 Droits d'accès à privilèges · A.8.3 Restriction de l'accès à l'information | `infra/terraform/identity.tf` | `az role assignment list --assignee <client-id> -o table` |
| **Moindre privilège — Kubernetes** : un ServiceAccount par composant sans jeton monté ; CI limitée à son namespace (Azure RBAC) ; rôle `biblio-viewer` sans accès aux Secrets ; Pod Security `restricted` ; conteneurs non-root, FS en lecture seule, capabilities supprimées | A.5.15 · A.8.2 · A.8.3 | `k8s/base/serviceaccounts.yaml`, `rbac.yaml`, `*.yaml` (securityContext), `platform.tf` | `kubectl auth can-i --list -n biblio-prod --as=system:serviceaccount:biblio-prod:backend` |
| **Segmentation réseau** : NetworkPolicies « deny all » puis ouverture flux par flux ; la base n'accepte que backend/worker/backup ; pare-feu Storage et Key Vault limité au sous-réseau AKS | A.8.20 Sécurité des réseaux · A.8.22 Cloisonnement des réseaux | `k8s/base/networkpolicies.yaml`, `storage.tf`, `keyvault.tf` | test `kubectl run` → postgres refusé (compte rendu, partie 7) |
| **Authentification sécurisée des utilisateurs** : mots de passe bcrypt (coût 12), 10 caractères min., JWT signé à durée courte (1 h), limitation de débit anti brute force, réponse identique compte inexistant / mauvais mot de passe | A.8.5 Authentification sécurisée | `backend/src/routes/auth.js`, `auth.js` | tests `tests/app.test.js` ; 11 tentatives → 429 |
| **Gestion des secrets** : aucun secret dans Git ni dans les images ; secrets générés aléatoirement par Terraform, stockés dans Key Vault, montés par CSI ; CI sans secret (OIDC) ; détection gitleaks en CI ; masquage dans les logs | A.5.17 Informations d'authentification · A.8.12 Prévention de la fuite de données | `keyvault.tf`, `k8s/components/azure/secretproviderclass.yaml`, `.github/workflows/ci-cd.yml`, `backend/src/logger.js` | `git grep -i password` ne montre que des références ; job gitleaks vert |
| **Journalisation des événements de sécurité** : événements tagués `security=true` (connexions réussies / échouées, jeton invalide, accès refusé, changement de rôle, sauvegarde) en JSON → Loki (7 j) ; `log_connections` PostgreSQL | A.8.15 Journalisation | `backend/src/logger.js`, `platform.tf` (Loki/Alloy) | requête Loki `{namespace="biblio-prod"} \| json \| security="true"` |
| **Supervision, tableaux de bord et alertes** : Prometheus + Grafana + Alertmanager, alertes SLO et sécurité (brute force) | A.8.16 Activités de surveillance | `k8s/components/monitoring/` | dashboard + alerte reçue dans Mailpit |
| **Sauvegardes** : `pg_dump` quotidien vers Blob `backups-<env>`, versioning + corbeille 7 j, cycle de vie (froid à 7 j, suppression à 30 j), alerte en cas d'échec, test de restauration documenté | A.8.13 Sauvegarde des informations | `k8s/base/backup-cronjob.yaml`, `worker/src/backup.js`, `storage.tf` | job manuel + fichier listé dans le conteneur + restauration (compte rendu, partie 7) |
| **Configuration décrite et versionnée par le code** | A.8.9 Gestion de la configuration | `infra/terraform/`, `k8s/`, `.github/` | `terraform plan` sans changement = pas de dérive |
| **Séparation dev / test / prod** : namespaces, Key Vault, identités et conteneurs Blob distincts ; prod déployée uniquement sur tag + approbation | A.8.31 Séparation des environnements | `k8s/overlays/*`, `identity.tf` | l'identité dev n'a aucun rôle sur `kv-...-prod` |
| **Contrôle d'accès au code source** : branche `main` protégée (PR + revue + CI verte obligatoires), environnement `production` avec relecteur requis, CODEOWNERS | A.8.4 Accès au code source | `.github/CODEOWNERS` + réglages GitHub (compte rendu, partie 5) | capture des règles de protection |
| **Sécurité intégrée à la CI/CD** : lint, tests, `npm audit`, gitleaks, Trivy (IaC + images, bloquant), images minimales non-root, dépendances figées (`package-lock.json`) | A.8.25 Cycle de vie de développement sécurisé · A.8.28 Codage sécurisé · A.8.7 Protection contre les logiciels malveillants | `.github/workflows/ci-cd.yml`, `Dockerfile`s | historique des runs, résumé Trivy |
| **Codage sécurisé applicatif** : validation stricte (zod) y compris de chaque ligne des CSV importés, requêtes SQL paramétrées, règles métier en **transaction** avec décrément atomique (pas de double emprunt du dernier exemplaire), en-têtes de sécurité (helmet, CSP), types et tailles de fichiers contrôlés (couvertures PNG/JPEG/WebP 2 Mo, CSV 1 Mo), 404 au lieu de 403 sur les ressources d'autrui, erreurs 500 sans détail | A.8.28 Codage sécurisé | `backend/src/routes/*.js`, `worker/src/jobs/import.js`, `frontend/nginx/` | tests d'isolation et de règles métier dans `app.test.js` |
| **Gestion des vulnérabilités techniques** : mises à jour automatiques AKS (patch) et images des nœuds, image cleaner, Dependabot | A.8.8 Gestion des vulnérabilités techniques | `aks.tf`, `.github/dependabot.yml` | PR Dependabot ouvertes |

## 2. Exceptions acceptées (risques résiduels)

Voir `.trivyignore` :
- **API AKS publique** (AZU-0041) : nécessaire aux runners GitHub hébergés ; compensé par Entra ID + Azure RBAC.
- **Pare-feu Storage / Key Vault en « Allow »** tant que `admin_ip_ranges` est vide (AZU-0012/0013) : passe à « Deny » dès que l'IP admin est renseignée.
- **Comptes locaux AKS conservés** pour que Terraform installe les charts Helm sans kubelogin.
- **Redis sans persistance** : perte possible des tâches en attente si le pod redémarre (notifications et exports peuvent être redemandés).
- **Mailpit** à la place d'un vrai SMTP : aucun e-mail ne sort du cluster.
- **Couvertures lisibles sans authentification** (`GET /api/books/:id/cover`) : une balise `<img>` ne peut pas envoyer de jeton. Risque faible : une couverture de livre n'est pas une donnée personnelle ni confidentielle ; l'écriture reste réservée aux bibliothécaires. Les CSV d'import et les exports PDF (données personnelles : historique d'emprunts) restent protégés.

## 3. Déclaration d'applicabilité (SoA) — extrait

| Contrôle | Intitulé | Applicable | Mis en œuvre | Justification |
|---|---|---|---|---|
| A.5.15 | Contrôle d'accès | Oui | Oui | Accès aux données et à l'infrastructure restreint par rôle (app, Azure, K8s) |
| A.5.17 | Informations d'authentification | Oui | Oui | Secrets générés, stockés dans Key Vault, jamais affichés ni commités |
| A.8.2 | Droits d'accès à privilèges | Oui | Oui | Admin cluster réservé au porteur du projet ; CI limitée au namespace |
| A.8.3 | Restriction de l'accès à l'information | Oui | Oui | Un membre ne voit que ses emprunts, réservations et exports ; pas de lecture des Secrets K8s |
| A.8.4 | Accès au code source | Oui | Oui | Branche protégée, revue obligatoire |
| A.8.5 | Authentification sécurisée | Oui | Partiel | bcrypt + JWT + rate limiting ; MFA non implémentée (amélioration : OIDC Entra ID) |
| A.8.7 | Protection contre les logiciels malveillants | Oui | Oui | Scan des images, types de fichiers téléversés restreints |
| A.8.8 | Gestion des vulnérabilités techniques | Oui | Oui | Mises à jour auto AKS, Dependabot, npm audit |
| A.8.9 | Gestion de la configuration | Oui | Oui | Tout est en Terraform / Kustomize versionné |
| A.8.12 | Prévention de la fuite de données | Oui | Oui | Masquage des logs, pas d'URL publique vers les CSV ni les historiques PDF, gitleaks |
| A.8.13 | Sauvegarde des informations | Oui | Oui | Sauvegarde quotidienne, rétention 30 j, test de restauration |
| A.8.15 | Journalisation | Oui | Oui | Événements de sécurité centralisés dans Loki |
| A.8.16 | Activités de surveillance | Oui | Oui | Alertes SLO + brute force |
| A.8.20 / A.8.22 | Sécurité / cloisonnement des réseaux | Oui | Oui | NetworkPolicies, pare-feu des services PaaS |
| A.8.24 | Utilisation de la cryptographie | Oui | Oui | TLS partout, chiffrement au repos natif + double chiffrement Blob |
| A.8.25 | Cycle de vie de développement sécurisé | Oui | Oui | Pipeline avec contrôles bloquants |
| A.8.28 | Codage sécurisé | Oui | Oui | Validation, requêtes paramétrées, en-têtes de sécurité |
| A.8.31 | Séparation des environnements | Oui | Partiel | Namespaces et ressources distincts, mais cluster partagé (choix FinOps) |
| A.7.x | Contrôles physiques | Non | — | Délégués à Microsoft Azure (modèle de responsabilité partagée) |
| A.6.x | Contrôles liés aux personnes | Non | — | Hors périmètre d'un projet technique |
