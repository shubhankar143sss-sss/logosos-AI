import { randomUUID } from "node:crypto";
import { signValue, verifyValue } from "./crypto.js";
import type { AuthorityToken, Permission } from "./types.js";

type Unsigned = Omit<AuthorityToken, "signature">;

export function issueToken(
  args: {
    issuer: string;
    subject: string;
    permissions: Permission[];
    expiry: number;
    delegable?: boolean;
    token_id?: string;
  },
  issuerPrivateKey: string,
): AuthorityToken {
  const body: Unsigned = {
    token_id: args.token_id ?? randomUUID(),
    issuer: args.issuer,
    subject: args.subject,
    permissions: args.permissions,
    expiry: args.expiry,
    delegable: args.delegable ?? false,
  };
  return { ...body, signature: signValue(body, issuerPrivateKey) };
}

export function tokenSignatureValid(token: AuthorityToken, issuerPublicKey: string): boolean {
  const { signature, ...body } = token;
  return verifyValue(body, signature, issuerPublicKey);
}

export function resourceMatches(pattern: string, resource: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return resource.startsWith(pattern.slice(0, -1));
  return pattern === resource;
}

/** True if `child` grants nothing that `parent` does not already grant. */
export function permissionCovered(child: Permission, parents: Permission[]): boolean {
  return parents.some((p) => {
    if (p.intent !== "*" && p.intent !== child.intent) return false;
    if (!child.resources.every((cr) => p.resources.some((pr) => patternCovers(pr, cr)))) return false;
    if (p.max_amount === undefined) return true;
    return child.max_amount !== undefined && child.max_amount <= p.max_amount;
  });
}

function patternCovers(parent: string, child: string): boolean {
  if (parent === "*") return true;
  if (parent.endsWith("*")) return child.startsWith(parent.slice(0, -1));
  return parent === child;
}

/** The permission in `token` that authorizes this intent/resource/amount, if any. */
export function matchPermission(
  token: AuthorityToken,
  intent: string,
  resource: string,
  amount: number,
): Permission | undefined {
  return token.permissions.find(
    (p) =>
      (p.intent === "*" || p.intent === intent) &&
      p.resources.some((r) => resourceMatches(r, resource)) &&
      (p.max_amount === undefined || amount <= p.max_amount),
  );
}
