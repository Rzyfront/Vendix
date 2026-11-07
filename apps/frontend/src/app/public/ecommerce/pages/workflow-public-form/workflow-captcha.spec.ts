import { leadingZeroBitsOfWord, sha256Words, solveCaptcha } from './workflow-captcha';

const hex = (words: Uint32Array) =>
  Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('');

describe('workflow captcha (proof of work)', () => {
  it('sha256Words matches the known vectors', () => {
    expect(hex(sha256Words(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hex(sha256Words(new Uint8Array()))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('counts leading zero bits of a word', () => {
    expect(leadingZeroBitsOfWord(0)).toBe(32);
    expect(leadingZeroBitsOfWord(0x00ffffff)).toBe(8);
    expect(leadingZeroBitsOfWord(0x80000000)).toBe(0);
  });

  it('finds a number whose hash has the required zero bits and echoes the signed fields', async () => {
    const challenge = {
      challenge: 'abcd',
      salt: '0123456789abcdef0123456789abcdef',
      algorithm: 'SHA-256' as const,
      difficulty: 12,
      expires_at: '2030-01-01T00:00:00.000Z',
      signature: 'sig',
    };
    const proof = await solveCaptcha(challenge);
    const words = sha256Words(new TextEncoder().encode(`${challenge.salt}${proof.number}`));
    expect(leadingZeroBitsOfWord(words[0])).toBeGreaterThanOrEqual(12);
    expect(proof).toEqual(jasmine.objectContaining({ salt: challenge.salt, expires_at: challenge.expires_at, signature: 'sig' }));
  });

  it('refuses an unsupported algorithm', async () => {
    await expectAsync(
      solveCaptcha({ challenge: '', salt: 'a', algorithm: 'MD5' as never, difficulty: 8, expires_at: '', signature: '' }),
    ).toBeRejected();
  });
});
