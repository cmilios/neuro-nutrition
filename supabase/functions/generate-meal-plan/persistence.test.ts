// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { GenerationRecord } from "./handler";
import {
  createHealthProfilePlanReplacementCommandStore,
  createInitialGenerationCommandStore,
  createMealRerollCommandStore,
  createNextWeeklyPlanCommandStore,
  getWeeklyPlanRolloutState,
  persistUsageRecordToSupabase,
} from "./persistence";

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

describe("Weekly Plan rollout persistence", () => {
  it("reads rollout state with server credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json("authoritative"));

    await expect(getWeeklyPlanRolloutState({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
    })).resolves.toBe("authoritative");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_weekly_plan_rollout_state",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer server-secret",
        }),
      }),
    );
  });
});

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

describe("initial generation command persistence", () => {
  it("routes stale recovery through the dedicated service-only RPC", async () => {
    const outcome = {
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "failed",
      result: null,
      error: {
        code: "provider_outcome_unrecoverable",
        message: "No Current Weekly Plan was committed.",
        retryable: false,
      },
      shouldGenerate: false,
      inputFingerprint: "a".repeat(64),
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(outcome));
    const commandStore = createInitialGenerationCommandStore({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
    });

    await commandStore.recover!({
      commandId: outcome.commandId,
      userId: "00000000-0000-4000-8000-000000000001",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/recover_stale_initial_weekly_plan_generation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_user_id: "00000000-0000-4000-8000-000000000001",
          p_command_id: outcome.commandId,
        }),
      }),
    );
  });

  it("uses separate RPC requests for start and completion transactions", async () => {
    const pending = {
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "in_progress",
      result: null,
      error: null,
      shouldGenerate: true,
    };
    const completed = {
      ...pending,
      status: "succeeded",
      result: { planId: "20000000-0000-4000-8000-000000000001", revision: 0 },
      shouldGenerate: false,
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(pending))
      .mockResolvedValueOnce(Response.json({
        ...pending,
        shouldGenerate: false,
        checkpoint: {
          kind: "success",
          document: { weeklySummary: "complete", days: [] },
          usageRecord: record,
        },
      }))
      .mockResolvedValueOnce(Response.json(completed));
    const commandStore = createInitialGenerationCommandStore({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
    });
    const identity = {
      commandId: pending.commandId,
      userId: "00000000-0000-4000-8000-000000000001",
      inputFingerprint: "a".repeat(64),
    };

    await expect(commandStore.begin(identity)).resolves.toEqual(pending);
    await expect(commandStore.checkpoint({
      ...identity,
      checkpoint: {
        kind: "success",
        document: { weeklySummary: "complete", days: [] },
        usageRecord: record,
      },
    })).resolves.toEqual(expect.objectContaining({
      checkpoint: expect.objectContaining({ kind: "success" }),
    }));
    await expect(commandStore.complete({
      ...identity,
      document: { weeklySummary: "complete", days: [] },
    })).resolves.toEqual(completed);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.supabase.co/rest/v1/rpc/begin_initial_weekly_plan_generation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_user_id: identity.userId,
          p_command_id: identity.commandId,
          p_input_fingerprint: identity.inputFingerprint,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.supabase.co/rest/v1/rpc/checkpoint_initial_weekly_plan_generation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_user_id: identity.userId,
          p_command_id: identity.commandId,
          p_input_fingerprint: identity.inputFingerprint,
          p_checkpoint: {
            kind: "success",
            document: { weeklySummary: "complete", days: [] },
            usageRecord: record,
          },
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://example.supabase.co/rest/v1/rpc/complete_initial_weekly_plan_generation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_user_id: identity.userId,
          p_command_id: identity.commandId,
          p_input_fingerprint: identity.inputFingerprint,
          p_document: { weeklySummary: "complete", days: [] },
        }),
      }),
    );
  });

  it("sends only structured privacy-safe evidence when failing a command", async () => {
    const outcome = {
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "failed",
      result: null,
      error: { code: "generation_failed", message: "Failed.", retryable: false },
      shouldGenerate: false,
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(outcome));
    const commandStore = createInitialGenerationCommandStore({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
    });

    await commandStore.fail({
      commandId: outcome.commandId,
      userId: "00000000-0000-4000-8000-000000000001",
      inputFingerprint: "a".repeat(64),
      errorCode: "generation_failed",
      errorMessage: "Failed.",
      retryable: false,
      evidence: { stage: "provider", providerRequestId: "req_safe" },
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toEqual(expect.objectContaining({
      p_error_code: "generation_failed",
      p_failure_evidence: { stage: "provider", providerRequestId: "req_safe" },
    }));
    expect(JSON.stringify(body)).not.toContain("profile");
    expect(JSON.stringify(body)).not.toContain("ingredient");
  });
});

describe("Next Weekly Plan command persistence", () => {
  it("passes source authority to the begin transaction", async () => {
    const outcome = {
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "in_progress",
      result: null,
      error: null,
      shouldGenerate: true,
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(outcome));
    const commandStore = createNextWeeklyPlanCommandStore({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
    });

    await commandStore.begin({
      commandId: outcome.commandId,
      userId: "00000000-0000-4000-8000-000000000001",
      inputFingerprint: "a".repeat(64),
      sourcePlanId: "20000000-0000-4000-8000-000000000001",
      sourceRevision: 3,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/begin_next_weekly_plan_generation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_user_id: "00000000-0000-4000-8000-000000000001",
          p_command_id: outcome.commandId,
          p_input_fingerprint: "a".repeat(64),
          p_source_plan_id: "20000000-0000-4000-8000-000000000001",
          p_source_revision: 3,
        }),
      }),
    );
  });

  it("routes stale recovery through the dedicated service-only RPC", async () => {
    const outcome = {
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "failed",
      result: null,
      error: { code: "provider_outcome_unrecoverable", retryable: false },
      shouldGenerate: false,
      inputFingerprint: "a".repeat(64),
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(outcome));
    const commandStore = createNextWeeklyPlanCommandStore({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
    });

    await commandStore.recover!({
      commandId: outcome.commandId,
      userId: "00000000-0000-4000-8000-000000000001",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/recover_stale_next_weekly_plan_generation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_user_id: "00000000-0000-4000-8000-000000000001",
          p_command_id: outcome.commandId,
        }),
      }),
    );
  });
});

describe("Meal Reroll command persistence", () => {
  it("routes stale recovery through the dedicated service-only RPC", async () => {
    const outcome = {
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "failed",
      result: null,
      error: { code: "provider_outcome_unrecoverable", retryable: false },
      shouldGenerate: false,
      inputFingerprint: "a".repeat(64),
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(outcome));
    const commandStore = createMealRerollCommandStore({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
    });

    await commandStore.recover!({
      commandId: outcome.commandId,
      userId: "00000000-0000-4000-8000-000000000001",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/recover_stale_meal_reroll",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_user_id: "00000000-0000-4000-8000-000000000001",
          p_command_id: outcome.commandId,
        }),
      }),
    );
  });
});

describe("Health Profile Plan Replacement persistence", () => {
  it("routes stale recovery through the dedicated service-only RPC", async () => {
    const outcome = {
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "in_progress",
      result: null,
      error: null,
      shouldGenerate: false,
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(outcome));
    const commandStore = createHealthProfilePlanReplacementCommandStore({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "server-secret",
      fetchImpl,
    });

    await commandStore.recover!({
      commandId: outcome.commandId,
      userId: "00000000-0000-4000-8000-000000000001",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/recover_stale_health_profile_plan_replacement",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_user_id: "00000000-0000-4000-8000-000000000001",
          p_command_id: outcome.commandId,
        }),
      }),
    );
  });
});
