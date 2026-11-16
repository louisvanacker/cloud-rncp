# ===================== Socle Kubernetes installé par Terraform =====================
# Namespaces applicatifs (+ garde-fous), cert-manager, Prometheus/Grafana/Alertmanager, Loki, Alloy.

locals {
  quotas = {
    dev  = { cpu_req = "1", mem_req = "2Gi", cpu_lim = "4", mem_lim = "4Gi" }
    prod = { cpu_req = "2", mem_req = "3Gi", cpu_lim = "6", mem_lim = "6Gi" }
  }
}

resource "kubernetes_namespace" "app" {
  for_each = toset(var.environments)
  metadata {
    name = "${var.project}-${each.key}"
    labels = {
      environment                          = each.key
      "pod-security.kubernetes.io/enforce" = "restricted" # refuse tout pod root / privilégié
      "pod-security.kubernetes.io/warn"    = "restricted"
      "app.kubernetes.io/part-of"          = var.project
    }
  }
  depends_on = [azurerm_role_assignment.me_aks_admin]
}

resource "kubernetes_resource_quota" "app" {
  for_each = toset(var.environments)
  metadata {
    name      = "biblio-quota"
    namespace = kubernetes_namespace.app[each.key].metadata[0].name
  }
  spec {
    hard = {
      "requests.cpu"           = lookup(local.quotas, each.key, local.quotas.dev).cpu_req
      "requests.memory"        = lookup(local.quotas, each.key, local.quotas.dev).mem_req
      "limits.cpu"             = lookup(local.quotas, each.key, local.quotas.dev).cpu_lim
      "limits.memory"          = lookup(local.quotas, each.key, local.quotas.dev).mem_lim
      "persistentvolumeclaims" = "4"
      "requests.storage"       = "20Gi"
      "pods"                   = "30"
      "services.loadbalancers" = "0"
    }
  }
}

resource "kubernetes_limit_range" "app" {
  for_each = toset(var.environments)
  metadata {
    name      = "biblio-defaults"
    namespace = kubernetes_namespace.app[each.key].metadata[0].name
  }
  spec {
    limit {
      type            = "Container"
      default_request = { cpu = "25m", memory = "64Mi" }
      default         = { cpu = "250m", memory = "256Mi" }
      max             = { cpu = "1", memory = "1Gi" }
    }
  }
}

resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
  }
  depends_on = [azurerm_role_assignment.me_aks_admin]
}

# ---------------- cert-manager (certificats TLS Let's Encrypt + CA interne PostgreSQL) ----------------
resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.18.2"
  namespace        = "cert-manager"
  create_namespace = true
  values = [yamlencode({
    crds      = { enabled = true }
    resources = { requests = { cpu = "10m", memory = "64Mi" } }
  })]
  depends_on = [azurerm_role_assignment.me_aks_admin]
}

# ---------------- Prometheus + Alertmanager + Grafana ----------------
resource "random_password" "grafana" {
  length  = 24
  special = false
}

resource "helm_release" "kube_prometheus_stack" {
  name       = "kps"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = "75.15.1"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  timeout    = 900

  values = [yamlencode({
    # Composants du plan de contrôle non accessibles sur AKS (managé) : on ne les scrape pas
    kubeControllerManager = { enabled = false }
    kubeScheduler         = { enabled = false }
    kubeEtcd              = { enabled = false }
    kubeProxy             = { enabled = false }

    prometheus = {
      prometheusSpec = {
        # Prend en compte les ServiceMonitor / PrometheusRule de TOUS les namespaces
        serviceMonitorSelectorNilUsesHelmValues = false
        podMonitorSelectorNilUsesHelmValues     = false
        ruleSelectorNilUsesHelmValues           = false
        retention                               = "7d" # FinOps : 7 jours suffisent pour le projet
        retentionSize                           = "8GB"
        resources                               = { requests = { cpu = "100m", memory = "512Mi" }, limits = { memory = "1536Mi" } }
        storageSpec = {
          volumeClaimTemplate = {
            spec = { accessModes = ["ReadWriteOnce"], resources = { requests = { storage = "10Gi" } } }
          }
        }
      }
    }

    alertmanager = {
      alertmanagerSpec = { resources = { requests = { cpu = "10m", memory = "32Mi" } } }
      # Démo : les alertes arrivent par e-mail dans le Mailpit de prod (aucun vrai envoi)
      config = {
        global = {
          smtp_smarthost   = "mailpit.${var.project}-prod.svc:1025"
          smtp_from        = "alertmanager@biblio.local"
          smtp_require_tls = false
          resolve_timeout  = "5m"
        }
        route = {
          receiver        = "mail"
          group_by        = ["alertname", "namespace"]
          group_wait      = "30s"
          group_interval  = "5m"
          repeat_interval = "4h"
          routes = [
            { receiver = "null", matchers = ["alertname =~ \"Watchdog|InfoInhibitor\""] },
          ]
        }
        receivers = [
          { name = "null" },
          { name = "mail", email_configs = [{ to = "ops@biblio.local", send_resolved = true }] },
        ]
      }
    }

    grafana = {
      adminPassword = random_password.grafana.result
      persistence   = { enabled = false } # tout est provisionné par code : rien à persister
      resources     = { requests = { cpu = "25m", memory = "128Mi" } }
      sidecar = {
        dashboards = { enabled = true, label = "grafana_dashboard", searchNamespace = "ALL" }
      }
      additionalDataSources = [{
        name   = "Loki"
        uid    = "loki"
        type   = "loki"
        access = "proxy"
        url    = "http://loki.monitoring.svc:3100"
      }]
    }

    prometheusOperator       = { resources = { requests = { cpu = "20m", memory = "64Mi" } } }
    kube-state-metrics       = { resources = { requests = { cpu = "10m", memory = "64Mi" } } }
    prometheus-node-exporter = { resources = { requests = { cpu = "10m", memory = "32Mi" } } }
  })]
}

# ---------------- Loki (logs) + Alloy (collecte) ----------------
resource "helm_release" "loki" {
  name       = "loki"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "loki"
  version    = "6.33.0"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  timeout    = 600

  values = [yamlencode({
    deploymentMode = "SingleBinary"
    loki = {
      auth_enabled = false
      commonConfig = { replication_factor = 1 }
      storage      = { type = "filesystem" }
      schemaConfig = {
        configs = [{
          from  = "2024-01-01", store = "tsdb", object_store = "filesystem", schema = "v13"
          index = { prefix = "index_", period = "24h" }
        }]
      }
      limits_config = { retention_period = "168h" } # 7 jours
      compactor     = { retention_enabled = true, delete_request_store = "filesystem" }
    }
    singleBinary = {
      replicas    = 1
      persistence = { size = "10Gi" }
      resources   = { requests = { cpu = "50m", memory = "256Mi" }, limits = { memory = "768Mi" } }
    }
    read         = { replicas = 0 }
    write        = { replicas = 0 }
    backend      = { replicas = 0 }
    gateway      = { enabled = false }
    chunksCache  = { enabled = false }
    resultsCache = { enabled = false }
    lokiCanary   = { enabled = false }
    test         = { enabled = false }
  })]
}

resource "helm_release" "alloy" {
  name       = "alloy"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "alloy"
  version    = "1.2.0"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name

  values = [yamlencode({
    controller = { type = "deployment", replicas = 1 } # lit les logs via l'API : pas de DaemonSet/hostPath
    alloy = {
      resources = { requests = { cpu = "20m", memory = "96Mi" } }
      configMap = {
        content = <<-EOT
          // Collecte des logs des seuls namespaces applicatifs (FinOps : volume de logs maîtrisé)
          discovery.kubernetes "pods" {
            role = "pod"
          }
          discovery.relabel "pods" {
            targets = discovery.kubernetes.pods.targets
            rule {
              source_labels = ["__meta_kubernetes_namespace"]
              regex         = "${var.project}-.*"
              action        = "keep"
            }
            rule {
              source_labels = ["__meta_kubernetes_namespace"]
              target_label  = "namespace"
            }
            rule {
              source_labels = ["__meta_kubernetes_pod_name"]
              target_label  = "pod"
            }
            rule {
              source_labels = ["__meta_kubernetes_pod_container_name"]
              target_label  = "container"
            }
            rule {
              source_labels = ["__meta_kubernetes_pod_label_app"]
              target_label  = "app"
            }
          }
          loki.source.kubernetes "pods" {
            targets    = discovery.relabel.pods.output
            forward_to = [loki.write.default.receiver]
          }
          loki.write "default" {
            endpoint {
              url = "http://loki.monitoring.svc:3100/loki/api/v1/push"
            }
          }
        EOT
      }
    }
  })]
  depends_on = [helm_release.loki]
}
