#!/usr/bin/env bash
# Install Argo CD into the current kube context and apply the playground
# projects, ApplicationSet, and self-monitoring wiring.
#
# Reproducible across environments: same chart version, same values, same
# manifests whether the target is kind, EKS, or any other conformant cluster.
# Mirrors the repo's Terraform helm_release convention (pinned chart version,
# values file) so this can be lifted into terraform/aws as a helm_release with
# no logic change.
set -euo pipefail

ARGOCD_CHART_VERSION="${ARGOCD_CHART_VERSION:-10.2.1}"   # Argo CD app v3.4.5
NAMESPACE="${NAMESPACE:-argocd}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

helm repo add argo https://argoproj.github.io/argo-helm >/dev/null 2>&1 || true
helm repo update argo >/dev/null

echo "Installing Argo CD ${ARGOCD_CHART_VERSION} into namespace ${NAMESPACE}..."
helm upgrade --install argocd argo/argo-cd \
  --version "${ARGOCD_CHART_VERSION}" \
  --namespace "${NAMESPACE}" \
  --create-namespace \
  --values "${HERE}/install/values.yaml" \
  --wait --timeout 10m

echo "Applying projects and ApplicationSet..."
kubectl apply -f "${HERE}/projects/"
kubectl apply -f "${HERE}/applicationsets/"

echo "Done. Argo CD server (in-cluster): svc/argocd-server -n ${NAMESPACE}"
