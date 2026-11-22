# 01 Overview: the control layer between AI and the world

## The problem

AI models are good at producing plausible text and plans. They are not good at being accountable for actions. As soon as a model can send money, delete files, email customers or call paid APIs, three things matter more than raw intelligence:

1. **Authority:** what is this agent allowed to do, right now, and who said so?
2. **Cost and loops:** can it burn money or time by retrying, looping or calling the same thing twice?
3. **Evidence:** can a human later see exactly what was decided and why?

## The thesis

Put a layer between models and the world. The model may *propose*. A deterministic layer *decides*. That layer:

- checks signed permission and limits before any action,
- tracks cost, stops loops, blocks duplicates,
- asks a human when an action cannot be undone,
- records everything in a tamper-evident log,
- remembers what worked so it need not be recomputed,
- sends easy work to cheap rules or small models and escalates to a large model only when worth it.

This is the same shape as an operating system kernel: user programs (agents) cannot touch hardware (money, files, APIs) except through system calls the kernel checks.

## The recurring parts

| Part | Plain meaning | Notes |
|---|---|---|
| Authority control | Signed, limited, expiring permissions | Implemented: [ACP](../acp/) |
| Execution firewall | Budgets, loop stops, duplicate blocks, approvals | Buildable now |
| Persistent memory | Keep verified results and reuse them | Useful, hard to prove its value |
| Cost router | Rules first, small model next, big model last | Buildable now |
| Verification before action | Check the plan against rules or evidence | Partly buildable |
| Agent identity and trust | Who is this agent and what has it earned | Crowded space; funded competitors exist |

## What is not claimed

These notes do not claim to beat large models, replace existing safety work, or have market size figures. Where an earlier draft made a claim that could not be verified, it was removed or marked as a hypothesis.

## How to read the rest

Start with [02](02-aios-kernel.md) for the kernel idea, then [03](03-cros-memory-and-cost-router.md). Notes 04 to 06 are further out and more speculative.
