export type AlertToneClass = "inline-alert-success" | "inline-alert-warning" | "inline-alert-danger";

export function getAlertTone(message: string): AlertToneClass {
  const lower = message.toLowerCase();

  if (
    lower.includes("could not") ||
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("match") ||
    lower.includes("invalid")
  ) {
    return "inline-alert-danger";
  }

  if (lower.includes("no services") || lower.includes("ask admin") || lower.includes("not available")) {
    return "inline-alert-warning";
  }

  return "inline-alert-success";
}
