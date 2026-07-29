import assert from "node:assert/strict";
import test from "node:test";

import { inspectLockfile } from "../scripts/verify-lockfile-sources.mjs";

function lockfile({
  spec = "1.2.3",
  resolved = "https://registry.npmjs.org/example/-/example-1.2.3.tgz",
  integrity = "sha512-example",
} = {}) {
  return {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { example: spec } },
      "node_modules/example": {
        version: "1.2.3",
        resolved,
        integrity,
      },
    },
  };
}

test("accepts exact direct versions with public HTTPS registry and integrity", () => {
  assert.deepEqual(inspectLockfile(lockfile()), []);
});

test("rejects floating direct dependency versions", () => {
  assert.match(inspectLockfile(lockfile({ spec: "latest" })).join("\n"), /exact version/);
});

test("rejects private or environment-specific registry hosts", () => {
  const issues = inspectLockfile(
    lockfile({
      resolved:
        "https://packages.internal.example/artifactory/api/npm/npm-public/example/-/example-1.2.3.tgz",
    }),
  );
  assert.match(issues.join("\n"), /unapproved host packages\.internal\.example/);
});

test("rejects insecure, credential-bearing, and unverified package sources", () => {
  const issues = inspectLockfile(
    lockfile({
      resolved: "http://user:secret@registry.npmjs.org/example/-/example-1.2.3.tgz?token=x",
      integrity: null,
    }),
  ).join("\n");
  assert.match(issues, /must resolve over HTTPS/);
  assert.match(issues, /contains credentials/);
  assert.match(issues, /query or fragment data/);
  assert.match(issues, /missing an integrity digest/);
});
