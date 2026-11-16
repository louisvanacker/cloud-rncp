# SLI / SLO de l'API Biblio

## Définitions

| | SLI (ce qu'on mesure) | SLO (objectif) | Fenêtre |
|---|---|---|---|
| **Disponibilité** | part des requêtes `/api` **sans** réponse 5xx | **99,5 %** | 30 jours glissants |
| **Latence** | part des requêtes `/api` servies en **< 300 ms** (p95) | **95 %** | 30 jours glissants |

- Source : métriques `http_requests_total` et `http_request_duration_seconds` exposées par le backend (`/metrics`), labellisées par route normalisée (`/api/books/:id`, pas l'ID réel → cardinalité maîtrisée).
- Les 4xx (erreurs du client : validation, 401, 404) ne consomment pas le budget.
- Les sondes `/healthz`, `/readyz`, `/metrics` sont exclues des métriques.

## Budget d'erreur

99,5 % sur 30 jours → **0,5 % d'erreurs autorisées**, soit environ **3 h 36 min** d'indisponibilité totale par mois.

## Alertes (fichier `k8s/components/monitoring/prometheusrule.yaml`)

Méthode « multi-window, multi-burn-rate » (Google SRE Workbook) :

| Alerte | Condition | Sens | Sévérité |
|---|---|---|---|
| `BiblioErrorBudgetFastBurn` | taux d'erreur > 14,4 × 0,5 % sur 1 h **et** 5 min | budget mensuel épuisé en ~2 jours | critical |
| `BiblioErrorBudgetSlowBurn` | taux d'erreur > 6 × 0,5 % sur 6 h **et** 30 min | budget épuisé en ~5 jours | warning |
| `BiblioApiHighLatency` | p95 > 300 ms pendant 10 min | SLO latence menacé | warning |
| `BiblioApiDown` | aucun pod backend scrapable pendant 2 min | panne totale | critical |

La double fenêtre évite à la fois les fausses alertes (pic de 2 minutes) et les alertes tardives.

Alertes complémentaires (non SLO) : échecs du worker, file engorgée, sauvegarde en échec, volume PostgreSQL plein à 85 %, rafale d'échecs de connexion (sécurité).

## Comment le démontrer

1. Dashboard Grafana « Biblio — Vue d'ensemble » : tuiles disponibilité 30 j, budget restant, p95.
2. Test de charge k6 (`tests/load/k6-load.js`) : ses seuils reprennent les SLO (`http_req_failed < 0,5 %`, `p95 < 300 ms`).
3. Provoquer une alerte en dev : supprimer l'HPA puis mettre le backend à 0 réplica (`kubectl delete hpa backend -n biblio-dev` puis `kubectl scale deploy/backend -n biblio-dev --replicas=0`) → `BiblioApiDown` en ~3 min → e-mail dans Mailpit. Retour à la normale : `kubectl scale ... --replicas=1` puis relancer le dernier run CI pour recréer l'HPA (voir GUIDE, étape 7).
