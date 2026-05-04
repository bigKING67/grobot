import {
  sanitizeTerminalDisplayText,
  sanitizeTerminalTitle,
} from "../../cli/tui/terminal/text-sanitizer";

const ansiInjected = "Hi\u001B[31mRED\u001B[0m\u001B]0;pwnd\u0007!";
const bidiInjected = "abc\u202Edef\u202Cghi";
const controlInjected = "line1\nline2\tok\u0000";
const titleInjected = "  Session \u001B[31mcritical\u001B[0m   \u202Ename\u202C ";

const sanitizedAnsi = sanitizeTerminalDisplayText(ansiInjected);
const sanitizedBidi = sanitizeTerminalDisplayText(bidiInjected);
const sanitizedControl = sanitizeTerminalDisplayText(controlInjected);
const sanitizedTitle = sanitizeTerminalTitle(titleInjected, 32);
const truncatedTitle = sanitizeTerminalTitle("1234567890", 6);

const payload = {
  ansi_sequences_removed:
    sanitizedAnsi === "HiRED!"
    && sanitizedAnsi.includes("\u001B") === false,
  bidi_controls_removed:
    sanitizedBidi === "abcdefghi"
    && sanitizedBidi.includes("\u202E") === false
    && sanitizedBidi.includes("\u202C") === false,
  control_chars_removed:
    sanitizedControl === "line1line2ok"
    && /[\u0000-\u001f\u007f]/.test(sanitizedControl) === false,
  title_compacted_and_sanitized:
    sanitizedTitle === "Session critical name",
  title_truncation_uses_ellipsis:
    truncatedTitle === "123...",
  title_zero_budget_empty:
    sanitizeTerminalTitle("demo", 0) === "",
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
