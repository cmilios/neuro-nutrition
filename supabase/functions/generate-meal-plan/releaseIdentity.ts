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

export function createReleaseIdentityHandler(options: {
  expectedTokenHash: string;
  expectedVersion: number;
  deploymentId: () => string | undefined;
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
    return Response.json(
      {
        matches: actualVersion === options.expectedVersion,
        expectedVersion: options.expectedVersion,
        actualVersion,
      },
      { headers: jsonHeaders },
    );
  };
}
