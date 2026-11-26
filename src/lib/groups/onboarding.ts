import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  GroupStatus,
  GroupType,
  SplitMode,
} from "@/types/database";
import {
  createSignedInviteToken,
  verifySignedInviteToken,
  type InviteTokenVerifyErrorCode,
} from "./invite-token";
import {
  buildInviteJoinPath,
  computeEqualSharePercentages,
  validateCustomRatios,
  type MemberRatioInput,
} from "./invite-utils";

export interface InviteAuthUser {
  id: string;
  email?: string | null;
  fullName?: string | null;
}

export type RegenerateInviteResult =
  | {
      ok: true;
      groupId: string;
      slug: string;
      inviteToken: string;
      inviteTokenVersion: number;
      invitePath: string;
    }
  | { ok: false; status: number; message: string };

export async function regenerateGroupInviteLink(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
): Promise<RegenerateInviteResult> {
  const { data: membership, error: memberError } = await supabase
    .from("group_members")
    .select("role, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) {
    return {
      ok: false,
      status: 500,
      message: memberError.message || "Unable to verify group permissions.",
    };
  }

  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.role !== "ADMIN"
  ) {
    return {
      ok: false,
      status: 403,
      message: "Only active group admins can regenerate invite links.",
    };
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, slug, status, invite_token_version")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      status: 500,
      message: groupError.message || "Unable to load group details.",
    };
  }

  if (!group) {
    return {
      ok: false,
      status: 404,
      message: "Split group not found.",
    };
  }

  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      message: "Archived groups cannot regenerate invite links.",
    };
  }

  const nextVersion = (group.invite_token_version ?? 1) + 1;
  const nextToken = createSignedInviteToken({
    groupId: group.id,
    slug: group.slug,
    version: nextVersion,
  });

  const { error: updateError } = await supabase
    .from("groups")
    .update({
      invite_token: nextToken,
      invite_token_version: nextVersion,
    })
    .eq("id", group.id);

  if (updateError) {
    return {
      ok: false,
      status: 500,
      message: updateError.message || "Failed to update invite token.",
    };
  }

  return {
    ok: true,
    groupId: group.id,
    slug: group.slug,
    inviteToken: nextToken,
    inviteTokenVersion: nextVersion,
    invitePath: buildInviteJoinPath(group.slug, nextToken),
  };
}

export type InviteLookupErrorCode =
  | InviteTokenVerifyErrorCode
  | "NOT_FOUND"
  | "GROUP_ARCHIVED"
  | "SERVER_CONFIG_ERROR";

export interface GroupInvitePreview {
  groupId: string;
  name: string;
  slug: string;
  groupType: GroupType;
  status: GroupStatus;
  baseCurrency: string;
  defaultSplitMode: SplitMode;
  activeMemberCount: number;
  alreadyMember: boolean;
  projectedSharePercentage: number;
}

export type PreviewGroupInviteResult =
  | { ok: true; invite: GroupInvitePreview }
  | { ok: false; status: number; code: InviteLookupErrorCode; message: string };

export async function previewGroupInvite(
  adminSupabase: SupabaseClient<Database>,
  params: {
    slug: string;
    token: string | null | undefined;
    currentUserId?: string | null;
  },
): Promise<PreviewGroupInviteResult> {
  const verified = verifySignedInviteToken({
    token: params.token,
    expectedSlug: params.slug,
  });

  if (!verified.ok) {
    return {
      ok: false,
      status: 403,
      code: verified.code,
      message: verified.message,
    };
  }

  const { data: group, error: groupError } = await adminSupabase
    .from("groups")
    .select(
      "id, name, slug, group_type, status, base_currency, default_split_mode, invite_token_version",
    )
    .eq("slug", params.slug)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_CONFIG_ERROR",
      message: groupError.message || "Unable to verify invitation details.",
    };
  }

  if (!group) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "This group invitation could not be found.",
    };
  }

  if (group.id !== verified.payload.g) {
    return {
      ok: false,
      status: 403,
      code: "INVALID_SIGNATURE",
      message: "This invite token does not match the requested group.",
    };
  }

  const currentVersion = group.invite_token_version ?? 1;
  if (verified.payload.v !== currentVersion) {
    return {
      ok: false,
      status: 403,
      code: "REVOKED",
      message:
        "This invite link has been revoked by a group admin. Ask for the latest link.",
    };
  }

  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      code: "GROUP_ARCHIVED",
      message:
        "This group has been archived and is no longer accepting new members.",
    };
  }

  const { data: memberRows, error: membersError } = await adminSupabase
    .from("group_members")
    .select("user_id, status, share_percentage")
    .eq("group_id", group.id);

  if (membersError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_CONFIG_ERROR",
      message: membersError.message || "Unable to inspect group members.",
    };
  }

  const activeMembers = (memberRows ?? []).filter((m) => m.status === "ACTIVE");
  const existingActive = params.currentUserId
    ? activeMembers.find((m) => m.user_id === params.currentUserId)
    : undefined;

  let projectedSharePercentage = 0;
  if (existingActive) {
    projectedSharePercentage = Number(existingActive.share_percentage);
  } else if (group.default_split_mode === "EQUAL") {
    const projectedMap = computeEqualSharePercentages([
      ...activeMembers.map((m) => m.user_id),
      "__pending_member__",
    ]);
    projectedSharePercentage = projectedMap.get("__pending_member__") ?? 0;
  }

  return {
    ok: true,
    invite: {
      groupId: group.id,
      name: group.name,
      slug: group.slug,
      groupType: group.group_type,
      status: group.status,
      baseCurrency: group.base_currency,
      defaultSplitMode: group.default_split_mode,
      activeMemberCount: activeMembers.length,
      alreadyMember: Boolean(existingActive),
      projectedSharePercentage,
    },
  };
}

export type AcceptGroupInviteResult =
  | {
      ok: true;
      alreadyMember: boolean;
      groupId: string;
      slug: string;
      groupName: string;
      groupStatus: GroupStatus;
      defaultSplitMode: SplitMode;
      sharePercentage: number;
      activeMemberCount: number;
      memberShares: Array<{ userId: string; sharePercentage: number }>;
    }
  | { ok: false; status: number; code: InviteLookupErrorCode; message: string };

export async function acceptGroupInvite(
  adminSupabase: SupabaseClient<Database>,
  params: {
    slug: string;
    token: string | null | undefined;
    authUser: InviteAuthUser;
  },
): Promise<AcceptGroupInviteResult> {
  const verified = verifySignedInviteToken({
    token: params.token,
    expectedSlug: params.slug,
  });

  if (!verified.ok) {
    return {
      ok: false,
      status: 403,
      code: verified.code,
      message: verified.message,
    };
  }

  const { data: group, error: groupError } = await adminSupabase
    .from("groups")
    .select(
      "id, name, slug, status, default_split_mode, invite_token_version",
    )
    .eq("slug", params.slug)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_CONFIG_ERROR",
      message: groupError.message || "Unable to load target group.",
    };
  }

  if (!group) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "This group invitation could not be found.",
    };
  }

  if (group.id !== verified.payload.g) {
    return {
      ok: false,
      status: 403,
      code: "INVALID_SIGNATURE",
      message: "This invite token does not match the target group.",
    };
  }

  const currentVersion = group.invite_token_version ?? 1;
  if (verified.payload.v !== currentVersion) {
    return {
      ok: false,
      status: 403,
      code: "REVOKED",
      message:
        "This invite link has been revoked by a group admin. Ask for the latest link.",
    };
  }

  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      code: "GROUP_ARCHIVED",
      message:
        "This group has been archived and is no longer accepting new members.",
    };
  }

  if (params.authUser.email) {
    const fallbackName =
      params.authUser.fullName?.trim() ||
      params.authUser.email.split("@")[0] ||
      "LedgerSplit User";

    await adminSupabase.from("users").upsert(
      {
        id: params.authUser.id,
        email: params.authUser.email,
        full_name: fallbackName,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  }

  const { data: existingMembers, error: membersError } = await adminSupabase
    .from("group_members")
    .select("user_id, role, status, share_percentage, joined_at")
    .eq("group_id", group.id)
    .order("joined_at", { ascending: true });

  if (membersError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_CONFIG_ERROR",
      message: membersError.message || "Unable to read group memberships.",
    };
  }

  const rows = existingMembers ?? [];
  const existingSelf = rows.find((m) => m.user_id === params.authUser.id);
  const currentActiveRows = rows.filter((m) => m.status === "ACTIVE");

  if (existingSelf && existingSelf.status === "ACTIVE") {
    return {
      ok: true,
      alreadyMember: true,
      groupId: group.id,
      slug: group.slug,
      groupName: group.name,
      groupStatus: group.status,
      defaultSplitMode: group.default_split_mode,
      sharePercentage: Number(existingSelf.share_percentage),
      activeMemberCount: currentActiveRows.length,
      memberShares: currentActiveRows.map((m) => ({
        userId: m.user_id,
        sharePercentage: Number(m.share_percentage),
      })),
    };
  }

  if (existingSelf && existingSelf.status === "FORMER_MEMBER") {
    const { error: reactivateError } = await adminSupabase
      .from("group_members")
      .update({
        status: "ACTIVE",
        role: "MEMBER",
        share_percentage: 0,
      })
      .eq("group_id", group.id)
      .eq("user_id", params.authUser.id);

    if (reactivateError) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_CONFIG_ERROR",
        message: reactivateError.message || "Unable to rejoin group.",
      };
    }
  } else {
    const { error: insertError } = await adminSupabase
      .from("group_members")
      .insert({
        group_id: group.id,
        user_id: params.authUser.id,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 0,
      });

    if (insertError) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_CONFIG_ERROR",
        message: insertError.message || "Unable to join group.",
      };
    }
  }

  const orderedActiveMemberIds = [
    ...currentActiveRows.map((m) => m.user_id),
    params.authUser.id,
  ];

  if (group.default_split_mode === "EQUAL") {
    const equalShares = computeEqualSharePercentages(orderedActiveMemberIds);

    for (const memberId of orderedActiveMemberIds) {
      const nextShare = equalShares.get(memberId) ?? 0;
      const { error: shareUpdateError } = await adminSupabase
        .from("group_members")
        .update({ share_percentage: nextShare })
        .eq("group_id", group.id)
        .eq("user_id", memberId);

      if (shareUpdateError) {
        return {
          ok: false,
          status: 500,
          code: "SERVER_CONFIG_ERROR",
          message:
            shareUpdateError.message ||
            "Failed to recalculate equal member shares.",
        };
      }
    }

    return {
      ok: true,
      alreadyMember: false,
      groupId: group.id,
      slug: group.slug,
      groupName: group.name,
      groupStatus: group.status,
      defaultSplitMode: "EQUAL",
      sharePercentage: equalShares.get(params.authUser.id) ?? 0,
      activeMemberCount: orderedActiveMemberIds.length,
      memberShares: orderedActiveMemberIds.map((userId) => ({
        userId,
        sharePercentage: equalShares.get(userId) ?? 0,
      })),
    };
  }

  // CUSTOM_RATIOS mode: new member remains at 0% and group transitions to NEEDS_RATIO_UPDATE.
  const { error: statusUpdateError } = await adminSupabase
    .from("groups")
    .update({ status: "NEEDS_RATIO_UPDATE" })
    .eq("id", group.id);

  if (statusUpdateError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_CONFIG_ERROR",
      message:
        statusUpdateError.message ||
        "Failed to mark group for split ratio update.",
    };
  }

  const memberShares = [
    ...currentActiveRows.map((m) => ({
      userId: m.user_id,
      sharePercentage: Number(m.share_percentage),
    })),
    { userId: params.authUser.id, sharePercentage: 0 },
  ];

  return {
    ok: true,
    alreadyMember: false,
    groupId: group.id,
    slug: group.slug,
    groupName: group.name,
    groupStatus: "NEEDS_RATIO_UPDATE",
    defaultSplitMode: "CUSTOM_RATIOS",
    sharePercentage: 0,
    activeMemberCount: orderedActiveMemberIds.length,
    memberShares,
  };
}

export type UpdateGroupRatiosResult =
  | {
      ok: true;
      groupId: string;
      groupStatus: GroupStatus;
      defaultSplitMode: SplitMode;
      memberShares: Array<{ userId: string; sharePercentage: number }>;
    }
  | { ok: false; status: number; message: string };

export async function updateGroupSplitRatios(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
  input: {
    defaultSplitMode: SplitMode;
    allocations?: MemberRatioInput[];
  },
): Promise<UpdateGroupRatiosResult> {
  const { data: selfMember, error: selfError } = await supabase
    .from("group_members")
    .select("role, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (selfError) {
    return {
      ok: false,
      status: 500,
      message: selfError.message || "Unable to verify admin permissions.",
    };
  }

  if (
    !selfMember ||
    selfMember.status !== "ACTIVE" ||
    selfMember.role !== "ADMIN"
  ) {
    return {
      ok: false,
      status: 403,
      message: "Only active group admins can update split ratios.",
    };
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, status")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      status: 500,
      message: groupError.message || "Unable to load group details.",
    };
  }

  if (!group) {
    return {
      ok: false,
      status: 404,
      message: "Split group not found.",
    };
  }

  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      message: "Archived groups are read-only.",
    };
  }

  const { data: memberRows, error: membersError } = await supabase
    .from("group_members")
    .select("user_id, status, joined_at")
    .eq("group_id", groupId)
    .eq("status", "ACTIVE")
    .order("joined_at", { ascending: true });

  if (membersError) {
    return {
      ok: false,
      status: 500,
      message: membersError.message || "Unable to load active members.",
    };
  }

  const activeMemberIds = (memberRows ?? []).map((m) => m.user_id);
  if (activeMemberIds.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "Group has no active members.",
    };
  }

  let resolvedMap: Map<string, number>;
  if (input.defaultSplitMode === "EQUAL") {
    resolvedMap = computeEqualSharePercentages(activeMemberIds);
  } else {
    const validation = validateCustomRatios(
      input.allocations ?? [],
      activeMemberIds,
    );
    if (!validation.ok) {
      return {
        ok: false,
        status: 400,
        message: validation.message,
      };
    }
    resolvedMap = validation.normalized;
  }

  for (const memberId of activeMemberIds) {
    const nextShare = resolvedMap.get(memberId) ?? 0;
    const { error: updateMemberError } = await supabase
      .from("group_members")
      .update({ share_percentage: nextShare })
      .eq("group_id", groupId)
      .eq("user_id", memberId);

    if (updateMemberError) {
      return {
        ok: false,
        status: 500,
        message:
          updateMemberError.message || "Failed to save member split ratios.",
      };
    }
  }

  const { error: updateGroupError } = await supabase
    .from("groups")
    .update({
      default_split_mode: input.defaultSplitMode,
      status: "ACTIVE",
    })
    .eq("id", groupId);

  if (updateGroupError) {
    return {
      ok: false,
      status: 500,
      message: updateGroupError.message || "Failed to update group split mode.",
    };
  }

  return {
    ok: true,
    groupId,
    groupStatus: "ACTIVE",
    defaultSplitMode: input.defaultSplitMode,
    memberShares: activeMemberIds.map((memberId) => ({
      userId: memberId,
      sharePercentage: resolvedMap.get(memberId) ?? 0,
    })),
  };
}
