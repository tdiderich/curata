import { authModeStartupWarning } from "@/lib/auth-mode-check";

// Next.js runs register() once per server start, before any request.
export async function register() {
  const warning = authModeStartupWarning(process.env);
  if (warning) console.warn(warning);
}
