import { generateKeyPair, issueToken, signProposal, Kernel } from "../src/index.js";
import type { AuthorityToken, KernelConfig, Proposal } from "../src/index.js";

export const T0 = 1_700_000_000_000;

export function world(overrides: Partial<KernelConfig> = {}) {
  const clock = { now: T0 };
  const root = generateKeyPair();
  const agentA = generateKeyPair();
  const agentB = generateKeyPair();
  const agentC = generateKeyPair();
  const human1 = generateKeyPair();
  const human2 = generateKeyPair();
  const kernel = new Kernel({
    roots: { root: root.publicKey },
    agents: { a: agentA.publicKey, b: agentB.publicKey, c: agentC.publicKey },
    approvers: { h1: human1.publicKey, h2: human2.publicKey },
    now: () => clock.now,
    ...overrides,
  });
  const tokenA = issueToken(
    {
      issuer: "root",
      subject: "a",
      permissions: [{ intent: "payment.send", resources: ["acct:*"], max_amount: 1000 }],
      expiry: T0 + 3_600_000,
      delegable: true,
    },
    root.privateKey,
  );
  let n = 0;
  function proposal(over: Partial<Proposal> = {}, token: AuthorityToken = tokenA, key = agentA.privateKey): Proposal {
    n++;
    return signProposal(
      {
        acp_version: "3.0",
        proposal_id: `p${n}`,
        timestamp: clock.now,
        sender_id: "a",
        intent: "payment.send",
        resource: "acct:42",
        amount: 100,
        payload: {},
        irreversible: false,
        idempotency_key: `k${n}`,
        delegation_chain: [],
        authority_token: token,
        ...over,
      },
      key,
    );
  }
  return { clock, root, agentA, agentB, agentC, human1, human2, kernel, tokenA, proposal };
}
