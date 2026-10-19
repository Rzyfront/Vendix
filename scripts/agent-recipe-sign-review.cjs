#!/usr/bin/env node
"use strict";
// OFFLINE HUMAN maintenance utility. Does not run fixtures or certify their truth.
// Usage: AI_RECIPE_REVIEW_KEY=<secure-env> node scripts/agent-recipe-sign-review.cjs < reviewed-evidence.json > attestation.json
// Never give the key to a model, tool, browser, job, trace, or untrusted template.
const { readFileSync } = require("node:fs");
const { createHmac } = require("node:crypto");
const stable = (value) =>
  Array.isArray(value)
    ? `[${value.map(stable).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
          .join(",")}}`
      : (JSON.stringify(value) ?? "null");
try {
  const input = readFileSync(0, "utf8");
  if (Buffer.byteLength(input) > 64000) throw new Error("RECIPE_REVIEW_SIZE");
  const review = JSON.parse(input),
    key = process.env.AI_RECIPE_REVIEW_KEY;
  if (
    !review ||
    Array.isArray(review) ||
    typeof review !== "object" ||
    Object.hasOwn(review, "signature") ||
    !["reviewed", "approved", "global"].includes(review.stage) ||
    !Number.isSafeInteger(review.recipe_id) ||
    review.recipe_id <= 0 ||
    !/^[a-f0-9]{64}$/.test(review.content_hash ?? "") ||
    !Number.isSafeInteger(review.reviewer_id) ||
    review.reviewer_id <= 0 ||
    !Array.isArray(review.runs) ||
    review.runs.length < 8 ||
    !key ||
    !/^[a-f0-9]{64}$/i.test(key)
  )
    throw new Error("RECIPE_REVIEW_INPUT_OR_AUTHORITY");
  // The backend revalidates exact schema, process owner, TTL, CAS, quality/control/holdout and scope.
  process.stdout.write(
    JSON.stringify({
      ...review,
      signature: createHmac("sha256", Buffer.from(key, "hex"))
        .update(stable(review))
        .digest("hex"),
    }) + "\n",
  );
} catch {
  process.stderr.write(
    "RECIPE_REVIEW_SIGNING_REFUSED: require explicit human-reviewed evidence and offline authority; nothing published.\n",
  );
  process.exitCode = 1;
}
