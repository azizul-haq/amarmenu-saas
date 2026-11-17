-- ==============================================================================
-- AmarMenu Migration: Seed Restaurant B and Owner B for Multi-Tenant Testing
-- Version: 20261117000008_test_seed_restaurant_b.sql
-- ==============================================================================

DO $$
DECLARE
  v_rest_b_id UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_owner_b_id UUID := 'b1111111-1111-1111-1111-111111111111';
  v_cat_b_id UUID := 'b2222222-2222-2222-2222-222222222222';
  v_item_b_id UUID := 'b3333333-3333-3333-3333-333333333333';
  v_order_b_id UUID := 'b4444444-4444-4444-4444-444444444444';
  v_rest_a_id UUID;
BEGIN
  -- 1. Create Restaurant B
  INSERT INTO restaurants (
    id, name, slug, phone, email, city, address, subscription_plan, is_active
  ) VALUES (
    v_rest_b_id,
    'Dhanmondi Treat (Rest B)',
    'dhanmondi-treat',
    '+8801722223333',
    'contact@dhanmonditreat.com',
    'Dhaka',
    'Road 27, Dhanmondi, Dhaka',
    'growth',
    true
  )
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  -- 2. Create Auth User for Owner B (ownerb@amarmenu.com / password123)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'ownerb@amarmenu.com') THEN
    INSERT INTO auth.users (
      id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      role,
      aud,
      created_at,
      updated_at
    ) VALUES (
      v_owner_b_id,
      'ownerb@amarmenu.com',
      crypt('password123', gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Owner Restaurant B"}'::jsonb,
      'authenticated',
      'authenticated',
      NOW(),
      NOW()
    );
  ELSE
    SELECT id INTO v_owner_b_id FROM auth.users WHERE email = 'ownerb@amarmenu.com';
    UPDATE auth.users
    SET encrypted_password = crypt('password123', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, NOW())
    WHERE id = v_owner_b_id;
  END IF;

  -- Identity for Owner B
  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_owner_b_id,
    json_build_object('sub', v_owner_b_id::text, 'email', 'ownerb@amarmenu.com')::jsonb,
    'email',
    'ownerb@amarmenu.com',
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (provider, provider_id) DO NOTHING;

  -- 3. Link Owner B to Restaurant B in restaurant_staff
  IF NOT EXISTS (SELECT 1 FROM restaurant_staff WHERE email = 'ownerb@amarmenu.com' AND restaurant_id = v_rest_b_id) THEN
    INSERT INTO restaurant_staff (
      auth_user_id,
      restaurant_id,
      full_name,
      phone,
      email,
      role,
      is_active
    ) VALUES (
      v_owner_b_id,
      v_rest_b_id,
      'Owner Restaurant B',
      '+8801722223333',
      'ownerb@amarmenu.com',
      'owner',
      true
    );
  ELSE
    UPDATE restaurant_staff
    SET auth_user_id = v_owner_b_id,
        role = 'owner',
        is_active = true
    WHERE email = 'ownerb@amarmenu.com' AND restaurant_id = v_rest_b_id;
  END IF;

  -- 4. Create Menu Category for Restaurant B
  INSERT INTO menu_categories (
    id, restaurant_id, name, display_order, is_active
  ) VALUES (
    v_cat_b_id,
    v_rest_b_id,
    'Rest B Platters',
    1,
    true
  )
  ON CONFLICT (id) DO NOTHING;

  -- 5. Create Menu Item for Restaurant B
  INSERT INTO menu_items (
    id, restaurant_id, category_id, name, base_price, is_available
  ) VALUES (
    v_item_b_id,
    v_rest_b_id,
    v_cat_b_id,
    'Kacchi Khichuri Platter B',
    450.00,
    true
  )
  ON CONFLICT (id) DO NOTHING;

  -- 6. Create Test Order for Restaurant B
  INSERT INTO orders (
    id,
    restaurant_id,
    order_number,
    order_type,
    items,
    subtotal,
    tax,
    total,
    status
  ) VALUES (
    v_order_b_id,
    v_rest_b_id,
    'ORD-B-1001',
    'counter',
    '[{"id":"b3333333-3333-3333-3333-333333333333","name":"Kacchi Khichuri Platter B","price":450,"quantity":1,"total":450}]'::jsonb,
    450.00,
    0.00,
    450.00,
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;

  -- 7. Ensure Restaurant A has a test order as well
  SELECT id INTO v_rest_a_id FROM restaurants WHERE slug = 'demo-restaurant' LIMIT 1;
  IF v_rest_a_id IS NOT NULL THEN
    INSERT INTO orders (
      id,
      restaurant_id,
      order_number,
      order_type,
      items,
      subtotal,
      tax,
      total,
      status
    ) VALUES (
      'a4444444-4444-4444-4444-444444444444',
      v_rest_a_id,
      'ORD-A-1001',
      'counter',
      '[{"name":"Burger A","price":250,"quantity":1,"total":250}]'::jsonb,
      250.00,
      0.00,
      250.00,
      'pending'
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

END $$;
