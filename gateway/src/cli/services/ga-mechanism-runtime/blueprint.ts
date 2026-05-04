import { type GaEvidenceRef } from "./contract";
import { collectDomainHints } from "./signature";
import { cleanText } from "./utils";

export function buildAskUserHintPrompt(input: {
  reason: string;
  userText: string;
}): string {
  return [
    "[AskUser Tool Hint]",
    `reason=${input.reason}`,
    `user_input=${cleanText(input.userText).slice(0, 160)}`,
    "If critical constraints are still missing, call ask_user exactly once.",
    "Question must be specific and unblock a single next action.",
    "Keep options <= 3 and avoid open-ended prompts unless necessary.",
  ].join("\n");
}

export function buildSkillCardBlueprint(input: {
  userText: string;
  assistantText: string;
}): {
  preconditions: string[];
  steps: string[];
  failureSignals: string[];
  rollback: string[];
} {
  const cleanedUserText = cleanText(input.userText).toLowerCase();
  const cleanedAssistantText = cleanText(input.assistantText).toLowerCase();
  const domains = collectDomainHints(`${cleanedUserText} ${cleanedAssistantText}`);
  const primaryDomain = domains[0];
  const loginIntent = /(登录|登入|login|sign[ -]?in|账号|密码)/i.test(cleanedUserText);
  const agreementSignal = /(勾选|同意|checkbox|agree)/i.test(`${cleanedUserText} ${cleanedAssistantText}`);

  const preconditions = [
    "same runtime environment",
    "same tool policy",
  ];
  if (primaryDomain) {
    preconditions.push(`target domain matches ${primaryDomain}`);
  }

  if (loginIntent) {
    const steps = [
      `Open target login page${primaryDomain ? ` on ${primaryDomain}` : ""} and pin active session`,
      "Fill username/password fields using secure input path",
    ];
    if (agreementSignal) {
      steps.push("Ensure required agreement checkbox is checked before submit");
    }
    steps.push("Submit login and verify authenticated state via URL/title/content checks");
    return {
      preconditions,
      steps,
      failureSignals: [
        "still on login page after submit",
        "captcha or risk challenge appears",
        "required checkbox/agreement is not satisfied",
      ],
      rollback: [
        "fallback to previous verified strategy",
        "request user confirmation for captcha/risk-control step",
      ],
    };
  }

  return {
    preconditions,
    steps: [
      `Interpret user goal: ${cleanText(input.userText).slice(0, 120)}`,
      "Execute minimal tool chain and verify outcome",
      "Return concise summary with evidence",
    ],
    failureSignals: [
      "verification failed",
      "runtime provider repeated errors",
    ],
    rollback: [
      "fallback to previous verified strategy",
      "request user clarification if constraints changed",
    ],
  };
}

export function providerEvidenceRef(traceId: string | undefined, providerName: string): GaEvidenceRef {
  return {
    traceId,
    source: `provider:${providerName}`,
  };
}
