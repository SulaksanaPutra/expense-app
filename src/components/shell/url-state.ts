export const ALL_GROUPS_VALUE = "all";

const CYCLE_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidCycleSlug(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && CYCLE_REGEX.test(value);
}

export function formatCycleSlug(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getCurrentCycleSlug(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function parseCycleParam(
  raw: string | null | undefined,
  fallback?: string,
): string {
  if (isValidCycleSlug(raw)) {
    return raw;
  }
  if (isValidCycleSlug(fallback)) {
    return fallback;
  }
  return getCurrentCycleSlug();
}

export function parseGroupParam(
  raw: string | null | undefined,
  availableGroupIds?: string[],
): string {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === ALL_GROUPS_VALUE) {
    return ALL_GROUPS_VALUE;
  }
  if (availableGroupIds && availableGroupIds.length > 0) {
    return availableGroupIds.includes(trimmed) ? trimmed : ALL_GROUPS_VALUE;
  }
  return trimmed;
}

export function stepCycleSlug(cycle: string, deltaMonths: number): string {
  const safe = parseCycleParam(cycle);
  const [yearStr, monthStr] = safe.split("-");
  const year = Number.parseInt(yearStr, 10);
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  const stepped = new Date(Date.UTC(year, monthIdx + deltaMonths, 1));
  return formatCycleSlug(stepped);
}

export function formatCycleLabel(
  cycle: string,
  monthFormat: "long" | "short" = "long",
): string {
  const safe = parseCycleParam(cycle);
  const [yearStr, monthStr] = safe.split("-");
  const year = Number.parseInt(yearStr, 10);
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  const date = new Date(Date.UTC(year, monthIdx, 1));

  return new Intl.DateTimeFormat("en-US", {
    month: monthFormat,
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export interface CycleOption {
  value: string;
  label: string;
}

export function getCyclePickerOptions(
  activeCycle: string,
  monthsBack = 11,
  monthsForward = 1,
): CycleOption[] {
  const current = getCurrentCycleSlug();
  const safeActive = parseCycleParam(activeCycle);
  const optionsMap = new Map<string, CycleOption>();

  for (let offset = monthsForward; offset >= -monthsBack; offset -= 1) {
    const slug = stepCycleSlug(current, offset);
    optionsMap.set(slug, {
      value: slug,
      label: formatCycleLabel(slug, "long"),
    });
  }

  for (let offset = 3; offset >= -3; offset -= 1) {
    const slug = stepCycleSlug(safeActive, offset);
    if (!optionsMap.has(slug)) {
      optionsMap.set(slug, {
        value: slug,
        label: formatCycleLabel(slug, "long"),
      });
    }
  }

  return Array.from(optionsMap.values()).sort((a, b) =>
    b.value.localeCompare(a.value),
  );
}

export interface ShellQueryState {
  group?: string | null;
  cycle?: string | null;
}

export function buildShellHref(
  pathname: string,
  state: ShellQueryState,
  extraParams?: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams();

  if (state.group) {
    params.set("group", state.group);
  }
  if (state.cycle && isValidCycleSlug(state.cycle)) {
    params.set("cycle", state.cycle);
  }

  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value === null || value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function mergeShellSearchParams(
  pathname: string,
  currentSearchParams: URLSearchParams | string,
  updates: ShellQueryState,
): string {
  const params = new URLSearchParams(
    typeof currentSearchParams === "string"
      ? currentSearchParams
      : currentSearchParams.toString(),
  );

  if (updates.group !== undefined) {
    if (updates.group) {
      params.set("group", updates.group);
    } else {
      params.delete("group");
    }
  }

  if (updates.cycle !== undefined) {
    if (updates.cycle && isValidCycleSlug(updates.cycle)) {
      params.set("cycle", updates.cycle);
    } else {
      params.delete("cycle");
    }
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
