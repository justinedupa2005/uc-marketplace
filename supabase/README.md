# Supabase database setup

The project database changes are stored in `supabase/migrations` so the schema
can be reproduced and reviewed alongside the application code.

## Apply the current migration

This project is not linked to the Supabase CLI yet. To apply the migration now:

1. Open the project's Supabase dashboard.
2. Go to **SQL Editor** and create a new query.
3. Copy the complete contents of
   `migrations/20260917000000_create_marketplace_core.sql` into the query.
4. Select **Run**.

The migration creates the marketplace tables, their Row Level Security
policies, and the public `listing-images` bucket with its upload policies.

The browser-safe publishable key in `.env.local` cannot perform database
definition changes. Applying migrations remotely requires the SQL Editor or a
linked Supabase CLI session.
