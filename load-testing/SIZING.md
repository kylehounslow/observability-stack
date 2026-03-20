# Capacity Sizing Chart

## Current Deployment (2026-03-20)

### Infrastructure
| Component | Replicas | CPU (req/limit) | Memory (req/limit) | Nodes |
|-----------|----------|-----------------|-------------------|-------|
| OpenSearch | 3 | 1000m / 2000m | 4Gi / 4Gi | 3x m5.xlarge |
| OpenSearch Dashboards | 3 | 500m / 2000m | 1Gi / 2Gi | spread across nodes |
| OTel Collector | 1 | none | none | 1 node |
| Data Prepper | 2 | none | none | 2 nodes |
| Prometheus | 1 | none | none | 1 node |
| EKS Nodes | 4x m5.xlarge | 4 vCPU each | 16 GB each | 16 vCPU / 64 GB total |

### Data Volume (OTel Demo + example agents)
| Metric | Current (1.7 days) | 7-Day Projection | 30-Day Projection |
|--------|-------------------|-------------------|-------------------|
| Spans | 379,025 | ~1.5M | ~6.6M |
| Logs | 139,909 | ~568K | ~2.4M |
| Service map entries | 128,604 | ~522K | ~2.2M |
| Primary store size | 316 MB | ~1.3 GB | ~5.6 GB |
| Total store (w/ replicas) | 632 MB | ~2.5 GB | ~11 GB |
| Ingestion rate (spans) | 9,163/hr | — | — |
| Ingestion rate (logs) | 3,382/hr | — | — |

---

## Concurrent User Capacity (Estimated)

Based on load tests 002–006, hitting OpenSearch Dashboards through ALB with PPL queries, _search, saved object loads, and service map queries.

### Current Config: 3 OS Nodes + 3 OSD Replicas, ~1.7 days of data (~316 MB primary)

| User Experience | Est. Concurrent Users (VUs) | p95 Latency | Throughput |
|----------------|---------------------------|-------------|------------|
| Excellent (< 200ms p95) | ~50 | < 200ms | ~50 req/s |
| Good (< 1s p95) | ~150–200 | < 1s | ~80 req/s |
| Acceptable (< 2s p95) | ~250–350 | < 2s | ~100 req/s |
| Degraded (< 5s p95) | ~500–700 | < 5s | ~120 req/s |
| Saturated | 1000 | **10.57s** | 143 req/s |
| Breaking (errors appear) | > 1000 (not yet found) | > 15s | — |

### Projected: 7 Days of Data (~1.3 GB primary)

With 4x more data, search queries scan more segments and use more heap. Expected impact:

| User Experience | Est. Concurrent Users | Notes |
|----------------|----------------------|-------|
| Excellent (< 200ms p95) | ~30–40 | Larger indices = slower scans |
| Good (< 1s p95) | ~100–150 | Query cache helps for repeated queries |
| Acceptable (< 2s p95) | ~150–250 | JVM heap pressure increases |
| Saturated | ~500–700 | Heap at 80%+, GC pauses start |

### Projected: 30 Days of Data (~5.6 GB primary)

| User Experience | Est. Concurrent Users | Notes |
|----------------|----------------------|-------|
| Excellent (< 200ms p95) | ~15–25 | Need shard optimization |
| Good (< 1s p95) | ~50–100 | Need more JVM heap or nodes |
| Acceptable (< 2s p95) | ~100–150 | ISM rollover policies critical |
| Saturated | ~300–500 | Need dedicated search nodes |

⚠️ **These are estimates** based on extrapolation from 1000 VU tests. Actual numbers depend on query complexity, time range selected, and index management policies. The 7-day and 30-day projections assume linear degradation which is optimistic — real degradation is often worse due to GC pressure and segment merge overhead.

---

## Scaling Recommendations by User Count

| Target Users | OpenSearch | OSD | EKS Nodes | Est. Monthly Cost |
|-------------|-----------|-----|-----------|-------------------|
| 10–50 | 1 node (4Gi, 2 CPU) | 1 replica | 2x m5.xlarge | ~$350 |
| 50–200 | 3 nodes (4Gi, 2 CPU) | 2 replicas | 3x m5.xlarge | ~$530 |
| 200–500 | 3 nodes (8Gi, 4 CPU) | 3 replicas | 4x m5.2xlarge | ~$1,100 |
| 500–1000 | 3 data + 2 search nodes | 3 replicas | 5x m5.2xlarge | ~$1,400 |
| 1000+ | 3 data + 3 search + 3 CM | 3+ replicas | 8x m5.2xlarge | ~$2,200 |

---

## Load Test History

| # | Date | Config | VUs | p95 | req/s | Bottleneck |
|---|------|--------|-----|-----|-------|-----------|
| 002 | 03-20 | 1 OS (direct, no OSD) | 300 | 16ms | 239 | None |
| 003 | 03-20 | 1 OS (direct, no OSD) | 1500 | 2.28s | 855 | OS CPU 99% |
| 004 | 03-20 | 1 OS + 1 OSD (ALB) | 1000 | 3s+ (broke) | ~0 | OSD 100m CPU |
| 005 | 03-20 | 1 OS + 3 OSD (ALB) | 1000 | 14.57s | 104 | OS CPU 99% |
| 006 | 03-20 | 3 OS + 3 OSD (ALB) | 1000 | 10.57s | 143 | Uneven shards |

### Key Findings
1. **OSD is the first bottleneck** — default 100m CPU is unusable under load. Minimum 500m request, 2000m limit.
2. **OpenSearch single node saturates at ~100 concurrent dashboard users** through OSD.
3. **3 OS nodes improve throughput 37%** but shard distribution must be balanced.
4. **Data volume directly impacts capacity** — more data = slower queries = fewer concurrent users.
5. **Write/search contention** — continuous indexing from OTel Demo competes with search for CPU (Lucene segment refresh).

### What We Haven't Tested Yet
- [ ] Balanced shard distribution (increase replica count)
- [ ] 7-day data volume impact
- [ ] Dedicated search nodes (requires remote store)
- [ ] Prometheus under concurrent PromQL load through OSD
- [ ] Browser-based load (real Chromium sessions)
- [ ] WAF impact on throughput
