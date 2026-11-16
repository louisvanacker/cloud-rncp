resource "azurerm_kubernetes_cluster" "this" {
  name                = "aks-${local.name}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  dns_prefix          = "aks-${local.name}"
  kubernetes_version  = var.kubernetes_version
  sku_tier            = "Free" # FinOps : plan de contrôle gratuit (pas de SLA, acceptable hors prod réelle)

  default_node_pool {
    name                 = "system"
    vm_size              = var.node_vm_size
    vnet_subnet_id       = azurerm_subnet.aks.id
    auto_scaling_enabled = true # cluster autoscaler : ajoute/retire des nœuds selon les pods en attente
    min_count            = var.node_min_count
    max_count            = var.node_max_count
    os_disk_size_gb      = var.node_os_disk_gb
    os_sku               = "AzureLinux"
    max_pods             = 110
    upgrade_settings {
      max_surge = "1"
    }
    tags = local.tags
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_data_plane  = "cilium"
    network_policy      = "cilium" # applique les NetworkPolicies du dépôt
    pod_cidr            = "192.168.0.0/16"
    service_cidr        = "10.20.0.0/16"
    dns_service_ip      = "10.20.0.10"
    load_balancer_sku   = "standard"
  }

  # Workload Identity : les pods échangent leur jeton Kubernetes contre un jeton Entra ID
  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  # Authentification Entra ID + autorisation Azure RBAC sur l'API Kubernetes
  azure_active_directory_role_based_access_control {
    tenant_id          = data.azurerm_client_config.current.tenant_id
    azure_rbac_enabled = true
  }
  # Arbitrage : comptes locaux conservés pour que Terraform installe la plateforme (Helm)
  # sans dépendre de kubelogin. Pour aller plus loin : local_account_disabled = true.
  local_account_disabled = false

  # Secrets Store CSI Driver (add-on) avec rotation automatique depuis Key Vault
  key_vault_secrets_provider {
    secret_rotation_enabled  = true
    secret_rotation_interval = "2m"
  }

  # Contrôleur d'Ingress NGINX managé par AKS (add-on App Routing) : 1 seule IP publique
  web_app_routing {
    dns_zone_ids = []
  }

  automatic_upgrade_channel    = "patch"
  node_os_upgrade_channel      = "NodeImage" # correctifs de sécurité des nœuds appliqués automatiquement
  image_cleaner_enabled        = true        # supprime les images vulnérables / inutilisées des nœuds
  image_cleaner_interval_hours = 48

  # Pas de Container Insights (Log Analytics facturé au Go ingéré) : on utilise
  # Prometheus + Loki dans le cluster (choix FinOps, cf. docs/FINOPS.md).

  tags = local.tags

  lifecycle {
    ignore_changes = [default_node_pool[0].node_count, kubernetes_version]
  }
}

# Les nœuds peuvent tirer les images de l'ACR (rôle minimal AcrPull, pas d'admin)
resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                            = azurerm_container_registry.this.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
  skip_service_principal_aad_check = true
}

# L'utilisateur qui lance Terraform est admin du cluster (Azure RBAC)
resource "azurerm_role_assignment" "me_aks_admin" {
  scope                = azurerm_kubernetes_cluster.this.id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = data.azurerm_client_config.current.object_id
}
