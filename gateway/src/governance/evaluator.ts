import { GovernanceEvaluation, ShadowComparison, TurnVerificationResult } from "../types";

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function evaluateTurnGovernance(
  verification: TurnVerificationResult,
  shadowComparison: ShadowComparison | undefined,
): GovernanceEvaluation {
  const reasons: string[] = [];
  let score = verification.pass ? 0.7 : 0.2;

  if (!verification.pass) {
    reasons.push("verification_failed");
  } else {
    reasons.push("verification_passed");
  }

  if (shadowComparison) {
    if (shadowComparison.assistantMessageMatch) {
      score += 0.2;
      reasons.push("shadow_message_match");
    } else {
      score -= 0.2;
      reasons.push("shadow_message_mismatch");
    }
    if (shadowComparison.eventCountDelta <= 1) {
      score += 0.1;
      reasons.push("shadow_event_delta_small");
    } else {
      score -= 0.1;
      reasons.push("shadow_event_delta_large");
    }
  } else {
    reasons.push("shadow_not_enabled");
  }

  const normalizedScore = clampScore(score);
  if (!verification.pass || normalizedScore < 0.5) {
    return {
      plane: "governance.v1",
      decision: "block",
      score: normalizedScore,
      gatePassed: false,
      reasons,
      suggestedAction: "manual_review",
    };
  }
  if (normalizedScore < 0.75) {
    return {
      plane: "governance.v1",
      decision: "review",
      score: normalizedScore,
      gatePassed: true,
      reasons,
      suggestedAction: "manual_review",
    };
  }
  return {
    plane: "governance.v1",
    decision: "pass",
    score: normalizedScore,
    gatePassed: true,
    reasons,
    suggestedAction: "none",
  };
}
