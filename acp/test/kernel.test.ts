import test from "node:test";
import assert from "node:assert/strict";
import { AuditLog, issueToken, signApproval, Kernel } from "../src/index.js";
import { T0, world } from "./helpers.js";

test("valid proposal is allowed and reserved", () => {
  const w = world();
  const d = w.kernel.evaluate(w.proposal());
  assert.equal(d.code, "ALLOW");
  assert.equal(w.kernel.reservationState(d.reservation_id!), "RESERVED");
});

test("tampered proposal fails signature (DENY_IDENTITY)", () => {
  const w = world();
  const p = w.proposal();
  const d = w.kernel.evaluate({ ...p, amount: 999 });
  assert.equal(d.code, "DENY_IDENTITY");
});

test("unknown sender is denied", () => {
  const w = world();
  assert.equal(w.kernel.evaluate(w.proposal({ sender_id: "ghost" })).code, "DENY_IDENTITY");
});

test("token signed by an untrusted key is denied", () => {
  const w = world();
  const evil = issueToken(
    { issuer: "root", subject: "a", permissions: [{ intent: "*", resources: ["*"] }], expiry: T0 + 1e6 },
    w.agentB.privateKey,
  );
  assert.equal(w.kernel.evaluate(w.proposal({}, evil)).code, "DENY_DELEGATION");
});

test("expired token is denied", () => {
  const w = world();
  const p = w.proposal();
  w.clock.now = T0 + 4_000_000;
  assert.equal(w.kernel.evaluate(p).code, "DENY_AUTHORITY");
});

test("intent, resource and amount outside the token are denied", () => {
  const w = world();
  assert.equal(w.kernel.evaluate(w.proposal({ intent: "file.delete" })).code, "DENY_AUTHORITY");
  assert.equal(w.kernel.evaluate(w.proposal({ resource: "db:1" })).code, "DENY_AUTHORITY");
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 1001 })).code, "DENY_AUTHORITY");
});

test("token subject must be the sender", () => {
  const w = world();
  const p = w.proposal({ sender_id: "b" }, w.tokenA, w.agentB.privateKey);
  assert.equal(w.kernel.evaluate(p).code, "DENY_AUTHORITY");
});

test("revoked token is denied immediately", () => {
  const w = world();
  w.kernel.revoke(w.tokenA.token_id);
  assert.equal(w.kernel.evaluate(w.proposal()).code, "DENY_REVOKED");
});

test("revoking a parent token kills delegated children", () => {
  const w = world();
  const child = issueToken(
    { issuer: "a", subject: "b", permissions: [{ intent: "payment.send", resources: ["acct:42"], max_amount: 50 }], expiry: T0 + 1e6 },
    w.agentA.privateKey,
  );
  const p = w.proposal({ sender_id: "b", amount: 10, delegation_chain: [w.tokenA] }, child, w.agentB.privateKey);
  assert.equal(w.kernel.evaluate(p).code, "ALLOW");
  w.kernel.revoke(w.tokenA.token_id);
  assert.equal(w.kernel.evaluate(w.proposal({ sender_id: "b", amount: 10, delegation_chain: [w.tokenA] }, child, w.agentB.privateKey)).code, "DENY_REVOKED");
});

test("per-call, window amount and window call limits", () => {
  const w = world({
    policies: { "payment.send": { max_amount_per_call: 500, window: { duration_ms: 60_000, max_total_amount: 250, max_calls: 5 } } },
  });
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 501 })).code, "DENY_CONSTRAINT");
  const d1 = w.kernel.evaluate(w.proposal({ amount: 200 }));
  assert.equal(d1.code, "ALLOW");
  // outstanding reservation counts against the window
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 100 })).code, "DENY_CONSTRAINT");
  w.kernel.commit(d1.reservation_id!);
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 100 })).code, "DENY_CONSTRAINT");
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 50 })).code, "ALLOW");
  // window slides
  w.clock.now = T0 + 61_000;
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 250 })).code, "ALLOW");
});

test("abort releases reserved authority; reservation then rolled back", () => {
  const w = world({ policies: { "payment.send": { window: { duration_ms: 60_000, max_total_amount: 100 } } } });
  const d = w.kernel.evaluate(w.proposal({ amount: 100 }));
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 1 })).code, "DENY_CONSTRAINT");
  assert.ok(w.kernel.abort(d.reservation_id!));
  assert.equal(w.kernel.reservationState(d.reservation_id!), "ROLLED_BACK");
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 100 })).code, "ALLOW");
});

test("uncommitted reservation auto-aborts after timeout", () => {
  const w = world({ reservation_timeout_ms: 1000 });
  const d = w.kernel.evaluate(w.proposal());
  w.clock.now = T0 + 2000;
  assert.equal(w.kernel.commit(d.reservation_id!), false);
  assert.equal(w.kernel.reservationState(d.reservation_id!), "ROLLED_BACK");
});

test("a committed reservation cannot be committed or aborted again", () => {
  const w = world();
  const d = w.kernel.evaluate(w.proposal());
  assert.ok(w.kernel.commit(d.reservation_id!));
  assert.equal(w.kernel.commit(d.reservation_id!), false);
  assert.equal(w.kernel.abort(d.reservation_id!), false);
});

test("idempotency: same proposal returns same decision, no second reservation", () => {
  const w = world({ policies: { "payment.send": { window: { duration_ms: 60_000, max_total_amount: 100 } } } });
  const p = w.proposal({ amount: 100 });
  const d1 = w.kernel.evaluate(p);
  const d2 = w.kernel.evaluate(p);
  assert.equal(d1.reservation_id, d2.reservation_id);
  w.kernel.commit(d1.reservation_id!);
  assert.equal(w.kernel.evaluate(p).code, "ALLOW"); // still the cached answer, nothing new reserved
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 1 })).code, "DENY_CONSTRAINT");
});

test("idempotency key reused for a different proposal is denied", () => {
  const w = world();
  const p1 = w.proposal({ idempotency_key: "same" });
  const p2 = w.proposal({ idempotency_key: "same", amount: 5 });
  assert.equal(w.kernel.evaluate(p1).code, "ALLOW");
  assert.equal(w.kernel.evaluate(p2).code, "DENY_IDEMPOTENCY");
});

test("aborted proposal can be retried with the same key", () => {
  const w = world();
  const p = w.proposal();
  const d = w.kernel.evaluate(p);
  w.kernel.abort(d.reservation_id!);
  const again = w.kernel.evaluate(p);
  assert.equal(again.code, "ALLOW");
  assert.notEqual(again.reservation_id, d.reservation_id);
});

test("clock going backwards halts decisions (fail closed)", () => {
  const w = world();
  w.kernel.evaluate(w.proposal());
  w.clock.now = T0 - 1;
  assert.equal(w.kernel.evaluate(w.proposal()).code, "DENY_CLOCK");
});

test("schema problems are denied", () => {
  const w = world();
  assert.equal(w.kernel.evaluate(w.proposal({ amount: -1 })).code, "DENY_SCHEMA");
  assert.equal(w.kernel.evaluate(w.proposal({ amount: 1.5 })).code, "DENY_SCHEMA");
  assert.equal(w.kernel.evaluate(w.proposal({ acp_version: "9.9" })).code, "DENY_SCHEMA");
  assert.equal(w.kernel.evaluate({} as never).code, "DENY_SCHEMA");
});

test("irreversible action needs signed human approval bound to this exact proposal", () => {
  const w = world();
  const p = w.proposal({ irreversible: true });
  assert.equal(w.kernel.evaluate(p).code, "CHALLENGE_HUMAN");

  const ok = signApproval({ approver_id: "h1", proposal: p, expires_at: T0 + 60_000 }, w.human1.privateKey);
  assert.equal(w.kernel.evaluate({ ...p, approvals: [ok] }).code, "ALLOW");
});

test("approval for a different proposal, expired, forged or from unknown approver does not count", () => {
  const w = world();
  const p = w.proposal({ irreversible: true });
  const other = w.proposal({ irreversible: true, amount: 5 });
  const forOther = signApproval({ approver_id: "h1", proposal: other, expires_at: T0 + 60_000 }, w.human1.privateKey);
  const expired = signApproval({ approver_id: "h1", proposal: p, expires_at: T0 - 1 }, w.human1.privateKey);
  const forged = signApproval({ approver_id: "h1", proposal: p, expires_at: T0 + 60_000 }, w.agentA.privateKey);
  const stranger = signApproval({ approver_id: "zed", proposal: p, expires_at: T0 + 60_000 }, w.human1.privateKey);
  for (const a of [forOther, expired, forged, stranger]) {
    assert.equal(w.kernel.evaluate({ ...p, approvals: [a] }).code, "CHALLENGE_HUMAN");
  }
});

test("quorum of 2 needs two distinct approvers", () => {
  const w = world({ approval_quorum: 2 });
  const p = w.proposal({ irreversible: true });
  const a1 = signApproval({ approver_id: "h1", proposal: p, expires_at: T0 + 60_000 }, w.human1.privateKey);
  const a2 = signApproval({ approver_id: "h2", proposal: p, expires_at: T0 + 60_000 }, w.human2.privateKey);
  assert.equal(w.kernel.evaluate({ ...p, approvals: [a1, a1] }).code, "CHALLENGE_HUMAN");
  assert.equal(w.kernel.evaluate({ ...p, approvals: [a1, a2] }).code, "ALLOW");
});

test("an agent cannot approve its own irreversible action", () => {
  const w = world();
  const p = w.proposal({ irreversible: true });
  const self = signApproval({ approver_id: "a", proposal: p, expires_at: T0 + 60_000 }, w.agentA.privateKey);
  assert.equal(w.kernel.evaluate({ ...p, approvals: [self] }).code, "CHALLENGE_HUMAN");
});

test("run(): adapter only called on ALLOW, commits, and rolls back on failure", async () => {
  const w = world();
  const calls: string[] = [];
  const good = { execute: () => void calls.push("exec") };
  const r1 = await w.kernel.run(w.proposal(), good);
  assert.equal(r1.executed, true);
  assert.equal(w.kernel.reservationState(r1.reservation_id!), "COMMITTED");

  const denied = await w.kernel.run(w.proposal({ resource: "db:1" }), good);
  assert.equal(denied.executed, false);
  assert.equal(calls.length, 1);

  let rolledBack = false;
  const bad = {
    execute: () => {
      throw new Error("boom");
    },
    rollback: () => void (rolledBack = true),
  };
  const r2 = await w.kernel.run(w.proposal(), bad);
  assert.equal(r2.executed, false);
  assert.ok(rolledBack);
  assert.equal(w.kernel.reservationState(r2.reservation_id!), "ROLLED_BACK");
});

test("audit log is hash-linked and detects tampering", () => {
  const w = world();
  w.kernel.evaluate(w.proposal());
  w.kernel.evaluate(w.proposal({ intent: "x" }));
  const entries = JSON.parse(JSON.stringify(w.kernel.audit.all));
  assert.ok(AuditLog.verify(entries));
  entries[0].detail.code = "DENY_SCHEMA";
  assert.equal(AuditLog.verify(entries), false);
});

test("kernel with no knowledge of a root denies everything", () => {
  const w = world();
  const k = new Kernel({ roots: {}, agents: { a: w.agentA.publicKey }, approvers: {}, now: () => T0 });
  assert.equal(k.evaluate(w.proposal()).code, "DENY_DELEGATION");
});
