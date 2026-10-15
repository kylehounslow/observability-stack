---
title: "Claude Platform"
description: "Send OpenTelemetry traces from the Claude SDK and the Claude API to the observability stack"
---

The Claude SDK and the Claude API emit OpenTelemetry spans for Messages API requests, tool uses, and Managed Agents sessions. The spans use the [GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai), so they appear in [Agent Traces](/docs/ai-observability/agent-tracing/) without a custom schema. Both features are in beta at Anthropic. See [OpenTelemetry for the Claude API](https://platform.claude.com/docs/en/manage-claude/opentelemetry).

There are two sources of spans. You can use either or both.

| Source | Spans | Where they're emitted | Setup |
|---|---|---|---|
| SDK tracing | One `CLIENT` span per request, tool runner spans, client tool spans | In your application | Register a tracer provider that exports to the OTel Collector |
| API tracing | One `SERVER` span per request, plus model request, server tool, MCP tool, and Managed Agents turn spans | In the Claude API | Add a telemetry destination in the Claude Console that points at a public HTTPS endpoint |

SDK tracing works with the Claude API, Claude Platform on AWS, Amazon Bedrock, Google Cloud, and Microsoft Foundry clients. API tracing works with the Claude API and Claude Platform on AWS.

## SDK tracing

The SDK uses the tracer provider that your application registers. Register it before the first call.

```bash
pip install --upgrade "anthropic[bedrock]" opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

```python
from anthropic import AnthropicBedrock, beta_tool
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

provider = TracerProvider(resource=Resource.create({"service.name": "weather-agent"}))
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://localhost:4318/v1/traces"))
)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("weather-agent")

client = AnthropicBedrock(
    aws_region="us-west-2",
    open_telemetry={"traces": {"content_mode": "content"}},
)


@beta_tool
def get_weather(city: str) -> str:
    """Get the current weather for a city.

    Args:
        city: City name, for example "Vancouver".
    """
    return f"12C and raining in {city}"


with tracer.start_as_current_span(
    "invoke_agent weather-agent",
    attributes={"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "weather-agent"},
):
    runner = client.beta.messages.tool_runner(
        model="global.anthropic.claude-haiku-4-5-20251001-v1:0",
        max_tokens=512,
        tools=[get_weather],
        messages=[{"role": "user", "content": "What's the weather in Vancouver?"}],
    )
    for message in runner:
        pass

provider.shutdown()
```

For the Claude API, use `Anthropic()` instead of `AnthropicBedrock()`. The tracing options are the same for every client.

This produces the following trace:

```text
invoke_agent weather-agent              Agent  (your span)
└── anthropic.messages.tool_runner      Agent
    ├── anthropic.messages.create       LLM
    ├── anthropic.custom_tool_use get_weather   Tool
    └── anthropic.messages.create       LLM
```

Agent Traces lists a trace only when its root span has `gen_ai.operation.name`. If you wrap SDK calls in your own span, set `gen_ai.operation.name` on that span, as in the example, or use `@observe(op=Op.INVOKE_AGENT)` from the [Python SDK](/docs/send-data/ai-agents/python/).

### SDK options

Set each option in `open_telemetry` on the client, or with its environment variable. Passing `open_telemetry` overrides all `ANTHROPIC_OPEN_TELEMETRY*` environment variables.

| Option | Environment variable | Values | Default |
|---|---|---|---|
| `traces.content_mode` | `ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE` | `metadata_only`, `content` | `metadata_only` |
| `traces.max_content_bytes` | `ANTHROPIC_OPEN_TELEMETRY_TRACES_MAX_CONTENT_BYTES` | Bytes of content per span | 0.75 MB |
| `conversation_id` | None | Sets `gen_ai.conversation.id` | None |
| `tracer_provider` | None | A tracer provider | The global tracer provider |
| `propagation` | `ANTHROPIC_OPEN_TELEMETRY_PROPAGATION` | `true`, `false` | `true` |
| `open_telemetry` | `ANTHROPIC_OPEN_TELEMETRY` | `false` turns off spans for the client | On |

With `metadata_only`, spans have no prompts or responses, so the Input and Output columns in Agent Traces are empty. Set `content` to see them. For other languages, see [Use OpenTelemetry with the Claude SDK](https://platform.claude.com/docs/en/manage-claude/opentelemetry/sdk).

## API tracing

The Claude API delivers spans to a destination with these requirements:

| Requirement | Value |
|---|---|
| Protocol | OTLP/HTTP, protobuf encoding |
| Transport | HTTPS on port 443, with a hostname that resolves to a public IP address |
| Path | The API appends `/v1/traces` to the endpoint URL |
| Authentication | Static request headers, for example `authorization: Bearer <token>` |
| Compression | gzip on the first attempt; uncompressed retry after a `400` or `415` |
| Timeouts | 5 seconds for the TLS handshake and for the response headers, 10 seconds per delivery |
| Redirects | A `3xx` response disables the destination |

The stack's collector listens on plain HTTP on port 4318 without authentication, so don't expose it directly. Run a gateway collector that terminates TLS and checks a bearer token, then forwards to the stack's collector:

```yaml
extensions:
  bearertokenauth:
    scheme: Bearer
    token: ${env:CLAUDE_OTLP_TOKEN}

receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4443
        tls:
          cert_file: /certs/cert.pem
          key_file: /certs/key.pem
        auth:
          authenticator: bearertokenauth

exporters:
  otlp:
    endpoint: otel-collector:4317
    tls:
      insecure: true

service:
  extensions: [bearertokenauth]
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp]
```

Publish port 443 to the gateway's port 4443, either directly or through a load balancer, with a certificate that a public CA issued for the gateway's hostname.

To add the destination in the Claude Console:

1. Open the [OpenTelemetry settings page](https://platform.claude.com/settings/telemetry-destinations) and click **Add destination**. You need the admin role.
2. Set **Provider** to **Custom**.
3. Set **OTLP endpoint URL** to the gateway's base URL, for example `https://otlp.example.com`.
4. Add the request header `authorization` with the value `Bearer <CLAUDE_OTLP_TOKEN>`.
5. Choose **Content mode** and **Workspaces**, then save.
6. Click **Test** in the destination's **More actions** menu, then check that an `anthropic.test` span arrived:

   ```
   source = otel-v1-apm-span-* | where name = 'anthropic.test'
   ```

API spans have `service.name` set to `claude-platform`. A request's API spans are in their own trace unless the request has a `traceparent` header. The SDK sends that header, so with both SDK and API tracing on, the API's `SERVER` span is a child of the SDK's `CLIENT` span. Claude Platform on AWS doesn't read `traceparent`; its API spans always start their own traces.

## How Claude spans appear in Agent Traces

| Span | Source | `gen_ai.operation.name` | Agent Traces kind |
|---|---|---|---|
| `anthropic.messages.create` | SDK (`CLIENT`), API (`SERVER`) | `chat` | LLM |
| `anthropic.messages.tool_runner` | SDK | `invoke_agent` | Agent |
| `anthropic.custom_tool_use <name>` | SDK | `execute_tool` | Tool |
| `anthropic.tool_use <name>`, `anthropic.mcp_tool_use <name>` | API | `execute_tool` | Tool |
| `anthropic.session.turn` | API | `invoke_agent` | Agent |
| `anthropic.model_request` | API | `chat` on Managed Agents sessions; not set on Messages API requests | LLM, or Other on Messages API requests |
| Other `anthropic.*` spans | SDK, API | Not set | Not listed in Agent Traces; visible in [Discover Traces](/docs/investigate/discover-traces/) |

Tool spans store arguments in `gen_ai.tool.call.arguments` and results in `anthropic.tool_result.content`. Agent Traces shows Input and Output from `gen_ai.input.messages` and `gen_ai.output.messages`, so tool spans show no Input or Output. Read the arguments and the result in **Raw Span**.

### Counting tokens

Token usage repeats across levels. A Messages API request has usage on both the SDK and the API `anthropic.messages.create` spans, and the API span's `anthropic.model_request` children carry the same tokens again. To count each token once with PPL, sum one level per request:

```
source = otel-v1-apm-span-*
| where name = 'anthropic.messages.create' AND kind = 'SPAN_KIND_SERVER'
| stats sum(`attributes.gen_ai.usage.input_tokens`) as input_tokens,
        sum(`attributes.gen_ai.usage.output_tokens`) as output_tokens
  by `attributes.gen_ai.request.model`
```

Use `kind = 'SPAN_KIND_CLIENT'` instead if you have SDK tracing only. For the full rules, including compaction and Managed Agents, see [Counting tokens](https://platform.claude.com/docs/en/manage-claude/opentelemetry#count-tokens).

## Related links

- [OpenTelemetry for the Claude API](https://platform.claude.com/docs/en/manage-claude/opentelemetry)
- [OpenTelemetry span reference](https://platform.claude.com/docs/en/api/opentelemetry/spans)
- [Agent Traces](/docs/ai-observability/agent-tracing/)
- [Framework integrations](/docs/send-data/ai-agents/integrations/)
