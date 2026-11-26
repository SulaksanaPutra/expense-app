export interface CurrencyOption {
  code: string;
  label: string;
  symbol: string;
  minorDigits: number;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: "USD", label: "USD — US Dollar ($)", symbol: "$", minorDigits: 2 },
  { code: "EUR", label: "EUR — Euro (€)", symbol: "€", minorDigits: 2 },
  { code: "GBP", label: "GBP — British Pound (£)", symbol: "£", minorDigits: 2 },
  { code: "CAD", label: "CAD — Canadian Dollar (CA$)", symbol: "CA$", minorDigits: 2 },
  { code: "AUD", label: "AUD — Australian Dollar (A$)", symbol: "A$", minorDigits: 2 },
  { code: "CHF", label: "CHF — Swiss Franc (CHF)", symbol: "CHF", minorDigits: 2 },
  { code: "JPY", label: "JPY — Japanese Yen (¥)", symbol: "¥", minorDigits: 0 },
];

const CURRENCY_META_MAP = new Map<string, CurrencyOption>(
  SUPPORTED_CURRENCIES.map((c) => [c.code, c]),
);

export function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

export function getCurrencyMinorDigits(currency = "USD"): number {
  const normalized = currency.toUpperCase();
  const known = CURRENCY_META_MAP.get(normalized);
  if (known) return known.minorDigits;

  try {
    const resolved = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    }).resolvedOptions();
    return resolved.maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function getCurrencySymbol(currency = "USD"): string {
  const normalized = currency.toUpperCase();
  const known = CURRENCY_META_MAP.get(normalized);
  if (known) return known.symbol;

  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? normalized;
  } catch {
    return normalized;
  }
}

export interface FormatMinorUnitsOptions {
  showPlus?: boolean;
  absolute?: boolean;
}

export function formatMinorUnits(
  minorUnits: number,
  currency = "USD",
  options: FormatMinorUnitsOptions = {},
): string {
  const safeUnits = Number.isFinite(minorUnits) ? Math.trunc(minorUnits) : 0;
  const normalizedCurrency = isValidCurrencyCode(currency.toUpperCase())
    ? currency.toUpperCase()
    : "USD";
  const digits = getCurrencyMinorDigits(normalizedCurrency);
  const divisor = 10 ** digits;

  const isNegative = safeUnits < 0 && !options.absolute;
  const absUnits = Math.abs(safeUnits);
  const majorValue = absUnits / divisor;

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(majorValue);
  } catch {
    formatted = `$${majorValue.toFixed(2)}`;
  }

  if (isNegative) {
    return `-${formatted}`;
  }
  if (options.showPlus && safeUnits > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

/**
 * Parses a decimal currency string (e.g. "4500.50") into integer minor units
 * using string arithmetic only (no IEEE 754 floating-point drift).
 * Returns null if the input is invalid, negative, or exceeds decimal precision.
 */
export function parseCurrencyInputToMinorUnits(
  raw: string,
  currency = "USD",
): number | null {
  const cleaned = raw.trim().replaceAll(",", "").replaceAll(" ", "");
  if (!cleaned) return null;

  const digits = getCurrencyMinorDigits(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;

  const wholePart = match[1];
  const fracPart = match[2] ?? "";

  if (digits === 0 && fracPart.length > 0) {
    return null;
  }
  if (fracPart.length > digits) {
    return null;
  }

  const paddedFrac = fracPart.padEnd(digits, "0");
  const combined = `${wholePart}${paddedFrac}`;
  const parsed = Number(combined);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}
