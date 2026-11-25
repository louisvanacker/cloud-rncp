# FinOps — coût estimé, coût réel et optimisations mesurées

Chiffres relevés pendant le TP (novembre 2026) : région **Belgium Central**, 2 nœuds **Standard_D2as_v4**,
paiement à l'usage. Estimation avec l'[Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/),
coût réel dans **Cost Management** (abonnement Azure for Students).

## 1. Méthode

1. **Estimer** avec la calculatrice Azure, en reprenant exactement les ressources créées par Terraform.
2. **Mesurer** dans Cost Management : *Analyse du coût* → coût par ressource, puis coût quotidien.
3. **Comparer** avant / après chaque optimisation.

Toutes les ressources portent les tags `project`, `owner`, `cost-center`, `managed-by` : c'est ce qui permet
d'attribuer chaque coût au projet.

## 2. Estimation

| Poste | Hypothèse | $ / mois |
|---|---|---|
| Plan de contrôle AKS | Standard, option « No SLA » (gratuit) | 0 |
| Nœuds AKS | 2 × D2as_v4, 730 h | 167,90 |
| Disques OS des nœuds | 2 × E6 Standard SSD 64 Go | 9,60 |
| Container Registry | Basic | 5,00 |
| Adresse IP publique, stockage Blob (5 Go LRS) | | ~3,85 |
| **Total, cluster allumé 24 h/24** | | **186,35** |
| **Total avec arrêt planifié** (nœuds 240 h/mois) | | **~74** |

Les nœuds représentent environ 90 % du coût : c'est sur eux que les optimisations ont le plus d'effet.

## 3. Coût réel mesuré

- Premiers jours : **1,18 €** au total, dont **0,88 €** pour les nœuds (75 %), le reste pour les IP publiques,
  l'ACR et les disques ; Key Vault et stockage < 0,01 €.
- Coût quotidien : **~1,10 €** un jour où le cluster tourne, **quelques centimes** un jour où il est arrêté.

## 4. Optimisations appliquées et effet

| # | Optimisation | Où | Effet |
|---|---|---|---|
| 1 | **Arrêt du cluster hors utilisation** (`az aks stop`, workflow `finops-schedule.yml`) | GitHub Actions | 186 $ → ~74 $/mois estimés (−60 %) ; réel : ~1,10 €/jour allumé contre quelques centimes éteint |
| 2 | **Rightsizing des requests + HPA** : au repos l'API consomme 3m CPU pour 50m réservés | `k8s/base/*.yaml` | les 15 conteneurs (dev + prod) réservent ~0,6 vCPU / 1,3 Go ; avec des réservations « par défaut » (0,5 vCPU / 512 Mo par conteneur) il faudrait 7,5 vCPU, soit 4 nœuds au lieu de 2 (~+168 $/mois, et au-delà du quota de 6 vCPU) |
| 3 | Plan de contrôle AKS sans SLA | `aks.tf` | 0 $ au lieu de ~70 $/mois |
| 4 | Prometheus + Loki dans le cluster plutôt que Container Insights | `platform.tf` | aucune facturation des journaux au Go |
| 5 | Disques OS 64 Go Standard SSD, stockage LRS, cycle de vie Blob (froid à 7 j, suppression à 30 j) | `aks.tf`, `storage.tf` | disques et stockage à quelques centimes par jour |
| 6 | dev et prod sur un même cluster (namespaces, quotas, `services.loadbalancers = 0`) | `platform.tf` | évite un second cluster et toute IP publique créée par erreur |
| 7 | Images légères multi-stage (21 / 79 / 84 Mo) | `Dockerfile`s | moins de stockage ACR, démarrage des pods plus rapide |

## 5. Garde-fou budgétaire

Budget **budget-CloudRNCP** : 25 €/mois sur l'abonnement, alertes e-mail à 50, 80 et 100 %.

Piste d'amélioration : au repos, l'autoscaler garde 2 nœuds car la supervision (Prometheus, Grafana, Loki)
réserve beaucoup de mémoire ; réduire ses réservations permettrait de revenir à 1 nœud au repos (~−50 % sur les nœuds).

En fin de séance : `az aks stop -g rg-biblio -n aks-biblio-gzx4h`. Après la notation : `terraform destroy`.
