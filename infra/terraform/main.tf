data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

locals {
  suffix = random_string.suffix.result
  name   = "${var.project}-${local.suffix}"
  tags   = merge(var.tags, { managed-by = "terraform" })
}

resource "azurerm_resource_group" "this" {
  name     = "rg-${var.project}"
  location = var.location
  tags     = local.tags
}

# ---------------- Réseau ----------------
# Azure CNI Overlay : les pods ont des IP d'un espace privé séparé (pas de consommation d'IP du VNet).
resource "azurerm_virtual_network" "this" {
  name                = "vnet-${local.name}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = ["10.10.0.0/16"]
  tags                = local.tags
}

resource "azurerm_subnet" "aks" {
  name                 = "snet-aks"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = ["10.10.0.0/22"]
  service_endpoints    = ["Microsoft.Storage", "Microsoft.KeyVault"] # trafic via le backbone Azure
}

# ---------------- Registre d'images ----------------
resource "azurerm_container_registry" "this" {
  name                = "acr${var.project}${local.suffix}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "Basic" # FinOps : ~5 $/mois, suffisant (pas de géo-réplication nécessaire)
  admin_enabled       = false   # pas de login/mot de passe : accès uniquement par rôle IAM
  tags                = local.tags
}
