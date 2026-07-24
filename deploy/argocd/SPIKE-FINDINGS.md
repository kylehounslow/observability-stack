# ArgoCD evaluation findings

Hands-on evaluation of ArgoCD for the observability-stack playground CD
pipeline. Everything below was observed on a running cluster (k3d / k3s
v1.30.4), ArgoCD Helm chart `argo-cd` 10.2.1 (ArgoCD v3.4.5).

These behaviours are Kubernetes- and ArgoCD-level and reproduce on any
conformant cluster. Ingress-specific validation (AWS load balancer controller,
external-dns, ACM, Route53) on EKS is listed as follow-up.

## Q1: In-place minor version upgrade downtime

An in-place rolling upgrade (`opensearchproject/opensearch:3.7.0` to
`opensearchstaging/opensearch:3.8.0`) is graceful and needs no new cluster or
DNS cutover. Downtime is a function of workload topology, not of ArgoCD, which
only reconciles the manifest; the StatefulSet controller performs the rolling
replacement.

Measured by probing `/_cluster/health` once per second through the upgrade:

| Topology | Storage | Availability during upgrade | Data |
|---|---|---|---|
| 1 replica | ephemeral | ~54 s unavailable (sole pod restarts) | lost |
| 2 replicas | persistent volumes | ~16 s degraded, no full outage; Service kept routing to the ready peer | survived |

The single-replica gap is pod restart time with no peer to serve. The
2-replica case rolled one pod at a time; the surviving pod served through the
client Service. The ~16 s degraded window is the 2-node cluster-manager quorum
re-forming and shrinks with 3+ dedicated manager nodes. A replicated index
seeded before the upgrade survived and the cluster returned to green.

Tradeoff: an in-place rolling upgrade has no one-step rollback. A blue/green
DNS cutover keeps the previous version available for a TTL-bounded revert, so it
remains the right unit for production promotion and for breaking changes, while
in-place is sufficient for staging and routine minor bumps.

## Q2: Isolating and gating staging vs production

Three independent, demonstrated mechanisms:

1. Per-environment sync policy from one `ApplicationSet`: `opensearch-staging`
   with `automated: {prune, selfHeal}` and `opensearch-production` with no
   automated policy, from a single template. Staging reached `Synced/Healthy`
   automatically; production stayed `OutOfSync/Missing`.
2. `AppProject` destination scoping: staging restricted to `obs-staging`,
   production to `obs-prod`, so a staging Application cannot write to the
   production namespace on a shared cluster.
3. A production `deny` sync window (`manualSync: true`) as a hard gate. With
   production autosync force-enabled for the test, the controller still refused
   (`Sync prevented by sync window`) and the namespace stayed empty. `AppProject`
   `roles` + RBAC scope the allowed manual sync to a promoter identity.

## Q3: Self-monitoring over OTLP

All three signal types available and landed in an OpenTelemetry Collector:

- Metrics: Prometheus `/metrics` on five components; 25 `argocd_*` families
  scraped. `argocd_app_info` carries `autosync_enabled`, `sync_status`,
  `health_status`, `project`, `dest_namespace` per application;
  `argocd_app_sync_total` counts syncs per phase.
- Traces: application-controller and repo-server export OTLP spans; a
  reconciliation produced `ResourceTraces service.name=argocd-controller` at
  the collector.
- Logs: `global.logging.format=json` yields structured JSON with per-phase sync
  timings, ingested by the collector `filelog` receiver + `json_parser`.

Configuration note: the OTLP address is read from the shared `otlp.address` /
`otlp.insecure` keys of `argocd-cmd-params-cm`, not from per-component
`controller.otlp.*` / `reposerver.otlp.*` keys. The install values use the
shared keys.

## Reproducibility

Declarative and pinned under `deploy/argocd`. `install.sh` maps one-to-one to a
Terraform `helm_release` plus applied manifests, consistent with the existing
`terraform/aws/addons.tf` convention.
