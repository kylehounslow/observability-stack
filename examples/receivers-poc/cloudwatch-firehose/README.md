# CloudWatch Logs via Kinesis Firehose

**Receiver:** `awsfirehosereceiver` (collector-contrib)
**Port:** HTTP (default `:4433` in this POC)
**Strategic context:** user-requested — "CloudWatch (logs mainly)"

## Why Firehose, not the direct CloudWatch receiver?

Two AWS receivers land CloudWatch Logs into an OTel collector:

| Receiver | Model | Good for | Drawbacks |
|----------|-------|----------|-----------|
| `awscloudwatchreceiver` | **Pull** (polls `FilterLogEvents` per log group) | Quick start, no AWS config beyond IAM | API throttling at scale, polling latency, cost scales with log-group count |
| `awsfirehosereceiver` | **Push** (HTTP endpoint Firehose delivers to) | Production-scale log volume, low latency, CloudWatch metric streams, VPC flow logs | Requires Firehose + subscription filter setup in AWS |

For the "drop-in replacement for CloudWatch as a backend" story, **Firehose is the right answer** — it scales to real log volumes, supports metrics via metric streams, and is the path AWS itself recommends for streaming to third-party endpoints.

We can *also* scaffold the pull-based `awscloudwatchreceiver` for the "just point me at my log group" quick-start story, but Firehose is the headline.

## User story

> Create a Firehose delivery stream with your log group's subscription filter pointing at `https://observability-stack.internal:4433`. Logs now in OpenSearch.

## Scope (this POC — config-only, no live AWS needed)

1. Enable `awsfirehosereceiver` on `:4433` in the POC collector config with `record_type: cwlogs`
2. Expose 4433 on the `otel-collector` service in the compose override
3. Document the AWS-side setup (Firehose stream + CloudWatch subscription filter + IAM)
4. (Optional) Provide a curl replay of a sample Firehose payload to prove the endpoint accepts data without a live AWS account
5. Write up the readiness story — what a user needs on the AWS side to make this work

**Not in scope for this POC:** a live AWS account emitting real CloudWatch logs. That lives in a follow-on or in the blog demo.

## Caveats to validate

1. `awsfirehosereceiver` supports three `record_type` values: `cwmetrics`, `cwlogs`, `otlp_v1`. Each shapes data differently — one receiver instance per record type if you need more than one.
2. Firehose signs requests with a shared secret (`x-amz-firehose-access-key`). Decide whether the POC keeps this optional or makes it required.
3. TLS termination: Firehose will only push to HTTPS endpoints in real deployments. In-compose we run plain HTTP; document the gap.
4. Sample payload: Firehose wraps CW Logs records in a specific envelope. The receiver handles decoding — sample payloads are in the receiver's README and test fixtures.

## Expected collector config delta

```yaml
receivers:
  awsfirehose:
    endpoint: 0.0.0.0:4433
    record_type: cwlogs

service:
  pipelines:
    logs:
      receivers: [otlp, awsfirehose]
      # rest unchanged
```

## AWS-side setup (for the README, not to deploy today)

1. Create a Kinesis Data Firehose delivery stream, destination type "HTTP endpoint"
2. Set endpoint URL to `https://your-observability-stack:4433`
3. (Optional) Set an access key — Firehose sends it as `x-amz-firehose-access-key`
4. Create a subscription filter on the target CloudWatch log group pointing at the Firehose stream

## Deliverables

- [ ] Receiver scaffolding + config
- [ ] README explaining Firehose setup end-to-end
- [ ] Optional: curl sample Firehose payload → confirm receiver accepts and pipeline ships to OpenSearch
- [ ] Gap analysis: TLS story, auth story, cost/volume caveats
