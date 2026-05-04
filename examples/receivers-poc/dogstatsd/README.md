# DogStatsD — drop-in for Datadog metrics

**Receiver:** `statsdreceiver` (collector-contrib)
**Port:** `8125/udp`
**Asana:** <https://app.asana.com/1/8442528107068/task/1214473690959543> (due 2026-05-08)

## User story

> Your app already emits DogStatsD metrics via `dogstatsd.increment("orders.placed")`. Set `DD_AGENT_HOST=observability-stack.internal`. Metrics now in OpenSearch.

## Scope

1. Enable `statsdreceiver` on `:8125/udp` in the POC collector config
2. Expose 8125/udp on the `otel-collector` service in the compose override
3. Emit metrics from an app using a standard DogStatsD client
4. Confirm metrics land in OpenSearch and render in OSD
5. Document:
   - Which DogStatsD features map cleanly (counters, gauges, histograms, timers)
   - Which don't (distributions, service checks, events)
   - Tag handling (`#tag1:val,tag2:val` → OTel attributes)

## Caveats to validate

1. **Metrics into OpenSearch is less well-trodden than traces/logs.** `opensearchexporter` stability row lists `traces, logs` only — metrics path likely needs Data Prepper.
2. **DogStatsD extends vanilla statsd.** Verify `statsdreceiver` handles DD-specific extensions (tags, distributions, events) vs vanilla statsd only.
3. **UDP is lossy by design.** Set expectations in the writeup — this is a statsd property, not an OpenSearch one.

## Expected collector config delta

```yaml
receivers:
  statsd:
    endpoint: 0.0.0.0:8125
    aggregation_interval: 60s
    enable_metric_type: true

service:
  pipelines:
    metrics:
      receivers: [otlp, statsd]
      # rest unchanged
```

## Deliverables

- [ ] Receiver enabled, metrics arriving in OSD
- [ ] Minimal DogStatsD emitter (any language — Python / Node / Go)
- [ ] Mapping notes per metric type
- [ ] Gap list: features DogStatsD has that statsdreceiver drops
