import { signUserAvatar } from './sign-user-avatar.helper';

describe('signUserAvatar (QUI-982)', () => {
  const s3Service = {
    signUrl: jest.fn(async (key: string | null | undefined) =>
      key ? `https://bucket.s3.amazonaws.com/${key}?X-Amz-Signature=sig` : undefined,
    ),
  };

  beforeEach(() => s3Service.signUrl.mockClear());

  it('replaces the stored S3 key with a signed storage URL', async () => {
    const user = {
      id: 114,
      first_name: 'Demo',
      avatar_url: 'organizations/vendix-demo-33/users/114/avatars/a.webp',
    };

    const result = await signUserAvatar(s3Service, user);

    expect(result).toEqual({
      id: 114,
      first_name: 'Demo',
      avatar_url:
        'https://bucket.s3.amazonaws.com/organizations/vendix-demo-33/users/114/avatars/a.webp?X-Amz-Signature=sig',
    });
    expect(s3Service.signUrl).toHaveBeenCalledWith(user.avatar_url);
    // The source row is not mutated.
    expect(user.avatar_url).toBe(
      'organizations/vendix-demo-33/users/114/avatars/a.webp',
    );
  });

  it.each([null, undefined, ''])(
    'returns avatar_url null when the user has no avatar (%p)',
    async (avatar_url) => {
      const result = await signUserAvatar(s3Service, { id: 1, avatar_url });
      expect(result).toEqual({ id: 1, avatar_url: null });
    },
  );
});
