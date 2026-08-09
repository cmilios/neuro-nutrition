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
export type PostgrestCredential = {
  apiKey: string;
  authorization?: string;
};

export function createPostgrestRpc(options: {
  supabaseUrl: string;
  credential: PostgrestCredential;
  fetch: typeof globalThis.fetch;
}) {
  return async (name: string): Promise<JsonObject> => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      apikey: options.credential.apiKey,
    };
    if (options.credential.authorization) {
      headers.authorization = options.credential.authorization;
    }

    const response = await options.fetch(
      `${options.supabaseUrl}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers,
        body: "{}",
      },
    );
    if (!response.ok) throw new Error(`RPC ${name} failed`);
    return await response.json() as JsonObject;
  };
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
    } catch {
      return Response.json(
        { error: "probe_unavailable" },
        { status: 502, headers: jsonHeaders },
      );
    }
  };
}
