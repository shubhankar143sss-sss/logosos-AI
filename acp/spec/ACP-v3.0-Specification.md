# Authority Control Protocol (ACP) — Specification

**Version:** 3.0 (draft)
**Author:** Shubhankar Sharma, Logos OS
**License:** Apache-2.0
**Status:** Draft for public review. Not an IETF, W3C or other standards-body document. It has not been independently reviewed or audited.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

---

## 0. What ACP is

ACP is a protocol for controlling what an AI agent, automation or other untrusted software is *allowed to do*. It does not govern what the software thinks or says. It governs **execution authority**.

An agent never acts directly. It sends a signed **proposal** to a **kernel**. The kernel is small, deterministic code that checks the proposal against signed **authority tokens** and configured **constraints**, reserves the authority, asks a human when the action cannot be undone, and only then lets an **execution adapter** act. Anything the kernel cannot positively verify is denied (fail closed).

### What ACP does not do

- It does not make an AI model safe, truthful or aligned. It limits the damage an untrusted proposer can cause through the actions the kernel guards.
- It protects only actions that really pass through a kernel. An adapter that can be bypassed, or credentials the agent holds directly, are outside its protection.
- It does not replace transport security, key management, or the sandboxing of adapters. It assumes them.
- It is a design, not a certification. Claims such as "RFC-grade" or "globally deployable" are not made here: they require independent review, multiple implementations and real-world use.

### Related work

ACP combines ideas that already exist. Readers should look at them too: capability tokens with attenuation (Macaroons, Biscuit, UCAN), policy engines (Open Policy Agent, Cedar), workload identity (SPIFFE), OAuth scopes and token exchange, and two-phase commit and saga patterns for reserve/commit/rollback. ACP's focus is applying them together to autonomous agents: bounded delegation depth, reservations that count against limits before execution, and mandatory human approval for irreversible actions.

---

## 1. Roles and layers

| Layer | Component | Trust |
|---|---|---|
| 5 | Humans: approvers and root authorities | Root of trust |
| 4 | Agents: AI, automation, external clients | **Untrusted** |
| 3 | Proposal and identity: schema, signatures, delegation chain | Verified by the kernel |
| 2 | **Kernel**: token and constraint checks, reservations, audit log | Trusted core |
| 1 | Execution adapters: sandboxed access to files, APIs, payments | Trusted to obey the kernel, least privilege |

Rules:

1. Agents MUST NOT hold the credentials that adapters use. Only adapters do.
2. Adapters MUST accept commands only from the kernel and MUST NOT grant authority.
3. The kernel MUST decide from the proposal and its own state only, not from free-form model output.

---

## 2. Proposal

A proposal is a request for one action.

| Field | Meaning |
|---|---|
| `acp_version` | Protocol version string, `"3.0"` |
| `proposal_id` | Unique id of this proposal |
| `timestamp` | Integer milliseconds since the Unix epoch |
| `sender_id` | Id of the proposing agent. Its public key is known to the kernel |
| `intent` | Action name, e.g. `payment.send`, `file.delete` |
| `resource` | What the action touches, e.g. `vendor:acme` |
| `amount` | Optional non-negative **integer** in minor units (cents, bytes, calls). Integers avoid rounding disagreements |
| `payload` | Structured parameters for the intent |
| `irreversible` | `true` if the action cannot be undone |
| `idempotency_key` | Identifies the logical operation across retries |
| `delegation_chain` | Ancestor tokens, root-issued first (may be empty) |
| `authority_token` | The sender's own token |
| `signature` | Sender's signature over every field except `signature` and `approvals` |
| `approvals` | Optional human approvals (section 7). Not covered by the signature |

Serialization MUST be deterministic before signing or hashing. The reference implementation uses canonical JSON: object keys sorted, no whitespace, UTF-8. CBOR (deterministic encoding, RFC 8949 §4.2) is a suitable binary alternative. Implementations SHOULD cap message size (1 MB suggested).

Intents SHOULD each define a deterministic payload validator (for example, `file.delete` checks the path; `email.send` checks recipient and size). Validators run before authority checks. The reference kernel validates only the common envelope; intent-specific validators are an extension point.

> Wire framing note: the earlier blueprint listed a fixed 32-byte signature field. Ed25519 signatures are 64 bytes, so a framed format MUST use a length that matches the signature scheme, or length-prefix it.

---

## 3. Authority token

| Field | Meaning |
|---|---|
| `token_id` | Unique id, used for revocation |
| `issuer` | A root authority id, or the agent that delegated |
| `subject` | The agent this token is for |
| `permissions` | List of `{intent, resources[], max_amount?}` |
| `expiry` | Integer ms. No token without an expiry |
| `delegable` | May the subject issue child tokens |
| `signature` | Issuer's signature over all other fields |

`resources` entries are an exact id, `*`, or a prefix ending in `*`. `intent` may be `*`.

A token permits a proposal only if some permission matches the intent, a resource pattern matches, and `amount ≤ max_amount` when `max_amount` is set.

Token checks, all MUST pass: signature valid under the issuer's key; not expired; not revoked; `subject == sender_id`; some permission matches.

---

## 4. Delegation

An agent holding a `delegable` token may issue a child token to another agent. The proposal presents the whole chain: `delegation_chain` followed by `authority_token`.

A chain is valid only if:

1. Its length is at most `max_delegation_depth` (default 5).
2. The first token is issued by a configured root authority.
3. For each later token, `issuer` equals the previous token's `subject` and the previous token is `delegable`.
4. No subject or `token_id` appears twice (no cycles).
5. Each child permission is covered by a parent permission: same or narrower intent, narrower or equal resources, and an equal or lower `max_amount` (a child may not drop a ceiling the parent has).
6. A child's `expiry` does not exceed its parent's.
7. Every signature is valid and no token is expired.
8. The last token's `subject` is the sender.

Authority can only shrink along a chain. Revoking any token in a chain invalidates everything below it.

---

## 5. Constraints and state

Beyond token limits, a kernel enforces operator-configured policy per intent. The reference kernel supports: a hard per-call amount ceiling, an allowed-resource list, and a sliding window with a maximum total amount and maximum number of calls per sender and intent.

Usage counted against a limit is **committed usage plus outstanding reservations**. This is the invariant that stops many concurrent agents from each passing a limit check and together exceeding it:

```
committed + reserved + requested ≤ limit
```

Constraint evaluation MUST be deterministic. Richer expression languages (time-of-day, risk score, identity attributes) are possible; this draft does not standardize one. Use an existing policy language (Cedar, OPA/Rego) when you need one.

Concurrency: the check and the reservation MUST be a single atomic step per limit (a lock, a transaction, or compare-and-swap on a version).

---

## 6. Reserve, commit, roll back

```
PROPOSED → RESERVED → COMMITTED
              ↓
           ABORTED → ROLLED_BACK
```

1. On ALLOW the kernel moves the proposal to RESERVED and returns a `reservation_id`. Reserved authority counts against limits.
2. The adapter executes. The kernel then COMMITs, and usage becomes permanent for the window.
3. If the adapter fails, or the proposal is not committed within `reservation_timeout_ms` (default 30 s), the reservation is ABORTED, the authority is released, and the adapter's `rollback` is invoked if it exists. Adapter rollback MUST be idempotent.
4. A COMMITTED reservation cannot be aborted or committed again. Undoing a committed action takes a new proposal (an `execution.rollback` intent referencing the original `proposal_id`, needing authority at least as large as the original). The reference kernel does not implement this; it is left to the adapter.

### Retries and idempotency

- The same `idempotency_key` with an identical proposal returns the earlier decision and reserves nothing new.
- The same key with a different proposal is denied (`DENY_IDEMPOTENCY`).
- After an abort, the same proposal may be retried and gets a fresh reservation.

---

## 7. Human approval for irreversible actions

If `irreversible` is true, the kernel returns `CHALLENGE_HUMAN` until it holds enough valid approvals.

An approval is `{approver_id, proposal_hash, expires_at, signature}`, signed by a human approver's key. It is valid only if: the approver is known to the kernel; `proposal_hash` is the SHA-256 of the canonical proposal (without `signature`/`approvals`), so it binds to exactly this action; and it has not expired. The kernel requires `approval_quorum` distinct valid approvers (default 1). Missing approval means deny; there is no default-allow on timeout.

Agents' own keys are not approver keys. An agent cannot approve its own action.

---

## 8. Revocation

The kernel keeps a set of revoked `token_id`s and checks every token in the chain. Revocation takes effect on the next evaluation. Entries may be dropped after the token's expiry.

---

## 9. Time

The kernel MUST use a clock that never goes backwards. If it does, the kernel MUST deny (`DENY_CLOCK`) until it recovers. Expiry and windows depend on it.

---

## 10. Audit log

Every decision, commit, abort and revocation is appended to a hash-linked log. Each entry's hash covers its content and the previous hash. This makes edits and deletions detectable by anyone who holds the head hash. It is tamper-**evident**, not tamper-proof: a deployment SHOULD periodically anchor or ship the head hash to storage the kernel's operator cannot rewrite.

---

## 11. Decision codes

| Code | Meaning |
|---|---|
| `ALLOW` | Authority reserved |
| `DENY_SCHEMA` | Malformed, wrong version or unknown intent |
| `DENY_IDENTITY` | Unknown sender or bad proposal signature |
| `DENY_AUTHORITY` | Token expired, wrong subject, or does not cover the action |
| `DENY_DELEGATION` | Invalid delegation chain or token signature |
| `DENY_REVOKED` | A token in the chain is revoked |
| `DENY_CONSTRAINT` | A policy limit would be exceeded |
| `DENY_IDEMPOTENCY` | Idempotency key reused for a different proposal |
| `DENY_CLOCK` | Clock moved backwards |
| `CHALLENGE_HUMAN` | Waiting for human approval |

---

## 12. Evaluation order

1. Clock check, then expire stale reservations
2. Schema and version
3. Idempotency lookup
4. Sender identity and proposal signature
5. Delegation chain and token signatures, expiry
6. Revocation
7. Token permission for this exact intent, resource and amount
8. Constraint policy including outstanding reservations
9. Human approvals if irreversible
10. Reserve and log

Execution is allowed only if every step passes. Any error or unexpected condition inside the kernel MUST result in a denial.

---

## 13. Optional extensions (not implemented in the reference kernel)

These appeared in earlier drafts. They are reasonable but unproven here, and each needs its own design and review.

- **Kernel integrity attestation and heartbeat:** an adapter disables execution when it stops hearing from the kernel (suggested 100 ms beat, 3 missed). Real attestation needs hardware support (for example TPM or confidential-computing attestation).
- **Discovery:** locating kernels via DNS SRV records such as `_acp._tcp.example.com`.
- **Version negotiation:** the agent lists supported versions and the kernel selects one.
- **Emergency override:** a multi-signature, time-limited halt token with full logging.
- **Federation:** several kernels sharing revocation and usage state. This is the hardest part of the design and is an open problem in this draft.

---

## 14. Security considerations

- The kernel is the trusted computing base. Keep it small, test it heavily, and run it where agents cannot reach its memory or keys.
- Key compromise: a stolen agent key lets an attacker act within that agent's token only. Short expiries and revocation limit this. A stolen root or approver key is severe.
- Approval fatigue is real. Make the approval request show the action's resource, amount and consequence, and keep irreversible actions rare.
- Side channels: an agent can still do harm through any action that is allowed. ACP bounds the blast radius; it does not remove it.
- Do not log secrets in `payload`.
