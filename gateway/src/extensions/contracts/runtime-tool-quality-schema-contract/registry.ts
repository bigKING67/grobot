import { resolveRuntimeToolQualitySignalFromRegistry } from "../../../cli/status/runtime-tool-quality-registry";
import {
  expect,
  expectThrowsIncludes,
  isObject,
} from "./assertions";

export type RuntimeToolQualitySurface = "status" | "release";

export interface RegistryReasonEntry {
  reason: string;
  surfaces: RuntimeToolQualitySurface[];
  actionFamily: string;
  priorityBySurface: Record<RuntimeToolQualitySurface, number>;
}

export interface RegistryActionEntry {
  action: string;
  reasons: string[];
  defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
}

export interface ResolvedFixtureSignal {
  actionReason: string;
  actionFamily: string;
  actionRequired: string;
  defaultNextStep: string | null;
  priority: number;
}

export function registryReasonEntries(value: unknown, label: string): RegistryReasonEntry[] {
  expect(Array.isArray(value), `${label} must be array`);
  return value.map((item, index) => {
    expect(isObject(item), `${label}[${String(index)}] must be object`);
    expect(typeof item.reason === "string", `${label}[${String(index)}].reason must be string`);
    expect(Array.isArray(item.surfaces), `${label}[${String(index)}].surfaces must be array`);
    const surfaces: RuntimeToolQualitySurface[] = item.surfaces.map((surface, surfaceIndex): RuntimeToolQualitySurface => {
      expect(
        surface === "status" || surface === "release",
        `${label}[${String(index)}].surfaces[${String(surfaceIndex)}] must be status or release`,
      );
      return surface;
    });
    expect(typeof item.action_family === "string", `${label}[${String(index)}].action_family must be string`);
    expect(isObject(item.priority_by_surface), `${label}[${String(index)}].priority_by_surface must be object`);
    const priorityBySurface = {} as Record<RuntimeToolQualitySurface, number>;
    for (const surface of surfaces) {
      const priority = item.priority_by_surface[surface];
      expect(
        typeof priority === "number" && Number.isInteger(priority) && priority > 0,
        `${label}[${String(index)}].priority_by_surface.${surface} must be positive integer`,
      );
      priorityBySurface[surface] = priority;
    }
    return {
      reason: item.reason,
      surfaces,
      actionFamily: item.action_family,
      priorityBySurface,
    };
  });
}

export function registryReasonsForSurface(
  entries: readonly { reason: string; surfaces: readonly RuntimeToolQualitySurface[] }[],
  surface: RuntimeToolQualitySurface,
): string[] {
  return entries
    .filter((entry) => entry.surfaces.includes(surface))
    .map((entry) => entry.reason);
}

export function registryActionFamilies(value: unknown): string[] {
  expect(Array.isArray(value), "action_families must be array");
  return value.map((item, index) => {
    expect(isObject(item), `action_families[${String(index)}] must be object`);
    expect(typeof item.family === "string", `action_families[${String(index)}].family must be string`);
    return item.family;
  });
}

export function registryActions(value: unknown): RegistryActionEntry[] {
  expect(Array.isArray(value), "action_required must be array");
  return value.map((item, index) => {
    expect(isObject(item), `action_required[${String(index)}] must be object`);
    expect(typeof item.action === "string", `action_required[${String(index)}].action must be string`);
    expect(Array.isArray(item.reasons), `action_required[${String(index)}].reasons must be array`);
    expect(
      isObject(item.default_next_step),
      `action_required[${String(index)}].default_next_step must be object`,
    );
    const reasons = item.reasons.map((reason, reasonIndex) => {
      expect(
        typeof reason === "string",
        `action_required[${String(index)}].reasons[${String(reasonIndex)}] must be string`,
      );
      return reason;
    });
    const defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>> = {};
    for (const [surface, nextStep] of Object.entries(item.default_next_step)) {
      expect(
        surface === "status" || surface === "release",
        `action_required[${String(index)}].default_next_step surface must be status or release: ${surface}`,
      );
      expect(
        typeof nextStep === "string" && nextStep.trim().length > 0,
        `action_required[${String(index)}].default_next_step.${surface} must be non-empty string`,
      );
      defaultNextStep[surface] = nextStep;
    }
    expect(reasons.length > 0, `action_required[${String(index)}].reasons must not be empty`);
    expect(
      Object.keys(defaultNextStep).length > 0,
      `action_required[${String(index)}].default_next_step must not be empty`,
    );
    return {
      action: item.action,
      reasons,
      defaultNextStep,
    };
  });
}

export function actionRegistryByReason(
  actions: readonly RegistryActionEntry[],
): ReadonlyMap<string, {
  action: string;
  defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
}> {
  const byReason = new Map<string, {
    action: string;
    defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
  }>();
  for (const action of actions) {
    for (const reason of action.reasons) {
      byReason.set(reason, {
        action: action.action,
        defaultNextStep: action.defaultNextStep,
      });
    }
  }
  return byReason;
}

export function resolveFixtureSignal(input: {
  reasons: readonly string[];
  surface: RuntimeToolQualitySurface;
  actionByReason: ReadonlyMap<string, {
    action: string;
    defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
  }>;
  reasonByReason: ReadonlyMap<string, {
    actionFamily: string;
    priorityBySurface: Record<RuntimeToolQualitySurface, number>;
  }>;
}): ResolvedFixtureSignal | null {
  const candidates: ResolvedFixtureSignal[] = [];
  for (const reason of input.reasons) {
    const reasonEntry = input.reasonByReason.get(reason);
    expect(reasonEntry !== undefined, `priority fixture reason must exist: ${reason}`);
    const priority = reasonEntry.priorityBySurface[input.surface];
    expect(
      typeof priority === "number" && Number.isInteger(priority) && priority > 0,
      `priority fixture reason must define priority_by_surface.${input.surface}: ${reason}`,
    );
    const actionEntry = input.actionByReason.get(reason);
    expect(actionEntry !== undefined, `priority fixture reason must map to action_required: ${reason}`);
    candidates.push({
      actionReason: reason,
      actionFamily: reasonEntry.actionFamily,
      actionRequired: actionEntry.action,
      defaultNextStep: actionEntry.defaultNextStep[input.surface] ?? null,
      priority,
    });
  }
  return candidates.sort((left, right) => (
    left.priority - right.priority || left.actionReason.localeCompare(right.actionReason)
  ))[0] ?? null;
}

export function expectProductionSignalMatchesFixture(input: {
  expected: ResolvedFixtureSignal;
  reasons: readonly string[];
  surface: RuntimeToolQualitySurface;
  label: string;
}): void {
  const actual = resolveRuntimeToolQualitySignalFromRegistry({
    actionReasons: input.reasons,
    surface: input.surface,
  });
  expect(actual !== null, `${input.label} production resolver must resolve a decisive signal`);
  expect(
    actual.actionReason === input.expected.actionReason,
    `${input.label} production resolver actionReason must match registry fixture`,
  );
  expect(
    actual.actionFamily === input.expected.actionFamily,
    `${input.label} production resolver actionFamily must match registry fixture`,
  );
  expect(
    actual.actionRequired === input.expected.actionRequired,
    `${input.label} production resolver actionRequired must match registry fixture`,
  );
  expect(
    actual.defaultNextStep === input.expected.defaultNextStep,
    `${input.label} production resolver defaultNextStep must match registry fixture`,
  );
  expect(
    actual.priority === input.expected.priority,
    `${input.label} production resolver priority must match registry fixture`,
  );
}

export function expectProductionResolverFailures(): void {
  expectThrowsIncludes(
    () => {
      resolveRuntimeToolQualitySignalFromRegistry({
        actionReasons: ["unknown_runtime_tool_quality_reason"],
        surface: "status",
      });
    },
    "runtime_tool_quality_registry_reason_unmapped:unknown_runtime_tool_quality_reason",
    "production resolver must fail fast for unknown action reasons",
  );
  expectThrowsIncludes(
    () => {
      resolveRuntimeToolQualitySignalFromRegistry({
        actionReasons: ["runtime_health_failed"],
        surface: "release",
      });
    },
    "runtime_tool_quality_registry_reason_surface_unmapped:runtime_health_failed:release",
    "production resolver must fail fast for wrong-surface action reasons",
  );
}
