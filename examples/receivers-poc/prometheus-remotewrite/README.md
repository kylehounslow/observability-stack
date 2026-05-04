# Prometheus remote_write — drop-in metrics push

**Receiver:** `prometheusremotewritereceiver` (collector-contrib)
**Port:** `19291/http` (default)
**Strategic context:** low-effort, high-leverage — most Prom users already run remote_write

## User story

> Your Prometheus or Prom-compatible agent already does remote_write. Change the URL to `http://observability-stack:19291/api/v1/write`. Metrics now in OpenSearch.

## Why remote_write, not scrape

- **Push vs pull:** remote_write is what customers already use for long-term-storage tiers (Mimir, Thanos, VictoriaMetrics, AMP). Changing the URL is effectively free.
- **`prometheusreceiver` (scrape) still matters** for the greenfield case where observability-stack scrapes targets directly, but that's a different story (config scrape targets) rather than a drop-in.

## Scope

1. Enable `prometheusremotewritereceiver` on `:19291` in the POC collector config
2. Expose 19291 on the `otel-collector` service in the compose override
3. Point a local Prometheus (or a `node_exporter` behind a tiny Prom) at the endpoint via `remote_write`
4. Confirm metrics land in OpenSearch + render in OSD
5. Mapping writeup: Prom metric types → OTel metric types (Prom only has counter/gauge/histogram/summary; OTel has more nuance around delta/cumulative temporality)

## Caveats to validate

1. Temporality: Prom is cumulative; confirm what the OpenSearch metrics path expects.
2. Histograms: Prom has classic + native histograms; receiver support differs. Check receiver README for the version in use.
3. Naming: Prom's `_total` / `_bucket` / `_count` suffixes vs OTel unit/name conventions — often a mismatch in dashboards.

## Expected collector config delta

```yaml
receivers:
  prometheusremotewrite:
    endpoint: 0.0.0.0:19291

service:
  pipelines:
    metrics:
      receivers: [otlp, prometheusremotewrite]
      # rest unchanged
```

## Deliverables

- [ ] Receiver enabled, metrics arriving in OSD
- [ ] A Prom config snippet showing `remote_write` pointed at observability-stack
- [ ] Mapping + gap writeup
