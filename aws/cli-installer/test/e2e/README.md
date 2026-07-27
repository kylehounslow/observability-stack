# Local AWS end-to-end tests

These tests exercise the CLI against **real AWS resources**: they create a full
stack (OpenSearch domain or serverless collection, OSIS pipeline, IAM roles, AMP
workspace, OpenSearch Application, and optionally an EC2 demo instance), drive
telemetry through it, confirm the data lands in OpenSearch, then tear everything
down.

Because they need AWS credentials and cost real money/time, they are **not run in
CI**; GitHub Actions has no AWS credentials by policy. Run them locally against a
disposable sandbox account when you touch AWS-specific code (`aws.mjs`,
`ec2-demo.mjs`, `opensearch-ui-init.mjs`, `render.mjs`, VPC handling, destroy).

> ⚠️ **Sandbox only.** The runner creates and **deletes** OpenSearch domains,
> OSIS pipelines, IAM roles, EC2 instances, and AMP workspaces. Every resource it
> touches is prefixed `e2e-`, but never point it at a production account. It
> prints the target account id up front so you can confirm before it proceeds.

## What is covered

The scenario matrix crosses the AWS-specific dimensions called out in the design:

| Scenario | Backend | Network | Demo | Data-flow verified | Default |
|---|---|---|---|---|---|
| `managed-public-demo` | Managed domain | Public | EC2 OTel-demo | ✅ | ✅ |
| `managed-public-nodemo` | Managed domain | Public | Synthetic OTLP push | ✅ | ✅ |
| `serverless-public-nodemo` | Serverless (AOSS) | Public | Synthetic OTLP push | ✅ | ✅ |
| `managed-vpc-demo` | Managed domain | VPC-private | EC2 OTel-demo | ✅ | opt-in |
| `managed-vpc-nodemo` | Managed domain | VPC-private | (none) | create/destroy only | opt-in |

- **Demo scenarios** launch the EC2 instance that runs the OTel demo + example
  agents and generate real telemetry. In VPC mode the instance is placed **inside
  the configured VPC**, so it can reach the VPC-private OSIS ingest endpoint. This
  is what actually proves end-to-end VPC data flow.
- **No-demo (public) scenarios** pass `--skip-demo` and instead push a small
  synthetic OTLP payload (logs + traces) straight at the OSIS ingest endpoint, so
  they are much faster and cheaper while still proving the ingest to index path.
- **`managed-vpc-nodemo` is create/destroy only.** A VPC-attached pipeline's ingest
  endpoint is VPC-private (RFC-1918), so a synthetic push from the developer's host
  cannot reach it; data-flow verification is not applicable. This scenario still
  exercises the full VPC create path (the CLI exits 0 only after the VPC-attached
  pipeline reaches `ACTIVE`) and the teardown path. To verify actual VPC data flow,
  use `managed-vpc-demo`, whose demo runs in-VPC.
- **VPC scenarios** are opt-in because they need pre-existing VPC infrastructure
  (see below). Without the VPC env vars they are reported as `skipped`, not
  failed, so the default matrix runs anywhere.

When data flow **is** verified, the runner always queries through the managed
**OpenSearch UI (Application)** endpoint, which is reachable from outside the VPC
and proxies to the domain over the AWS-internal network, the same path the
installer uses. This is what lets a VPC-private *domain* be verified from a laptop
with no bastion or VPN. (The *ingest* endpoint, unlike the domain, is not proxied,
which is why VPC ingest can only be driven from inside the VPC.)

## Prerequisites

- Node.js 18+ (repo uses 22).
- AWS credentials for a sandbox account (`aws sts get-caller-identity` succeeds).
- Permissions for OpenSearch, OpenSearch Serverless, OSIS, AMP, IAM, EC2, SSM,
  Secrets Manager, and Resource Groups Tagging.
- For VPC scenarios: a VPC with 1-3 private subnets in distinct AZs and a security
  group that allows intra-VPC traffic (a group that allows traffic from itself
  works well).

## Running

From `aws/cli-installer/`:

```bash
# List the scenario matrix
npm run e2e:list

# Run the default (public) scenarios in one region
AWS_PROFILE=my-sandbox npm run e2e -- --region us-east-1

# Run a single scenario
AWS_PROFILE=my-sandbox node test/e2e/run.mjs --scenario managed-public-nodemo --region us-east-1

# Include the VPC scenarios (requires the env vars below)
AWS_PROFILE=my-sandbox \
  E2E_VPC_ID=vpc-0123456789abcdef0 \
  E2E_SUBNET_IDS=subnet-aaa,subnet-bbb \
  E2E_SECURITY_GROUP_IDS=sg-0123456789abcdef0 \
  node test/e2e/run.mjs --all --region us-east-1

# Leave resources up for debugging (remember to destroy them yourself)
node test/e2e/run.mjs --scenario managed-public-demo --no-teardown --region us-east-1
```

### Options

| Flag | Meaning |
|---|---|
| `--region <r>` | AWS region (default `$AWS_REGION` or `us-east-1`) |
| `--scenario <name>` | Run only this scenario (repeatable) |
| `--all` | Include opt-in (VPC) scenarios |
| `--list` | Print the matrix and exit |
| `--no-teardown` | Skip destroy after the run (debugging) |
| `--data-timeout <min>` | Minutes to wait for data to land (default 20) |

### Timing

- Managed + demo: ~15 min to create, plus up to ~15 min for the EC2 demo to
  bootstrap and telemetry to appear.
- Serverless / no-demo: a few minutes to create; synthetic data lands quickly
  once ingest is warm.
- A freshly created (especially VPC-attached) OSIS pipeline can take ~10-15 min
  after it reports `ACTIVE` before it actually accepts ingest; the runner keeps
  retrying the synthetic push during that warmup, so give it the default timeout.

The process exits non-zero if any scenario fails or errors, so it works as a
pass/fail gate in a local script.

## Troubleshooting

- **OSIS `CreatePipeline` fails with "Unable to create pipeline due to an internal
  exception."** This is an AWS-side error, not a CLI or harness defect. It is
  intermittent (observed on a serverless create that then passed unchanged on the
  next run). Re-run the scenario; if it persists across several attempts, check the
  OSIS service health for the region.
- **A run left resources behind (killed mid-run, interrupted, or `--no-teardown`).**
  `destroy` is idempotent: it skips resources that no longer exist and deletes what
  remains. Re-run it with the same pipeline name to finish cleanup:
  ```bash
  node bin/cli-installer.mjs destroy --pipeline-name <name> --region <region>
  ```
  For a VPC scenario, resolve `<name>` from the leftover domain/pipeline (the
  runner names both after the pipeline). Managed-domain deletion is asynchronous,
  so the domain may still list as `Deleted: true, Processing: true` for a while
  after `destroy` returns; its VPC ENIs (described `ES <domain>`) release
  automatically once deletion completes.

## Unit tests (no AWS)

The pure logic of the harness (the scenario matrix, CLI arg construction,
document-count evaluation, and synthetic OTLP payload building) is unit-tested in
`e2e-unit.test.mjs` and runs with the normal unit suite (no credentials needed):

```bash
npm test          # runs src unit tests + e2e harness unit tests
```

## Files

| File | Purpose |
|---|---|
| `scenarios.mjs` | Scenario matrix + pure CLI arg construction |
| `verify.mjs` | Synthetic OTLP push + data-flow verification via the UI endpoint |
| `run.mjs` | Live runner: create → drive telemetry → verify → destroy per scenario |
| `e2e-unit.test.mjs` | Unit tests for the pure logic above |
