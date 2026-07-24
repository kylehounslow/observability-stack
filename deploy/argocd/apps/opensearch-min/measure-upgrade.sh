#!/usr/bin/env bash
# Measure availability of the OpenSearch StatefulSet during an in-place image
# upgrade driven by Argo CD. Poll /_cluster/health continuously from inside the
# cluster while the image tag changes, and report how many probes failed and
# for how long the endpoint was unreachable.
#
# Usage: run against a namespace where opensearch-min is deployed. Provide the
# poller as a pod so DNS and networking match the real ingest path.
set -euo pipefail
NS="${1:-obs-staging}"
DURATION="${2:-180}"   # seconds to poll
SVC="opensearch.${NS}.svc.cluster.local:9200"

kubectl -n "$NS" run os-probe --image=curlimages/curl:8.13.0 --restart=Never --command -- \
  sh -c "
    end=\$(( \$(date +%s) + ${DURATION} ))
    total=0; fail=0; first_fail=0; last_fail=0
    while [ \$(date +%s) -lt \$end ]; do
      total=\$((total+1))
      if curl -fsS -m 2 http://${SVC}/_cluster/health >/dev/null 2>&1; then :; else
        fail=\$((fail+1))
        now=\$(date +%s)
        [ \$first_fail -eq 0 ] && first_fail=\$now
        last_fail=\$now
      fi
      sleep 1
    done
    echo RESULT total=\$total fail=\$fail first_fail=\$first_fail last_fail=\$last_fail
  "
echo "Probe running. Trigger the upgrade now (git commit image bump + argocd sync),"
echo "then: kubectl -n $NS logs -f os-probe   and read the RESULT line."
