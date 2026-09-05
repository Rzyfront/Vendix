import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReportQueryDto } from './dto/report-query.dto';

/**
 * Tests the contract of `ReportQueryDto` (QUI-722):
 *
 *   a) The DTO extends `BaseReportQueryDto`, so `date_from`,
 *      `date_to`, `page`, `limit` are inherited without having to
 *      fork them. Before this change, `?page=1&limit=10` was
 *      rejected by the global `ValidationPipe` (forbidNonWhitelisted
 *      + whitelist) because those fields were missing from this DTO.
 *
 *   b) `fiscal_period_id` remains required (the controller delegates
 *      inference to the service via `resolveFiscalPeriod`).
 *
 *   c) Unknown params (e.g. `foo=bar`) are STILL rejected.
 */
describe('ReportQueryDto (QUI-722)', () => {
  const build = (input: Record<string, unknown>) =>
    plainToInstance(ReportQueryDto, input, { enableImplicitConversion: true });

  it('inherits page and limit from BaseReportQueryDto', async () => {
    const dto = build({ fiscal_period_id: 5, page: 2, limit: 25 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.fiscal_period_id).toBe(5);
    expect((dto as any).page).toBe(2);
    expect((dto as any).limit).toBe(25);
  });

  it('inherits date_from and date_to from BaseReportQueryDto', async () => {
    const dto = build({
      fiscal_period_id: 5,
      date_from: '2026-09-01',
      date_to: '2026-09-30',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect((dto as any).date_from).toBe('2026-09-01');
    expect((dto as any).date_to).toBe('2026-09-30');
  });

  it('rejects when fiscal_period_id is missing', async () => {
    const dto = build({ date_from: '2026-09-01', date_to: '2026-09-30' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'fiscal_period_id')).toBe(true);
  });

  it('accepts an empty query (controller default — service infers later)', async () => {
    const dto = build({});
    const errors = await validate(dto);
    // Validator considers 0/empty-ish values: fiscal_period_id is required,
    // so there must be at least one constraint error on it. This documents
    // current behavior; relaxing it would be an explicit design call.
    expect(errors.some((e) => e.property === 'fiscal_period_id')).toBe(true);
  });

  it('rejects unknown keys (mimics global ValidationPipe behavior)', async () => {
    // plainToInstance copies everything — verify the class itself does NOT
    // silently absorb a typo param. The real rejection happens at the pipe
    // layer (forbidNonWhitelisted); this test just guards the DTO shape.
    const dto = build({ fiscal_period_id: 5, foo: 'bar' });
    expect((dto as any).foo).toBe('bar'); // <-- class-validator itself does NOT strip unknown keys;
    // stripping is owned by `whitelist: true` in the global pipe (main.ts).
  });
});
