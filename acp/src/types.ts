/** All times are integer milliseconds since the Unix epoch. */

export interface Permission {
  /** Intent name, e.g. "payment.send". "*" matches any intent. */
  intent: string;
  /** Resource patterns. Exact match, "*" for any, or a trailing "*" for a prefix. */
  resources: string[];
  /** Per-call ceiling on `amount`. Undefined = no ceiling at this level. */
  max_amount?: number;
}

export interface AuthorityToken {
  token_id: string;
  issuer: string;
  subject: string;
  permissions: Permission[];
  expiry: number;
  /** Whether the subject may issue child tokens. */
  delegable: boolean;
  signature: string;
}

export interface Proposal {
  acp_version: string;
  proposal_id: string;
  timestamp: number;
  sender_id: string;
  intent: string;
  resource: string;
  /** Non-negative integer in minor units, for intents that spend or consume. */
  amount?: number;
  payload: Record<string, unknown>;
  irreversible: boolean;
  idempotency_key: string;
  /** Ancestor tokens, root-issued first. Empty when authority_token is issued by a root. */
  delegation_chain: AuthorityToken[];
  authority_token: AuthorityToken;
  signature: string;
  /** Human approvals. Not covered by the proposal signature or hash. */
  approvals?: Approval[];
}

export interface Approval {
  approver_id: string;
  /** Hash of the proposal being approved (see proposalHash). */
  proposal_hash: string;
  expires_at: number;
  signature: string;
}

export type DecisionCode =
  | "ALLOW"
  | "DENY_SCHEMA"
  | "DENY_IDENTITY"
  | "DENY_AUTHORITY"
  | "DENY_DELEGATION"
  | "DENY_REVOKED"
  | "DENY_CONSTRAINT"
  | "DENY_IDEMPOTENCY"
  | "DENY_CLOCK"
  | "CHALLENGE_HUMAN";

export interface Decision {
  code: DecisionCode;
  reason: string;
  proposal_id: string;
  /** Present only when code is ALLOW. */
  reservation_id?: string;
}

export type ReservationState = "RESERVED" | "COMMITTED" | "ABORTED" | "ROLLED_BACK";

export interface ConstraintPolicy {
  /** Hard ceiling per call, applied on top of the token's own max_amount. */
  max_amount_per_call?: number;
  /** Total amount allowed per sliding window per sender (committed + reserved). */
  window?: { duration_ms: number; max_total_amount?: number; max_calls?: number };
  /** If set, only these resources may be touched with this intent. */
  allowed_resources?: string[];
}

export interface KernelConfig {
  /** Root authority id -> base64 SPKI public key. Tokens must chain to one of these. */
  roots: Record<string, string>;
  /** Agent id -> public key. Proposal signatures are checked against this. */
  agents: Record<string, string>;
  /** Human approver id -> public key. */
  approvers: Record<string, string>;
  /** Distinct approvers needed for an irreversible action. Default 1. */
  approval_quorum?: number;
  /** Default 5. */
  max_delegation_depth?: number;
  /** A RESERVED action not committed within this time is auto-aborted. Default 30000. */
  reservation_timeout_ms?: number;
  /** Per-intent constraint policy. Intents with no entry have only token limits. */
  policies?: Record<string, ConstraintPolicy>;
  /** Intents that are denied outright unless listed here. Default: all intents allowed by token. */
  known_intents?: string[];
  now?: () => number;
}
