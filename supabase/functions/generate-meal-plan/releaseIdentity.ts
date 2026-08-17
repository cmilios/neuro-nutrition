const jsonHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function deploymentVersion(deploymentId: string | undefined): number | null {
  const match = deploymentId?.match(/_(\d+)$/);
  return match ? Number(match[1]) : null;
}

export type SourceFile = { name: string; content: string };

/**
 * Digest of the source this deployment is actually running.
 *
 * The version comparison below cannot detect source drift: `expectedVersion`
 * travels inside the same bundle it describes, so a deployment built from
 * unreviewed source carries a constant that still matches. This digest is
 * computed from the running files instead, and is compared against the
 * reviewed source by the monitoring runner — outside the artifact, which is
 * the only place the comparison means anything.
 *
 * Line endings and trailing whitespace are normalised so a checkout or upload
 * that rewrites them does not read as a code change.
 */
export async function computeSourceDigest(
  files: readonly SourceFile[],
): Promise<string> {
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

export function createReleaseIdentityHandler(options: {
  expectedTokenHash: string;
  expectedVersion: number;
  deploymentId: () => string | undefined;
  readSourceFiles: () => Promise<readonly SourceFile[]>;
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return Response.json(
        { error: "method_not_allowed" },
        { status: 405, headers: jsonHeaders },
      );
    }

    const token = bearerToken(request);
    const authenticated = token
      ? constantTimeEqual(
        await sha256Hex(token),
        options.expectedTokenHash,
      )
      : false;
    if (!authenticated) {
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: jsonHeaders },
      );
    }

    const actualVersion = deploymentVersion(options.deploymentId());
    // A runtime that cannot read its own source reports null rather than
    // guessing, so the runner can tell "no drift" from "cannot tell".
    let sourceDigest: string | null = null;
    try {
      sourceDigest = await computeSourceDigest(await options.readSourceFiles());
    } catch {
      sourceDigest = null;
    }
    return Response.json(
      {
        matches: actualVersion === options.expectedVersion,
        expectedVersion: options.expectedVersion,
        actualVersion,
        sourceDigest,
      },
      { headers: jsonHeaders },
    );
  };
}
