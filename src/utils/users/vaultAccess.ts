/**
 * Which reps' recordings a person hears in the Vault. It comes from their company, not per-person
 * subscriptions (the old Big Five / salesperson_subscriptions setup is retired).
 *
 * Mirrors the app (slab-mobile src/game/vault.ts and boot.ts isAceCompany): Ace Cooperatives get
 * Marshall only; SLAB and everyone else get every published rep. Update both together when a new
 * company gets its own rep.
 */
export const isAceCompany = (company: { name?: string | null; slug?: string | null } | null | undefined) =>
  !!company && (/^ace/i.test(company.slug || '') || /^ace/i.test(company.name || ''))

export function vaultRepsFor(company: { name?: string | null; slug?: string | null } | null | undefined): string[] {
  return isAceCompany(company) ? ['Marshall'] : ['Marshall', 'Rylan']
}
