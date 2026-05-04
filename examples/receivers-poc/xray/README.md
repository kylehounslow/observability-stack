# AWS X-Ray — drop-in for the X-Ray daemon

**Receiver:** `awsxrayreceiver` (collector-contrib)
**Port:** `2000/udp` (X-Ray daemon protocol)
**Strategic context:** pairs with CloudWatch flows for the "AWS-native migration" story

## User story

> Point your X-Ray daemon at observability-stack, or set `AWS_XRAY_DAEMON_ADDRESS=observability-stack:2000` on your app. Traces now in OpenSearch.

The X-Ray daemon listens on UDP 2000 and accepts the X-Ray segment wire format. `awsxrayreceiver` mimics that listener — any app or SDK wired to an X-Ray daemon already works.

## Scope

1. Enable `awsxrayreceiver` on `:2000/udp` in the POC collector config
2. Expose 2000/udp on the `otel-collector` service in the compose override
3. (Optional) Run a small app instrumented with `aws-xray-sdk-*` pointed at the receiver
4. Confirm traces land in OpenSearch + render in OSD
5. Mapping writeup: X-Ray segments → OTel spans

## Caveats to validate

1. X-Ray segments have AWS-specific fields (`origin`, `user`, annotations, metadata). Receiver maps these to OTel attributes — verify which land where.
2. X-Ray sampling rules are evaluated on the SDK side before the daemon sees anything. Not a receiver concern, but worth a docs note.
3. X-Ray subsegments → child spans. Confirm the span tree shape.

## Expected collector config delta

```yaml
receivers:
  awsxray:
    endpoint: 0.0.0.0:2000
    transport: udp

service:
  pipelines:
    traces:
      receivers: [otlp, awsxray]
      # rest unchanged
```

## Deliverables

- [ ] Receiver enabled, traces arriving in OSD
- [ ] Mapping notes: X-Ray segment fields → OTel span fields
- [ ] Gap list: X-Ray-specific concepts that OSD doesn't render (e.g. X-Ray's service graph view)
