import { BadRequestException } from '@nestjs/common';

const SECRET_KEY =
  /^(?:confirmation_?token|access_?token|refresh_?token|authorization|cookie|set-cookie|password|api_?key|secret|bearer|raw_?audio|reasoning(?:_content|_details)?|thinking(?:_blocks)?|chain_of_thought|scratchpad)$/i;

/** Artifacts are business results, never credentials, signed URLs or private reasoning. */
export function safeObjectiveArtifact(value: unknown): unknown {
  const visiting = new WeakSet<object>();
  const clean = (input: unknown, depth: number): unknown => {
    if (depth > 64)
      throw new BadRequestException('Artifact nesting limit exceeded');
    if (input === null || input === undefined) return null;
    if (typeof input === 'string') {
      if (/^Bearer\s+\S+/i.test(input)) return '[credential-redacted]';
      if (
        /https?:\/\/[^\s]+[?&](?:X-Amz-(?:Signature|Credential|Security-Token)|Signature|token|access_token)=/i.test(
          input,
        )
      )
        return '[signed-url-redacted-use-storage-key]';
      return input;
    }
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input === 'boolean') return input;
    if (typeof input !== 'object') return null;
    if (input instanceof Date) return input.toISOString();
    if (visiting.has(input))
      throw new BadRequestException('Cyclic artifacts are not supported');
    visiting.add(input);
    try {
      if (Array.isArray(input))
        return input.map((item) => clean(item, depth + 1));
      return Object.fromEntries(
        Object.entries(input)
          .filter(([key]) => !SECRET_KEY.test(key))
          .map(([key, item]) => [key, clean(item, depth + 1)]),
      );
    } finally {
      visiting.delete(input);
    }
  };
  return clean(value, 0);
}

/** Known transport envelopes only: fetching a historical artifact is not a new domain observation. */
export function isHistoricalObjectiveArtifact(value: unknown): boolean {
  const visit = (input: unknown, depth: number): boolean => {
    if (
      depth > 4 ||
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input)
    )
      return false;
    const envelope = input as Record<string, unknown>;
    if (envelope.artifact === true) return true;
    return ['data', 'body', 'response'].some((key) =>
      visit(envelope[key], depth + 1),
    );
  };
  return visit(value, 0);
}
