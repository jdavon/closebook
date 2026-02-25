import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database.types";

// Fallbacks prevent @supabase/ssr from throwing during Next.js static
// prerendering (build step) where env vars may not be available.
// The client is instantiated but never called during prerender — real
// values are used at runtime in the browser.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://placeholder.invalid",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder"
  );
}
