import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Digest of a set of Edge Function source files.
 *
 * This is deliberately a second implementation of `computeSourceDigest` in
 * `supabase/functions/generate-meal-plan/releaseIdentity.ts`. The two cannot
 * share a module: one is bundled into the deployed function, the other runs in
 * the monitoring runner, and the whole point is that the verifier lives outside
 * the artifact it verifies. `sourceDigestParity.test.mjs` pins them together.
 */
export async function computeSourceDigest(files) {
  const payload = [...files]
    .sort((left, right) => (left.name < right.name ? -1 : 1))
    .map((file) =>
      `${file.name}\n${file.content.replace(/\r\n/g, "\n").trimEnd()}\n`
    )
    .join("");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The reviewed source of one Edge Function, as the platform would deploy it:
 * every `.ts` file in the function directory except its tests.
 */
export async function readFunctionSource(source) {
  const directory = source instanceof URL ? fileURLToPath(source) : source;
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }
    files.push({
      name: entry.name,
      content: await readFile(path.join(directory, entry.name), "utf8"),
    });
  }
  return files;
}
