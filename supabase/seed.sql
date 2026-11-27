-- LedgerSplit Idempotent Seed Data
-- Safe to re-run: uses deterministic UUIDs and ON CONFLICT DO NOTHING.

-- 1. Seed Auth Users (required by public.users FK -> auth.users)
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '11111111-1111-4111-8111-111111111101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'seed-alex@ledgersplit.test',
    '$2a$10$abcdefghijklmnopqrstuv',
    NOW(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Alex Rivera"}'::jsonb,
    NOW(),
    NOW()
  ),
  (
    '11111111-1111-4111-8111-111111111102',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'seed-elena@ledgersplit.test',
    '$2a$10$abcdefghijklmnopqrstuv',
    NOW(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Elena Rostova"}'::jsonb,
    NOW(),
    NOW()
  ),
  (
    '11111111-1111-4111-8111-111111111103',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'seed-marcus@ledgersplit.test',
    '$2a$10$abcdefghijklmnopqrstuv',
    NOW(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Marcus Chen"}'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- 2. Seed Public Users
INSERT INTO public.users (id, full_name, email, base_currency, instant_settlement_tag)
VALUES
  ('11111111-1111-4111-8111-111111111101', 'Alex Rivera', 'seed-alex@ledgersplit.test', 'USD', '@alex-rivera'),
  ('11111111-1111-4111-8111-111111111102', 'Elena Rostova', 'seed-elena@ledgersplit.test', 'USD', '@elena-r'),
  ('11111111-1111-4111-8111-111111111103', 'Marcus Chen', 'seed-marcus@ledgersplit.test', 'USD', '@mchen')
ON CONFLICT (id) DO NOTHING;

-- 3. Seed Groups
INSERT INTO public.groups (
  id,
  name,
  slug,
  group_type,
  status,
  base_currency,
  default_split_mode,
  simplify_debts,
  operational_budget_cents,
  billing_cycle_anchor_day,
  created_by
)
VALUES
  (
    '22222222-2222-4222-8222-222222222201',
    'Mission Loft 4B',
    'mission-loft-4b',
    'RESIDENTIAL',
    'ACTIVE',
    'USD',
    'CUSTOM_RATIOS',
    TRUE,
    450000,
    1,
    '11111111-1111-4111-8111-111111111101'
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    'Tokyo Autumn Trip',
    'tokyo-autumn-trip',
    'TRIP',
    'ACTIVE',
    'USD',
    'EQUAL',
    TRUE,
    300000,
    1,
    '11111111-1111-4111-8111-111111111102'
  )
ON CONFLICT (id) DO NOTHING;

-- 4. Seed Group Members (also include primary local user if present)
INSERT INTO public.group_members (group_id, user_id, role, status, share_percentage)
VALUES
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101', 'ADMIN', 'ACTIVE', 40.00),
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111102', 'MEMBER', 'ACTIVE', 35.00),
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111103', 'MEMBER', 'ACTIVE', 25.00),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111101', 'MEMBER', 'ACTIVE', 33.33),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111102', 'ADMIN', 'ACTIVE', 33.34),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111103', 'MEMBER', 'ACTIVE', 33.33)
ON CONFLICT (group_id, user_id) DO NOTHING;

INSERT INTO public.group_members (group_id, user_id, role, status, share_percentage)
SELECT '22222222-2222-4222-8222-222222222202', id, 'MEMBER', 'ACTIVE', 0.00
FROM public.users
WHERE email = 'kevefor401@bcough.com'
ON CONFLICT (group_id, user_id) DO NOTHING;

-- 5. Seed Open Billing Cycle for Mission Loft 4B
INSERT INTO public.billing_cycles (id, group_id, period_start, period_end, status)
VALUES (
  '33333333-3333-4333-8333-333333333301',
  '22222222-2222-4222-8222-222222222201',
  DATE_TRUNC('month', CURRENT_DATE)::date,
  (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date,
  'OPEN'
)
ON CONFLICT (id) DO NOTHING;

-- 6. Seed Expenses
INSERT INTO public.expenses (
  id,
  group_id,
  created_by,
  paid_by,
  description,
  category,
  expense_date,
  amount_cents,
  currency,
  original_amount_cents,
  original_currency,
  exchange_rate,
  exchange_rate_source,
  split_method,
  split_breakdown
)
VALUES
  (
    '44444444-4444-4444-8444-444444444401',
    '22222222-2222-4222-8222-222222222201',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111101',
    'November Apartment Rent',
    'Rent & Housing',
    NOW() - INTERVAL '10 days',
    360000,
    'USD',
    NULL,
    NULL,
    NULL,
    NULL,
    'PERCENTAGE',
    '{"11111111-1111-4111-8111-111111111101":144000,"11111111-1111-4111-8111-111111111102":126000,"11111111-1111-4111-8111-111111111103":90000}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444402',
    '22222222-2222-4222-8222-222222222201',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111102',
    'Sonic Fiber Gigabit Internet',
    'Utilities',
    NOW() - INTERVAL '6 days',
    9000,
    'USD',
    NULL,
    NULL,
    NULL,
    NULL,
    'EQUAL',
    '{"11111111-1111-4111-8111-111111111101":3000,"11111111-1111-4111-8111-111111111102":3000,"11111111-1111-4111-8111-111111111103":3000}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444403',
    '22222222-2222-4222-8222-222222222201',
    '11111111-1111-4111-8111-111111111103',
    '11111111-1111-4111-8111-111111111103',
    'Trader Joe''s Weekly Groceries',
    'Groceries',
    NOW() - INTERVAL '2 days',
    18600,
    'USD',
    NULL,
    NULL,
    NULL,
    NULL,
    'EQUAL',
    '{"11111111-1111-4111-8111-111111111101":6200,"11111111-1111-4111-8111-111111111102":6200,"11111111-1111-4111-8111-111111111103":6200}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444404',
    '22222222-2222-4222-8222-222222222202',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111102',
    'Shinkansen Rail Passes (Tokyo-Kyoto)',
    'Transit',
    NOW() - INTERVAL '4 days',
    63000,
    'USD',
    94500,
    'JPY',
    0.006667,
    'API',
    'EQUAL',
    '{"11111111-1111-4111-8111-111111111101":21000,"11111111-1111-4111-8111-111111111102":21000,"11111111-1111-4111-8111-111111111103":21000}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- 7. Seed Settlement
INSERT INTO public.settlements (
  id,
  group_id,
  payer_id,
  recipient_id,
  amount_cents,
  currency,
  payment_rail,
  settled_at
)
VALUES (
  '55555555-5555-4555-8555-555555555501',
  '22222222-2222-4222-8222-222222222201',
  '11111111-1111-4111-8111-111111111103',
  '11111111-1111-4111-8111-111111111101',
  50000,
  'USD',
  'VENMO',
  NOW() - INTERVAL '1 day'
)
ON CONFLICT (id) DO NOTHING;
