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

type JsonObject = Record<string, unknown>;

/**
 * Carries the status an upstream answered a probe loader with, so the handler
 * can tell a refused credential from an unreachable dependency. The status is
 * the only detail that crosses the boundary; the message stays on this side.
 */
export class ProbeUpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function createObservationProbeHandler(options: {
  expectedTokenHash: string;
  loadDatabaseSnapshot: () => Promise<JsonObject>;
  loadFunctionFailures: () => Promise<JsonObject>;
  loadReleaseIdentity: (authorization: string) => Promise<JsonObject>;
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

    const probe = new URL(request.url).searchParams.get("probe");
    try {
      let result: JsonObject;
      if (probe === "database") {
        result = await options.loadDatabaseSnapshot();
      } else if (probe === "function-failures") {
        result = await options.loadFunctionFailures();
      } else if (probe === "release-identity") {
        result = await options.loadReleaseIdentity(`Bearer ${token}`);
      } else {
        return Response.json(
          { error: "unknown_probe" },
          { status: 404, headers: jsonHeaders },
        );
      }
      return Response.json(result, { headers: jsonHeaders });
    } catch (error) {
      // The monitoring runner retries 408, 429 and 5xx and gives up immediately
      // on everything else, so a refused upstream credential needs a status
      // outside that set to fail fast. It cannot reuse the 401 above: that one
      // means the runner's own monitoring token was rejected, which is a
      // different fault from an upstream refusing the credential we presented.
      const upstream = error instanceof ProbeUpstreamError ? error.status : null;
      if (upstream === 401 || upstream === 403) {
        return Response.json(
          { error: "probe_credential_rejected" },
          { status: 424, headers: jsonHeaders },
        );
      }
      return Response.json(
        { error: "probe_unavailable" },
        { status: 502, headers: jsonHeaders },
      );
    }
  };
}
