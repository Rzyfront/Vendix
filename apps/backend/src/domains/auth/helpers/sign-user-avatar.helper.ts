import { S3Service } from '@common/services/s3.service';

/**
 * QUI-982 — `users.avatar_url` persists the S3 *key*
 * (`organizations/<org>/users/<id>/avatars/<file>`), never a URL. Any user
 * payload that reaches the session (login, refresh, environment switch, /me)
 * must expose a signed URL: a bare key used as `<img src>` resolves against
 * the frontend host and 404s.
 *
 * Returns a shallow copy with `avatar_url` signed, or `null` when the user
 * has no avatar. External absolute URLs pass through unchanged (`signUrl`
 * contract).
 */
export async function signUserAvatar<T extends { avatar_url?: string | null }>(
  s3Service: Pick<S3Service, 'signUrl'>,
  user: T,
): Promise<T & { avatar_url: string | null }> {
  const signed = await s3Service.signUrl(user.avatar_url);
  return { ...user, avatar_url: signed || null };
}
