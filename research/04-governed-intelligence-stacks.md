# 04 Governed intelligence stacks: Aurora-X and Nexus-Prime

Two layered designs that put human authority at the top and evidence and audit at the bottom.

## Aurora-X: governance first

**Identity:** an execution system where every action must be adversarially tested, constrained, cryptographically authorized by a human, and auditable before it runs. It "does not maximize intelligence, it maximizes controlled intelligence."

**Invariants (as stated by the design):** no action without proof; no proof without an attempt to break it; no authority without human cryptographic consent; no silent failure; no irreversible action without escalated proof; no single point of sovereignty. A violation means a safe halt.

**Stack:** hardware trust anchor (a trusted execution environment with hardware-bound keys); a human sovereignty kernel (identities, Ed25519 signatures, time-bound capability tokens, kill switch); then layers for generating candidate plans, a second "shadow" opinion, a proof engine, a governance/constitution engine, and sandboxed optimization.

**What is real here:** the human sovereignty kernel is exactly what [ACP](../acp/) implements: signed capability tokens with expiry and a mandatory human signature for irreversible actions.

**What is speculative:** adversarial "proof" for open-ended decisions has no general method. A practical version applies checks where checks exist (limits, schemas, policy, simulation on a test copy) and routes everything else to a human.

## Nexus-Prime: human-governed adaptive system

Twelve to fourteen layers from secure compute and immutable audit at the bottom, through data fusion, a knowledge ledger with drift monitoring, scenario simulation, regime awareness, resource allocation, multi-agent mesh and a fragility radar, up to a constitutional constraint engine and human strategic authority at the top. The system may simulate, adapt and execute only inside limits that humans define; it may not set its own mission or expand its own scope.

**Buildable parts:** hash-chained logs, a versioned model registry, signed execution events, drift detection on inputs and performance, and a constraint engine that is the top-level veto.

**Speculative parts:** self-modeling strategy evolution, zero-knowledge attestation of data origin at scale, and survival/durability optimization have no simple, testable first version.

## Takeaway

Both designs agree on one point that is practical today: **put the permission and audit layer at the base and under human control, and keep intelligence above it replaceable.** That is the part built openly as ACP.
