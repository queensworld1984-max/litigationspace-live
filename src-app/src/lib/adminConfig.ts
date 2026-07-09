/**
 * Shared allowlist for internal admin dashboards.
 * Only these email accounts may access the Marketing Growth OS
 * and Analytics Dashboard — in the sidebar, via routes, and via API.
 */
export const ALLOWED_INTERNAL_DASHBOARD_EMAILS: string[] = [
  'queensworld1984@gmail.com',
  'dorothypierce84@gmail.com',
]

/** Returns true if the given email is in the internal dashboard allowlist. */
export function isInternalDashboardEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const lower = email.toLowerCase()
  return ALLOWED_INTERNAL_DASHBOARD_EMAILS.some(e => e.toLowerCase() === lower)
}
