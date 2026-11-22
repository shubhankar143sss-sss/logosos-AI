import { randomUUID } from "node:crypto";
import { AuditLog } from "./audit.js";
import { canonicalize, sha256Hex } from "./canonical.js";
import { signValue, verifyValue } from "./crypto.js";
import { matchPermission, permissionCovered, tokenSignatureValid } from "./token.js";
import type {
  Approval,
  AuthorityToken,
  ConstraintPolicy,
  Decision,
  DecisionCode,
  KernelConfig,
  Proposal,
  ReservationState,
} from "./types.js";

export const ACP_VERSION = "3.0";

interface Reservation {
  id: string;
  proposal_id: string;
  sender_id: string;
  intent: string;
  amount: number;
  created_at: number;
  state: ReservationState;
}

interface UsageRecord {
  at: number;
  amount: number;
}

export interface Adapter {
  execute(proposal: Proposal): Promise<void> | void;
  /** Undo a committed or partly executed action. Must be idempotent. */
  rollback?(proposal: Proposal): Promise<void> | void;
}

/** The part of a proposal that the sender signs and that approvals bind to. */
function signedBody(p: Proposal): Omit<Proposal, "signature" | "approvals"> {
  const { signature: _s, approvals: _a, ...rest } = p;
  return rest;
}

export function proposalHash(p: Proposal): string {
  return sha256Hex(canonicalize(signedBody(p)));
}

export function signProposal(p: Omit<Proposal, "signature">, senderPrivateKey: string): Proposal {
  const { approvals: _a, ...rest } = p;
  return { ...p, signature: signValue(rest, senderPrivateKey) };
}

export function signApproval(
  args: { approver_id: string; proposal: Proposal; expires_at: number },
  approverPrivateKey: string,
): Approval {
  const body = { approver_id: args.approver_id, proposal_hash: proposalHash(args.proposal), expires_at: args.expires_at };
  return { ...body, signature: signValue(body, approverPrivateKey) };
}

export class Kernel {
  readonly audit = new AuditLog();
  private revoked = new Set<string>();
  private reservations = new Map<string, Reservation>();
  private usage = new Map<string, UsageRecord[]>(); // key: sender|intent, committed only
  private seen = new Map<string, { hash: string; decision: Decision }>(); // idempotency_key
  private lastNow = 0;
  private readonly cfg: Required<Pick<KernelConfig, "approval_quorum" | "max_delegation_depth" | "reservation_timeout_ms">> &
    KernelConfig;

  constructor(config: KernelConfig) {
    this.cfg = {
      approval_quorum: 1,
      max_delegation_depth: 5,
      reservation_timeout_ms: 30_000,
      ...config,
    };
  }

  revoke(token_id: string): void {
    this.revoked.add(token_id);
    this.audit.append(this.lastNow, "REVOKE", "-", { token_id });
  }

  reservationState(id: string): ReservationState | undefined {
    return this.reservations.get(id)?.state;
  }

  /** Monotonic clock: time may not go backwards. Returns null on violation (fail closed). */
  private tick(): number | null {
    const now = (this.cfg.now ?? Date.now)();
    if (now < this.lastNow) return null;
    this.lastNow = now;
    return now;
  }

  /**
   * Evaluate a proposal. On ALLOW the authority is reserved; the caller must
   * then commit() or abort() the reservation (or use run()).
   */
  evaluate(p: Proposal): Decision {
    const now = this.tick();
    if (now === null) return this.finish(p, "DENY_CLOCK", "clock moved backwards", this.lastNow);
    this.sweep(now);

    const deny = (code: DecisionCode, reason: string) => this.finish(p, code, reason, now);

    // 1. schema
    const schemaErr = this.checkSchema(p);
    if (schemaErr) return deny("DENY_SCHEMA", schemaErr);
    if (p.acp_version !== ACP_VERSION) return deny("DENY_SCHEMA", `unsupported acp_version ${p.acp_version}`);
    if (this.cfg.known_intents && !this.cfg.known_intents.includes(p.intent)) {
      return deny("DENY_SCHEMA", `unknown intent ${p.intent}`);
    }

    // 2. idempotency: a repeat of a settled proposal returns the same answer
    const hash = proposalHash(p);
    const prior = this.seen.get(p.idempotency_key);
    if (prior) {
      if (prior.hash !== hash) return deny("DENY_IDEMPOTENCY", "idempotency_key reused with a different proposal");
      this.audit.append(now, "REPLAY", p.proposal_id, { code: prior.decision.code });
      return prior.decision;
    }

    // 3. sender identity
    const senderKey = this.cfg.agents[p.sender_id];
    if (!senderKey || !verifyValue(signedBody(p), p.signature, senderKey)) {
      return deny("DENY_IDENTITY", "bad sender or signature");
    }

    // 4. delegation chain
    const chain = [...p.delegation_chain, p.authority_token];
    const delErr = this.checkChain(chain, p.sender_id, now);
    if (delErr) return deny(delErr.code, delErr.reason);

    // 5. revocation (any token in the chain)
    if (chain.some((t) => this.revoked.has(t.token_id))) return deny("DENY_REVOKED", "token revoked");

    // 6. authority: the final token must cover this exact action
    const amount = p.amount ?? 0;
    const perm = matchPermission(p.authority_token, p.intent, p.resource, amount);
    if (!perm) return deny("DENY_AUTHORITY", "token does not permit this intent, resource and amount");

    // 7. constraints, with usage that includes outstanding reservations
    const conErr = this.checkConstraints(p, amount, now);
    if (conErr) return deny("DENY_CONSTRAINT", conErr);

    // 8. human approval for irreversible actions (not cached: the caller retries with approvals)
    if (p.irreversible) {
      const apprErr = this.checkApprovals(p, hash, now);
      if (apprErr) {
        const d: Decision = { code: "CHALLENGE_HUMAN", reason: apprErr, proposal_id: p.proposal_id };
        this.audit.append(now, "DECISION", p.proposal_id, { code: d.code, reason: d.reason });
        return d;
      }
    }

    // 9. reserve
    const r: Reservation = {
      id: randomUUID(),
      proposal_id: p.proposal_id,
      sender_id: p.sender_id,
      intent: p.intent,
      amount,
      created_at: now,
      state: "RESERVED",
    };
    this.reservations.set(r.id, r);
    const d: Decision = { code: "ALLOW", reason: "ok", proposal_id: p.proposal_id, reservation_id: r.id };
    this.seen.set(p.idempotency_key, { hash, decision: d });
    this.audit.append(now, "DECISION", p.proposal_id, { code: "ALLOW", reservation_id: r.id });
    return d;
  }

  commit(reservation_id: string): boolean {
    const now = this.tick() ?? this.lastNow;
    const r = this.reservations.get(reservation_id);
    if (!r || r.state !== "RESERVED") return false;
    if (now - r.created_at > this.cfg.reservation_timeout_ms) {
      this.abort(reservation_id, "timeout");
      return false;
    }
    r.state = "COMMITTED";
    const key = `${r.sender_id}|${r.intent}`;
    const list = this.usage.get(key) ?? [];
    list.push({ at: now, amount: r.amount });
    this.usage.set(key, list);
    this.audit.append(now, "COMMIT", r.proposal_id, { reservation_id });
    return true;
  }

  /** RESERVED -> ABORTED -> ROLLED_BACK. Releases the reserved authority. */
  abort(reservation_id: string, reason = "aborted"): boolean {
    const now = this.tick() ?? this.lastNow;
    const r = this.reservations.get(reservation_id);
    if (!r || r.state !== "RESERVED") return false;
    r.state = "ABORTED";
    this.audit.append(now, "ABORT", r.proposal_id, { reservation_id, reason });
    r.state = "ROLLED_BACK";
    this.audit.append(now, "ROLLED_BACK", r.proposal_id, { reservation_id });
    // an aborted proposal can be retried with the same key: drop the cached ALLOW
    for (const [k, v] of this.seen) if (v.decision.reservation_id === reservation_id) this.seen.delete(k);
    return true;
  }

  /** Auto-abort reservations older than the timeout. Called on every evaluate(). */
  sweep(now: number): void {
    for (const r of this.reservations.values()) {
      if (r.state === "RESERVED" && now - r.created_at > this.cfg.reservation_timeout_ms) {
        this.abort(r.id, "timeout");
      }
    }
  }

  /**
   * Evaluate, execute through the adapter, and settle. The adapter is only
   * called on ALLOW. If it throws, the reservation is aborted and the
   * adapter's rollback (if any) is called.
   */
  async run(p: Proposal, adapter: Adapter): Promise<Decision & { executed: boolean }> {
    const d = this.evaluate(p);
    if (d.code !== "ALLOW" || !d.reservation_id) return { ...d, executed: false };
    try {
      await adapter.execute(p);
    } catch (err) {
      this.abort(d.reservation_id, "adapter error");
      try {
        await adapter.rollback?.(p);
      } catch {
        /* rollback failure is surfaced in the audit log below */
        this.audit.append(this.lastNow, "ROLLBACK_FAILED", p.proposal_id, {});
      }
      return { ...d, code: "DENY_CONSTRAINT", reason: `adapter failed: ${(err as Error).message}`, executed: false };
    }
    if (!this.commit(d.reservation_id)) {
      await adapter.rollback?.(p);
      return { ...d, code: "DENY_CONSTRAINT", reason: "reservation expired before commit", executed: false };
    }
    return { ...d, executed: true };
  }

  // ---- internals ----

  private finish(p: Proposal, code: DecisionCode, reason: string, now: number): Decision {
    const d: Decision = { code, reason, proposal_id: p?.proposal_id ?? "-" };
    this.audit.append(now, "DECISION", d.proposal_id, { code, reason });
    // Remember settled denials for idempotency except client-fixable ones.
    return d;
  }

  private checkSchema(p: Proposal): string | null {
    if (!p || typeof p !== "object") return "not an object";
    for (const f of ["proposal_id", "sender_id", "intent", "resource", "idempotency_key", "signature"] as const) {
      if (typeof p[f] !== "string" || p[f].length === 0) return `missing ${f}`;
    }
    if (typeof p.acp_version !== "string") return "missing acp_version";
    if (!Number.isInteger(p.timestamp)) return "timestamp must be integer ms";
    if (typeof p.irreversible !== "boolean") return "irreversible must be boolean";
    if (p.amount !== undefined && (!Number.isInteger(p.amount) || p.amount < 0)) return "amount must be a non-negative integer";
    if (!p.authority_token || typeof p.authority_token !== "object") return "missing authority_token";
    if (!Array.isArray(p.delegation_chain)) return "delegation_chain must be an array";
    if (typeof p.payload !== "object" || p.payload === null) return "payload must be an object";
    return null;
  }

  private checkChain(chain: AuthorityToken[], sender: string, now: number): { code: DecisionCode; reason: string } | null {
    if (chain.length > this.cfg.max_delegation_depth) {
      return { code: "DENY_DELEGATION", reason: `chain longer than ${this.cfg.max_delegation_depth}` };
    }
    const seen = new Set<string>();
    for (let i = 0; i < chain.length; i++) {
      const t = chain[i];
      if (seen.has(t.subject) || seen.has(t.token_id)) return { code: "DENY_DELEGATION", reason: "circular delegation" };
      seen.add(t.subject);
      seen.add(t.token_id);

      // issuer key: a root for the first token, the previous subject after that
      let issuerKey: string | undefined;
      if (i === 0) {
        issuerKey = this.cfg.roots[t.issuer];
        if (!issuerKey) return { code: "DENY_DELEGATION", reason: "chain does not start at a trusted root" };
      } else {
        const prev = chain[i - 1];
        if (t.issuer !== prev.subject) return { code: "DENY_DELEGATION", reason: "chain link issuer mismatch" };
        if (!prev.delegable) return { code: "DENY_DELEGATION", reason: "parent token is not delegable" };
        issuerKey = this.cfg.agents[prev.subject];
        if (!issuerKey) return { code: "DENY_DELEGATION", reason: "unknown delegating agent" };
        if (!t.permissions.every((perm) => permissionCovered(perm, prev.permissions))) {
          return { code: "DENY_DELEGATION", reason: "child permissions exceed parent" };
        }
        if (t.expiry > prev.expiry) return { code: "DENY_DELEGATION", reason: "child outlives parent" };
      }
      if (!tokenSignatureValid(t, issuerKey)) return { code: "DENY_DELEGATION", reason: "bad token signature" };
      if (t.expiry <= now) return { code: "DENY_AUTHORITY", reason: "token expired" };
    }
    if (chain[chain.length - 1].subject !== sender) {
      return { code: "DENY_AUTHORITY", reason: "token subject is not the sender" };
    }
    return null;
  }

  private checkConstraints(p: Proposal, amount: number, now: number): string | null {
    const pol: ConstraintPolicy | undefined = this.cfg.policies?.[p.intent];
    if (!pol) return null;
    if (pol.allowed_resources && !pol.allowed_resources.includes(p.resource)) return "resource not allowed for intent";
    if (pol.max_amount_per_call !== undefined && amount > pol.max_amount_per_call) return "over per-call limit";
    if (pol.window) {
      const key = `${p.sender_id}|${p.intent}`;
      const since = now - pol.window.duration_ms;
      const committed = (this.usage.get(key) ?? []).filter((u) => u.at > since);
      const reserved = [...this.reservations.values()].filter(
        (r) => r.state === "RESERVED" && r.sender_id === p.sender_id && r.intent === p.intent,
      );
      const total = committed.reduce((s, u) => s + u.amount, 0) + reserved.reduce((s, r) => s + r.amount, 0);
      const calls = committed.length + reserved.length;
      if (pol.window.max_total_amount !== undefined && total + amount > pol.window.max_total_amount) {
        return "window amount limit exceeded";
      }
      if (pol.window.max_calls !== undefined && calls + 1 > pol.window.max_calls) return "window call limit exceeded";
    }
    return null;
  }

  private checkApprovals(p: Proposal, hash: string, now: number): string | null {
    const ok = new Set<string>();
    for (const a of p.approvals ?? []) {
      const key = this.cfg.approvers[a.approver_id];
      if (!key || a.proposal_hash !== hash || a.expires_at <= now) continue;
      const { signature, ...body } = a;
      if (verifyValue(body, signature, key)) ok.add(a.approver_id);
    }
    const need = this.cfg.approval_quorum;
    return ok.size >= need ? null : `irreversible action needs ${need} valid human approval(s), has ${ok.size}`;
  }
}
