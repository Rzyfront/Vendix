import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateQuotationDto } from './create-quotation.dto';
import { PreviewContractQuotationDto } from './preview-contract-quotation.dto';

describe('contract quotation due_date validation', () => {
  const cases = [
    { name: 'create', body: (due_date: unknown) => ({ items: [], due_date }) },
    { name: 'preview', body: (due_date: unknown) => ({ due_date }) },
  ];

  for (const testCase of cases) {
    describe(testCase.name, () => {
      async function hasDueDateError(value: unknown): Promise<boolean> {
        const payload = testCase.body(value);
        const instance = testCase.name === 'create'
          ? plainToInstance(CreateQuotationDto, payload)
          : plainToInstance(PreviewContractQuotationDto, payload);
        const errors = await validate(instance);
        return errors.some((error) => error.property === 'due_date');
      }

      it('allows null as an explicit cleared date', async () => {
        expect(await hasDueDateError(null)).toBe(false);
      });

      it('allows a valid date-only value', async () => {
        expect(await hasDueDateError('2026-02-28')).toBe(false);
      });

      it('rejects ISO timestamps because the agreed value is date-only', async () => {
        expect(await hasDueDateError('2026-02-28T10:00:00.000Z')).toBe(true);
      });

      it('rejects impossible calendar dates instead of normalizing them', async () => {
        expect(await hasDueDateError('2026-02-31')).toBe(true);
      });
    });
  }
});
