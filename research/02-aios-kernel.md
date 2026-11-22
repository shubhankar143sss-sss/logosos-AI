# 02 AIOS kernel: an operating system for models

## Idea

A personal "cognitive operating system" in four layers:

1. **Resource substrate:** the raw compute (phone, GPU, cloud, external APIs). No decisions.
2. **Kernel:** not an AI. It is the law, scheduler, memory pager and permission gate: a syscall interface, hard-rule enforcement, context paging, agent scheduling, retry and termination logic, audit logging.
3. **Intelligence fabric:** small models for planning and judgment, plus task-specific agents that execute.
4. **Language shell:** turns user speech or chat into a structured intent, and nothing more.

Flow: user → shell (intent only) → kernel → hard rules → planner models → execution agents → rule gate on the result → response or controlled action.

The claim worth keeping: **intelligence can be spread across many models, while authority stays in one small deterministic place.**

## Hard rules ("non-negotiable laws")

Rules the kernel enforces regardless of what any model says, such as: no action without a permission, no irreversible action without human approval, every action logged, spending limits. These are expressed as code, not prompts. This is what ACP formalizes.

## What could be built now

- Kernel skeleton with a syscall-like API for tools, a rule gate, and an audit log (a few weeks for one engineer).
- Model routing and per-run budgets.
- A phone or chat front end that only extracts intent.

## What is unproven

- The specific counts (ten planners, ten agents) are a design choice, not a finding. Start with one planner and two tools.
- "Stronger than any single LLM" needs a benchmark. A governed system is *safer* by construction; whether it is *better* at tasks is an empirical question.

## Relationship to ACP

ACP is the kernel's authority-and-limits core, specified and implemented in the open: signed tokens, delegation, reserve/commit/rollback, human approval.
