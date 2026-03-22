# ============================================================================
# Outputs
# ============================================================================

output "dashboards_url" {
  description = "OpenSearch Dashboards URL"
  value       = local.enable_tls ? "https://${var.domain}" : "http://<ALB_DNS> — run: kubectl get ingress -n observability-stack"
}

output "credentials" {
  description = "OpenSearch Dashboards login"
  value       = "Username: admin | Password: (set via TF_VAR_opensearch_password)"
  sensitive   = false
}

output "opensearch_password" {
  description = "OpenSearch admin password"
  value       = var.opensearch_password
  sensitive   = true
}

output "kubeconfig_command" {
  description = "Command to configure kubectl"
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}"
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "otlp_endpoint" {
  description = "OTLP endpoint (port-forward required)"
  value       = "kubectl port-forward -n observability-stack svc/obs-stack-opentelemetry-collector 4317:4317 4318:4318"
}

output "next_steps" {
  description = "To add TLS and custom domain"
  value       = local.enable_tls ? "✅ TLS enabled at https://${var.domain}" : "Add domain and route53_zone_id to terraform.tfvars, then terraform apply"
}
