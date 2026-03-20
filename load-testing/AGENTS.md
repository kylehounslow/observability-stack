# AGENTS.md — Load Testing Procedures

This document captures the exact procedures for reproducing load tests against the Observability Stack Helm deployment. Designed for AI coding assistants to execute without prior context.

## Repository Context

- Load testing files live in `load-testing/` within the `feat/helm-charts` worktree at `.worktrees/feat-helm-charts/`
- Helm chart is at `.worktrees/feat-helm-charts/charts/observability-stack/`
- Terraform for EKS cluster is at `.worktrees/feat-helm-charts/terraform/aws/`
- Terraform for EC2 load generator is at `load-testing/terraform/`
- Results are tracked in `load-testing/RESULTS.md`, sizing in `load-testing/SIZING.md`

## Current Deployment State (as of 2026-03-20)

### EKS Cluster
- Name: `observability-stack`, region: `us-west-2`
- 4x m5.xlarge nodes (4 vCPU, 16 GB each)
- Helm release: `obs-stack` in namespace `observability-stack`

### Stack Configuration
| Component | Replicas | CPU (req/limit) | Memory (req/limit) |
|-----------|----------|-----------------|-------------------|
| OpenSearch | 3 (StatefulSet) | 1000m/2000m | 4Gi/4Gi (JVM: 2Gi) |
| OpenSearch Dashboards | 3 | 500m/2000m | 1Gi/2Gi |
| OTel Collector | 1 | none | none |
| Data Prepper | 2 | none | none |
| Prometheus | 1 | none | none |
| OTel Demo | enabled | ~20 microservices | built-in load generator |

### Access Points
- Dashboards ALB: `https://obs-playground-dev-027423573553.kylhouns.people.aws.dev`
- Credentials: `admin` / `My_password_123!@#`
- DNS configured via terraform at `.worktrees/feat-helm-charts/terraform/aws/terraform.tfvars`

### EC2 Load Generator
- Instance: `i-08f9652631fe73302` (m5.xlarge, same VPC)
- Access: SSM only (no SSH key)
- k6 installed at `/usr/local/bin/k6` (v1.0.0)
- Scripts at `/home/ec2-user/k6/scenarios/`
- Results at `/home/ec2-user/k6/results/`
- Terraform state at `load-testing/terraform/`

## Procedures

### 1. Upload k6 Scripts to EC2

```bash
INSTANCE_ID="i-08f9652631fe73302"
SCRIPT=$(cat load-testing/k6/scenarios/api-queries-alb.js | base64)
aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[\"echo '$SCRIPT' | base64 -d > /home/ec2-user/k6/scenarios/api-queries-alb.js\"]" \
  --region us-west-2 --output text --query 'Command.CommandId'
```

### 2. Run a Load Test

```bash
INSTANCE_ID="i-08f9652631fe73302"
TARGET_URL="https://obs-playground-dev-027423573553.kylhouns.people.aws.dev"
VUS=1000
TEST_NUM=007

CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[\"cd /home/ec2-user/k6 && k6 run --env TARGET_VUS=$VUS --env DASHBOARDS_URL=$TARGET_URL --env OSD_USER=admin --env OSD_PASSWORD='My_password_123!@#' scenarios/api-queries-alb.js 2>&1 | tee results/test-${TEST_NUM}.log\"]" \
  --timeout-seconds 1200 \
  --region us-west-2 \
  --output text --query 'Command.CommandId')
echo "Command: $CMD_ID"
```

### 3. Monitor During Test

```bash
# Check test status
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" --region us-west-2 --query 'Status' --output text

# Monitor OpenSearch nodes
kubectl exec -n observability-stack opensearch-cluster-master-0 -- curl -sk -u admin:'My_password_123!@#' \
  'https://localhost:9200/_cat/nodes?h=name,heap.percent,cpu,load_1m,search.query_total,search.query_current'

# Thread pool pressure
kubectl exec -n observability-stack opensearch-cluster-master-0 -- curl -sk -u admin:'My_password_123!@#' \
  'https://localhost:9200/_cat/thread_pool/search?v&h=name,node_name,active,queue,rejected'

# Hot threads (what's consuming CPU)
kubectl exec -n observability-stack opensearch-cluster-master-0 -- curl -sk -u admin:'My_password_123!@#' \
  'https://localhost:9200/_nodes/hot_threads?threads=3'

# JVM and OS stats
kubectl exec -n observability-stack opensearch-cluster-master-0 -- curl -sk -u admin:'My_password_123!@#' \
  'https://localhost:9200/_nodes/stats/jvm,os?pretty'
```

### 4. Retrieve Results

SSM truncates long output. Always read from the log file:

```bash
RESULT_CMD=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[\"tail -35 /home/ec2-user/k6/results/test-${TEST_NUM}.log\"]" \
  --region us-west-2 --output text --query 'Command.CommandId')
sleep 5
aws ssm get-command-invocation --command-id "$RESULT_CMD" --instance-id "$INSTANCE_ID" --region us-west-2 --query 'StandardOutputContent' --output text
```

### 5. Record Results

Create `load-testing/results/NNN-description.md` with:
- Start/end timestamps (UTC and PDT)
- Configuration at time of test
- k6 summary (p50, p90, p95, max, error rate, req/s)
- Cluster observations during test (CPU, heap, thread pool, queue depths)
- Root cause analysis
- Next steps

Update `load-testing/RESULTS.md` index table and bottleneck progression.
Update `load-testing/SIZING.md` if capacity estimates change.

### 6. Apply Configuration Changes

```bash
# Edit values.yaml
vim .worktrees/feat-helm-charts/charts/observability-stack/values.yaml

# Deploy
helm upgrade obs-stack .worktrees/feat-helm-charts/charts/observability-stack \
  -n observability-stack --reuse-values

# Or override specific values
helm upgrade obs-stack .worktrees/feat-helm-charts/charts/observability-stack \
  -n observability-stack --reuse-values \
  --set opensearch.replicas=3
```

### 7. Scale EKS Nodes

```bash
NODEGROUP=$(aws eks list-nodegroups --cluster-name observability-stack --region us-west-2 --query 'nodegroups[0]' --output text)
aws eks update-nodegroup-config \
  --cluster-name observability-stack \
  --nodegroup-name "$NODEGROUP" \
  --scaling-config minSize=2,maxSize=5,desiredSize=4 \
  --region us-west-2
```

### 8. Manage EC2 Load Generator

```bash
# Create (from load-testing/terraform/)
cd load-testing/terraform && terraform init && terraform apply

# Destroy when done
terraform destroy

# SSM session
aws ssm start-session --target i-08f9652631fe73302 --region us-west-2
```

### 9. Redeploy Dashboards (after changing saved queries/dashboard YAMLs)

```bash
helm upgrade obs-stack .worktrees/feat-helm-charts/charts/observability-stack \
  -n observability-stack --reuse-values
# Init job runs automatically as post-install/post-upgrade hook
```

## k6 Script Details

### api-queries-alb.js
The primary load test script. Hits OSD through ALB with a mix of:
- **30% PPL queries** on span index (`/api/ppl/search`)
- **20% PPL queries** on log index
- **20% OpenSearch DSL search** via console proxy (`/api/console/proxy?path=...&method=POST`)
- **15% Saved objects list** (`/api/saved_objects/_find?type=dashboard`)
- **15% Service map query** via console proxy

Key env vars:
- `TARGET_VUS` — peak virtual users (default 200)
- `DASHBOARDS_URL` — ALB endpoint
- `OSD_USER` / `OSD_PASSWORD` — credentials

Ramp stages: 0→25%→50%→100% (hold 3min) →0 over 15 minutes.

### Known Script Issues
- Console proxy path (`/api/console/proxy?path=...&method=POST`) returns 400 for some queries — needs investigation
- Prometheus queries not yet routed through OSD (datasource proxy path TBD)
- `insecureSkipTLSVerify: true` required in options block (not per-request)
- Auth uses manual `Authorization: Basic <base64>` header via `k6/encoding` module

## Key Learnings

### Bottleneck Discovery Order
1. **OSD (100m CPU)** — Node.js single-threaded, saturates immediately. Fix: 3 replicas, 2 CPU each.
2. **OpenSearch (single node, 4 vCPU)** — 99% CPU, search queue depth 34. Fix: 3 data nodes.
3. **Uneven shard distribution** — original indices have 1 primary shard, load concentrates on 2 of 3 nodes. Fix: increase replica count or reindex with more shards.
4. **Data volume** (not yet tested) — 7-day data projected to reduce capacity ~40%.

### Important Gotchas
- `kubectl port-forward` is NOT a valid load test path — it bottlenecks at the tunnel, not the cluster. Always use EC2 in the same VPC hitting the ALB.
- OSD workspace IDs differ between internal cluster access and external port-forward. The init script uses the internal workspace ID.
- The opensearch-dashboards Helm subchart uses `replicaCount` not `replicas` for scaling.
- OpenSearch `singleNode: true` must be set to `false` when scaling to multiple nodes.
- SSM command output is truncated for long-running tests. Always `tee` to a log file and read from there.

## File Structure

```
load-testing/
├── AGENTS.md              # This file — procedures for AI assistants
├── README.md              # Load testing plan and approach
├── RESULTS.md             # Test result index with bottleneck progression
├── SIZING.md              # Capacity sizing chart and projections
├── results/
│   ├── 001-api-queries-auth-bug.md
│   ├── 002-api-queries.md
│   ├── 003-api-queries-1500vu.md
│   ├── 004-alb-1000vu-osd-bottleneck.md
│   ├── 005-alb-1000vu-opensearch-bottleneck.md
│   └── 006-alb-1000vu-3node-opensearch.md
├── k6/
│   ├── full-test.js                    # Combined API + browser test
│   └── scenarios/
│       ├── api-queries.js              # Direct OpenSearch/Prometheus (port-forward)
│       ├── api-queries-alb.js          # Through ALB/OSD (EC2 → ALB)
│       ├── browser-traces.js           # Chromium: trace analytics flow
│       ├── browser-discover.js         # Chromium: discover + PPL
│       └── browser-metrics.js          # Chromium: metric dashboards
├── osb/
│   ├── run-osb.sh                      # OpenSearch Benchmark runner
│   ├── workload.json                   # Custom trace/log workload
│   └── index-settings.json             # Index mappings
├── pipeline/
│   └── run-telemetrygen.sh             # OTLP pipeline throughput test
├── terraform/
│   ├── main.tf                         # EC2 load generator
│   ├── terraform.tfvars                # VPC/subnet/target config
│   └── .gitignore
└── run-remote.sh                       # Upload + run helper
```

## Next Steps (Pending)

1. **Fix shard distribution** — increase replica count on span/log indices so all 3 nodes serve searches equally
2. **Run 300 VU test** — validate the "good experience" threshold estimate
3. **7-day data test** — let OTel Demo run for a week, then re-run 1000 VU test
4. **Dedicated search nodes** — set up remote store (S3) + search node role for production config
5. **Prometheus load** — route PromQL through OSD to test single-pod Prometheus under concurrent dashboard users
6. **WAF testing** — enable WAF on ALB, measure throughput impact
7. **Browser tests** — run k6 browser module for real Chromium sessions
