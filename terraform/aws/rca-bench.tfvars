# OpenRCA benchmark deployment overlay.
#
# Sized for the full 335-case OpenRCA dataset:
#   - ~290 GB raw NDJSON across traces+logs+metrics
#   - ~1 TB indexed in OpenSearch (with 1 replica)
#   - <1 GB in Cortex
#
# Use:
#   terraform apply -var-file=rca-bench.tfvars
#
# Tear-down replaces the default observability-stack deployment with a
# benchmark-sized one. Sized for one-shot bulk ingest + 335 case runs +
# Intelligence Layer A/B comparisons. Tear it down when the publication
# ships.

cluster_name       = "obs-stack-rca-bench"
node_instance_type = "m5.2xlarge"   # 8 vCPU / 32 GB RAM each
node_count         = 3              # 24 vCPU / 96 GB RAM total cluster

# OpenSearch — bulk-ingest sized
opensearch_replicas      = 3
opensearch_storage_size  = "500Gi"  # 3 × 500 = 1.5 TB cluster
opensearch_storage_class = "gp3"    # cheaper + provisioned IOPS for bulk ingest
opensearch_node_memory   = "16Gi"
opensearch_jvm_heap      = "8g"     # 50% of 16 GB request

# Cortex — metrics tiny, default works fine
cortex_storage_size      = "50Gi"
cortex_storage_class     = "gp3"

# OTel Demo — must stay disabled for benchmark runs.
# Demo writes spans/logs/metrics to the default otel-v1-apm-span-* and
# logs-otel-v1-* indices. The OpenRCA suite relies on the eval-* prefix
# for data isolation; demo traffic on the same cluster pollutes the
# catch-all indices and makes ingest sanity-checks ambiguous. Pinned
# explicitly so future bench runs can't accidentally inherit a different
# default.
enable_otel_demo = false
