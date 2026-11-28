"use client";

import * as React from "react";
import {
  Coffee,
  Home,
  MoreHorizontal,
  Plus,
  Send,
  X,
  Zap,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Dialog,
  Input,
  SegmentedControl,
  Select,
} from "@/components/ui";
import type { SegmentedOption, SelectOption } from "@/components/ui";
import type { ShellGroupSummary } from "@/components/shell/types";
import { cn } from "@/lib/cn";
import { resolveGroupCategory } from "@/lib/groups/service";
import type { SplitGroupDetail } from "@/lib/groups/types";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import type { GroupCategory, SplitMode } from "@/types/database";

const CATEGORY_OPTIONS: Array<{
  value: GroupCategory;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  { value: "HOME", label: "Home", icon: Home },
  { value: "TRIP", label: "Trip", icon: Send },
  { value: "DINING", label: "Dining", icon: Coffee },
  { value: "UTILITIES", label: "Utilities", icon: Zap },
  { value: "OTHER", label: "Other", icon: MoreHorizontal },
];

type ModalSplitMethod = "EQUAL" | "PERCENTAGE" | "CUSTOM";

const SPLIT_METHOD_OPTIONS: Array<SegmentedOption<ModalSplitMethod>> = [
  { value: "EQUAL", label: "Equal" },
  { value: "PERCENTAGE", label: "Percentage" },
  { value: "CUSTOM", label: "Custom" },
];

const CURRENCY_OPTIONS: SelectOption[] = SUPPORTED_CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} (${c.symbol}) — ${c.label.replace(/^[^—]+—\s*/, "").replace(/\s*\([^)]+\)$/, "")}`,
}));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeSplitMethod(mode?: SplitMode): ModalSplitMethod {
  if (mode === "PERCENTAGE") return "PERCENTAGE";
  if (mode === "CUSTOM" || mode === "CUSTOM_RATIOS" || mode === "SHARES") {
    return "CUSTOM";
  }
  return "EQUAL";
}

export interface CreateGroupModalProps {
  open: boolean;
  mode?: "create" | "edit";
  group?: SplitGroupDetail | null;
  currentUserName?: string;
  currentUserEmail?: string;
  onClose: () => void;
  defaultCurrency?: string;
  onCreated?: (result: {
    group: SplitGroupDetail;
    shellGroup: ShellGroupSummary;
  }) => void;
  onUpdated?: (result: {
    group: SplitGroupDetail;
    shellGroup: ShellGroupSummary;
    invitedEmails: string[];
    removedMemberIds: string[];
  }) => void;
}

interface FieldErrors {
  name?: string;
  memberEmail?: string;
}

export function CreateGroupModal(props: CreateGroupModalProps) {
  if (!props.open) return null;
  const isEdit = props.mode === "edit" && Boolean(props.group);
  const modalKey = isEdit && props.group ? `edit-${props.group.id}` : "create";
  return <CreateGroupModalInner key={modalKey} {...props} />;
}

function CreateGroupModalInner({
  open,
  mode = "create",
  group = null,
  currentUserName = "You",
  currentUserEmail = "",
  onClose,
  defaultCurrency = "USD",
  onCreated,
  onUpdated,
}: CreateGroupModalProps) {
  const formId = React.useId();
  const isEdit = mode === "edit" && Boolean(group);

  const [name, setName] = React.useState(() =>
    isEdit && group ? group.name : "",
  );
  const [category, setCategory] = React.useState<GroupCategory>(() =>
    isEdit && group ? resolveGroupCategory(group) : "HOME",
  );
  const [splitMethod, setSplitMethod] = React.useState<ModalSplitMethod>(() =>
    isEdit && group ? normalizeSplitMethod(group.defaultSplitMode) : "EQUAL",
  );
  const [baseCurrency, setBaseCurrency] = React.useState(() =>
    isEdit && group ? group.baseCurrency : defaultCurrency,
  );
  const [memberEmailInput, setMemberEmailInput] = React.useState("");
  const [addedEmails, setAddedEmails] = React.useState<string[]>([]);
  const [removedMemberIds, setRemovedMemberIds] = React.useState<string[]>([]);

  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const nameInputRef = React.useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const existingActiveMembers = React.useMemo(() => {
    if (!isEdit || !group) return [];
    const removedSet = new Set(removedMemberIds);
    return group.members.filter(
      (m) => m.status === "ACTIVE" && !removedSet.has(m.userId),
    );
  }, [group, isEdit, removedMemberIds]);

  const visibleMemberCount = isEdit
    ? existingActiveMembers.length + addedEmails.length
    : 1 + addedEmails.length;

  const validateName = React.useCallback((rawName: string): string | undefined => {
    const trimmed = rawName.trim();
    if (!trimmed) {
      return "Please enter a group name.";
    }
    if (trimmed.length < 2) {
      return "Group name must be at least 2 characters.";
    }
    if (trimmed.length > 80) {
      return "Group name must be 80 characters or fewer.";
    }
    return undefined;
  }, []);

  const handleAddMemberEmail = () => {
    const normalized = memberEmailInput.trim().toLowerCase();
    if (!normalized) {
      setErrors((prev) => ({
        ...prev,
        memberEmail: "Enter an email address to invite.",
      }));
      return;
    }
    if (!EMAIL_REGEX.test(normalized)) {
      setErrors((prev) => ({
        ...prev,
        memberEmail: "Enter a valid email address.",
      }));
      return;
    }

    const existingEmails = new Set<string>(
      [
        currentUserEmail.trim().toLowerCase(),
        ...existingActiveMembers.map((m) => m.email.trim().toLowerCase()),
        ...addedEmails,
      ].filter(Boolean),
    );

    if (existingEmails.has(normalized)) {
      setErrors((prev) => ({
        ...prev,
        memberEmail: "That member is already in this group.",
      }));
      return;
    }

    setAddedEmails((prev) => [...prev, normalized]);
    setMemberEmailInput("");
    setErrors((prev) => ({ ...prev, memberEmail: undefined }));
  };

  const handleRemoveAddedEmail = (email: string) => {
    setAddedEmails((prev) => prev.filter((item) => item !== email));
  };

  const handleRemoveExistingMember = (userId: string) => {
    setRemovedMemberIds((prev) =>
      prev.includes(userId) ? prev : [...prev, userId],
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);

    const nameError = validateName(name);
    if (nameError) {
      setTouched({ name: true });
      setErrors((prev) => ({ ...prev, name: nameError }));
      nameInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && group) {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(group.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              category,
              default_split_mode: splitMethod,
              base_currency: baseCurrency,
              add_member_emails: addedEmails,
              remove_member_ids: removedMemberIds,
            }),
          },
        );

        const payload = (await response.json()) as {
          error?: string;
          group?: SplitGroupDetail;
          shellGroup?: ShellGroupSummary;
          invitedEmails?: string[];
          removedMemberIds?: string[];
        };

        if (!response.ok || !payload.group || !payload.shellGroup) {
          setServerError(
            payload.error || "Could not update split group. Please try again.",
          );
          setIsSubmitting(false);
          return;
        }

        onUpdated?.({
          group: payload.group,
          shellGroup: payload.shellGroup,
          invitedEmails: payload.invitedEmails ?? addedEmails,
          removedMemberIds: payload.removedMemberIds ?? removedMemberIds,
        });
        onClose();
        return;
      }

      const response = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          default_split_mode: splitMethod,
          base_currency: baseCurrency,
          member_emails: addedEmails,
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

      onCreated?.({
        group: payload.group,
        shellGroup: payload.shellGroup,
      });
      onClose();
    } catch {
      setServerError(
        isEdit
          ? "Network error while updating group. Please try again."
          : "Network error while creating group. Please try again.",
      );
      setIsSubmitting(false);
    }
  };

  const modalTitle =
    isEdit && group ? `Edit Group · ${group.name}` : "Create Group";

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={modalTitle}
      description="Configure group name, category, default split method, and members."
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
            {isEdit ? "Save Group" : "Create Group"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        {serverError && (
          <AlertBanner
            tone="error"
            title={isEdit ? "Unable to update group" : "Unable to create group"}
            description={serverError}
          />
        )}

        <Input
          ref={nameInputRef}
          label="Group Name"
          name="name"
          required
          autoFocus
          placeholder="e.g. Apartment 4B Shared"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) {
              setErrors((prev) => ({ ...prev, name: undefined }));
            }
          }}
          onBlur={() => {
            setTouched((prev) => ({ ...prev, name: true }));
            setErrors((prev) => ({ ...prev, name: validateName(name) }));
          }}
          error={touched.name ? errors.name : undefined}
        />

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-on-surface">
            Category
          </span>
          <div
            role="radiogroup"
            aria-label="Category"
            className="flex flex-wrap gap-2"
          >
            {CATEGORY_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = category === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  variant={isActive ? "primary" : "secondary"}
                  size="sm"
                  leftIcon={<Icon className="h-3.5 w-3.5" aria-hidden={true} />}
                  onClick={() => setCategory(option.value)}
                  className={cn(
                    "px-3.5 text-[12px]",
                    !isActive &&
                      "border-outline-variant/60 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high",
                  )}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-on-surface">
              Default Split Method
            </span>
            <SegmentedControl
              role="radiogroup"
              ariaLabel="Default Split Method"
              variant="pill-tabs"
              fullWidth
              options={SPLIT_METHOD_OPTIONS}
              value={splitMethod}
              onChange={setSplitMethod}
              className="h-11"
            />
          </div>

          <Select
            label="Currency"
            options={CURRENCY_OPTIONS}
            value={baseCurrency}
            onChange={setBaseCurrency}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-on-surface tabular-nums">
            Members ({visibleMemberCount})
          </span>

          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Input
                type="email"
                name="member_email"
                aria-label="Add member by email"
                placeholder="Add member by email..."
                value={memberEmailInput}
                onChange={(e) => {
                  setMemberEmailInput(e.target.value);
                  if (errors.memberEmail) {
                    setErrors((prev) => ({ ...prev, memberEmail: undefined }));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddMemberEmail();
                  }
                }}
                error={errors.memberEmail}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={handleAddMemberEmail}
              className="shrink-0 bg-surface-container-low"
            >
              Add
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {isEdit ? (
              existingActiveMembers.map((member) => {
                const isOwner = member.role === "ADMIN" || member.isCurrentUser;
                return (
                  <div
                    key={member.userId}
                    className="inline-flex items-center gap-1.5 rounded-pill border border-outline-variant/60 bg-surface-container-low py-1 pr-2.5 pl-1.5 text-[12px] text-on-surface"
                  >
                    <Avatar name={member.name} size="sm" className="h-5 w-5 text-[10px]" />
                    <span className="max-w-[140px] truncate">{member.name}</span>
                    {isOwner ? (
                      <Badge
                        tone="neutral"
                        size="sm"
                        className="border-outline-variant/60 bg-surface-container-lowest px-1.5 py-0 text-[10px] uppercase tracking-wide text-outline"
                      >
                        Owner
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${member.name}`}
                        onClick={() => handleRemoveExistingMember(member.userId)}
                        className="h-5 w-5 rounded-full p-0 text-outline hover:bg-surface-container-high hover:text-on-surface"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-pill border border-outline-variant/60 bg-surface-container-low py-1 pr-3 pl-1.5 text-[12px] text-on-surface">
                <Avatar name={currentUserName} size="sm" className="h-5 w-5 text-[10px]" />
                <span className="max-w-[140px] truncate">{currentUserName}</span>
                <Badge
                  tone="neutral"
                  size="sm"
                  className="border-outline-variant/60 bg-surface-container-lowest px-1.5 py-0 text-[10px] uppercase tracking-wide text-outline"
                >
                  Owner
                </Badge>
              </div>
            )}

            {addedEmails.map((email) => (
              <div
                key={email}
                className="inline-flex items-center gap-1.5 rounded-pill border border-outline-variant/60 bg-surface-container-low py-1 pr-2 pl-1.5 text-[12px] text-on-surface"
              >
                <Avatar name={email} size="sm" className="h-5 w-5 text-[10px]" />
                <span className="max-w-[180px] truncate">{email}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${email}`}
                  onClick={() => handleRemoveAddedEmail(email)}
                  className="h-5 w-5 rounded-full p-0 text-outline hover:bg-surface-container-high hover:text-on-surface"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export const CreateEditGroupModal = CreateGroupModal;
