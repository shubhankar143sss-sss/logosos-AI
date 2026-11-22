/**
 * Demo: an AI agent tries to pay invoices through an ACP kernel.
 * Run with: npm run demo
 */
import { generateKeyPair, issueToken, signProposal, signApproval, Kernel } from "../src/index.js";
import type { Proposal } from "../src/index.js";

const root = generateKeyPair(); // the human organisation's root authority
const agent = generateKeyPair(); // the untrusted AI agent
const cfo = generateKeyPair(); // a human approver

const kernel = new Kernel({
  roots: { "acme-root": root.publicKey },
  agents: { "invoice-bot": agent.publicKey },
  approvers: { cfo: cfo.publicKey },
  policies: { "payment.send": { window: { duration_ms: 86_400_000, max_total_amount: 50_000 } } },
});

// The agent may pay up to $200.00 (20,000 cents) per call to vendor accounts, for one hour.
const token = issueToken(
  {
    issuer: "acme-root",
    subject: "invoice-bot",
    permissions: [{ intent: "payment.send", resources: ["vendor:*"], max_amount: 20_000 }],
    expiry: Date.now() + 3_600_000,
  },
  root.privateKey,
);

let n = 0;
function propose(resource: string, amount: number, irreversible = false): Proposal {
  n++;
  return signProposal(
    {
      acp_version: "3.0",
      proposal_id: `demo-${n}`,
      timestamp: Date.now(),
      sender_id: "invoice-bot",
      intent: "payment.send",
      resource,
      amount,
      payload: { memo: "invoice" },
      irreversible,
      idempotency_key: `demo-key-${n}`,
      delegation_chain: [],
      authority_token: token,
    },
    agent.privateKey,
  );
}

const bank = {
  execute: (p: Proposal) => console.log(`   bank: sent ${p.amount} cents to ${p.resource}`),
};

async function show(label: string, p: Proposal) {
  const r = await kernel.run(p, bank);
  console.log(`${label}\n   -> ${r.code}${r.executed ? " (executed)" : ""}  ${r.code === "ALLOW" ? "" : r.reason}`);
}

await show("1. pay $150 to a vendor", propose("vendor:acme-supplies", 15_000));
await show("2. pay $500 (over the token's $200 limit)", propose("vendor:acme-supplies", 50_000));
await show("3. pay an unknown account (not a vendor)", propose("personal:attacker", 100));

// 4. an irreversible wire needs a human
const wire = propose("vendor:big-supplier", 18_000, true);
await show("4. irreversible $180 wire, no approval", wire);
const approval = signApproval({ approver_id: "cfo", proposal: wire, expires_at: Date.now() + 60_000 }, cfo.privateKey);
await show("5. same wire, CFO signs approval", { ...wire, approvals: [approval] });

console.log(`\naudit log: ${kernel.audit.all.length} entries, head ${kernel.audit.head().slice(0, 16)}…`);
