// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAlertForwarder, type ForwardFailure } from "./webhook";

const alert = {
  failedEvent: "oauth_auth_failure",
  occurredAt: "2026-08-08T12:00:00.000Z",
  receivedAt: "2026-08-08T12:00:01.000Z",
};

const WEBHOOK = "https://hooks.example.test/T000/B000/xxxx";

function okResponse() {
  return new Response(null, { status: 204 });
}

describe("alert forwarding", () => {
  it("posts a channel-readable alert to the configured webhook", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const forward = createAlertForwarder({ webhookUrl: WEBHOOK, fetchImpl });

    await forward(alert);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    // Slack reads `text`, Discord reads `content`; both must carry the summary.
    expect(body.text).toContain("oauth_auth_failure");
    expect(body.content).toBe(body.text);
    expect(body.failedEvent).toBe("oauth_auth_failure");
    expect(body.occurredAt).toBe(alert.occurredAt);
  });

  it("does nothing when no channel is configured", async () => {
    const fetchImpl = vi.fn();
    const onFailure = vi.fn();
    const forward = createAlertForwarder({
      webhookUrl: undefined,
      fetchImpl,
      onFailure,
    });

    await forward(alert);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("refuses to send an alert over plaintext http", async () => {
    const fetchImpl = vi.fn();
    const failures: ForwardFailure[] = [];
    const forward = createAlertForwarder({
      webhookUrl: "http://hooks.example.test/T000/B000/xxxx",
      fetchImpl,
      onFailure: (failure) => failures.push(failure),
    });

    await forward(alert);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(failures).toEqual([{ reason: "insecure_url" }]);
  });

  it("reports a rejection by status without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("no_service", { status: 404 }),
    );
    const failures: ForwardFailure[] = [];
    const forward = createAlertForwarder({
      webhookUrl: WEBHOOK,
      fetchImpl,
      onFailure: (failure) => failures.push(failure),
    });

    await expect(forward(alert)).resolves.toBeUndefined();
    expect(failures).toEqual([{ reason: "rejected", status: 404 }]);
  });

  it("survives a channel outage without surfacing the secret url", async () => {
    // A Deno network error can embed the request URL, which is the secret, so
    // the failure must be reported as a bare code.
    const fetchImpl = vi.fn().mockRejectedValue(
      new Error(`error sending request for url (${WEBHOOK})`),
    );
    const failures: ForwardFailure[] = [];
    const forward = createAlertForwarder({
      webhookUrl: WEBHOOK,
      fetchImpl,
      onFailure: (failure) => failures.push(failure),
    });

    await expect(forward(alert)).resolves.toBeUndefined();
    expect(failures).toEqual([{ reason: "network_error" }]);
    expect(JSON.stringify(failures)).not.toContain("hooks.example.test");
  });

  it("gives up on a hanging channel rather than pinning the isolate", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })
    );
    const failures: ForwardFailure[] = [];
    const forward = createAlertForwarder({
      webhookUrl: WEBHOOK,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
      onFailure: (failure) => failures.push(failure),
    });

    await expect(forward(alert)).resolves.toBeUndefined();
    expect(failures).toEqual([{ reason: "network_error" }]);
  });

  it("carries nothing beyond the validated fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const forward = createAlertForwarder({ webhookUrl: WEBHOOK, fetchImpl });

    await forward(alert);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual([
      "content",
      "event",
      "failedEvent",
      "occurredAt",
      "receivedAt",
      "text",
    ]);
  });
});
