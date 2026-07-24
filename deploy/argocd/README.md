# Argo CD for the observability-stack playground

Reproducible Argo CD deployment for the playground CD pipeline, and the
manifests used to de-risk three questions:

1. Can a minor version upgrade (OpenSearch 3.7.0 to 3.8.0) happen in place
   with no downtime, or does it need a new cluster and DNS cutover?
2. How does Argo CD isolate and gate deployments between staging and
   production?
3. Which Argo CD signals (logs, metrics, traces) can be sent to an OTLP
   endpoint for self-monitoring?

## Layout

```
deploy/argocd
├── install/values.yaml              Argo CD Helm values (self-monitoring wired)
├── install.sh                       helm install + apply projects/appset
├── projects/
│   ├── staging.yaml                 auto-sync project, scoped to obs-staging
│   └── production.yaml              manual-sync project, deny window + RBAC
├── applicationsets/
│   └── observability-stack.yaml     one Application per environment
├── apps/opensearch-min/            test workload (StatefulSet) for Q1
└── observability/
    └── collector-argocd.yaml        OTLP self-monitoring collector config (Q3)
```

## Reproducibility

The install pins the Argo CD chart version and applies declarative manifests.
It runs identically on kind, EKS, or any conformant cluster. Because the repo
already deploys Helm releases through Terraform `helm_release` resources
(`terraform/aws/addons.tf`), `install.sh` maps one-to-one to a `helm_release`
plus `kubectl_manifest` resources with no logic change; the values file and
pinned version are the same artifact.

## Install

```bash
export KUBECONFIG=...            # target cluster
./install.sh
```

## Findings

See `SPIKE-FINDINGS.md` in this directory for the measured results and the
recommendation that feeds the CD RFC.
