import { createHmac } from 'crypto';

/** Label of every ticket Vex files for a missing capability. */
export const CAPABILITY_REQUEST_TAG = 'vex-capability-request';
const CAPABILITY_KEY_TAG_PREFIX = 'capability:';
export const CAPABILITY_VOTE_TAG_PREFIX = 'capability-vote:';

/** Tag that makes one capability one ticket, whatever store asks for it. */
export function capabilityKeyTag(capabilityKey: string): string {
  return `${CAPABILITY_KEY_TAG_PREFIX}${capabilityKey}`;
}

/**
 * A store's vote: HMAC of the store id under a server secret. A plain hash of
 * a small integer is reversible by brute force; the ticket belongs to the
 * organization that asked first, and its people must not learn which other
 * stores voted. Fails closed without a secret.
 */
export function capabilityVoteTag(
  storeId: number,
  secret: string | undefined = process.env.JWT_SECRET,
): string {
  if (!secret) {
    throw new Error('capabilityVoteTag: missing server secret (JWT_SECRET)');
  }
  const digest = createHmac('sha256', secret)
    .update(`vex-capability-vote:store:${storeId}`)
    .digest('hex')
    .slice(0, 24);
  return `${CAPABILITY_VOTE_TAG_PREFIX}${digest}`;
}

/**
 * Tags only the capability flow may write. Stripped from every HTTP writer of
 * `support_tickets.tags` (tickets create/update, PQR admin update, superadmin
 * update) so nobody can pre-claim a capability key and collect other stores'
 * votes.
 */
export function isReservedCapabilityTag(tag: string): boolean {
  return (
    tag === CAPABILITY_REQUEST_TAG ||
    tag.startsWith(CAPABILITY_KEY_TAG_PREFIX) ||
    tag.startsWith(CAPABILITY_VOTE_TAG_PREFIX)
  );
}

/**
 * The tags an HTTP writer may set: `requested` without reserved tags, plus the
 * reserved tags the ticket already had (an update neither adds nor drops them).
 * `undefined` stays `undefined` so a partial update leaves `tags` untouched.
 */
export function withoutReservedCapabilityTags(
  requested: string[] | undefined,
  current: string[] = [],
): string[] | undefined {
  if (!Array.isArray(requested)) return undefined;
  return [
    ...requested.filter((tag) => !isReservedCapabilityTag(tag)),
    ...current.filter(isReservedCapabilityTag),
  ];
}
