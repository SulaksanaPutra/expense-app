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

/**
 * Deterministic USD-per-1-unit reference FX rates used for display-only
 * `User.display_currency` rollups when offline or before live FX rates load.
 * Never used to mutate group ledger records (each group ledger remains strictly
 * in `Group.base_currency`).
 */
export const DEFAULT_USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  EUR: 1.085,
  GBP: 1.27,
  CAD: 0.725,
  AUD: 0.655,
  CHF: 1.135,
  JPY: 0.006667,
};

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

/**
 * Returns the deterministic fallback FX rate (units of `to` per 1 unit of `from`).
 */
export function getFallbackFxRate(from: string, to: string): number {
  const normFrom = from.trim().toUpperCase();
  const normTo = to.trim().toUpperCase();
  if (normFrom === normTo) return 1;
  const fromUsd = DEFAULT_USD_PER_UNIT[normFrom] ?? 1;
  const toUsd = DEFAULT_USD_PER_UNIT[normTo] ?? 1;
  return Number((fromUsd / toUsd).toFixed(6));
}

/**
 * Converts integer minor units from `fromCurrency` into `toCurrency` for
 * display-only rollup (e.g. All Groups KPIs and Monthly Category Breakdown).
 *
 * - Identity when `fromCurrency === toCurrency` (zero drift).
 * - Accounts for differing minor digits (e.g. JPY 0 digits vs USD 2 digits).
 * - Accepts an optional `fxRatesToTarget` map keyed by source currency code
 *   (e.g. `{ EUR: 1.085, GBP: 1.27 }`), falling back to `getFallbackFxRate`.
 */
export function convertMinorUnitsToCurrency(
  minorUnits: number,
  fromCurrency: string,
  toCurrency: string,
  fxRatesToTarget?: Readonly<Record<string, number>>,
): number {
  if (!Number.isFinite(minorUnits)) return 0;
  const truncated = Math.trunc(minorUnits);
  const normFrom = fromCurrency.trim().toUpperCase();
  const normTo = toCurrency.trim().toUpperCase();
  if (truncated === 0 || normFrom === normTo) {
    return truncated === 0 ? 0 : truncated;
  }

  const suppliedRate = fxRatesToTarget?.[normFrom];
  const rate =
    typeof suppliedRate === "number" &&
    Number.isFinite(suppliedRate) &&
    suppliedRate > 0
      ? suppliedRate
      : getFallbackFxRate(normFrom, normTo);

  const fromDigits = getCurrencyMinorDigits(normFrom);
  const toDigits = getCurrencyMinorDigits(normTo);
  const fromScale = 10 ** fromDigits;
  const toScale = 10 ** toDigits;

  const sign = truncated < 0 ? -1 : 1;
  const absMinor = Math.abs(truncated);
  const convertedAbs = Math.round((absMinor / fromScale) * rate * toScale);
  if (convertedAbs === 0) return 0;
  return sign * convertedAbs;
}

export interface FormatMinorUnitsOptions {
  showPlus?: boolean;
  absolute?: boolean;
}

function toSafeBigIntMinorUnits(minorUnits: number | bigint): bigint {
  if (typeof minorUnits === "bigint") return minorUnits;
  if (!Number.isFinite(minorUnits)) return BigInt(0);
  return BigInt(Math.trunc(minorUnits));
}

/**
 * Formats integer minor units into an exact decimal string (e.g. 18250 USD -> "182.50",
 * 1500 JPY -> "1500") using BigInt string arithmetic with zero IEEE 754 float drift.
 */
export function formatMinorUnitsDecimal(
  minorUnits: number | bigint,
  currency = "USD",
  options: FormatMinorUnitsOptions = {},
): string {
  const zero = BigInt(0);
  const safeUnits = toSafeBigIntMinorUnits(minorUnits);
  const normalizedCurrency = isValidCurrencyCode(currency.toUpperCase())
    ? currency.toUpperCase()
    : "USD";
  const digits = getCurrencyMinorDigits(normalizedCurrency);

  const isNegative = safeUnits < zero && !options.absolute;
  const absUnits = safeUnits < zero ? -safeUnits : safeUnits;

  let unsignedDecimal: string;
  if (digits === 0) {
    unsignedDecimal = absUnits.toString();
  } else {
    const raw = absUnits.toString().padStart(digits + 1, "0");
    const whole = raw.slice(0, -digits);
    const frac = raw.slice(-digits);
    unsignedDecimal = `${whole}.${frac}`;
  }

  if (isNegative) {
    return `-${unsignedDecimal}`;
  }
  if (options.showPlus && safeUnits > zero) {
    return `+${unsignedDecimal}`;
  }
  return unsignedDecimal;
}

export function formatMinorUnits(
  minorUnits: number | bigint,
  currency = "USD",
  options: FormatMinorUnitsOptions = {},
): string {
  const zero = BigInt(0);
  const safeUnits = toSafeBigIntMinorUnits(minorUnits);
  const normalizedCurrency = isValidCurrencyCode(currency.toUpperCase())
    ? currency.toUpperCase()
    : "USD";
  const digits = getCurrencyMinorDigits(normalizedCurrency);
  const isNegative = safeUnits < zero && !options.absolute;
  const unsignedDecimal = formatMinorUnitsDecimal(safeUnits, normalizedCurrency, {
    absolute: true,
  });

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(unsignedDecimal as unknown as number);
  } catch {
    formatted = `$${unsignedDecimal}`;
  }

  if (isNegative) {
    return `-${formatted}`;
  }
  if (options.showPlus && safeUnits > zero) {
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

/**
 * Parses a signed decimal currency string (e.g. "-25.50" or "25.50") into
 * integer minor units for offsetting adjustments.
 */
export function parseSignedCurrencyInputToMinorUnits(
  raw: string,
  currency = "USD",
): number | null {
  const cleaned = raw.trim().replaceAll(",", "").replaceAll(" ", "");
  if (!cleaned) return null;

  const isNegative = cleaned.startsWith("-");
  const unsigned = isNegative || cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  const minor = parseCurrencyInputToMinorUnits(unsigned, currency);
  if (minor === null) return null;
  if (minor === 0) return 0;
  return isNegative ? -minor : minor;
}
