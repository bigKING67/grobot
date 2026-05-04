import { reviewPlanContent } from "../../../cli/start/plan-artifact";
import { validPlan } from "./helpers";

export function runReviewContract() {
  const review = reviewPlanContent(validPlan);
  const weakValidationReview = reviewPlanContent(
    validPlan.replace(
      "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/start-plan-mode-contract.ts；预期: exit 0 且所有断言通过。",
      "- 看一下是否正常。",
    ),
  );
  const weakRiskReview = reviewPlanContent(
    validPlan
      .replace("- 风险: 旧帮助文案或 contract 未同步。", "- 风险: 低")
      .replace("- 回退: 恢复精简前 surface 并重新整理说明。", "- 回退: 回滚"),
  );
  const canonicalProposedPlanReview = reviewPlanContent(
    `<proposed_plan>\n${validPlan}\n</proposed_plan>`,
  );

  return {
    review_rejects_validation_without_command:
      !weakValidationReview.ok
      && weakValidationReview.findings.some((item) => item.code === "validation_missing_command"),
    review_rejects_validation_without_expected_result:
      !weakValidationReview.ok
      && weakValidationReview.findings.some((item) => item.code === "validation_missing_expected_result"),
    review_rejects_vague_risk:
      !weakRiskReview.ok
      && weakRiskReview.findings.some((item) => item.code === "risk_too_vague"),
    review_rejects_vague_rollback:
      !weakRiskReview.ok
      && weakRiskReview.findings.some((item) => item.code === "rollback_too_vague"),
    review_accepts_canonical_proposed_plan_block:
      canonicalProposedPlanReview.ok && canonicalProposedPlanReview.blocked === false,
    review_passes_for_valid_plan: review.ok && review.blocked === false,
  };
}
