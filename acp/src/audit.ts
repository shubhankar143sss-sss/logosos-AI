import { canonicalize, sha256Hex } from "./canonical.js";

export interface AuditEntry {
  index: number;
  ts: number;
  event: string;
  proposal_id: string;
  detail: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

/** Append-only, hash-linked log. Tamper-evident, not tamper-proof: anchor the head hash externally. */
export class AuditLog {
  private entries: AuditEntry[] = [];

  append(ts: number, event: string, proposal_id: string, detail: Record<string, unknown> = {}): AuditEntry {
    const prev_hash = this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
    const index = this.entries.length;
    const hash = sha256Hex(canonicalize({ index, ts, event, proposal_id, detail, prev_hash }));
    const entry = { index, ts, event, proposal_id, detail, prev_hash, hash };
    this.entries.push(entry);
    return entry;
  }

  get all(): readonly AuditEntry[] {
    return this.entries;
  }

  head(): string {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
  }

  static verify(entries: readonly AuditEntry[]): boolean {
    let prev = GENESIS;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const expected = sha256Hex(
        canonicalize({ index: i, ts: e.ts, event: e.event, proposal_id: e.proposal_id, detail: e.detail, prev_hash: prev }),
      );
      if (e.index !== i || e.prev_hash !== prev || e.hash !== expected) return false;
      prev = e.hash;
    }
    return true;
  }
}
