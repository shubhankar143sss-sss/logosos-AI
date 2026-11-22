import test from "node:test";
import assert from "node:assert/strict";
import { issueToken } from "../src/index.js";
import { T0, world } from "./helpers.js";

const perm = (max?: number, res = "acct:*") => [{ intent: "payment.send", resources: [res], max_amount: max }];

test("delegated token within parent's scope is allowed", () => {
  const w = world();
  const child = issueToken({ issuer: "a", subject: "b", permissions: perm(200, "acct:42"), expiry: T0 + 1e6 }, w.agentA.privateKey);
  const p = w.proposal({ sender_id: "b", amount: 150, delegation_chain: [w.tokenA] }, child, w.agentB.privateKey);
  assert.equal(w.kernel.evaluate(p).code, "ALLOW");
});

test("child cannot exceed parent amount, resources or lifetime", () => {
  const w = world();
  const mk = (permissions: ReturnType<typeof perm>, expiry = T0 + 1e6) =>
    issueToken({ issuer: "a", subject: "b", permissions, expiry }, w.agentA.privateKey);
  for (const child of [mk(perm(5000)), mk(perm(undefined)), mk(perm(100, "db:*")), mk(perm(100), T0 + 9e9)]) {
    const p = w.proposal({ sender_id: "b", amount: 10, delegation_chain: [w.tokenA] }, child, w.agentB.privateKey);
    assert.equal(w.kernel.evaluate(p).code, "DENY_DELEGATION");
  }
});

test("non-delegable parent cannot delegate", () => {
  const w = world();
  const fixed = issueToken({ issuer: "root", subject: "a", permissions: perm(1000), expiry: T0 + 1e6, delegable: false }, w.root.privateKey);
  const child = issueToken({ issuer: "a", subject: "b", permissions: perm(10), expiry: T0 + 1e5 }, w.agentA.privateKey);
  const p = w.proposal({ sender_id: "b", amount: 1, delegation_chain: [fixed] }, child, w.agentB.privateKey);
  assert.equal(w.kernel.evaluate(p).code, "DENY_DELEGATION");
});

test("depth limit is enforced", () => {
  const w = world({ max_delegation_depth: 2 });
  const t1 = issueToken({ issuer: "root", subject: "a", permissions: perm(1000), expiry: T0 + 1e6, delegable: true }, w.root.privateKey);
  const t2 = issueToken({ issuer: "a", subject: "b", permissions: perm(900), expiry: T0 + 9e5, delegable: true }, w.agentA.privateKey);
  const t3 = issueToken({ issuer: "b", subject: "c", permissions: perm(800), expiry: T0 + 8e5 }, w.agentB.privateKey);
  const p = w.proposal({ sender_id: "c", amount: 1, delegation_chain: [t1, t2] }, t3, w.agentC.privateKey);
  assert.equal(w.kernel.evaluate(p).code, "DENY_DELEGATION");
  const ok = w.proposal({ sender_id: "b", amount: 1, delegation_chain: [t1] }, t2, w.agentB.privateKey);
  assert.equal(w.kernel.evaluate(ok).code, "ALLOW");
});

test("circular delegation is denied", () => {
  const w = world();
  const t1 = issueToken({ issuer: "root", subject: "a", permissions: perm(1000), expiry: T0 + 1e6, delegable: true }, w.root.privateKey);
  const t2 = issueToken({ issuer: "a", subject: "b", permissions: perm(900), expiry: T0 + 9e5, delegable: true }, w.agentA.privateKey);
  const t3 = issueToken({ issuer: "b", subject: "a", permissions: perm(800), expiry: T0 + 8e5 }, w.agentB.privateKey);
  const p = w.proposal({ sender_id: "a", amount: 1, delegation_chain: [t1, t2] }, t3, w.agentA.privateKey);
  assert.equal(w.kernel.evaluate(p).code, "DENY_DELEGATION");
});

test("broken link (issuer is not previous subject) is denied", () => {
  const w = world();
  const child = issueToken({ issuer: "c", subject: "b", permissions: perm(10), expiry: T0 + 1e5 }, w.agentC.privateKey);
  const p = w.proposal({ sender_id: "b", amount: 1, delegation_chain: [w.tokenA] }, child, w.agentB.privateKey);
  assert.equal(w.kernel.evaluate(p).code, "DENY_DELEGATION");
});

test("expired ancestor kills the chain", () => {
  const w = world();
  const child = issueToken({ issuer: "a", subject: "b", permissions: perm(10), expiry: T0 + 1e5 }, w.agentA.privateKey);
  const p = w.proposal({ sender_id: "b", amount: 1, delegation_chain: [w.tokenA] }, child, w.agentB.privateKey);
  w.clock.now = T0 + 3_700_000;
  assert.notEqual(w.kernel.evaluate(p).code, "ALLOW");
});
