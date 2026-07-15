/**
 * Auth user type shared across the app.
 *
 * Auth is now handled directly by Supabase Auth (see `lib/supabase.ts`
 * and `hooks/useAuth.tsx`). This file only retains the `AuthUser`
 * interface so existing imports don't break.
 */

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}
