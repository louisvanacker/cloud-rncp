# ===================== Identités des workloads (Workload Identity) =====================
# Par environnement, deux identités (moindre privilège, ISO 27001 A.5.15 / A.8.2) :
#   app  : backend + worker + sauvegarde -> lecture Key Vault + écriture Blob (conteneurs de SON env)
#   data : postgres + redis               -> lecture Key Vault uniquement
locals {
  issuer = azurerm_kubernetes_cluster.this.oidc_issuer_url
  federations = merge([
    for env in var.environments : {
      "${env}-backend" = { env = env, identity = "app", sa = "backend" }
      "${env}-worker"  = { env = env, identity = "app", sa = "worker" }
      "${env}-data"    = { env = env, identity = "data", sa = "data" }
    }
  ]...)
  identities = merge([
    for env in var.environments : {
      "${env}-app"  = env
      "${env}-data" = env
    }
  ]...)
}

resource "azurerm_user_assigned_identity" "workload" {
  for_each            = local.identities
  name                = "id-${var.project}-${each.key}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = merge(local.tags, { environment = each.value })
}

resource "azurerm_federated_identity_credential" "workload" {
  for_each            = local.federations
  name                = "fic-${each.key}"
  resource_group_name = azurerm_resource_group.this.name
  parent_id           = azurerm_user_assigned_identity.workload["${each.value.env}-${each.value.identity}"].id
  issuer              = local.issuer
  audience            = ["api://AzureADTokenExchange"]
  subject             = "system:serviceaccount:${var.project}-${each.value.env}:${each.value.sa}"
}

resource "azurerm_role_assignment" "workload_kv" {
  for_each             = local.identities
  scope                = azurerm_key_vault.env[each.value].id
  role_definition_name = "Key Vault Secrets User" # lecture seule des secrets
  principal_id         = azurerm_user_assigned_identity.workload[each.key].principal_id
}

resource "azurerm_role_assignment" "app_blob" {
  for_each             = local.containers
  scope                = azurerm_storage_container.this[each.key].id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.workload["${each.value}-app"].principal_id
}

# ===================== Identité de la CI/CD (GitHub Actions, OIDC) =====================
# Aucun secret Azure stocké dans GitHub : GitHub présente un jeton OIDC signé,
# accepté uniquement pour ce dépôt et ces branches / environnements.
resource "azurerm_user_assigned_identity" "github" {
  name                = "id-${var.project}-github-actions"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

locals {
  github_subjects = {
    main       = "repo:${var.github_repository}:ref:refs/heads/main"
    pr         = "repo:${var.github_repository}:pull_request"
    env-dev    = "repo:${var.github_repository}:environment:dev"
    env-prod   = "repo:${var.github_repository}:environment:production"
    env-finops = "repo:${var.github_repository}:environment:finops"
  }
}

resource "azurerm_federated_identity_credential" "github" {
  for_each            = local.github_subjects
  name                = "github-${each.key}"
  resource_group_name = azurerm_resource_group.this.name
  parent_id           = azurerm_user_assigned_identity.github.id
  issuer              = "https://token.actions.githubusercontent.com"
  audience            = ["api://AzureADTokenExchange"]
  subject             = each.value
}

# Pousser les images
resource "azurerm_role_assignment" "github_acr_push" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPush"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}

# Récupérer le kubeconfig (aucun droit Kubernetes en soi)
resource "azurerm_role_assignment" "github_aks_user" {
  scope                = azurerm_kubernetes_cluster.this.id
  role_definition_name = "Azure Kubernetes Service Cluster User Role"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}

# Déployer : droits d'admin LIMITÉS à chaque namespace applicatif
# (ne peut ni créer de namespace, ni modifier les quotas, ni toucher kube-system / monitoring)
resource "azurerm_role_assignment" "github_aks_ns" {
  for_each             = toset(var.environments)
  scope                = "${azurerm_kubernetes_cluster.this.id}/namespaces/${var.project}-${each.key}"
  role_definition_name = "Azure Kubernetes Service RBAC Admin"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
  depends_on           = [kubernetes_namespace.app]
}

# FinOps : le workflow planifié peut arrêter / démarrer le cluster la nuit et le week-end
resource "azurerm_role_assignment" "github_aks_startstop" {
  scope                = azurerm_kubernetes_cluster.this.id
  role_definition_name = "Azure Kubernetes Service Contributor Role"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}

# Équipe dev (optionnel) : lecture seule sur les namespaces applicatifs
resource "azurerm_role_assignment" "devs_reader" {
  for_each             = var.devs_group_object_id == null ? toset([]) : toset(var.environments)
  scope                = "${azurerm_kubernetes_cluster.this.id}/namespaces/${var.project}-${each.key}"
  role_definition_name = "Azure Kubernetes Service RBAC Reader"
  principal_id         = var.devs_group_object_id
  depends_on           = [kubernetes_namespace.app]
}
