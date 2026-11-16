# Un Key Vault par environnement : un secret de dev ne peut jamais servir en prod.
resource "azurerm_key_vault" "env" {
  for_each                   = toset(var.environments)
  name                       = "kv-${var.project}-${each.key}-${local.suffix}"
  location                   = azurerm_resource_group.this.location
  resource_group_name        = azurerm_resource_group.this.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  enable_rbac_authorization  = true # droits par rôle Azure (pas de "access policies")
  soft_delete_retention_days = 7
  purge_protection_enabled   = false # projet d'école ; true en production réelle

  # Pare-feu : seul le sous-réseau AKS (CSI driver) et votre IP (Terraform) peuvent lire les secrets
  network_acls {
    default_action             = length(var.admin_ip_ranges) > 0 ? "Deny" : "Allow"
    bypass                     = "AzureServices"
    virtual_network_subnet_ids = [azurerm_subnet.aks.id]
    ip_rules                   = var.admin_ip_ranges
  }
  tags = merge(local.tags, { environment = each.key })
}

# Terraform écrit les secrets : rôle "Secrets Officer" pour l'utilisateur courant
resource "azurerm_role_assignment" "me_kv" {
  for_each             = azurerm_key_vault.env
  scope                = each.value.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Secrets générés aléatoirement : personne ne les choisit, personne ne les tape.
resource "random_password" "db" {
  for_each = toset(var.environments)
  length   = 32
  special  = false
}
resource "random_password" "redis" {
  for_each = toset(var.environments)
  length   = 32
  special  = false
}
resource "random_password" "jwt" {
  for_each = toset(var.environments)
  length   = 64
  special  = false
}
resource "random_password" "admin" {
  for_each = toset(var.environments)
  length   = 20
  special  = true
}

locals {
  kv_secrets = merge([
    for env in var.environments : {
      "${env}/db-password"         = { env = env, name = "db-password", value = random_password.db[env].result }
      "${env}/redis-password"      = { env = env, name = "redis-password", value = random_password.redis[env].result }
      "${env}/jwt-secret"          = { env = env, name = "jwt-secret", value = random_password.jwt[env].result }
      "${env}/seed-admin-email"    = { env = env, name = "seed-admin-email", value = var.seed_admin_email }
      "${env}/seed-admin-password" = { env = env, name = "seed-admin-password", value = random_password.admin[env].result }
    }
  ]...)
}

resource "azurerm_key_vault_secret" "this" {
  for_each     = local.kv_secrets
  name         = each.value.name
  value        = each.value.value
  key_vault_id = azurerm_key_vault.env[each.value.env].id
  content_type = "text/plain"
  depends_on   = [azurerm_role_assignment.me_kv]
}
