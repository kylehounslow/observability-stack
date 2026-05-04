# Receivers POC — observability-stack as a drop-in for other vendors

> **Status:** Work in progress. Scaffolding only — no receivers are wired up yet.

This folder explores whether observability-stack can absorb data from existing vendor agents by adding OTel collector-contrib receivers. The story we're trying to validate:

> *Your app is already emitting `${vendor}` telemetry. Change one env var (or one config line). It now lands in OpenSearch.*

Each subfolder below targets one vendor/protocol and aims to prove — or disprove — the drop-in promise for that flow.

## Why this exists

Every receiver in `otel-collector-contrib` that can feed OpenSearch (via `opensearchexporter` directly, or via `otlphttp` → Data Prepper) is effectively a free integration with whatever vendor produces that format. The question is *which receivers are already working, which are content-only gaps, and which need code.*

## Scope per receiver

| # | Folder | Receiver | Port / protocol | Story |
|---|--------|----------|-----------------|-------|
| 1 | [`datadog/`](./datadog/) | `datadogreceiver` | `:8126/tcp` | Drop-in for the Datadog trace-agent (APM) |
| 2 | [`dogstatsd/`](./dogstatsd/) | `statsdreceiver` | `:8125/udp` | Drop-in for DogStatsD (Datadog metrics) |
| 3 | [`cloudwatch-firehose/`](./cloudwatch-firehose/) | `awsfirehosereceiver` | HTTP | CloudWatch Logs → Firehose subscription → observability-stack |
| 4 | [`xray/`](./xray/) | `awsxrayreceiver` | `:2000/udp` | Point X-Ray daemon at observability-stack for traces |
| 5 | [`prometheus-remotewrite/`](./prometheus-remotewrite/) | `prometheusremotewritereceiver` | `:19291/http` | Existing Prom setup pushes to observability-stack |

See each subfolder's `README.md` for the specific user story, caveats, and gap analysis.

## How this composes with the main stack

The POC lives next to the existing docker-compose stack. Two new files layer on top:

- [`docker-compose.receivers.yml`](./docker-compose.receivers.yml) — compose override exposing the receiver ports on the `otel-collector` service.
- [`otel-collector-config.yaml`](./otel-collector-config.yaml) — collector config override adding the new receivers to the existing pipelines.

Run the stack with both overlays:

```sh
# From repo root
docker compose \
  -f docker-compose.yml \
  -f examples/receivers-poc/docker-compose.receivers.yml \
  up -d
```

> **NOTE:** the override files ship with receiver stanzas *commented out* until each subfolder validates its flow. Uncomment per-receiver as you work through the POC.

## Deployment modes to keep in mind

From the Datadog PoC planning — applies to every receiver in this folder:

1. **Greenfield** — only observability-stack runs on the target port. Clean story for new deployments.
2. **Side-by-side** — real vendor agent AND observability-stack on different ports/hosts, app fans out to both. Best for validating migration before cutting over.
3. **Full replacement** — real vendor agent removed, observability-stack listens on the canonical port. The "drop-in" story.

Each subfolder's README calls out which modes it supports.

## What's in scope / out of scope

**In scope**
- Config to stand each receiver up
- A minimal sample app (or emitter) demonstrating the drop-in
- A gap writeup: what maps cleanly, what's lossy, what fails

**Out of scope (for this POC cycle)**
- Production-grade auth / TLS on each receiver endpoint
- Full feature-parity with the vendor product (e.g. Datadog service map fidelity — that's a blog-post exercise, not a PoC)
- Any receiver not listed in the matrix above

## Related

- Parent audit: <https://app.asana.com/1/8442528107068/project/1212930095947887/task/1214459491609850>
- Datadog APM PoC task: <https://app.asana.com/1/8442528107068/task/1214459492210646>
- DogStatsD PoC task: <https://app.asana.com/1/8442528107068/task/1214473690959543>
- Synthesis task: <https://app.asana.com/1/8442528107068/task/1214459189007316>
- OTel collector-contrib receivers (v0.151.0): <https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/v0.151.0/receiver>
