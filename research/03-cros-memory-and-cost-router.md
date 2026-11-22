# 03 CROS: persistent memory, cost routing and governed execution

## Idea

Treat the foundation models as interchangeable compute, and build the stable layer around them:

```
Application → SDK → security isolation → intent integrity check
→ vendor abstraction → execution kernel → resource governor
→ model adapter → model → verification and calibration
→ learning → metering and billing
```

## Components worth explaining

- **Persistent memory:** structured episodic, semantic and goal memory, so the system does not recompute what it already verified.
- **Reasoning and execution records:** store verified solution patterns (a "genome" is just a verified, reusable pattern) and reuse them.
- **Escalation by compute:** try rules, then a small model, then a larger model, only when confidence is too low or stakes are high.
- **Recursion control:** depth limit, budget cap, loop detection and a cooling period, so a reasoning loop cannot run away. "If cost rises and value gained falls, stop that branch."
- **Execution governance:** policy checks, validation and a compliance-friendly audit ledger.
- **Uncertainty gate:** act only when confidence times verification score clears a threshold.
- **Metering:** per-run cost tracking that can feed billing.

## What could be built now

1. A router: deterministic rules first, small model, big model last.
2. Per-run budget caps, loop detection and duplicate-call blocking.
3. An append-only audit ledger with export.
4. A cache of verified results keyed by task type.

These need no new science. They are engineering, and cheap to test with a real LLM bill.

## What is unproven or crowded

- The long list of named engines (prefetch, belief revision, causal simulation, global pattern network) is a *roadmap*, not evidence. Each would need an evaluation showing it beats a simple baseline.
- Gateways such as LiteLLM, Portkey and Helicone already provide per-key and team budgets, and observability tools such as Langfuse trace costs. The gap this idea targets is small teams that want per-run caps and hard loop stops across tool calls and retries, with a simple setup. That gap is a hypothesis to test with real users.

## Honest minimum

A budget cap, a loop detector, a duplicate-call blocker, a human-approval hook, and a signed log: roughly one to three weeks of work, and it already solves a problem people report.
