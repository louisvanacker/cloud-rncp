# Stockage objet : couvertures, CSV d'import, exports PDF et sauvegardes PostgreSQL.
resource "azurerm_storage_account" "this" {
  name                     = "st${var.project}${local.suffix}"
  location                 = azurerm_resource_group.this.location
  resource_group_name      = azurerm_resource_group.this.name
  account_tier             = "Standard"
  account_replication_type = "LRS" # FinOps : 3 copies dans 1 datacenter, suffisant ici
  account_kind             = "StorageV2"
  access_tier              = "Hot"

  # Sécurité (ISO 27001 A.8.24 / A.8.5)
  min_tls_version                   = "TLS1_2"
  https_traffic_only_enabled        = true
  allow_nested_items_to_be_public   = false
  shared_access_key_enabled         = false # aucune clé : uniquement Entra ID + rôles IAM
  infrastructure_encryption_enabled = true  # double chiffrement au repos (AES-256)
  default_to_oauth_authentication   = true

  # Pare-feu : seul le sous-réseau AKS (et votre IP pour Terraform) peut joindre le stockage
  network_rules {
    default_action             = length(var.admin_ip_ranges) > 0 ? "Deny" : "Allow"
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = [azurerm_subnet.aks.id]
    ip_rules                   = var.admin_ip_ranges
  }

  blob_properties {
    versioning_enabled       = true
    last_access_time_enabled = true # requis par la règle "covers-cool" (dernier accès)
    delete_retention_policy {
      days = 7 # corbeille : un fichier supprimé par erreur reste récupérable 7 jours
    }
    container_delete_retention_policy {
      days = 7
    }
  }

  tags = local.tags
}

# Un conteneur par usage et par environnement (séparation dev/prod, ISO 27001 A.8.31)
locals {
  containers = merge([
    for env in var.environments : {
      "attachments-${env}" = env
      "backups-${env}"     = env
    }
  ]...)
}

resource "azurerm_storage_container" "this" {
  for_each              = local.containers
  name                  = each.key
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
  depends_on            = [azurerm_role_assignment.me_blob]
}

# Terraform (l'utilisateur courant) doit pouvoir créer les conteneurs sans clé partagée
resource "azurerm_role_assignment" "me_blob" {
  scope                = azurerm_storage_account.this.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = data.azurerm_client_config.current.object_id
}

# FinOps : cycle de vie automatique des objets
resource "azurerm_storage_management_policy" "this" {
  storage_account_id = azurerm_storage_account.this.id

  rule {
    name    = "backups-cool-then-delete"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = [for env in var.environments : "backups-${env}/"]
    }
    actions {
      base_blob {
        tier_to_cool_after_days_since_creation_greater_than = 7  # stockage froid ~2x moins cher
        delete_after_days_since_creation_greater_than       = 30 # rétention des sauvegardes : 30 j
      }
      version {
        delete_after_days_since_creation = 7
      }
    }
  }

  rule {
    name    = "exports-expire"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = [for env in var.environments : "attachments-${env}/exports/"]
    }
    actions {
      base_blob {
        delete_after_days_since_creation_greater_than = 7 # filet de sécurité en plus du nettoyage du worker
      }
    }
  }

  rule {
    name    = "imports-expire"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = [for env in var.environments : "attachments-${env}/imports/"]
    }
    actions {
      base_blob {
        delete_after_days_since_creation_greater_than = 30 # CSV d'import : inutiles une fois traités
      }
    }
  }

  rule {
    name    = "covers-cool"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = [for env in var.environments : "attachments-${env}/covers/"]
    }
    actions {
      base_blob {
        tier_to_cool_after_days_since_last_access_time_greater_than = 30
      }
      version {
        delete_after_days_since_creation = 30
      }
    }
  }
}