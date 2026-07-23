import { createInterface } from "node:readline";
import {
  initialState,
  present,
  reduceClientState,
  samplePlan,
  type ClientState,
  type Event,
} from "./stateMachine.ts";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";
const slot = "Monday · breakfast" as const;

let state: ClientState = initialState();
let commandSequence = 0;
let successorSequence = 0;

const nextCommandId = () => `cmd-${String(++commandSequence).padStart(3, "0")}`;

function successPlan(): ReturnType<typeof samplePlan> | null {
  const pending = state.pending;
  const current = present(state).plan;
  if (!pending) return current;

  if (pending.operation === "Start Over") return null;
  if (pending.operation === "initial generation") {
    return samplePlan({ id: "plan-A", revision: 0, label: "Generated current week" });
  }
  if (pending.operation === "Next Weekly Plan") {
    successorSequence += 1;
    return samplePlan({
      id: `plan-next-${successorSequence}`,
      revision: 0,
      label: `Successor week ${successorSequence}`,
    });
  }
  if (!current) return samplePlan({ revision: 0 });

  return {
    ...current,
    revision: current.revision + 1,
    busySlots: [],
    label: pending.operation === "Meal Reroll"
      ? `${current.label} · breakfast rerolled`
      : `${current.label} · ingredient progress saved`,
  };
}

const dispatch = (event: Event) => {
  state = reduceClientState(state, event);
};

function render() {
  console.clear();
  const view = present(state);
  const authority = state.authority.kind === "confirmed-plan"
    ? `confirmed plan ${state.authority.plan.id}@${state.authority.plan.revision}`
    : state.authority.kind;

  console.log(`${bold}PROTOTYPE — authoritative Current Weekly Plan client${reset}`);
  console.log(`${dim}Drive one browser/device through load, live-sync, and command outcomes.${reset}\n`);
  console.log(`${bold}Client state${reset}`);
  console.log(`${bold}authority:${reset}   ${authority}`);
  console.log(`${bold}connection:${reset}  ${state.connection}`);
  console.log(`${bold}invalidated:${reset} ${state.invalidated}`);
  console.log(`${bold}pending:${reset}     ${state.pending ? JSON.stringify(state.pending) : "none"}`);
  console.log(`${bold}notice:${reset}      ${state.notice ?? "none"}\n`);
  console.log(`${bold}Presentation${reset}`);
  console.log(`${bold}screen:${reset}      ${view.screen}`);
  console.log(`${bold}plan:${reset}        ${view.plan ? `${view.plan.label} (${view.plan.id}@${view.plan.revision})` : "none"}`);
  console.log(`${bold}badge:${reset}       ${view.badge}`);
  console.log(`${bold}permitted:${reset}   ${view.permitted.join(", ")}\n`);
  console.log(`${bold}Server/load events${reset}`);
  console.log(`${bold}p${reset}${dim} plan loaded${reset}  ${bold}e${reset}${dim} confirmed empty${reset}  ${bold}f${reset}${dim} load fails${reset}  ${bold}v${reset}${dim} live invalidation${reset}`);
  console.log(`${bold}d${reset}${dim} disconnect${reset}   ${bold}c${reset}${dim} reconnect${reset}       ${bold}u${reset}${dim} refreshed successor${reset}  ${bold}k${reset}${dim} refreshed server lock${reset}`);
  console.log(`${bold}Commands${reset}`);
  console.log(`${bold}g${reset}${dim} initial generation${reset}  ${bold}n${reset}${dim} Next Weekly Plan${reset}  ${bold}r${reset}${dim} Meal Reroll${reset}`);
  console.log(`${bold}i${reset}${dim} ingredient change${reset}   ${bold}z${reset}${dim} Start Over${reset}`);
  console.log(`${bold}Command outcomes${reset}`);
  console.log(`${bold}o${reset}${dim} already in progress${reset}  ${bold}t${reset}${dim} transport unknown${reset}  ${bold}y${reset}${dim} retry same ID${reset}`);
  console.log(`${bold}s${reset}${dim} success${reset}              ${bold}x${reset}${dim} terminal failure${reset}  ${bold}a${reset}${dim} stale conflict${reset}`);
  console.log(`${bold}0${reset}${dim} restart clean${reset}  ${bold}1${reset}${dim} restart with cached plan${reset}  ${bold}q${reset}${dim} quit${reset}`);
}

const handlers: Record<string, () => void> = {
  "0": () => dispatch({ type: "restart" }),
  "1": () => dispatch({ type: "restart", cachedPlan: samplePlan() }),
  p: () => dispatch({ type: "load_plan", plan: samplePlan() }),
  e: () => dispatch({ type: "load_empty" }),
  f: () => dispatch({ type: "load_failed", message: "The authoritative plan could not be loaded." }),
  v: () => dispatch({ type: "realtime_invalidated" }),
  d: () => dispatch({ type: "disconnect" }),
  c: () => dispatch({ type: "reconnect" }),
  u: () => dispatch({
    type: "load_plan",
    plan: samplePlan({
      id: `plan-next-${++successorSequence}`,
      revision: 0,
      label: `Authoritative successor ${successorSequence}`,
    }),
  }),
  k: () => dispatch({
    type: "load_plan",
    plan: samplePlan({ generationLocked: true, label: "Current plan · generation locked" }),
  }),
  g: () => dispatch({ type: "begin", operation: "initial generation", commandId: nextCommandId() }),
  n: () => dispatch({ type: "begin", operation: "Next Weekly Plan", commandId: nextCommandId() }),
  r: () => dispatch({ type: "begin", operation: "Meal Reroll", commandId: nextCommandId(), slot }),
  i: () => dispatch({ type: "begin", operation: "ingredient change", commandId: nextCommandId(), slot }),
  z: () => dispatch({ type: "begin", operation: "Start Over", commandId: nextCommandId() }),
  o: () => dispatch({ type: "command_in_progress" }),
  t: () => dispatch({ type: "transport_failed" }),
  y: () => dispatch({ type: "retry_same_command" }),
  s: () => dispatch({ type: "command_succeeded", plan: successPlan() }),
  x: () => dispatch({ type: "command_failed", message: "The command failed safely." }),
  a: () => dispatch({ type: "stale_conflict" }),
};

const rl = createInterface({ input: process.stdin, output: process.stdout });
process.stdin.setRawMode?.(true);
process.stdin.setEncoding("utf8");
render();

process.stdin.on("data", (key: string) => {
  const normalized = key.trim().toLowerCase().slice(0, 1);
  if (!normalized) return;
  if (normalized === "q" || normalized === "\u0003") {
    process.stdin.setRawMode?.(false);
    rl.close();
    return;
  }
  handlers[normalized]?.();
  render();
});
