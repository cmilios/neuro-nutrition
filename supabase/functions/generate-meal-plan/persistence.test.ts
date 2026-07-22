// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { GenerationRecord } from "./handler";
import { persistUsageRecordToSupabase } from "./persistence";

const record: GenerationRecord = {
  callId: "00000000-0000-4000-8000-000000000201",
  userId: "00000000-0000-4000-8000-000000000001",
  action: "plan",
  attempt: 1,
  provider: "openai",
  model: "gpt-5.6-sol",
  providerResponseId: "resp_retry",
  inputTokens: 100,
  outputTokens: 25,
  totalTokens: 125,
  outcome: "success",
};

describe("AI Usage Record persistence", () => {
  it("retries transient failures with the same idempotency key and body", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const delay = vi.fn().mockResolvedValue(undefined);

    await persistUsageRecordToSupabase(record, {
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
      delay,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenNthCalledWith(1, 50);
    expect(delay).toHaveBeenNthCalledWith(2, 100);
    const calls = fetchImpl.mock.calls;
    expect(calls.map((call) => call[0])).toEqual([
      "https://example.supabase.co/rest/v1/ai_usage_records?on_conflict=call_id",
      "https://example.supabase.co/rest/v1/ai_usage_records?on_conflict=call_id",
      "https://example.supabase.co/rest/v1/ai_usage_records?on_conflict=call_id",
    ]);
    expect(calls.map((call) => call[1]?.body)).toEqual([
      calls[0][1]?.body,
      calls[0][1]?.body,
      calls[0][1]?.body,
    ]);
    expect(JSON.parse(String(calls[0][1]?.body))).toMatchObject({
      call_id: record.callId,
      user_id: record.userId,
      provider_response_id: record.providerResponseId,
    });
    expect(calls[0][1]?.headers).toMatchObject({
      Prefer: "resolution=ignore-duplicates,return=minimal",
    });
  });

  it("does not retry a permanent client error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const delay = vi.fn();

    await expect(persistUsageRecordToSupabase(record, {
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
      delay,
    })).rejects.toThrow("AI Usage Record insert failed");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
});
