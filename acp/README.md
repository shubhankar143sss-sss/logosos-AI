# ACP: Authority Control Protocol

**A protocol and reference kernel for limiting what AI agents are allowed to do.**

An AI agent never acts directly. It sends a signed *proposal*. A small deterministic *kernel* checks it against signed, expiring *authority tokens* and configured limits, reserves the authority, asks a human when the action is irreversible, and only then lets an adapter act. Anything it cannot verify is denied.

ACP is part of **Logos OS**, a set of open designs for governed AI systems, by Shubhankar Sharma. See [`../research`](../research/).

> **Status: draft, v0.1 reference code.** Not audited, not a standard, not production-ready. Use it to learn, prototype and critique. Issues and pull requests are welcome.

## What the reference kernel enforces

| Rule | Where to look |
|---|---|
| Proposals are signed by the sender (Ed25519) and tamper-evident | `src/kernel.ts`, `src/crypto.ts` |
| Authority tokens are signed, expire, name an intent, resources and a max amount | `src/token.ts` |
| Delegation can only narrow authority; depth limit; no cycles; revoking a parent kills children | `checkChain` in `src/kernel.ts` |
| Limits count reserved plus committed usage, so concurrent agents cannot overshoot | `checkConstraints` |
| Reserve, commit, abort, rollback with auto-abort on timeout | `commit`, `abort`, `sweep` |
| Idempotency keys: safe retries, and a reused key with different content is denied | `evaluate` |
| Irreversible actions need signed human approval bound to the exact proposal, with quorum | `checkApprovals` |
| Clock may not go backwards; kernel fails closed | `tick` |
| Hash-linked audit log | `src/audit.ts` |

34 tests cover the allow and deny paths in `test/`.

## Quick start

Needs Node 20 or newer.

```bash
npm install
npm test
npm run demo
```

The demo shows an invoice bot being allowed a small payment, denied an over-limit one, denied an unknown account, and blocked from an irreversible wire until a human approver signs.

```ts
import { Kernel, generateKeyPair, issueToken, signProposal } from "./src/index.js"; // or the published package, if you publish one

const root = generateKeyPair(), agent = generateKeyPair();
const kernel = new Kernel({
  roots: { org: root.publicKey },
  agents: { bot: agent.publicKey },
  approvers: {},
});
const token = issueToken(
  { issuer: "org", subject: "bot",
    permissions: [{ intent: "payment.send", resources: ["vendor:*"], max_amount: 20_000 }],
    expiry: Date.now() + 3_600_000 },
  root.privateKey,
);
const proposal = signProposal({
  acp_version: "3.0", proposal_id: "p1", timestamp: Date.now(), sender_id: "bot",
  intent: "payment.send", resource: "vendor:acme", amount: 15_000, payload: {},
  irreversible: false, idempotency_key: "k1", delegation_chain: [], authority_token: token,
}, agent.privateKey);

const result = await kernel.run(proposal, { execute: (p) => console.log("paying", p.amount) });
// result.code === "ALLOW", result.executed === true
```

## Specification

[`spec/ACP-v3.0-Specification.md`](spec/ACP-v3.0-Specification.md). It states plainly what ACP does not do, lists related work (Macaroons, Biscuit, UCAN, OPA, Cedar), and separates what the reference kernel implements from optional extensions (discovery, version negotiation, heartbeat, federation).

## Not implemented yet

Wire framing and CBOR, network server, intent-specific payload validators, kernel integrity attestation, heartbeat, federation, persistent state. State is in memory; restarting the kernel forgets reservations and usage.

## Contributing

Review of the spec and the code is the most useful contribution: try to get the kernel to ALLOW something it should not. Open an issue with a failing test.

## Credit and license

Authored by **Shubhankar Sharma** under the Logos OS name. Licensed under the [Apache License 2.0](LICENSE). Use it freely, including commercially; keep the license and notice, and please credit "Shubhankar Sharma, Logos OS" with a link back.
