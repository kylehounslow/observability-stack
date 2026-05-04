# Datadog APM — drop-in for the Datadog trace-agent

**Receiver:** `datadogreceiver` (alpha, collector-contrib)
**Port:** `8126/tcp`
**Asana:** <https://app.asana.com/1/8442528107068/task/1214459492210646> (due 2026-05-07)

## User story

> Set `DD_AGENT_HOST=observability-stack.internal`. Restart your app. Traces now in OpenSearch. No code changes, no re-instrumentation.

The Datadog tracer libraries (`dd-trace-py`, `dd-trace-java`, `dd-trace-go`, …) already support endpoint override via `DD_AGENT_HOST`, `DD_TRACE_AGENT_PORT`, or `DD_TRACE_AGENT_URL`. Switching targets is an env-var change.

## Scope

1. Enable `datadogreceiver` on `:8126` in the POC collector config
2. Expose 8126 on the `otel-collector` service in the compose override
3. Run a dd-trace-go sample app pointed at `observability-stack:8126`
4. Confirm traces land in OpenSearch and render in OSD
5. Write up: what maps cleanly, what's lossy

## Deployment modes

- **Greenfield:** app sends only to observability-stack on 8126. Easiest demo.
- **Side-by-side:** real Datadog Agent on 8126, observability-stack on a different port (e.g. 8127). Two tracer configs, or one tracer + fan-out. Best for pre-migration validation.
- **Full replacement:** Datadog Agent removed, observability-stack on 8126. The headline "drop-in" story.

## Caveats to validate (not assume)

1. Both `datadogreceiver` and `opensearchexporter` are alpha — call out honestly in any writeup.
2. Two paths into OpenSearch — pick one:
   - Path A: `datadogreceiver → opensearchexporter → OpenSearch` (direct)
   - Path B: `datadogreceiver → otlphttp → Data Prepper → OpenSearch` (current stack default; more enrichment)
3. Datadog's stance: `datadogreceiver` is alpha in contrib partly due to Datadog friction. Worth a heads-up internally before external messaging.
4. APM feature-parity (service map, RED metrics, latency percentiles) is *stretch* for this PoC — it's blog-post territory.

## Expected collector config delta

```yaml
receivers:
  datadog:
    endpoint: 0.0.0.0:8126
    read_timeout: 60s

service:
  pipelines:
    traces:
      receivers: [otlp, datadog]   # side-by-side
      # rest unchanged
```

## Sample app

TBD — `app/` subfolder will host a small dd-trace-go service. Pinning to a specific `dd-trace-go` version + Go version up front to keep the repro tight.

## Deliverables (feeds the blog follow-up)

- [ ] Receiver enabled, traces arriving in OSD
- [ ] Minimal sample app reproducing the flow
- [ ] Mapping notes: `service` → `service.name`, `resource` → span name/attr, DD tags → OTel attrs
- [ ] Gap list: attributes that don't translate, span kinds that look wrong, anything lossy
- [ ] Animated GIF: env-var change → restart → traces in OSD
