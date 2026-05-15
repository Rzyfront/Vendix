import { normalizeAcmTags, sanitizeAcmTagValue } from './acm.service';

describe('AcmService tag normalization', () => {
  it('sanitizes wildcard hostnames for ACM tag values', () => {
    expect(sanitizeAcmTagValue('*.gorrerolicor.online')).toBe(
      '_.gorrerolicor.online',
    );
  });

  it('adds the managed tag and keeps caller tags AWS-compatible', () => {
    const tags = normalizeAcmTags([
      { key: 'wildcard_hostname', value: '*.example.com' },
      { key: 'store_id', value: '74' },
    ]);

    expect(tags).toEqual([
      { Key: 'vendix:managed', Value: 'true' },
      { Key: 'wildcard_hostname', Value: '_.example.com' },
      { Key: 'store_id', Value: '74' },
    ]);
  });
});
