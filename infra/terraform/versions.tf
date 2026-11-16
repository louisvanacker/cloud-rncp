terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm    = { source = "hashicorp/azurerm", version = "~> 4.40" }
    helm       = { source = "hashicorp/helm", version = "~> 3.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.38" }
    random     = { source = "hashicorp/random", version = "~> 3.7" }
  }

  # État distant chiffré et verrouillé (créé par infra/bootstrap/bootstrap-state.ps1)
  backend "azurerm" {
    resource_group_name  = "rg-biblio-tfstate"
    storage_account_name = "sttfstatesmdncb"
    container_name       = "tfstate"
    key                  = "biblio.tfstate"
    use_azuread_auth     = true
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true # projet d'école : destroy complet possible
    }
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
  # Le compte de stockage refuse les clés partagées : Terraform s'authentifie via Entra ID
  storage_use_azuread = true
}

locals {
  kube = azurerm_kubernetes_cluster.this.kube_admin_config[0]
}

provider "kubernetes" {
  host                   = local.kube.host
  client_certificate     = base64decode(local.kube.client_certificate)
  client_key             = base64decode(local.kube.client_key)
  cluster_ca_certificate = base64decode(local.kube.cluster_ca_certificate)
}

provider "helm" {
  kubernetes = {
    host                   = local.kube.host
    client_certificate     = base64decode(local.kube.client_certificate)
    client_key             = base64decode(local.kube.client_key)
    cluster_ca_certificate = base64decode(local.kube.cluster_ca_certificate)
  }
}