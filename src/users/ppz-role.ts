/**
 * PPZ role hierarchy. Stored on User.ppzRole. Only relevant for users
 * who have a linked ppzId — non-PPZ accounts always have ppzRole = null.
 *
 * Ordering matches the partner-app hierarchy from least to most senior:
 *
 *   new_member (default)  →  member  →  leader  →  block_leader  →
 *   big_leader  →  management  →  sponsors  →  artist
 *
 * The auto-job only ever moves a user along the New Member ↔ Member
 * transition based on lifetime points; everything from Leader upward
 * is set manually by an admin or manager. The auto-job never demotes
 * (a Member who later loses points doesn't drop back to New Member).
 */
export type PpzRole =
  | 'new_member'
  | 'member'
  | 'leader'
  | 'block_leader'
  | 'big_leader'
  | 'management'
  | 'sponsors'
  | 'artist';

export const PPZ_ROLES: readonly PpzRole[] = [
  'new_member',
  'member',
  'leader',
  'block_leader',
  'big_leader',
  'management',
  'sponsors',
  'artist',
] as const;

export const PPZ_ROLE_LABELS: Record<PpzRole, string> = {
  new_member: 'New Member',
  member: 'Member',
  leader: 'Leader',
  block_leader: 'Block Leader',
  big_leader: 'Big Leader',
  management: 'Management',
  sponsors: 'Sponsors',
  artist: 'Artist',
};

/**
 * Lifetime PPZ points required to auto-promote a New Member to Member.
 * Higher-tier transitions are admin-managed and not driven by this
 * threshold.
 */
export const MEMBER_LIFETIME_THRESHOLD = 2000;

/**
 * Decide the role to apply when a PPZ user's profile syncs (login or
 * manual sync). Pure function — no side effects.
 *
 *   - Non-PPZ user → null (no role)
 *   - First sync (current === null/undefined):
 *       lifetime >= threshold ? 'member' : 'new_member'
 *   - current === 'new_member' AND lifetime >= threshold → 'member'
 *   - otherwise → leave current alone (covers manual roles and the
 *     "no demotion" rule for established Members)
 */
export function autopromotePpzRole(opts: {
  current: PpzRole | null | undefined;
  lifetimePpzCurrency: number;
  hasPpzId: boolean;
}): PpzRole | null {
  if (!opts.hasPpzId) return null;
  const lifetime = opts.lifetimePpzCurrency || 0;
  if (!opts.current) {
    return lifetime >= MEMBER_LIFETIME_THRESHOLD ? 'member' : 'new_member';
  }
  if (opts.current === 'new_member' && lifetime >= MEMBER_LIFETIME_THRESHOLD) {
    return 'member';
  }
  return opts.current;
}
