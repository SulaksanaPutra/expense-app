"use client";

import * as React from "react";
import { AlertBanner, Button, Dialog, Input, Select } from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import type { ShellGroupSummary } from "@/components/shell/types";
import type { SplitGroupDetail } from "@/lib/groups/types";
import {
  SUPPORTED_CURRENCIES,
  getCurrencySymbol,
  parseCurrencyInputToMinorUnits,
} from "@/lib/money";
import type { GroupType } from "@/types/database";

const GROUP_TYPE_OPTIONS: SelectOption[] = [
  {
    value: "RESIDENTIAL",
    label: "Primary Residence",
    description: "RESIDENTIAL — Rent, utilities, and household costs",
  },
  {
    value: "TRIP",
    label: "Seasonal Trip",
    description: "TRIP — Travel, lodging, and shared itinerary expenses",
  },
  {
    value: "RECURRING",
    label: "Recurring Flat",
    description: "RECURRING — Clubs, subscriptions, and regular group buys",
  },
];

const CURRENCY_OPTIONS: SelectOption[] = SUPPORTED_CURRENCIES.map((c) => ({
  value: c.code,
  label: c.label,
}));

export interface CreateGroupModalProps {
  open: boolean;
  onClose: () => void;
  defaultCurrency?: string;
  onCreated: (result: {
    group: SplitGroupDetail;
    shellGroup: ShellGroupSummary;
  }) => void;
}

interface FieldErrors {
  name?: string;
  operational_budget?: string;
  billing_cycle_anchor_day?: string;
  lease_end_date?: string;
}

export function CreateGroupModal({
  open,
  onClose,
  defaultCurrency = "USD",
  onCreated,
}: CreateGroupModalProps) {
  const formId = React.useId();

  const [name, setName] = React.useState("");
  const [groupType, setGroupType] = React.useState<GroupType>("RESIDENTIAL");
  const [baseCurrency, setBaseCurrency] = React.useState(defaultCurrency);
  const [budgetInput, setBudgetInput] = React.useState("");
  const [anchorDayInput, setAnchorDayInput] = React.useState("1");
  const [leaseEndDate, setLeaseEndDate] = React.useState("");

  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const budgetInputRef = React.useRef<HTMLInputElement>(null);
  const anchorInputRef = React.useRef<HTMLInputElement>(null);
  const leaseDateInputRef = React.useRef<HTMLInputElement>(null);

  const resetForm = React.useCallback(() => {
    setName("");
    setGroupType("RESIDENTIAL");
    setBaseCurrency(defaultCurrency);
    setBudgetInput("");
    setAnchorDayInput("1");
    setLeaseEndDate("");
    setTouched({});
    setErrors({});
    setServerError(null);
    setIsSubmitting(false);
  }, [defaultCurrency]);

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const validateFields = React.useCallback(
    (values: {
      name: string;
      budgetInput: string;
      baseCurrency: string;
      anchorDayInput: string;
      leaseEndDate: string;
    }): {
      valid: boolean;
      fieldErrors: FieldErrors;
      budgetCents: number | null;
      anchorDay: number;
    } => {
      const nextErrors: FieldErrors = {};

      const trimmedName = values.name.trim();
      if (!trimmedName) {
        nextErrors.name = "Please enter a group name.";
      } else if (trimmedName.length < 2) {
        nextErrors.name = "Group name must be at least 2 characters.";
      } else if (trimmedName.length > 80) {
        nextErrors.name = "Group name must be 80 characters or fewer.";
      }

      let budgetCents: number | null = null;
      if (values.budgetInput.trim() !== "") {
        const parsed = parseCurrencyInputToMinorUnits(
          values.budgetInput,
          values.baseCurrency,
        );
        if (parsed === null) {
          nextErrors.operational_budget =
            "Enter a valid non-negative amount (e.g. 4500.00).";
        } else {
          budgetCents = parsed;
        }
      }

      const trimmedAnchor = values.anchorDayInput.trim();
      const parsedAnchor = Number.parseInt(trimmedAnchor, 10);
      if (
        !/^\d+$/.test(trimmedAnchor) ||
        !Number.isInteger(parsedAnchor) ||
        parsedAnchor < 1 ||
        parsedAnchor > 28
      ) {
        nextErrors.billing_cycle_anchor_day =
          "Enter a billing cycle day between 1 and 28.";
      }

      const trimmedLease = values.leaseEndDate.trim();
      if (trimmedLease !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedLease)) {
        nextErrors.lease_end_date = "Enter a valid lease end date.";
      }

      return {
        valid: Object.keys(nextErrors).length === 0,
        fieldErrors: nextErrors,
        budgetCents,
        anchorDay: parsedAnchor,
      };
    },
    [],
  );

  const handleFieldBlur = (field: keyof FieldErrors) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const { fieldErrors } = validateFields({
      name,
      budgetInput,
      baseCurrency,
      anchorDayInput,
      leaseEndDate,
    });
    setErrors((prev) => ({
      ...prev,
      [field]: fieldErrors[field],
    }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);

    const validation = validateFields({
      name,
      budgetInput,
      baseCurrency,
      anchorDayInput,
      leaseEndDate,
    });

    if (!validation.valid) {
      setTouched({
        name: true,
        operational_budget: true,
        billing_cycle_anchor_day: true,
        lease_end_date: true,
      });
      setErrors(validation.fieldErrors);

      if (validation.fieldErrors.name) {
        nameInputRef.current?.focus();
      } else if (validation.fieldErrors.operational_budget) {
        budgetInputRef.current?.focus();
      } else if (validation.fieldErrors.billing_cycle_anchor_day) {
        anchorInputRef.current?.focus();
      } else if (validation.fieldErrors.lease_end_date) {
        leaseDateInputRef.current?.focus();
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          group_type: groupType,
          base_currency: baseCurrency,
          operational_budget_cents: validation.budgetCents,
          billing_cycle_anchor_day: validation.anchorDay,
          lease_end_date: leaseEndDate.trim() || null,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        group?: SplitGroupDetail;
        shellGroup?: ShellGroupSummary;
      };

      if (!response.ok || !payload.group || !payload.shellGroup) {
        setServerError(
          payload.error || "Could not create split group. Please try again.",
        );
        setIsSubmitting(false);
        return;
      }

      onCreated({
        group: payload.group,
        shellGroup: payload.shellGroup,
      });
      resetForm();
      onClose();
    } catch {
      setServerError("Network error while creating group. Please try again.");
      setIsSubmitting(false);
    }
  };

  const currencySymbol = getCurrencySymbol(baseCurrency);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create New Group"
      description="Set up an isolated expense ledger with its base currency, cycle anchor, and optional budget."
      size="md"
      closeOnBackdropClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={isSubmitting}
          >
            Create Group
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
      >
        {serverError && (
          <AlertBanner
            tone="error"
            title="Unable to create group"
            description={serverError}
          />
        )}

        <Input
          ref={nameInputRef}
          label="Group Name"
          name="name"
          required
          autoFocus
          placeholder="e.g. Apt 4B Roommates"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) {
              setErrors((prev) => ({ ...prev, name: undefined }));
            }
          }}
          onBlur={() => handleFieldBlur("name")}
          error={touched.name ? errors.name : undefined}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Group Type"
            options={GROUP_TYPE_OPTIONS}
            value={groupType}
            onChange={(val) => setGroupType(val as GroupType)}
          />

          <Select
            label="Base Currency"
            options={CURRENCY_OPTIONS}
            value={baseCurrency}
            onChange={(val) => {
              setBaseCurrency(val);
              if (errors.operational_budget) {
                setErrors((prev) => ({
                  ...prev,
                  operational_budget: undefined,
                }));
              }
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            ref={budgetInputRef}
            label="Operational Budget (Optional)"
            name="operational_budget"
            type="text"
            inputMode="decimal"
            prefix={currencySymbol}
            placeholder="0.00"
            hint={`Monthly target in ${baseCurrency}.`}
            value={budgetInput}
            onChange={(e) => {
              setBudgetInput(e.target.value);
              if (errors.operational_budget) {
                setErrors((prev) => ({
                  ...prev,
                  operational_budget: undefined,
                }));
              }
            }}
            onBlur={() => handleFieldBlur("operational_budget")}
            error={
              touched.operational_budget ? errors.operational_budget : undefined
            }
          />

          <Input
            ref={anchorInputRef}
            label="Billing Cycle Anchor Day"
            name="billing_cycle_anchor_day"
            type="text"
            inputMode="numeric"
            required
            placeholder="1"
            hint="Day of month (1–28)."
            value={anchorDayInput}
            onChange={(e) => {
              setAnchorDayInput(e.target.value);
              if (errors.billing_cycle_anchor_day) {
                setErrors((prev) => ({
                  ...prev,
                  billing_cycle_anchor_day: undefined,
                }));
              }
            }}
            onBlur={() => handleFieldBlur("billing_cycle_anchor_day")}
            error={
              touched.billing_cycle_anchor_day
                ? errors.billing_cycle_anchor_day
                : undefined
            }
          />
        </div>

        <Input
          ref={leaseDateInputRef}
          label="Lease End Date (Optional)"
          name="lease_end_date"
          type="date"
          hint="Optional target end date for residential archival reminders."
          value={leaseEndDate}
          onChange={(e) => {
            setLeaseEndDate(e.target.value);
            if (errors.lease_end_date) {
              setErrors((prev) => ({ ...prev, lease_end_date: undefined }));
            }
          }}
          onBlur={() => handleFieldBlur("lease_end_date")}
          error={touched.lease_end_date ? errors.lease_end_date : undefined}
        />
      </form>
    </Dialog>
  );
}
