import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fixture, signReview } from '../../../test/agentic/f-recipe.fixtures';
const script = resolve(
  __dirname,
  '../../../../../scripts/agent-recipe-sign-review.cjs',
);
describe('F offline human attestation utility (synthetic evidence only)', () => {
  beforeEach(() => {
    process.env.AI_RECIPE_REVIEW_KEY = 'ab'.repeat(32);
  });
  afterEach(() => {
    delete process.env.AI_RECIPE_REVIEW_KEY;
  });
  it('signature is byte-equivalent to backend canonical verification; never calls DB/provider', () => {
    const { recipe, quality } = fixture();
    const { signature, ...review } = signReview(recipe);
    const output = spawnSync(process.execPath, [script], {
      env: { AI_RECIPE_REVIEW_KEY: process.env.AI_RECIPE_REVIEW_KEY },
      input: JSON.stringify(review),
      encoding: 'utf8',
    });
    expect(output.status).toBe(0);
    expect(output.stdout).not.toContain('ab'.repeat(32));
    expect(JSON.parse(output.stdout).signature).toBe(signature);
    expect(() =>
      quality.validateReview(recipe, JSON.parse(output.stdout)),
    ).not.toThrow();
  });
  it.each(['missing-key', 'oversize', 'already-signed', 'malformed'])(
    'refuses %s without printing input or key',
    (kind) => {
      const { recipe } = fixture();
      const signed = signReview(recipe),
        { signature, ...unsigned } = signed;
      const input =
        kind === 'oversize'
          ? 'x'.repeat(64001)
          : kind === 'malformed'
            ? 'not-json'
            : JSON.stringify(kind === 'already-signed' ? signed : unsigned);
      const result = spawnSync(process.execPath, [script], {
        env:
          kind === 'missing-key'
            ? {}
            : { AI_RECIPE_REVIEW_KEY: process.env.AI_RECIPE_REVIEW_KEY },
        input,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain('ab'.repeat(32));
    },
  );
});
