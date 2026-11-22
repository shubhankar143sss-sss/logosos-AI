# 05 World-model evidence layer

## Idea

Add a layer that simulates outcomes *before* an action is allowed, and gives the planner structured evidence. Strict roles:

- Language models talk.
- The kernel decides.
- World models simulate.

The world model **never talks to users, never executes, never overrides the hard rules**. It emits structured evidence only (for example: "in 1,000 simulated runs of this plan, the budget is exceeded in 12%").

## Parts

1. **State encoder:** turns the current situation into structured state, not free text.
2. **Dynamics model:** how that state tends to evolve.
3. **Counterfactual simulator:** "what happens if we do A instead of B."
4. **Outcome aggregator:** collapses runs into evidence with ranges.
5. Optional: a public, append-only record of decisions.

Order of construction: the kernel must exist and be hardened first. If the kernel is weak, extra layers add noise.

## What could be built now

A narrow version: Monte Carlo or rule-based simulation of a single process such as a payment batch, a deployment, or a spend budget, checked against past outcomes.

## What is unproven

- General-purpose world models that predict real-world consequences reliably are an open research area.
- Any "capability comparison" with other systems should be treated as a hypothesis until measured. A simulator that is wrong with high confidence is worse than none: its output must carry error ranges and be checked against actual results over time (see note 06).
