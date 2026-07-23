export type MealSlot = "Monday · breakfast";

export interface PlanSnapshot {
  id: string;
  revision: number;
  label: string;
  generationLocked: boolean;
  busySlots: MealSlot[];
}

type Authority =
  | { kind: "checking"; cachedPlan: PlanSnapshot | null }
  | { kind: "confirmed-empty" }
  | { kind: "confirmed-plan"; plan: PlanSnapshot }
  | { kind: "unavailable"; cachedPlan: PlanSnapshot | null; message: string };

type Connection = "connecting" | "live" | "disconnected" | "refreshing";
type Operation = "initial generation" | "Next Weekly Plan" | "Meal Reroll" | "ingredient change" | "Start Over";
type CommandStatus = "submitting" | "in progress" | "outcome unknown";

interface PendingCommand {
  operation: Operation;
  commandId: string;
  status: CommandStatus;
  slot?: MealSlot;
}

export interface ClientState {
  authority: Authority;
  connection: Connection;
  invalidated: boolean;
  pending: PendingCommand | null;
  notice: string | null;
}

export type Event =
  | { type: "restart"; cachedPlan?: PlanSnapshot }
  | { type: "load_plan"; plan: PlanSnapshot }
  | { type: "load_empty" }
  | { type: "load_failed"; message: string }
  | { type: "realtime_invalidated" }
  | { type: "disconnect" }
  | { type: "reconnect" }
  | { type: "begin"; operation: Operation; commandId: string; slot?: MealSlot }
  | { type: "command_in_progress" }
  | { type: "transport_failed" }
  | { type: "retry_same_command" }
  | { type: "command_succeeded"; plan: PlanSnapshot | null }
  | { type: "command_failed"; message: string }
  | { type: "stale_conflict" };

export const samplePlan = (overrides: Partial<PlanSnapshot> = {}): PlanSnapshot => ({
  id: "plan-A",
  revision: 4,
  label: "Current week · Plan A",
  generationLocked: false,
  busySlots: [],
  ...overrides,
});

export const initialState = (cachedPlan: PlanSnapshot | null = null): ClientState => ({
  authority: { kind: "checking", cachedPlan },
  connection: "connecting",
  invalidated: cachedPlan !== null,
  pending: null,
  notice: cachedPlan
    ? "Showing a cached snapshot while the authoritative plan loads."
    : "Checking for the authoritative Current Weekly Plan.",
});

const visiblePlan = (state: ClientState): PlanSnapshot | null => {
  if (state.authority.kind === "confirmed-plan") return state.authority.plan;
  if (state.authority.kind === "checking" || state.authority.kind === "unavailable") {
    return state.authority.cachedPlan;
  }
  return null;
};

const isSynchronized = (state: ClientState) =>
  state.authority.kind === "confirmed-plan" &&
  state.connection === "live" &&
  !state.invalidated;

const canBegin = (state: ClientState, operation: Operation) => {
  if (state.pending || state.connection !== "live" || state.invalidated) return false;

  if (operation === "initial generation") {
    return state.authority.kind === "confirmed-empty";
  }

  if (state.authority.kind !== "confirmed-plan") return false;
  const plan = state.authority.plan;
  if (plan.generationLocked) return false;

  if (operation === "Next Weekly Plan" || operation === "Start Over") {
    return plan.busySlots.length === 0;
  }

  return operation === "Meal Reroll" || operation === "ingredient change";
};

export function reduceClientState(state: ClientState, event: Event): ClientState {
  switch (event.type) {
    case "restart":
      return initialState(event.cachedPlan ?? null);

    case "load_plan":
      return {
        ...state,
        authority: { kind: "confirmed-plan", plan: event.plan },
        connection: "live",
        invalidated: false,
        notice: event.plan.generationLocked
          ? "Another device is generating the Next Weekly Plan. This plan stays visible and read-only."
          : "This device is synchronized with the authoritative Current Weekly Plan.",
      };

    case "load_empty":
      return {
        ...state,
        authority: { kind: "confirmed-empty" },
        connection: "live",
        invalidated: false,
        notice: state.pending?.operation === "initial generation"
          ? "No plan row exists yet, but the existing generation command is still pending."
          : "The server confirmed that no Current Weekly Plan exists.",
      };

    case "load_failed":
      return {
        ...state,
        authority: {
          kind: "unavailable",
          cachedPlan: visiblePlan(state),
          message: event.message,
        },
        connection: "disconnected",
        invalidated: true,
        notice: "Loading failed. Retry loading; never interpret this as an empty account.",
      };

    case "realtime_invalidated":
      if (state.authority.kind === "checking") return state;
      return {
        ...state,
        connection: "refreshing",
        invalidated: true,
        notice: "A live change was detected. Keep the snapshot visible but read-only while refetching authority.",
      };

    case "disconnect":
      return {
        ...state,
        connection: "disconnected",
        invalidated: true,
        notice: "Live synchronization is unavailable. The visible snapshot may be stale; reload to recover.",
      };

    case "reconnect":
      return {
        ...state,
        connection: "refreshing",
        invalidated: true,
        notice: "Connection restored. Refetching the authoritative row before enabling mutations.",
      };

    case "begin":
      if (!canBegin(state, event.operation)) {
        return {
          ...state,
          notice: event.operation === "initial generation"
            ? "Blocked: generation requires a successful, confirmed-empty load."
            : "Blocked: synchronize first, wait for the active command, or wait for the server lock to clear.",
        };
      }
      return {
        ...state,
        pending: {
          operation: event.operation,
          commandId: event.commandId,
          status: "submitting",
          slot: event.slot,
        },
        notice: event.operation === "Next Weekly Plan"
          ? "Keep the Current Weekly Plan visible while the successor is generated."
          : `${event.operation} submitted with a durable command identity.`,
      };

    case "command_in_progress":
      if (!state.pending) return state;
      return {
        ...state,
        pending: { ...state.pending, status: "in progress" },
        notice: "The server confirms this command is already running. Do not start another.",
      };

    case "transport_failed":
      if (!state.pending) return state;
      return {
        ...state,
        pending: { ...state.pending, status: "outcome unknown" },
        notice: `Outcome unknown. Retry ${state.pending.commandId}; do not create a new command ID.`,
      };

    case "retry_same_command":
      if (!state.pending || state.pending.status !== "outcome unknown") return state;
      return {
        ...state,
        pending: { ...state.pending, status: "submitting" },
        notice: `Retrying the same durable command: ${state.pending.commandId}.`,
      };

    case "command_succeeded":
      return {
        ...state,
        authority: event.plan
          ? { kind: "confirmed-plan", plan: event.plan }
          : { kind: "confirmed-empty" },
        invalidated: false,
        pending: null,
        notice: event.plan
          ? "The initiating mutation response supplied the new authoritative row; Realtime is only for other devices."
          : "The server confirmed there is no Current Weekly Plan.",
      };

    case "command_failed":
      return {
        ...state,
        pending: null,
        notice: `${event.message} Existing authoritative content remains unchanged. A user Try Again must use a new command ID.`,
      };

    case "stale_conflict":
      return {
        ...state,
        pending: null,
        connection: "refreshing",
        invalidated: true,
        notice: "The server rejected stale intent. Refetch the authoritative Current Weekly Plan before another action.",
      };
  }
}

export interface Presentation {
  screen: "loading" | "confirmed empty" | "Current Weekly Plan" | "stale snapshot" | "load failure";
  plan: PlanSnapshot | null;
  badge: string;
  permitted: string[];
}

export function present(state: ClientState): Presentation {
  const plan = visiblePlan(state);
  let screen: Presentation["screen"];

  if (state.authority.kind === "checking") screen = plan ? "stale snapshot" : "loading";
  else if (state.authority.kind === "confirmed-empty") screen = "confirmed empty";
  else if (state.authority.kind === "unavailable") screen = plan ? "stale snapshot" : "load failure";
  else screen = isSynchronized(state) ? "Current Weekly Plan" : "stale snapshot";

  const permitted = ["retry/reload"];
  if (!state.pending) {
    if (canBegin(state, "initial generation")) permitted.push("generate initial plan");
    if (canBegin(state, "Next Weekly Plan")) permitted.push("generate Next Weekly Plan");
    if (canBegin(state, "Meal Reroll")) permitted.push("reroll a Meal Slot");
    if (canBegin(state, "ingredient change")) permitted.push("set ingredient progress");
    if (canBegin(state, "Start Over")) permitted.push("Start Over");
  } else if (state.pending.status === "outcome unknown") {
    permitted.push(`retry ${state.pending.commandId}`);
  }

  return {
    screen,
    plan,
    badge: state.pending
      ? `${state.pending.operation}: ${state.pending.status} (${state.pending.commandId})`
      : state.connection,
    permitted,
  };
}
