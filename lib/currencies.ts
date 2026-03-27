export const SUPPORTED_CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "AUD",
  "CAD",
  "SGD",
  "JPY",
  "CNY",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
