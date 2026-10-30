/**
 * QUI-966 (S16): columns of `users` that never leave the auth API. Every
 * response builder that returns the user row goes through this helper, so the
 * bcrypt hash and the TOTP secret are not serialized; all other fields keep
 * their shape because the frontend reads them.
 */
export function toPublicAuthUser<T extends Record<string, any>>(
  user: T,
): Omit<T, 'password' | 'two_factor_secret'> {
  const {
    password: _password,
    two_factor_secret: _twoFactorSecret,
    ...publicUser
  } = user;
  return publicUser;
}
