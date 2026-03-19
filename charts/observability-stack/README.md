# Observability Stack Helm Chart

Umbrella Helm chart that deploys the full observability stack to Kubernetes. Wraps community subcharts (OpenSearch, Prometheus, OTel Collector, Data Prepper) with opinionated defaults and adds self-monitoring dashboards.

## Components

| Subchart | Source | Purpose |
|----------|--------|---------|
| `opensearch` | opensearch-project/helm-charts | Log and trace storage |
| `opensearch-dashboards` | opensearch-project/helm-charts | Web UI |
| `data-prepper` | opensearch-project/helm-charts | OTLP → OpenSearch pipeline |
| `opentelemetry-collector` | open-telemetry/helm-charts | Telemetry receiver and router |
| `prometheus` | prometheus-community/helm-charts | Metrics storage (OTLP + scrape) |

Additional templates (not subcharts):
- `opensearch-exporter` — Prometheus exporter for OpenSearch cluster metrics
- `init-dashboards-job` — Post-install hook that creates index patterns, dashboards, saved queries
- `opensearch-credentials-secret` — Shared credentials secret

## Install

```bash
cd charts/observability-stack
helm dependency build
helm install obs-stack . -n observability-stack --create-namespace
```

For EKS with ALB ingress, use the values override:
```bash
helm install obs-stack . -n observability-stack --create-namespace -f ../../terraform/aws/values-eks.yaml
```

Or use Terraform (recommended) — see `terraform/aws/README.md`.

## Upgrading

The init job (dashboard/index pattern setup) runs as a post-install/post-upgrade hook. It installs pip packages and takes 3-5 minutes, which often exceeds helm's default timeout.

**Recommended upgrade workflow:**
```bash
# 1. Deploy chart changes (skip hooks to avoid timeout)
helm upgrade obs-stack . -n observability-stack -f ../../terraform/aws/values-eks.yaml --no-hooks

# 2. If dashboard or init script changed, trigger the job manually:
kubectl delete job obs-stack-observability-stack-init-dashboards -n observability-stack 2>/dev/null
helm get hooks obs-stack -n observability-stack | kubectl apply -n observability-stack -f -
kubectl wait --for=condition=complete job/obs-stack-observability-stack-init-dashboards -n observability-stack --timeout=10m
kubectl logs -n observability-stack job/obs-stack-observability-stack-init-dashboards --tail=30
```

If only `values.yaml` scrape configs changed (no dashboard changes), step 2 is not needed — but you may need to restart Prometheus to pick up the new configmap:
```bash
kubectl rollout restart deployment obs-stack-prometheus-server -n observability-stack
```

## Self-Monitoring Dashboards

Three dashboards are auto-created by the init job from YAML config files in `files/`:

| Dashboard | Panels | File |
|-----------|--------|------|
| Kubernetes Cluster Health | 8 | `files/dashboard-k8s-cluster-health.yaml` |
| Observability Pipeline Health | 24 | `files/dashboard-pipeline-health.yaml` |
| OpenSearch Cluster Health | 10 | `files/dashboard-opensearch-health.yaml` |

**Adding a new dashboard:**
1. Create `files/dashboard-my-thing.yaml` (see existing files for format)
2. Add it to `templates/init-dashboards-configmap.yaml`
3. Add one line to `main()` in `files/init-opensearch-dashboards.py`:
   ```python
   create_promql_dashboard_from_yaml(workspace_id, "/config/dashboard-my-thing.yaml")
   ```

**Dashboard YAML format:**
```yaml
dashboard:
  id: my-dashboard-id
  title: My Dashboard
  description: What this monitors

panels:
  - id: panel-unique-id
    title: "Panel Title"
    query: "rate(some_metric_total[5m])"
    chartType: line
```

**Syncing with docker-compose:** The docker-compose init script and dashboard YAMLs (`docker-compose/opensearch-dashboards/`) are the source of truth. The helm versions in `files/` should be kept in sync. The only helm-specific addition is the K8s Cluster Health dashboard (not applicable to docker-compose) and the `BASE_URL` env var override in the init script (line 11).

## Prometheus Scrape Targets

Configured via `scrapeConfigs` in `values.yaml`. Default K8s scrape jobs are disabled (saves ~60k series). Active targets:

| Job | Target | Interval |
|-----|--------|----------|
| `prometheus` | localhost:9090 | 60s |
| `otel-collector` | `<release>`-opentelemetry-collector:8888 | 10s |
| `opensearch` | `<release>`-observability-stack-opensearch-exporter:9114 | 30s |
| `data-prepper` | `<release>`-data-prepper:4900 | 30s |
| `node-exporter` | auto-discovered via kubernetes_sd | 60s |
| `kube-state-metrics` | auto-discovered via kubernetes_sd | 60s |

> **Note:** Targets use the helm release name as prefix. The values in `values.yaml` are hardcoded to `obs-stack-*` — update them if you change the release name.

## Key Values

See `values.yaml` for all options. Notable settings:

```yaml
# Credentials (update opensearchPassword before any real deployment)
opensearchUsername: "admin"
opensearchPassword: "My_password_123!@#"

# Data Prepper metrics port (must be in ports list for Prometheus to scrape)
data-prepper:
  ports:
    - name: metrics
      port: 4900

# Disable noisy K8s scrape defaults
prometheus:
  scrapeConfigs:
    kubernetes-api-servers: { enabled: false }
    # ... etc
```

## OpenTelemetry Demo (Optional)

The [OpenTelemetry Demo](https://opentelemetry.io/docs/demo/) is available as an optional subchart. It deploys a full microservices e-commerce app (20+ services) that generates realistic telemetry — useful for load testing and showcasing the stack.

Disabled by default (~2GB additional memory required).

**Enable:**
```bash
helm upgrade obs-stack . -n observability-stack -f ../../terraform/aws/values-eks.yaml \
  --set opentelemetry-demo.enabled=true --no-hooks
```

**Disable:**
```bash
helm upgrade obs-stack . -n observability-stack -f ../../terraform/aws/values-eks.yaml --no-hooks
```

All bundled backends (Jaeger, Grafana, Prometheus, OpenSearch) in the demo chart are disabled — demo services send telemetry to our OTel Collector. No duplicate infrastructure.
