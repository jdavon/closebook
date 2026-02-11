-- ============================================================================
-- AUTH TRIGGER (requires elevated permissions)
-- ============================================================================
-- This migration must be run via ONE of these methods:
--
-- Option A (Recommended): Supabase Dashboard > SQL Editor > "Run as superuser"
--   Click the dropdown arrow next to "Run" and select "Run as superuser"
--
-- Option B: Supabase CLI
--   supabase db push
--
-- Option C: Supabase Dashboard > Database > Hooks
--   Create a Database Webhook that fires on auth.users INSERT
--   and calls the handle_new_user() function
-- ============================================================================

-- Create trigger to auto-create profile when user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
