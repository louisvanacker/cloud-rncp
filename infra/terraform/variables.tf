variable "project" {
  description = "Préfixe des ressources"
  type        = string
  default     = "biblio"
}

variable "location" {
  description = "Région Azure (vérifier la disponibilité de la taille de VM et vos quotas)"
  type        = string
  default     = "francecentral"
}

variable "environments" {
  description = "Environnements applicatifs : un namespace, un Key Vault, des identités et des conteneurs Blob chacun"
  type        = list(string)
  default     = ["dev", "prod"]
}

variable "kubernetes_version" {
  description = "Version d'AKS (null = version par défaut de la région)"
  type        = string
  default     = null
}

variable "node_vm_size" {
  description = "Taille des nœuds. B2als_v2 = 2 vCPU / 4 Go, burstable (FinOps : bon marché pour un trafic faible)"
  type        = string
  default     = "Standard_B2als_v2"
}

variable "node_min_count" {
  type    = number
  default = 1
}

variable "node_max_count" {
  description = "Plafond du cluster autoscaler (attention au quota vCPU de l'abonnement : 4 vCPU sur un compte d'essai)"
  type        = number
  default     = 2
}

variable "node_os_disk_gb" {
  description = "Disque OS des nœuds (128 Go par défaut côté AKS ; 64 Go suffisent ici et coûtent ~2x moins)"
  type        = number
  default     = 64
}

variable "github_repository" {
  description = "Dépôt GitHub autorisé à déployer via OIDC, format owner/repo"
  type        = string
}

variable "devs_group_object_id" {
  description = "Object ID d'un groupe Entra ID en lecture seule sur les namespaces (optionnel)"
  type        = string
  default     = null
}

variable "acme_email" {
  description = "E-mail de contact Let's Encrypt (expiration des certificats)"
  type        = string
}

variable "seed_admin_email" {
  description = "E-mail du compte administrateur créé au premier démarrage"
  type        = string
  default     = "admin@biblio.local"
}

variable "admin_ip_ranges" {
  description = "Votre IP publique (ex: [\"81.250.10.20\"]). Si renseignée, le compte de stockage n'accepte plus que le sous-réseau AKS + ces IP"
  type        = list(string)
  default     = []
}

variable "tags" {
  type = map(string)
  default = {
    project     = "biblio-bc3"
    owner       = "hexagone-m1-ia"
    cost-center = "formation"
  }
}
