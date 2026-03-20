# Test 005: ALB E2E — 1000 VUs, OSD Scaled to 3 Replicas

**Status:** ⚠️ 0% errors but p95=14.57s — OpenSearch is now the bottleneck  
**Script:** `k6/scenarios/api-queries-alb.js`  
**Start:** 2026-03-20 15:08:58 PDT (22:08:58 UTC)  
**End:** 2026-03-20 15:24:01 PDT (22:24:01 UTC)  
**Duration:** 15m01s  
**Source:** EC2 m5.xlarge in same VPC → ALB → OSD (3 replicas) → OpenSearch  

## Configuration Changes (from Test 004)
- OSD: 1 replica (100m CPU, 512M) → **3 replicas (2 CPU, 2Gi each)**

## k6 Summary

| Metric | Test 004 (1x OSD 100m) | Test 005 (3x OSD 2CPU) |
|--------|------------------------|------------------------|
| Total requests | ~few hundred (broke immediately) | 93,912 |
| Requests/sec | N/A | 104 |
| http_req_duration p(50) | 3+ seconds | 824ms |
| http_req_duration p(90) | N/A | 13.89s |
| http_req_duration p(95) | N/A | **14.57s** 🔴 |
| http_req_duration max | N/A | 16.95s |
| http_req_failed | immediate failures | **0.00%** ✅ |
| Data received | N/A | 5.4 GB |

## Per-Check Breakdown

| Check | Rate | Notes |
|-------|------|-------|
| PPL 2xx | 100% ✅ | Working through OSD |
| PPL logs 2xx | 100% ✅ | Working |
| Search 2xx | 100% ✅ | Console proxy fixed |
| ServiceMap 2xx | 100% ✅ | Console proxy fixed |
| Dashboards list 2xx | 100% ✅ | Saved objects API |

## OpenSearch Cluster During Test

| Metric | Value | Notes |
|--------|-------|-------|
| CPU | **99-100%** | Pegged for entire test |
| JVM Heap | 34-78% (oscillating) | GC keeping up but under pressure |
| Search threads | 7 (pool size) | Only 7 concurrent searches possible |
| Search queue peak | **34** | Queries waiting in line |
| Search rejections | 0 | Queue didn't overflow (size=1000) |
| Write threads | 4 active | OTel Demo continuously indexing |
| Write queue | 6 | Steady write backlog |

## Hot Threads Analysis

Top CPU consumer: **write thread doing Lucene segment refresh** (`ReferenceManager.maybeRefreshBlocking`). The OTel Demo's continuous indexing forces segment refreshes that contend with search threads for CPU and lock access.

## Root Cause

**OpenSearch single node (4 vCPU) is CPU-saturated.**

- Search thread pool: 7 threads on 4 vCPU — can't parallelize enough
- Write/refresh contention: indexing from OTel Demo competes with search for CPU
- JVM heap at 512MB (50% of 1Gi request) — adequate but tight
- Single node = all shards, all searches, all writes on one box

## OSD Bottleneck: RESOLVED ✅

Scaling OSD from 1×100m to 3×2CPU completely eliminated the OSD bottleneck:
- Median response dropped from 3+ seconds to 824ms
- 0% error rate (was failing immediately before)
- OSD is no longer the constraint

## Recommendations for Next Test

1. **Scale OpenSearch horizontally**: Add dedicated search nodes (separate from data/ingest)
2. **Increase OpenSearch JVM heap**: 512MB → 2GB+ for query caching
3. **Consider node roles**: Dedicated cluster-manager, data, and search nodes
4. Follow OpenSearch official scaling guide for search-heavy workloads
