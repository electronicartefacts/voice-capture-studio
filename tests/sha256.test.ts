import assert from "node:assert/strict";
import test from "node:test";
import { sha256Blob, sha256Bytes } from "../src/app/storage/sha256";

test("SHA-256 fallback matches standard vectors", () => {
  assert.equal(
    sha256Bytes(new Uint8Array()),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Bytes(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("SHA-256 blob hashing keeps export artifact checksums stable", async () => {
  await assert.doesNotReject(async () => {
    assert.equal(
      await sha256Blob(new Blob(["abc"], { type: "text/plain" })),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
