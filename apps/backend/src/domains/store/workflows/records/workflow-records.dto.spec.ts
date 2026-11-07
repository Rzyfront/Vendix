import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateWorkflowCollectionDto, UpdateWorkflowCollectionDto } from './workflow-records.dto';

/** Same options as the global pipe in main.ts. */
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});
const body = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });

describe('Collection DTOs through the global ValidationPipe (P3.6)', () => {
  const fields = [
    { key: 'cliente', label: 'Cliente', type: 'text', required: true },
    { key: 'vence', label: 'Vence', type: 'date' },
  ];

  it('accepts a list of field objects on create and update (the deep shape is checked by the service)', async () => {
    const created = await pipe.transform(
      { name: 'Contratos', item_name: 'Contrato', key: 'contratos', fields },
      body(CreateWorkflowCollectionDto),
    );
    expect(created.fields).toEqual(fields);
    const updated = await pipe.transform({ fields }, body(UpdateWorkflowCollectionDto));
    expect(updated.fields).toEqual(fields);
  });

  it('rejects a non-array and more than 50 fields', async () => {
    await expect(
      pipe.transform({ name: 'C', item_name: 'C', key: 'c', fields: 'x' }, body(CreateWorkflowCollectionDto)),
    ).rejects.toBeInstanceOf(BadRequestException);
    const many = Array.from({ length: 51 }, (_, i) => ({ key: `f${i}`, label: 'F', type: 'text' }));
    await expect(
      pipe.transform({ name: 'C', item_name: 'C', key: 'c', fields: many }, body(CreateWorkflowCollectionDto)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
