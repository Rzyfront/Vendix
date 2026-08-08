/**
 * Smoke test para QUI-606: valida que el `exceptionFactory` del pipe global
 * aplana correctamente los errores de class-validator al shape canónico
 * `BulkRowError`. No requiere backend corriendo ni JWT.
 *
 * Ejecutar con: `npx ts-node scripts/smoke-bulk-validation.ts`
 *   o:         `node --import tsx scripts/smoke-bulk-validation.ts`
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { BulkCustomerUploadDto } from '../src/domains/store/customers/dto/bulk-customer.dto';
import {
  flattenBulkValidationErrors,
  isBulkValidationError,
} from '../src/common/validators/bulk-validation.util';

async function main() {
  const badPayload = {
    customers: [
      {
        row_number: 2,
        document_number: '12345678',
        document_type: 'INVALID',
        email: 'not-an-email',
      },
      {
        row_number: 3,
        first_name: 'Maria',
        email: 'maria@example.com',
      },
    ],
  };

  const dto = plainToInstance(BulkCustomerUploadDto, badPayload);
  const errors = await validate(dto as any);

  console.log('=== Errores crudos de class-validator ===');
  console.log(JSON.stringify(errors, null, 2));

  console.log('\n=== isBulkValidationError ===');
  console.log(isBulkValidationError(errors));

  console.log('\n=== BulkRowError[] (shape canónico) ===');
  const flat = flattenBulkValidationErrors(errors);
  console.log(JSON.stringify(flat, null, 2));

  // Simula el exceptionFactory del pipe global
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errs) => {
      if (isBulkValidationError(errs)) {
        const f = flattenBulkValidationErrors(errs);
        return new BadRequestException({
          statusCode: 400,
          message: `Se encontraron ${f.length} error(es) de validación en la carga masiva`,
          error_code: 'CUST_BULK_VALIDATION',
          validationErrors: f,
        });
      }
      return new BadRequestException({ message: 'no-op' });
    },
  });

  try {
    await pipe.transform(dto, { type: 'body', metatype: BulkCustomerUploadDto });
    console.log('\n[ERROR] El pipe debió haber lanzado BadRequestException');
    process.exit(1);
  } catch (err) {
    const e = err as BadRequestException;
    const body = e.getResponse() as any;
    console.log('\n=== Response body (lo que recibe el frontend) ===');
    console.log(JSON.stringify(body, null, 2));

    if (body.error_code !== 'CUST_BULK_VALIDATION') {
      console.log('\n[FAIL] error_code debería ser CUST_BULK_VALIDATION');
      process.exit(1);
    }
    if (!Array.isArray(body.validationErrors) || body.validationErrors.length === 0) {
      console.log('\n[FAIL] validationErrors debe ser un array no vacío');
      process.exit(1);
    }
    const first = body.validationErrors[0];
    if (typeof first.row !== 'number' || !first.column || !first.message) {
      console.log('\n[FAIL] Cada BulkRowError debe tener row (number), column (string) y message (string)');
      console.log('Primer elemento:', first);
      process.exit(1);
    }
    console.log('\n[OK] Shape canónico válido. Primer BulkRowError:');
    console.log(JSON.stringify(first, null, 2));
  }
}

main().catch((e) => {
  console.error('Unexpected:', e);
  process.exit(1);
});
