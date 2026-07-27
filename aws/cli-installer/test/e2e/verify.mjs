/**
 * E2E data-flow verification.
 *
 * After a stack is created and telemetry is pushed (either by the EC2 OTel-demo
 * or a synthetic OTLP push), these helpers confirm that documents actually
 * landed in the expected OpenSearch indices by querying through the managed
 * OpenSearch UI (Application) endpoint — the same SigV4 proxy path the installer
 * uses, which works even for VPC-private domains from outside the VPC.
 *
 * Pure helpers (index expectations, count evaluation, OTLP payload building) are
 * separated from the network calls so they can be unit-tested without AWS.
 */
import { createHash } from 'node:crypto';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * The index patterns the stack ingests into, matching render.mjs sink config and
 * the index patterns created in opensearch-ui-init.mjs. Each is checked for a
 * positive document count during verification.
 *
 * `signal` labels how the index is populated: 'logs' and 'traces' map directly
 * to the OTLP signal that fills them; 'service-map' is derived asynchronously by
 * the pipeline from spans, so it gets its own key and can be required separately.
 */
export const EXPECTED_INDICES = [
  { pattern: 'logs-otel-v1', signal: 'logs' },
  { pattern: 'otel-v1-apm-span', signal: 'traces' },
  { pattern: 'otel-v2-apm-service-map', signal: 'service-map' },
];

/**
 * Given a map of index-pattern -> observed count, decide pass/fail per index and
 * overall. `require` narrows which signals must have data (e.g. a synthetic push
 * that only sends logs+traces should not require the service-map index, which is
 * derived asynchronously by the pipeline from spans).
 *
 * @returns {{ ok: boolean, results: Array<{pattern, signal, count, ok}> }}
 */
export function evaluateCounts(counts, { requireSignals } = {}) {
  const results = EXPECTED_INDICES.map(({ pattern, signal }) => {
    const count = Number(counts[pattern] ?? 0);
    const required = requireSignals ? requireSignals.includes(signal) : true;
    return { pattern, signal, count, required, ok: required ? count > 0 : true };
  });
  return { ok: results.every((r) => r.ok), results };
}

/**
 * Parse a document count out of an OpenSearch `_count` response body, which may
 * arrive as a parsed object or a raw JSON string (the console proxy returns text).
 * Returns 0 when the shape is unexpected rather than throwing.
 */
export function parseCount(body) {
  let obj = body;
  if (typeof body === 'string') {
    try { obj = JSON.parse(body); } catch { return 0; }
  }
  const n = obj?.count;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build a minimal OTLP/HTTP JSON payload for a single signal, used by the
 * no-demo scenarios to push synthetic telemetry directly at the OSIS ingest
 * endpoint. `nowNanos` is injected (not read from the clock) so this stays pure
 * and unit-testable.
 *
 * Supports 'logs' and 'traces'. The trace payload carries service.name so the
 * pipeline can derive service-map edges.
 */
export function buildOtlpPayload(signal, { serviceName = 'e2e-synthetic', nowNanos, traceId, spanId } = {}) {
  const ts = String(nowNanos ?? '0');
  const resource = {
    attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
  };

  if (signal === 'logs') {
    return {
      resourceLogs: [{
        resource,
        scopeLogs: [{
          scope: { name: 'e2e-verifier' },
          logRecords: [{
            timeUnixNano: ts,
            observedTimeUnixNano: ts,
            severityNumber: 9,
            severityText: 'INFO',
            body: { stringValue: 'e2e synthetic log' },
            traceId: traceId || '',
            spanId: spanId || '',
          }],
        }],
      }],
    };
  }

  if (signal === 'traces') {
    return {
      resourceSpans: [{
        resource,
        scopeSpans: [{
          scope: { name: 'e2e-verifier' },
          spans: [{
            traceId: traceId || '00000000000000000000000000000001',
            spanId: spanId || '0000000000000001',
            name: 'e2e-synthetic-span',
            kind: 2, // SERVER
            startTimeUnixNano: ts,
            endTimeUnixNano: String(BigInt(ts || '0') + 1_000_000n),
            attributes: [{ key: 'e2e', value: { boolValue: true } }],
            status: { code: 1 },
          }],
        }],
      }],
    };
  }

  throw new Error(`buildOtlpPayload: unsupported signal '${signal}'`);
}

/**
 * Build the OSIS OTLP ingest URL for a signal.
 * OSIS exposes per-pipeline paths: https://<endpoint>/<pipeline>/v1/{logs,traces,metrics}
 */
export function otlpUrl(ingestEndpoint, pipelineName, signal) {
  const host = ingestEndpoint.replace(/^https?:\/\//, '');
  return `https://${host}/${pipelineName}/v1/${signal}`;
}

// ── SigV4 request helper (shared by ingest + query) ─────────────────────────────

async function sigv4Fetch({ method, url, body, service, region }) {
  const isBodyless = method === 'GET' || method === 'DELETE';
  const bodyBytes = !isBodyless && body != null
    ? (typeof body === 'string' ? body : JSON.stringify(body))
    : '';
  const parsed = new URL(url);
  const query = {};
  parsed.searchParams.forEach((v, k) => { query[k] = v; });

  const request = new HttpRequest({
    method,
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    path: parsed.pathname,
    query,
    headers: {
      host: parsed.hostname,
      'Content-Type': 'application/json',
      'osd-xsrf': 'osd-fetch',
      'x-amz-content-sha256': createHash('sha256').update(bodyBytes).digest('hex'),
    },
    body: bodyBytes || undefined,
  });

  const signer = new SignatureV4({ credentials: defaultProvider(), region, service, sha256: Sha256 });
  const signed = await signer.sign(request);
  const resp = await fetch(url, { method, headers: signed.headers, body: isBodyless ? undefined : bodyBytes });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data };
}

/**
 * Push a synthetic OTLP payload to the OSIS ingest endpoint (service `osis`).
 * Used by no-demo scenarios. Returns { status }.
 */
export async function pushOtlp({ ingestEndpoint, pipelineName, region, signal, payload }) {
  const url = otlpUrl(ingestEndpoint, pipelineName, signal);
  const { status } = await sigv4Fetch({
    method: 'POST', url, body: payload, service: 'osis', region,
  });
  return { status };
}

// ── Query the domain through the OpenSearch UI (Application) endpoint ───────────

/**
 * Discover the auto-created data-source id behind the OpenSearch UI, needed to
 * proxy queries to the underlying domain/collection.
 */
export async function findDataSourceId({ appEndpoint, region }) {
  const { status, data } = await sigv4Fetch({
    method: 'GET',
    url: `${appEndpoint}/api/saved_objects/_find?type=data-source&per_page=10`,
    service: 'opensearch', region,
  });
  if (status !== 200) return null;
  return data?.saved_objects?.[0]?.id || null;
}

/**
 * Get the document count for an index pattern by proxying an OpenSearch
 * `_count` request through the UI console proxy. This is the reachable path for
 * VPC-private domains (the UI proxies over the AWS-internal network).
 */
export async function countDocs({ appEndpoint, region, dataSourceId, indexPattern }) {
  const path = encodeURIComponent(`/${indexPattern}*/_count`);
  const url = `${appEndpoint}/api/console/proxy?path=${path}&method=GET`
    + (dataSourceId ? `&dataSourceId=${dataSourceId}` : '');
  const { status, data } = await sigv4Fetch({ method: 'POST', url, service: 'opensearch', region });
  if (status !== 200) return { status, count: 0 };
  return { status, count: parseCount(data) };
}

/**
 * Poll all expected indices until every required signal has a positive count or
 * the deadline passes. Returns the final evaluateCounts() result plus timing.
 *
 * Data can take several minutes to land (EC2 demo bootstrap, or OSIS ingest
 * warmup for a freshly-created VPC pipeline), so this polls patiently.
 */
export async function waitForData({
  appEndpoint, region, dataSourceId, requireSignals,
  timeoutMs = 20 * 60_000, intervalMs = 30_000, log = () => {},
}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    const counts = {};
    for (const { pattern } of EXPECTED_INDICES) {
      const { count } = await countDocs({ appEndpoint, region, dataSourceId, indexPattern: pattern });
      counts[pattern] = count;
    }
    last = evaluateCounts(counts, { requireSignals });
    const summary = last.results.map((r) => `${r.pattern}=${r.count}${r.required ? '' : '(opt)'}`).join(' ');
    log(`counts: ${summary} — ${last.ok ? 'OK' : 'waiting'}`);
    if (last.ok) return { ...last, elapsedMs: Date.now() - start };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ...(last || { ok: false, results: [] }), elapsedMs: Date.now() - start, timedOut: true };
}
