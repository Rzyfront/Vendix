import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProviderDto } from './update-provider.dto';

async function check(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProviderDto, payload);
  const errors = await validate(dto);
  return { dto, nameErrors: errors.filter((e) => e.property === 'display_name') };
}

describe('UpdateProviderDto.display_name', () => {
  it('accepts a new visible name and trims it', async () => {
    const { dto, nameErrors } = await check({ display_name: '  Andrés Quintero  ' });
    expect(nameErrors).toHaveLength(0);
    expect(dto.display_name).toBe('Andrés Quintero');
  });

  it.each(['', '   '])('rejects an empty visible name (%p)', async (value) => {
    const { nameErrors } = await check({ display_name: value });
    expect(nameErrors).toHaveLength(1);
  });

  it('rejects a name longer than the column (100)', async () => {
    const { nameErrors } = await check({ display_name: 'a'.repeat(101) });
    expect(nameErrors).toHaveLength(1);
  });

  it('keeps other updates working without a display_name', async () => {
    const { nameErrors } = await check({ is_active: false, bio: '' });
    expect(nameErrors).toHaveLength(0);
  });
});
