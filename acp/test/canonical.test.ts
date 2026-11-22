import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, generateKeyPair, signValue, verifyValue } from "../src/index.js";

test("canonical JSON is key-order independent", () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] }), canonicalize({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
});

test("signatures verify and fail on change", () => {
  const k = generateKeyPair();
  const sig = signValue({ x: 1, y: 2 }, k.privateKey);
  assert.ok(verifyValue({ y: 2, x: 1 }, sig, k.publicKey));
  assert.equal(verifyValue({ x: 2, y: 2 }, sig, k.publicKey), false);
  assert.equal(verifyValue({ x: 1, y: 2 }, "AAAA", k.publicKey), false);
});
