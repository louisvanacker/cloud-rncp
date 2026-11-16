# FinOps — coût chiffré et optimisations mesurées

> ⚠️ Les prix ci-dessous sont des **ordres de grandeur** (paiement à l'usage, Linux, région France Central) donnés pour structurer le calcul. **Recalcule-les le jour J** avec l'[Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/) et mesure le réel dans **Cost Management** (filtre par tag `project = biblio-bc3`). Remplace les valeurs dans les tableaux par tes chiffres.

## 1. Méthode

1. **Estimer** avant déploiement (calculatrice Azure) — tableau 2.
2. **Mesurer** après quelques jours : Cost Management → *Analyse des coûts* → groupé par *ressource*, filtré sur le groupe `rg-biblio` (et le groupe de nœuds `MC_rg-biblio_...`).
3. **Optimiser** et **mesurer à nouveau** pour chiffrer le gain — tableau 3.

Toutes les ressources portent les tags `project`, `owner`, `cost-center`, `managed-by` (Terraform) : c'est ce qui permet d'attribuer les coûts.

## 2. Estimation de référence (« sans optimisation »)

Hypothèse naïve : 2 nœuds 24 h/24, réglages par défaut d'AKS.

| Poste | Hypothèse | Ordre de grandeur / mois |
|---|---|---|
| Nœuds AKS | 2 × Standard_B2als_v2, 730 h | ~ 2 × 30 € = **60 €** |
| Disques OS des nœuds | 2 × 128 Go Premium SSD (défaut AKS) | ~ 2 × 18 € = **36 €** |
| Load Balancer Standard + IP publique | 1 règle d'Ingress | ~ **20 €** |
| Plan de contrôle AKS | tier Standard (SLA) | ~ **70 €** |
| PVC (PostgreSQL ×2, Prometheus, Loki) | ~35 Go Standard SSD | ~ **4 €** |
| ACR | Basic | ~ **5 €** |
| Blob, Key Vault, egress | volumes de projet d'école | < **1 €** |
| Logs Container Insights | si activé, ~2 Go/jour | ~ **150 €** |
| **Total de référence** | | **~ 345 € / mois** |

## 3. Optimisations réellement appliquées et effet mesurable

| # | Optimisation | Où | Effet attendu | Comment le mesurer |
|---|---|---|---|---|
| 1 | **Plan de contrôle AKS « Free »** (pas de SLA, suffisant hors vraie prod) | `aks.tf` `sku_tier = "Free"` | −70 € | ligne « Uptime SLA » absente de la facture |
| 2 | **Arrêt planifié du cluster** soir et week-end (55 h / 168 h) | `.github/workflows/finops-schedule.yml` | nœuds : −67 % (~−40 €) | historique des runs + coût journalier semaine vs week-end dans Cost Management |
| 3 | **Cluster autoscaler 1 → 2 nœuds** : un seul nœud au repos | `aks.tf` `min_count = 1` | ~−30 € quand la charge est faible | `kubectl get nodes` au repos ; métrique « node count » |
| 4 | **Disque OS 64 Go au lieu de 128 Go** | `aks.tf` `os_disk_size_gb` | ~−50 % sur les disques des nœuds | taille des disques dans `MC_...` |
| 5 | **Pas de Container Insights** : Prometheus + Loki dans le cluster, logs limités aux namespaces applicatifs, rétention 7 j | `platform.tf` | −150 € potentiels | aucune ligne Log Analytics |
| 6 | **Rightsizing** : requests basses mesurées (50m / 96 Mi pour l'API), HPA qui ajoute des pods seulement sous charge | `k8s/base/*.yaml` | plus de pods par nœud → moins de nœuds | dashboard Grafana CPU/mémoire vs requests ; `kubectl top pods` |
| 7 | **dev et prod sur le même cluster** (namespaces + quotas) | `platform.tf` | évite un 2e cluster (~−100 €) | 1 seul cluster dans la facture |
| 8 | **Cycle de vie Blob** : sauvegardes en tier froid à 7 j, supprimées à 30 j ; exports PDF supprimés à 7 j et CSV d'import à 30 j (worker + politique Azure) ; couvertures peu consultées en tier froid | `storage.tf`, `worker/src/jobs/cleanup.js` | volume stocké plafonné | taille du compte de stockage dans le temps |
| 9 | **Images légères** multi-stage (front ~20 Mo, API ~60 Mo) | `Dockerfile`s | moins de stockage ACR, démarrage plus rapide des pods | taille affichée dans le résumé CI |
| 10 | **ResourceQuota / LimitRange** par namespace, `services.loadbalancers = 0` | `platform.tf` | aucun service ne peut créer une IP publique facturée par erreur | `kubectl describe quota -n biblio-dev` |

**Résultat cible** : ~345 € → **~50–60 € / mois** (ordre de grandeur), soit environ −80 %.

## 4. Mesures à faire pour le rapport

- [ ] Capture de l'estimation « avant » dans la calculatrice Azure (export Excel possible)
- [ ] Capture Cost Management après ≥ 3 jours : coût par ressource
- [ ] Graphique coût journalier montrant la baisse les jours d'arrêt planifié
- [ ] `kubectl top nodes` / `kubectl top pods -A` au repos (justifie les requests)
- [ ] Nombre de nœuds au repos vs pendant le test de charge k6 (autoscaler)
- [ ] Taille des images (résumé du job CI)

## 5. Garde-fou budgétaire (à créer dans le portail, 2 minutes)

Cost Management → *Budgets* → budget mensuel de 50 € sur `rg-biblio` avec alertes à 50 %, 80 % et 100 % par e-mail. (Sur un compte d'essai, c'est la meilleure assurance contre une mauvaise surprise.)

Et **toujours** en fin de séance : `az aks stop -g rg-biblio -n <aks>` (ou laisser le workflow planifié le faire).
