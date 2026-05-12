/**
 * List of well-known personal / consumer email domains.
 * Used to:
 * 1. Hide the auto-join domain setting in the UI when the current user is on
 *    one of these domains (it doesn't make sense to auto-join on gmail etc.).
 * 2. Prevent these domains from being set as an org's auto-join domain.
 * 3. Skip auto-setting the domain during login when the user's email is personal.
 */
export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "live.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mail.com",
  "protonmail.com",
  "proton.me",
]);

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}
