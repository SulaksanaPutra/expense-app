# Entity-Relationship Diagram (ERD)

Deterministically generated from `supabase/migrations/*.sql` via `npm run docs:erd`.

```mermaid
erDiagram
    billing_cycles {
        uuid id PK
        timestamptz closed_at
        uuid closed_by FK
        timestamptz created_at
        uuid group_id FK
        date period_end
        date period_start
        text status
    }
    expense_revisions {
        uuid id PK
        timestamptz created_at
        uuid expense_id FK
        jsonb new_snapshot
        jsonb old_snapshot
        uuid updated_by FK
    }
    expenses {
        uuid id PK
        uuid adjustment_for_expense_id FK
        bigint amount_cents
        text category
        timestamptz created_at
        uuid created_by FK
        varchar currency
        timestamptz deleted_at
        text description
        numeric exchange_rate
        text exchange_rate_source
        timestamptz expense_date
        uuid group_id FK
        boolean is_locked
        boolean is_recurring_generated
        bigint original_amount_cents
        varchar original_currency
        uuid paid_by FK
        text receipt_url
        date recurring_occurrence_date
        uuid recurring_rule_id FK
        jsonb split_breakdown
        text split_method
        timestamptz updated_at
    }
    group_audit_logs {
        uuid id PK
        uuid actor_id FK
        timestamptz created_at
        text event_type
        uuid group_id FK
        jsonb metadata
        text summary
    }
    group_members {
        uuid group_id PK,FK
        uuid user_id PK,FK
        timestamptz joined_at
        text role
        numeric share_percentage
        text status
    }
    groups {
        uuid id PK
        timestamptz archived_at
        uuid archived_by FK
        varchar base_currency
        integer billing_cycle_anchor_day
        timestamptz created_at
        uuid created_by FK
        text default_split_mode
        text group_type
        text invite_token
        integer invite_token_version
        date lease_end_date
        timestamptz lease_prompt_snoozed_until
        text name
        bigint operational_budget_cents
        boolean residential_lease_prompt_enabled
        boolean simplify_debts
        text slug
        text status
        integer trip_auto_archive_days
        boolean trip_auto_archive_enabled
        timestamptz updated_at
        timestamptz zero_balance_since
    }
    notifications {
        uuid id PK
        uuid actor_id FK
        timestamptz created_at
        varchar currency
        bigint delta_cents
        text description
        uuid expense_id FK
        uuid group_id FK
        text href
        boolean is_read
        uuid revision_id FK
        text title
        text type
        uuid user_id FK
    }
    recurring_rules {
        uuid id PK
        bigint amount_cents
        text category
        timestamptz created_at
        uuid created_by FK
        varchar currency
        integer day_of_month
        text description
        text frequency
        uuid group_id FK
        boolean is_active
        date next_run_date
        uuid paid_by FK
        text split_rule
        timestamptz updated_at
    }
    reminder_logs {
        uuid id PK
        text channel
        uuid creditor_id FK
        uuid debtor_id FK
        uuid group_id FK
        timestamptz sent_at
    }
    settlements {
        uuid id PK
        bigint amount_cents
        varchar currency
        uuid group_id FK
        uuid payer_id FK
        text payment_rail
        uuid recipient_id FK
        timestamptz settled_at
    }
    users {
        uuid id PK,FK
        varchar base_currency
        timestamptz created_at
        text email
        text full_name
        text instant_settlement_tag
        jsonb notification_prefs
        bigint personal_share_cap_cents
        text phone_number
        boolean phone_verified
        bigint receipt_storage_used_bytes
        timestamptz updated_at
    }

    expense_revisions |o--o{ notifications : "revision_id"
    expenses ||--o{ expense_revisions : "expense_id"
    expenses |o--o{ expenses : "adjustment_for_expense_id"
    expenses |o--o{ notifications : "expense_id"
    groups ||--o{ billing_cycles : "group_id"
    groups ||--o{ expenses : "group_id"
    groups ||--o{ group_audit_logs : "group_id"
    groups ||--o{ group_members : "group_id"
    groups |o--o{ notifications : "group_id"
    groups ||--o{ recurring_rules : "group_id"
    groups ||--o{ reminder_logs : "group_id"
    groups ||--o{ settlements : "group_id"
    recurring_rules |o--o{ expenses : "recurring_rule_id"
    users |o--o{ billing_cycles : "closed_by"
    users ||--o{ expense_revisions : "updated_by"
    users ||--o{ expenses : "created_by"
    users ||--o{ expenses : "paid_by"
    users |o--o{ group_audit_logs : "actor_id"
    users ||--o{ group_members : "user_id"
    users |o--o{ groups : "archived_by"
    users |o--o{ groups : "created_by"
    users |o--o{ notifications : "actor_id"
    users ||--o{ notifications : "user_id"
    users |o--o{ recurring_rules : "created_by"
    users ||--o{ recurring_rules : "paid_by"
    users ||--o{ reminder_logs : "creditor_id"
    users ||--o{ reminder_logs : "debtor_id"
    users ||--o{ settlements : "payer_id"
    users ||--o{ settlements : "recipient_id"
```

## Tables Summary

| Table | Schema | Columns | Primary Key | Foreign Keys |
| --- | --- | ---: | --- | --- |
| `billing_cycles` | `public` | 8 | `id` | `closed_by`, `group_id` |
| `expense_revisions` | `public` | 6 | `id` | `expense_id`, `updated_by` |
| `expenses` | `public` | 24 | `id` | `adjustment_for_expense_id`, `created_by`, `group_id`, `paid_by`, `recurring_rule_id` |
| `group_audit_logs` | `public` | 7 | `id` | `actor_id`, `group_id` |
| `group_members` | `public` | 6 | `group_id`, `user_id` | `group_id`, `user_id` |
| `groups` | `public` | 23 | `id` | `archived_by`, `created_by` |
| `notifications` | `public` | 14 | `id` | `actor_id`, `expense_id`, `group_id`, `revision_id`, `user_id` |
| `recurring_rules` | `public` | 15 | `id` | `created_by`, `group_id`, `paid_by` |
| `reminder_logs` | `public` | 6 | `id` | `creditor_id`, `debtor_id`, `group_id` |
| `settlements` | `public` | 8 | `id` | `group_id`, `payer_id`, `recipient_id` |
| `users` | `public` | 12 | `id` | `id` |

## External Schema References

- `public.users.id` -> `auth.users.id`
