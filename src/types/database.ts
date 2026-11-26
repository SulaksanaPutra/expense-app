export type GroupType = "RESIDENTIAL" | "TRIP" | "RECURRING";
export type GroupStatus = "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
export type SplitMode = "EQUAL" | "CUSTOM_RATIOS";
export type MemberRole = "ADMIN" | "MEMBER";
export type MemberStatus = "ACTIVE" | "FORMER_MEMBER";
export type ExpenseSplitMethod = "EQUAL" | "PERCENTAGE" | "EXACT";
export type ExchangeRateSource = "API" | "MANUAL_OVERRIDE";
export type PaymentRail = "VENMO" | "APPLE_CARD" | "CASH" | "OTHER";
export type BillingCycleStatus = "OPEN" | "CLOSED";
export type RecurringFrequency = "MONTHLY";
export type ReminderChannel = "PUSH" | "EMAIL" | "SMS";
export type GroupAuditEventType =
  | "GROUP_CREATED"
  | "RATIOS_UPDATED"
  | "SPLIT_MODE_CHANGED"
  | "NEEDS_RATIO_UPDATE_FLAGGED"
  | "NEEDS_RATIO_UPDATE_CLEARED"
  | "MEMBER_JOINED"
  | "MEMBER_REJOINED"
  | "MEMBER_REMOVED"
  | "MEMBER_ROLE_CHANGED"
  | "INVITE_LINK_REGENERATED"
  | "BILLING_CYCLE_CLOSED"
  | "GROUP_ARCHIVED";

export interface NotificationPrefs {
  new_expense: boolean;
  settlement_confirmation: boolean;
  monthly_recap: boolean;
  sms_nudges_opt_in: boolean;
}

export interface SplitBreakdownItem {
  user_id: string;
  share_cents: number;
  percentage?: number;
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          phone_number: string | null;
          phone_verified: boolean;
          instant_settlement_tag: string | null;
          base_currency: string;
          personal_share_cap_cents: number | null;
          receipt_storage_used_bytes: number;
          notification_prefs: NotificationPrefs;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          email: string;
          phone_number?: string | null;
          phone_verified?: boolean;
          instant_settlement_tag?: string | null;
          base_currency?: string;
          personal_share_cap_cents?: number | null;
          receipt_storage_used_bytes?: number;
          notification_prefs?: NotificationPrefs;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string;
          phone_number?: string | null;
          phone_verified?: boolean;
          instant_settlement_tag?: string | null;
          base_currency?: string;
          personal_share_cap_cents?: number | null;
          receipt_storage_used_bytes?: number;
          notification_prefs?: NotificationPrefs;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      groups: {
        Row: {
          id: string;
          name: string;
          slug: string;
          group_type: GroupType;
          status: GroupStatus;
          base_currency: string;
          default_split_mode: SplitMode;
          simplify_debts: boolean;
          operational_budget_cents: number | null;
          billing_cycle_anchor_day: number;
          lease_end_date: string | null;
          invite_token: string;
          invite_token_version: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          group_type: GroupType;
          status?: GroupStatus;
          base_currency?: string;
          default_split_mode?: SplitMode;
          simplify_debts?: boolean;
          operational_budget_cents?: number | null;
          billing_cycle_anchor_day?: number;
          lease_end_date?: string | null;
          invite_token?: string;
          invite_token_version?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          group_type?: GroupType;
          status?: GroupStatus;
          base_currency?: string;
          default_split_mode?: SplitMode;
          simplify_debts?: boolean;
          operational_budget_cents?: number | null;
          billing_cycle_anchor_day?: number;
          lease_end_date?: string | null;
          invite_token?: string;
          invite_token_version?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      group_members: {
        Row: {
          group_id: string;
          user_id: string;
          role: MemberRole;
          status: MemberStatus;
          share_percentage: number;
          joined_at: string;
        };
        Insert: {
          group_id: string;
          user_id: string;
          role?: MemberRole;
          status?: MemberStatus;
          share_percentage?: number;
          joined_at?: string;
        };
        Update: {
          group_id?: string;
          user_id?: string;
          role?: MemberRole;
          status?: MemberStatus;
          share_percentage?: number;
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_cycles: {
        Row: {
          id: string;
          group_id: string;
          period_start: string;
          period_end: string;
          status: BillingCycleStatus;
          closed_by: string | null;
          closed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          period_start: string;
          period_end: string;
          status?: BillingCycleStatus;
          closed_by?: string | null;
          closed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          period_start?: string;
          period_end?: string;
          status?: BillingCycleStatus;
          closed_by?: string | null;
          closed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_cycles_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_cycles_closed_by_fkey";
            columns: ["closed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_rules: {
        Row: {
          id: string;
          group_id: string;
          paid_by: string;
          description: string;
          category: string;
          amount_cents: number;
          currency: string;
          frequency: RecurringFrequency;
          day_of_month: number;
          split_rule: SplitMode;
          is_active: boolean;
          next_run_date: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          paid_by: string;
          description: string;
          category: string;
          amount_cents: number;
          currency: string;
          frequency?: RecurringFrequency;
          day_of_month: number;
          split_rule?: SplitMode;
          is_active?: boolean;
          next_run_date: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          paid_by?: string;
          description?: string;
          category?: string;
          amount_cents?: number;
          currency?: string;
          frequency?: RecurringFrequency;
          day_of_month?: number;
          split_rule?: SplitMode;
          is_active?: boolean;
          next_run_date?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_rules_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_rules_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          id: string;
          group_id: string;
          created_by: string;
          paid_by: string;
          description: string;
          category: string;
          expense_date: string;
          amount_cents: number;
          currency: string;
          original_amount_cents: number | null;
          original_currency: string | null;
          exchange_rate: number | null;
          exchange_rate_source: ExchangeRateSource | null;
          split_method: ExpenseSplitMethod;
          split_breakdown: SplitBreakdownItem[];
          receipt_url: string | null;
          is_recurring_generated: boolean;
          recurring_rule_id: string | null;
          adjustment_for_expense_id: string | null;
          is_locked: boolean;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          created_by: string;
          paid_by: string;
          description: string;
          category: string;
          expense_date?: string;
          amount_cents: number;
          currency: string;
          original_amount_cents?: number | null;
          original_currency?: string | null;
          exchange_rate?: number | null;
          exchange_rate_source?: ExchangeRateSource | null;
          split_method: ExpenseSplitMethod;
          split_breakdown: SplitBreakdownItem[];
          receipt_url?: string | null;
          is_recurring_generated?: boolean;
          recurring_rule_id?: string | null;
          adjustment_for_expense_id?: string | null;
          is_locked?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          created_by?: string;
          paid_by?: string;
          description?: string;
          category?: string;
          expense_date?: string;
          amount_cents?: number;
          currency?: string;
          original_amount_cents?: number | null;
          original_currency?: string | null;
          exchange_rate?: number | null;
          exchange_rate_source?: ExchangeRateSource | null;
          split_method?: ExpenseSplitMethod;
          split_breakdown?: SplitBreakdownItem[];
          receipt_url?: string | null;
          is_recurring_generated?: boolean;
          recurring_rule_id?: string | null;
          adjustment_for_expense_id?: string | null;
          is_locked?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_recurring_rule_id_fkey";
            columns: ["recurring_rule_id"];
            isOneToOne: false;
            referencedRelation: "recurring_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_adjustment_for_expense_id_fkey";
            columns: ["adjustment_for_expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_revisions: {
        Row: {
          id: string;
          expense_id: string;
          updated_by: string;
          old_snapshot: Json;
          new_snapshot: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          expense_id: string;
          updated_by: string;
          old_snapshot: Json;
          new_snapshot: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          expense_id?: string;
          updated_by?: string;
          old_snapshot?: Json;
          new_snapshot?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_revisions_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_revisions_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      settlements: {
        Row: {
          id: string;
          group_id: string;
          payer_id: string;
          recipient_id: string;
          amount_cents: number;
          currency: string;
          payment_rail: PaymentRail;
          settled_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          payer_id: string;
          recipient_id: string;
          amount_cents: number;
          currency: string;
          payment_rail: PaymentRail;
          settled_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          payer_id?: string;
          recipient_id?: string;
          amount_cents?: number;
          currency?: string;
          payment_rail?: PaymentRail;
          settled_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settlements_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      reminder_logs: {
        Row: {
          id: string;
          creditor_id: string;
          debtor_id: string;
          group_id: string;
          channel: ReminderChannel;
          sent_at: string;
        };
        Insert: {
          id?: string;
          creditor_id: string;
          debtor_id: string;
          group_id: string;
          channel: ReminderChannel;
          sent_at?: string;
        };
        Update: {
          id?: string;
          creditor_id?: string;
          debtor_id?: string;
          group_id?: string;
          channel?: ReminderChannel;
          sent_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminder_logs_creditor_id_fkey";
            columns: ["creditor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminder_logs_debtor_id_fkey";
            columns: ["debtor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminder_logs_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      group_audit_logs: {
        Row: {
          id: string;
          group_id: string;
          actor_id: string | null;
          event_type: GroupAuditEventType;
          summary: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          actor_id?: string | null;
          event_type: GroupAuditEventType;
          summary: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          actor_id?: string | null;
          event_type?: GroupAuditEventType;
          summary?: string;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_audit_logs_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_group_member: {
        Args: { p_group_id: string; p_user_id?: string };
        Returns: boolean;
      };
      is_active_group_member: {
        Args: { p_group_id: string; p_user_id?: string };
        Returns: boolean;
      };
      is_group_admin: {
        Args: { p_group_id: string; p_user_id?: string };
        Returns: boolean;
      };
      is_group_not_archived: {
        Args: { p_group_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
