import {
  dispatchSessionInteractiveInput,
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
} from "../../orchestration/entrypoints/dev-cli/start/session-interactive";

interface DispatchCaseResult {
  action: SessionInteractiveAction;
  events: string[];
}

const controls: SessionInteractiveControls = {
  withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
};

async function runDispatchCase(input: string): Promise<DispatchCaseResult> {
  const events: string[] = [];
  const handlers: SessionInteractiveHandlers = {
    writeStdout: () => {
      events.push("writeStdout");
    },
    showHelp: () => {
      events.push("showHelp");
    },
    showHealthStatus: () => {
      events.push("showHealthStatus");
    },
    showModelCurrent: async () => {
      events.push("showModelCurrent");
    },
    listModels: async () => {
      events.push("listModels");
    },
      useModel: async () => {
        events.push("useModel");
      },
      resetModel: async () => {
        events.push("resetModel");
      },
      openModelMenu: async () => {
        events.push("openModelMenu");
      },
    openSessionMenu: async (mode) => {
      events.push(`openSessionMenu:${mode}`);
    },
    createAndSwitchSession: async () => {
      events.push("createAndSwitchSession");
    },
    switchSession: async () => {
      events.push("switchSession");
    },
    continueFromSession: async () => {
      events.push("continueFromSession");
    },
    writeHandoff: () => {
      events.push("writeHandoff");
    },
    isPlanMode: () => false,
    showPlanStatus: async () => {
      events.push("showPlanStatus");
    },
    enterPlan: async () => {
      events.push("enterPlan");
    },
    applyPlan: async () => {
      events.push("applyPlan");
    },
    cancelPlan: async () => {
      events.push("cancelPlan");
    },
    requestPlanInterrupt: async () => {
      events.push("requestPlanInterrupt");
    },
    requestRuntimeInterrupt: async () => {
      events.push("requestRuntimeInterrupt");
    },
    runPlanTurn: async () => {
      events.push("runPlanTurn");
    },
    runTurn: async (userInput) => {
      events.push(`runTurn:${userInput}`);
    },
    onTurnError: () => {
      events.push("onTurnError");
    },
  };
  const action = await dispatchSessionInteractiveInput(input, controls, handlers);
  return { action, events };
}

function includesEvent(events: readonly string[], target: string): boolean {
  return events.includes(target);
}

async function main(): Promise<void> {
  const switchPrefixMiss = await runDispatchCase("/switcher");
  const continuePrefixMiss = await runDispatchCase("/continue-next");
  const modelPrefixMiss = await runDispatchCase("/models");
  const planPrefixMiss = await runDispatchCase("/planner");
  const switchMenu = await runDispatchCase("/switch");
  const continueMenu = await runDispatchCase("/continue");
  const modelReset = await runDispatchCase("/model reset");
  const interruptCommand = await runDispatchCase("/interrupt");

  const payload = {
    switch_prefix_miss_hits_run_turn: includesEvent(switchPrefixMiss.events, "runTurn:/switcher"),
    switch_prefix_miss_opened_menu: includesEvent(switchPrefixMiss.events, "openSessionMenu:switch"),
    continue_prefix_miss_hits_run_turn: includesEvent(continuePrefixMiss.events, "runTurn:/continue-next"),
    continue_prefix_miss_opened_menu: includesEvent(continuePrefixMiss.events, "openSessionMenu:continue"),
    model_prefix_miss_hits_run_turn: includesEvent(modelPrefixMiss.events, "runTurn:/models"),
    model_prefix_miss_opened_menu: includesEvent(modelPrefixMiss.events, "openModelMenu"),
    plan_prefix_miss_hits_run_turn: includesEvent(planPrefixMiss.events, "runTurn:/planner"),
    plan_prefix_miss_entered_plan: includesEvent(planPrefixMiss.events, "enterPlan"),
    switch_menu_opened: includesEvent(switchMenu.events, "openSessionMenu:switch"),
    continue_menu_opened: includesEvent(continueMenu.events, "openSessionMenu:continue"),
    model_reset_dispatched: includesEvent(modelReset.events, "resetModel"),
    interrupt_dispatched: includesEvent(interruptCommand.events, "requestRuntimeInterrupt"),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
