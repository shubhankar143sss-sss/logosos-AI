# Logos OS research notes

Readable write-ups of the architecture ideas behind Logos OS, by Shubhankar Sharma. They are **design thinking, not finished systems**. Each note says what the idea is, what could be built today, and what is unproven. Nothing here has been independently reviewed.

The shared thesis across all of them:

> Language models propose. Deterministic code decides, limits cost, checks results, remembers, and logs. Humans keep authority.

| Note | Idea | Closest to buildable |
|---|---|---|
| [01 Overview](01-overview.md) | The common thesis and how the pieces fit | n/a |
| [02 AIOS kernel](02-aios-kernel.md) | A kernel that schedules models, enforces hard rules and audits every action | Yes: kernel skeleton and rule gate |
| [03 CROS memory and cost router](03-cros-memory-and-cost-router.md) | Persistent memory, escalation by cost and confidence, governance and audit | Yes: router, budget caps, audit ledger |
| [04 Governed intelligence stacks](04-governed-intelligence-stacks.md) | Aurora-X and Nexus-Prime: layered systems where a human signs off and every action carries evidence | Partly: the authority and audit layers |
| [05 World-model evidence layer](05-world-model-evidence-layer.md) | Simulate outcomes first, give the planner evidence, never let the simulator act | Research |
| [06 Calibration and claim graphs](06-calibration-and-claim-graphs.md) | Track predictions against outcomes; a graph of claims with confidence | Small single-domain version |

The part of Logos OS that is implemented as open code is **[ACP, the Authority Control Protocol](../acp/)**.

## Credit

Written by Shubhankar Sharma under the Logos OS name. You may read, use and build on this. Please credit "Shubhankar Sharma, Logos OS" and link back. License for this folder: CC BY 4.0.
