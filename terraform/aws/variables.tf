# ============================================================================
# No required variables. Just `terraform apply` for a working stack.
# Add domain + route53_zone_id when ready for TLS/DNS.
# ============================================================================

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "observability-stack"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version"
  type        = string
  default     = "1.32"
}

variable "node_instance_type" {
  description = "EC2 instance type for EKS nodes"
  type        = string
  default     = "m5.xlarge"
}

variable "node_count" {
  description = "Number of EKS worker nodes"
  type        = number
  default     = 3
}

# ============================================================================
# TLS / DNS — optional. Set both to enable HTTPS + custom domain.
# ============================================================================

variable "domain" {
  description = "Domain name for OpenSearch Dashboards (e.g. obs.example.com). Leave empty for plain HTTP on ALB."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID. Required when domain is set."
  type        = string
  default     = ""
}

# ============================================================================
# Security — off by default for initial smoke test
# ============================================================================

variable "enable_waf" {
  description = "Enable WAF rate limiting on the ALB (2000 req/5min/IP)"
  type        = bool
  default     = false
}

variable "anonymous_auth" {
  description = "Enable anonymous read-only access to OpenSearch Dashboards (for public demos)"
  type        = bool
  default     = false
}

variable "opensearch_password" {
  description = "OpenSearch admin password. Leave empty to use chart default."
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_examples" {
  description = "Deploy example agent services (weather-agent, travel-planner, canary)"
  type        = bool
  default     = false
}

variable "enable_otel_demo" {
  description = "Deploy OpenTelemetry Demo microservices (~2GB additional memory)"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    Project   = "observability-stack"
    ManagedBy = "terraform"
  }
}

# ============================================================================
# OpenSearch sizing — bump up for high-volume ingest workloads (e.g. RCA
# benchmark dataset at ~290 GB raw NDJSON / ~1 TB indexed with 1 replica)
# ============================================================================

variable "opensearch_replicas" {
  description = "Number of OpenSearch nodes (StatefulSet replicas). 3 is the production minimum."
  type        = number
  default     = 3
}

variable "opensearch_storage_size" {
  description = "Per-node OpenSearch PVC size, e.g. 100Gi for default, 500Gi for large-ingest workloads. Total cluster storage = opensearch_replicas × this value."
  type        = string
  default     = "100Gi"
}

variable "opensearch_storage_class" {
  description = "EBS storage class for OpenSearch PVCs. gp3 is cheaper and gives provisioned-IOPS knobs vs gp2; both are valid."
  type        = string
  default     = "gp2"
}

variable "opensearch_node_memory" {
  description = "Per-node OpenSearch container memory request/limit (e.g. 4Gi default, 16Gi for high-volume). The chart sets requests=limits, so set to whatever the node should reserve."
  type        = string
  default     = "4Gi"
}

variable "opensearch_jvm_heap" {
  description = "OpenSearch JVM heap size. Should be ~50% of opensearch_node_memory, max 31g. Use the matching G/g suffix the chart expects (e.g. '2g', '8g', '16g')."
  type        = string
  default     = "2g"
}

# ============================================================================
# Cortex sizing — usually small, but exposing for parity
# ============================================================================

variable "cortex_storage_size" {
  description = "Cortex PVC size. 50Gi handles a year of OTLP-demo traffic; bump for higher cardinality fleets."
  type        = string
  default     = "50Gi"
}

variable "cortex_storage_class" {
  description = "EBS storage class for Cortex PVC."
  type        = string
  default     = "gp2"
}

# ============================================================================
# Data Prepper sizing — bump for sustained high-throughput trace ingest. The
# default 180s trace_flush_interval buffers all in-flight spans for traceGroup
# inference; at ~30K spans/sec sustained that's ~5M spans (~10 GB heap) at peak.
# ============================================================================

variable "data_prepper_memory" {
  description = "Data Prepper container memory request/limit. Defaults to 1Gi (subchart default). Bump to 4Gi+ for sustained ingest workloads."
  type        = string
  default     = "1Gi"
}

variable "data_prepper_jvm_heap" {
  description = "Data Prepper JVM heap size. Should be ~75% of data_prepper_memory. Use the G/g suffix Java expects (e.g. '512m', '2g', '8g'). Empty string disables JAVA_OPTS override."
  type        = string
  default     = ""
}

variable "data_prepper_trace_flush_interval" {
  description = "Seconds the otel_traces processor buffers spans before computing traceGroup. Default 180s buffers ~5M spans at 30K/sec; lower to ~90 for ingest-time-bounded workloads at the cost of marking late-arriving traces incomplete."
  type        = number
  default     = 180
}

# ============================================================================
# Derived
# ============================================================================

locals {
  enable_tls = var.domain != "" && var.route53_zone_id != ""
}
