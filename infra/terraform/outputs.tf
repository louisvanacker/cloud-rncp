output "resource_group" {
  value = azurerm_resource_group.this.name
}

output "aks_name" {
  value = azurerm_kubernetes_cluster.this.name
}

output "acr_login_server" {
  value = azurerm_container_registry.this.login_server
}

# À recopier dans les "Variables" GitHub (Settings > Secrets and variables > Actions > Variables)
output "github_variables" {
  value = {
    AZURE_CLIENT_ID       = azurerm_user_assigned_identity.github.client_id
    AZURE_TENANT_ID       = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = data.azurerm_client_config.current.subscription_id
    AZURE_RESOURCE_GROUP  = azurerm_resource_group.this.name
    AKS_NAME              = azurerm_kubernetes_cluster.this.name
    ACR_NAME              = azurerm_container_registry.this.name
    ACR_LOGIN_SERVER      = azurerm_container_registry.this.login_server
  }
}

output "ingress_hint" {
  value = "IP publique de l'Ingress : kubectl get svc -n app-routing-system nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'  -> hôte <IP>.nip.io"
}

# Fichiers azure-settings.env des overlays Kustomize (valeurs NON secrètes)
output "azure_settings_dev" {
  value = contains(var.environments, "dev") ? local.azure_settings["dev"] : null
}

output "azure_settings_prod" {
  value = contains(var.environments, "prod") ? local.azure_settings["prod"] : null
}

output "grafana_admin_password" {
  value     = random_password.grafana.result
  sensitive = true
}

output "seed_admin_passwords" {
  value     = { for env in var.environments : env => random_password.admin[env].result }
  sensitive = true
}

locals {
  azure_settings = {
    for env in var.environments : env => <<-EOT
      # Fichier GÉNÉRÉ par Terraform (output azure_settings_${env}) - aucune valeur secrète
      TENANT_ID=${data.azurerm_client_config.current.tenant_id}
      KEYVAULT_NAME=${azurerm_key_vault.env[env].name}
      APP_CLIENT_ID=${azurerm_user_assigned_identity.workload["${env}-app"].client_id}
      DATA_CLIENT_ID=${azurerm_user_assigned_identity.workload["${env}-data"].client_id}
      STORAGE_ACCOUNT_URL=${azurerm_storage_account.this.primary_blob_endpoint}
      HOST=${env == "prod" ? "" : "${env}."}biblio.A_REMPLACER_PAR_IP_INGRESS.nip.io
      ACME_EMAIL=${var.acme_email}
      ATTACHMENTS_CONTAINER=attachments-${env}
      BACKUPS_CONTAINER=backups-${env}
    EOT
  }
}
