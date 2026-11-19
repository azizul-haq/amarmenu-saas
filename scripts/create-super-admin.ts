/**
 * scripts/create-super-admin.ts
 * Provision a Super Admin user securely.
 * - Reads email from process.env.SUPER_ADMIN_EMAIL
 * - Generates cryptographically secure random password
 * - Prints password once to stdout
 * - Zero hardcoded credentials
 */

import crypto from 'crypto';
import fs from 'fs';
import pg from 'pg';

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('ERROR: SUPER_ADMIN_EMAIL environment variable is required and must be a valid email.');
    console.error('Example: SUPER_ADMIN_EMAIL="admin@amarmenu.com" npx tsx scripts/create-super-admin.ts');
    process.exit(1);
  }

  // Load db connection string
  let dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl && fs.existsSync('.env.staging')) {
    const env = fs.readFileSync('.env.staging', 'utf8');
    const match = env.match(/SUPABASE_DB_URL=([^\r\n]+)/);
    if (match) dbUrl = match[1];
  }

  if (!dbUrl) {
    console.error('ERROR: SUPABASE_DB_URL environment variable is required.');
    process.exit(1);
  }

  // Generate cryptographically secure random password
  // 16 bytes = 22 characters base64url + symbols
  const rawBytes = crypto.randomBytes(18).toString('base64url');
  const randomPassword = `A1!${rawBytes}`;

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if user exists in auth.users
    const existing = await client.query('SELECT id FROM auth.users WHERE lower(email) = $1', [email]);
    let userId: string;

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      // Update password
      await client.query(`
        UPDATE auth.users
        SET 
          encrypted_password = extensions.crypt($1, extensions.gen_salt('bf', 10)),
          email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
          raw_app_meta_data = raw_app_meta_data || '{"provider":"email","providers":["email"]}'::jsonb,
          raw_user_meta_data = raw_user_meta_data || '{"name":"Super Administrator"}'::jsonb,
          updated_at = NOW()
        WHERE id = $2;
      `, [randomPassword, userId]);
      console.log(`Updated existing auth user ${email} with new credentials.`);
    } else {
      userId = crypto.randomUUID();
      await client.query(`
        INSERT INTO auth.users (
          id,
          instance_id,
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
          $1,
          '00000000-0000-0000-0000-000000000000',
          $2,
          extensions.crypt($3, extensions.gen_salt('bf', 10)),
          NOW(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{"name":"Super Administrator"}'::jsonb,
          'authenticated',
          'authenticated',
          NOW(),
          NOW()
        );
      `, [userId, email, randomPassword]);

      // Add identity
      await client.query(`
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
          $1,
          $1,
          json_build_object('sub', $1::text, 'email', $2::text),
          'email',
          $2,
          NOW(),
          NOW(),
          NOW()
        );
      `, [userId, email]);
      console.log(`Created new auth user ${email}.`);
    }

    // 2. Ensure record in platform_admins
    await client.query(`
      INSERT INTO public.platform_admins (
        auth_user_id,
        email,
        full_name,
        role,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        $1,
        $2,
        'Super Administrator',
        'super_admin',
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (auth_user_id) DO UPDATE SET
        role = 'super_admin',
        is_active = true,
        updated_at = NOW();
    `, [userId, email]);

    await client.query('COMMIT');

    console.log('\n======================================================');
    console.log(' SUPER ADMIN PROVISIONED SUCCESSFULLY');
    console.log('======================================================');
    console.log(` Email:    ${email}`);
    console.log(` Password: ${randomPassword}`);
    console.log('======================================================');
    console.log(' IMPORTANT: Copy this password immediately.');
    console.log(' It is printed ONCE and never stored in plaintext.');
    console.log('======================================================\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to create super admin:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
