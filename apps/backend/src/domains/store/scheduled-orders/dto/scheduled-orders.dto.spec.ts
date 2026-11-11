import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgendaQueryDto } from './scheduled-orders.dto';

/** S16: `status=no_show` de un filtro guardado no produce 400 y equivale a `expired`. */
describe('AgendaQueryDto.status', () => {
  const parse = async (status?: string) => {
    const dto = plainToInstance(AgendaQueryDto, { from: '2026-11-02', to: '2026-11-08', status });
    return { dto, errors: await validate(dto) };
  };

  it('no_show se acepta y se traduce a expired', async () => {
    const { dto, errors } = await parse('no_show');
    expect(errors).toHaveLength(0);
    expect(dto.status).toBe('expired');
  });

  it('en una lista traduce solo ese estado y no duplica expired', async () => {
    const a = await parse('scheduled,no_show');
    expect(a.errors).toHaveLength(0);
    expect(a.dto.status).toBe('scheduled,expired');
    const b = await parse('expired,no_show');
    expect(b.errors).toHaveLength(0);
    expect(b.dto.status).toBe('expired');
  });

  it('los estados vigentes siguen igual y uno desconocido sigue rechazándose', async () => {
    const ok = await parse('scheduled,ready');
    expect(ok.errors).toHaveLength(0);
    expect(ok.dto.status).toBe('scheduled,ready');
    expect((await parse(undefined)).errors).toHaveLength(0);
    expect((await parse('bogus')).errors.length).toBeGreaterThan(0);
  });
});
