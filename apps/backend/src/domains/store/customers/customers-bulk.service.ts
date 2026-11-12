import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CustomersService } from './customers.service';
import { AddressesService } from '../addresses/addresses.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  DOCUMENT_TYPE_CODES,
  DOCUMENT_TYPE_RULES,
} from '@common/constants/document-types';
import {
  BulkCustomerUploadDto,
  BulkCustomerUploadResultDto,
  BulkCustomerUploadItemResultDto,
  BulkRowError,
  BulkCustomerItemDto,
} from './dto/bulk-customer.dto';
import { buildReportBuffer } from '@common/reports/report-builder';
import type { ReportColumn } from '@common/reports/report-column.types';
import {
  FIELD_TO_COLUMN,
  getFieldAndColumnForCode,
} from '@common/validators/bulk-validation.util';

/**
 * Mapea un error interno (código de `VendixHttpException` + `details`) a un
 * `BulkRowError` en español, con código canónico y sugerencia de acción.
 *
 * El mapping es la ÚNICA fuente de verdad del copy de errores a nivel de
 * fila. Si la excepción ya trae un `message` en español (los `VendixHttpException`
 * que lanza `customers.service.ts`), se respeta; si no, se cae al genérico.
 *
 * @returns los campos `code`, `message` y `suggestion` que el bulk service
 *          pone en el `BulkRowError`. `row` y `field` se setean fuera.
 */
export function mapBulkErrorToUserCopy(
  errorCode: string,
  details: Record<string, unknown> | undefined,
): { code: string; message: string; suggestion?: string } {
  if (errorCode === 'SYS_CONFLICT_001') {
    const kind = details?.kind;
    if (kind === 'email') {
      const email = (details?.value as string | undefined) ?? 'este correo';
      return {
        code: 'duplicate_email',
        message: `El correo "${email}" ya está registrado en la organización`,
        suggestion:
          'Usa otro correo electrónico o elimina la fila si es un duplicado.',
      };
    }
    if (kind === 'document') {
      const doc = (details?.value as string | undefined) ?? '';
      const type = (details?.type as string | undefined) ?? '';
      return {
        code: 'duplicate_document',
        message: `Ya existe un cliente con el documento "${doc}" de tipo "${type}"`,
        suggestion:
          'Verifica que el documento no esté duplicado en la plantilla o usa otro tipo de documento.',
      };
    }
    return {
      code: 'conflict',
      message: 'El cliente no se pudo crear porque entra en conflicto con datos existentes',
    };
  }
  return { code: 'internal', message: 'Error interno al procesar la fila' };
}

@Injectable()
export class CustomersBulkService {
  private readonly MAX_BATCH_SIZE = 10000;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly customersService: CustomersService,
    private readonly addressesService: AddressesService,
  ) {}

  /**
   * Clave estable de un documento dentro del archivo/organización. El NIT se
   * compara sin DV pegado (`900123456-7` == `900123456`). Devuelve `null` si
   * la fila no trae documento.
   */
  private documentKey(customer: BulkCustomerItemDto): string | null {
    const raw = customer.document_number?.trim();
    if (!raw) return null;
    const type =
      customer.document_type?.trim().toUpperCase() ||
      (customer.person_type === 'JURIDICA' ? 'NIT' : 'CC');
    const base = type === 'NIT' ? raw.split('-')[0] : raw;
    const number = base.toUpperCase().replace(/[\s\-.]/g, '');
    return number ? `${type}:${number}` : null;
  }

  /**
   * Genera la plantilla de carga masiva en formato Excel (.xlsx)
   * Incluye ejemplos con y sin email para mostrar que es opcional.
   *
   * Los códigos de "Tipo Documento" se derivan del catálogo DIAN compartido
   * (`@common/constants/document-types`). No mantener una lista hardcodeada
   * aquí — añadir nuevos tipos en el catálogo y los ejemplos los respetarán.
   */
  async generateExcelTemplate(): Promise<Buffer> {
    const headers = [
      'Correo',
      'Nombre',
      'Apellido',
      'Documento',
      'Tipo Documento',
      'Teléfono',
      'Tipo Persona',
      'Razón Social',
      'DV',
      'Nombre Sede',
      'Dirección',
      'Dirección 2',
      'Ciudad',
      'Departamento',
      'Código DANE',
      'País',
      'Teléfono Sede',
    ];

    // Cada columna es texto (ejemplos). `key === header` para que las filas de
    // ejemplo (ya indexadas por el texto del encabezado) se reutilicen sin
    // reindexar y el contrato round-trip (parseFile mapea POR HEADER) quede intacto.
    const columns: ReportColumn[] = headers.map(
      (header): ReportColumn => ({ key: header, header, type: 'text' }),
    );

    const exampleData: Array<Record<string, string>> = [
      {
        Correo: 'maria.garcia@email.com',
        Nombre: 'Maria',
        Apellido: 'Garcia',
        Documento: '1023456789',
        'Tipo Documento': 'CC',
        Teléfono: '3001234567',
      },
      {
        Correo: 'juan.perez@email.com',
        Nombre: 'Juan',
        Apellido: 'Perez',
        Documento: '1023456780',
        'Tipo Documento': 'CC',
        Teléfono: '3012345678',
      },
      {
        Correo: '',
        Nombre: 'Ana',
        Apellido: 'Martinez',
        Documento: '1023456781',
        'Tipo Documento': 'CC',
        Teléfono: '3023456789',
      },
      {
        Correo: 'carlos.rodriguez@email.com',
        Nombre: 'Carlos',
        Apellido: 'Rodriguez',
        Documento: '1023456782',
        'Tipo Documento': 'CE',
        Teléfono: '3034567890',
      },
      {
        Correo: '',
        Nombre: 'Laura',
        Apellido: 'Sanchez',
        Documento: '900123456-7',
        'Tipo Documento': 'NIT',
        Teléfono: '3045678901',
      },
      {
        Correo: 'pedro.gomez@email.com',
        Nombre: 'Pedro',
        Apellido: 'Gomez',
        Documento: '1023456783',
        'Tipo Documento': 'CC',
        Teléfono: '3056789012',
      },
      {
        Correo: 'sofia.lopez@email.com',
        Nombre: 'Sofia',
        Apellido: 'Lopez',
        Documento: '1012345678',
        'Tipo Documento': 'TI',
        Teléfono: '3067890123',
      },
      {
        Correo: 'andres.diaz@email.com',
        Nombre: 'Andres',
        Apellido: 'Diaz',
        Documento: '1023456784',
        'Tipo Documento': 'CC',
        Teléfono: '3078901234',
      },
      {
        Correo: '',
        Nombre: 'Valentina',
        Apellido: 'Hernandez',
        Documento: '1023456785',
        'Tipo Documento': 'CC',
        Teléfono: '3089012345',
      },
      {
        Correo: 'diego.torres@email.com',
        Nombre: 'Diego',
        Apellido: 'Torres',
        Documento: 'AB123456',
        'Tipo Documento': 'PA',
        Teléfono: '3090123456',
      },
      // Persona jurídica con varias sedes: mismo NIT en varias filas = un solo
      // cliente con una ubicación por fila.
      {
        Correo: 'compras@acme.com',
        Nombre: '',
        Apellido: '',
        Documento: '900123456',
        'Tipo Documento': 'NIT',
        Teléfono: '6041234567',
        'Tipo Persona': 'JURIDICA',
        'Razón Social': 'Acme S.A.S',
        DV: '7',
        'Nombre Sede': 'Sede Principal',
        Dirección: 'Calle 10 # 20-30',
        'Dirección 2': 'Oficina 301',
        Ciudad: 'Medellín',
        Departamento: 'Antioquia',
        'Código DANE': '05001',
        País: 'CO',
        'Teléfono Sede': '6041234567',
      },
      {
        Correo: '',
        Nombre: '',
        Apellido: '',
        Documento: '900123456',
        'Tipo Documento': 'NIT',
        Teléfono: '',
        'Tipo Persona': 'JURIDICA',
        'Razón Social': 'Acme S.A.S',
        DV: '7',
        'Nombre Sede': 'Sede Norte',
        Dirección: 'Carrera 50 # 80-12',
        'Dirección 2': '',
        Ciudad: 'Bogotá',
        Departamento: 'Cundinamarca',
        'Código DANE': '11001',
        País: 'CO',
        'Teléfono Sede': '6017654321',
      },
    ];

    // Hoja de instrucciones con códigos válidos del catálogo DIAN.
    const instructions: Array<Record<string, string>> = [
      {
        Campo: 'Correo',
        Descripción: 'Correo electrónico del cliente (opcional)',
        Obligatorio: 'No',
      },
      {
        Campo: 'Nombre',
        Descripción: 'Nombre(s) del cliente',
        Obligatorio: 'Sí (o Documento)',
      },
      {
        Campo: 'Apellido',
        Descripción: 'Apellido(s) del cliente',
        Obligatorio: 'No',
      },
      {
        Campo: 'Documento',
        Descripción: 'Número de identificación',
        Obligatorio: 'Sí (o Nombre)',
      },
      {
        Campo: 'Tipo Documento',
        Descripción: 'Código DIAN del tipo de documento (ver lista abajo)',
        Obligatorio: 'No (por defecto CC)',
      },
      {
        Campo: 'Teléfono',
        Descripción: 'Número de contacto',
        Obligatorio: 'No',
      },
      {
        Campo: 'Tipo Persona',
        Descripción: 'NATURAL o JURIDICA',
        Obligatorio: 'No (por defecto NATURAL)',
      },
      {
        Campo: 'Razón Social',
        Descripción: 'Nombre legal de la empresa (personas jurídicas)',
        Obligatorio: 'Sí si Tipo Persona es JURIDICA',
      },
      {
        Campo: 'DV',
        Descripción: 'Dígito de verificación del NIT',
        Obligatorio: 'No',
      },
      {
        Campo: 'Nombre Sede',
        Descripción: 'Nombre de la ubicación o establecimiento (ej. Sede Norte)',
        Obligatorio: 'No',
      },
      {
        Campo: 'Dirección',
        Descripción:
          'Dirección de la ubicación. Repite el mismo Documento en varias filas para cargar varias ubicaciones de un mismo cliente',
        Obligatorio: 'No (si la llenas, Ciudad es obligatoria)',
      },
      {
        Campo: 'Dirección 2',
        Descripción: 'Complemento de la dirección (oficina, bodega, etc.)',
        Obligatorio: 'No',
      },
      {
        Campo: 'Ciudad',
        Descripción: 'Ciudad de la ubicación',
        Obligatorio: 'Sí si hay Dirección',
      },
      {
        Campo: 'Departamento',
        Descripción: 'Departamento o estado',
        Obligatorio: 'No',
      },
      {
        Campo: 'Código DANE',
        Descripción: 'Código DANE del municipio (5 dígitos, ej. 05001)',
        Obligatorio: 'No',
      },
      {
        Campo: 'País',
        Descripción: 'Código ISO del país',
        Obligatorio: 'No (por defecto CO)',
      },
      {
        Campo: 'Teléfono Sede',
        Descripción: 'Teléfono de contacto de la ubicación',
        Obligatorio: 'No',
      },
      { Campo: '', Descripción: '', Obligatorio: '' },
      {
        Campo: 'Códigos válidos de Tipo Documento',
        Descripción: '',
        Obligatorio: '',
      },
      ...DOCUMENT_TYPE_CODES.map((code) => ({
        Campo: code,
        Descripción: DOCUMENT_TYPE_RULES[code].label,
        Obligatorio: '',
      })),
    ];

    const instructionColumns: ReportColumn[] = [
      { key: 'Campo', header: 'Campo', type: 'text', width: 30 },
      { key: 'Descripción', header: 'Descripción', type: 'text', width: 55 },
      { key: 'Obligatorio', header: 'Obligatorio', type: 'text', width: 20 },
    ];

    return buildReportBuffer({
      sheets: [
        { name: 'Plantilla Clientes', columns, rows: exampleData },
        {
          name: 'Instrucciones',
          columns: instructionColumns,
          rows: instructions,
        },
      ],
    });
  }

  /**
   * Procesa la carga masiva de clientes.
   *
   * Política de errores (QUI-606):
   *  - Errores de lote (lote > 10000, sin store context) → 4xx con
   *    `VendixHttpException` (cuerpo entero falla).
   *  - Errores por fila (validación de campo, email duplicado, doc duplicado)
   *    → NO revientan el lote: se acumulan en `results[].row_error` y el
   *    endpoint responde 201 con `failed > 0` para que el frontend los
   *    pinte uno por uno.
   */
  async uploadCustomers(
    bulkUploadDto: BulkCustomerUploadDto,
  ): Promise<BulkCustomerUploadResultDto> {
    const { customers } = bulkUploadDto;

    if (customers.length > this.MAX_BATCH_SIZE) {
      throw new VendixHttpException(
        ErrorCodes.CUST_BULK_001,
        `El lote excede el tamaño máximo permitido de ${this.MAX_BATCH_SIZE} clientes`,
      );
    }

    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.CUST_BULK_004);
    }

    // Pre-calculamos duplicados DENTRO del archivo y los marcamos por fila
    // (no rompemos el lote entero). Cada fila duplicada se reporta con su
    // propio `BulkRowError`.
    const seenDocs = new Set<string>();
    const emailToFirstRow = new Map<string, number>();
    const duplicateEmailsByRow = new Map<number, string>(); // row -> email
    for (const customer of customers) {
      // Una fila adicional del mismo documento con dirección es otra ubicación
      // del mismo cliente: repite el correo legítimamente.
      const docKey = this.documentKey(customer);
      const isContinuation =
        !!docKey && seenDocs.has(docKey) && this.hasAddress(customer);
      if (docKey) seenDocs.add(docKey);
      if (!customer.email || isContinuation) continue;
      const normalized = customer.email.toLowerCase().trim();
      const row = customer.row_number ?? 0;
      if (emailToFirstRow.has(normalized)) {
        duplicateEmailsByRow.set(row, customer.email);
      } else {
        emailToFirstRow.set(normalized, row);
      }
    }

    const results: BulkCustomerUploadItemResultDto[] = [];
    let successful = 0;
    let failed = 0;
    let locationsAdded = 0;
    let warnings = 0;
    const organizationId = context?.organization_id;
    // Clientes creados/resueltos en este envío, por documento.
    const customerIdByDoc = new Map<string, number>();

    for (const customerData of customers) {
      const rowNum = customerData.row_number ?? 0;
      const pushError = (rowError: BulkRowError) => {
        const fieldCol =
          FIELD_TO_COLUMN[rowError.field] ?? rowError.column;
        results.push({
          customer: null,
          status: 'error',
          message: rowError.message,
          error: rowError.code,
          row_number: rowNum,
          row_error: { ...rowError, column: fieldCol },
        });
        failed++;
      };

      // Duplicado dentro del archivo: error per-row ANTES de tocar la BD.
      const dupEmail = duplicateEmailsByRow.get(rowNum);
      if (dupEmail) {
        pushError({
          row: rowNum,
          column: 'Correo',
          field: 'email',
          value: dupEmail,
          code: 'duplicate_email_in_file',
          message: `El correo "${dupEmail}" aparece más de una vez en la plantilla`,
          suggestion:
            'Deja solo una fila con este correo y elimina las demás (o usa correos distintos).',
        });
        continue;
      }

      const docKey = this.documentKey(customerData);
      const withAddress = this.hasAddress(customerData);
      const isJuridica = customerData.person_type === 'JURIDICA';

      if (isJuridica && !customerData.legal_name?.trim()) {
        pushError({
          row: rowNum,
          column: 'Razón Social',
          field: 'legal_name',
          value: null,
          code: 'missing_legal_name',
          message: 'La razón social es obligatoria para personas jurídicas',
          suggestion: 'Completa la columna "Razón Social" en esta fila.',
        });
        continue;
      }
      if (withAddress && !customerData.city?.trim()) {
        pushError({
          row: rowNum,
          column: 'Ciudad',
          field: 'city',
          value: null,
          code: 'missing_city',
          message: 'La ciudad es obligatoria cuando la fila trae una dirección',
          suggestion: 'Completa la columna "Ciudad" o deja vacía la dirección.',
        });
        continue;
      }

      /** Agrega la dirección de la fila como ubicación del cliente. */
      const addLocation = async (customerId: number) => {
        const { created } = await this.addressesService.addCustomerLocation(
          customerId,
          this.buildLocationDto(customerData),
        );
        return created;
      };

      /** Reporta la fila como ubicación agregada a un cliente existente. */
      const reportExistingCustomerLocation = async (
        customerId: number,
      ): Promise<void> => {
        try {
          const created = await addLocation(customerId);
          if (created) {
            results.push({
              customer: { id: customerId },
              status: 'location_added',
              message: 'Ubicación agregada al cliente existente',
              row_number: rowNum,
            });
            locationsAdded++;
          } else {
            results.push({
              customer: { id: customerId },
              status: 'warning',
              message: 'Ubicación ya registrada',
              row_number: rowNum,
            });
            warnings++;
          }
          successful++;
        } catch (locError) {
          pushError({
            row: rowNum,
            column: 'Dirección',
            field: 'address_line_1',
            value: customerData.address_line_1 ?? null,
            code: 'location_failed',
            message: this.errorMessage(locError),
          });
        }
      };

      try {
        // Validar: requiere al menos nombre O documento
        if (
          !customerData.first_name &&
          !customerData.legal_name &&
          !customerData.document_number
        ) {
          throw new VendixHttpException(
            ErrorCodes.CUST_BULK_002,
            'Se requiere al menos el nombre o el número de documento',
          );
        }

        // Mismo documento ya visto en este archivo/envío o ya existente en la
        // organización, y la fila trae dirección: es otra ubicación.
        if (withAddress && docKey) {
          let existingId = customerIdByDoc.get(docKey);
          if (existingId === undefined && organizationId) {
            const existing =
              await this.customersService.findByDocumentInOrganization(
                organizationId,
                docKey.split(':')[1],
                docKey.split(':')[0],
              );
            if (existing?.id) existingId = existing.id;
          }
          if (existingId !== undefined) {
            customerIdByDoc.set(docKey, existingId);
            await reportExistingCustomerLocation(existingId);
            continue;
          }
        }

        // Crear el cliente usando el servicio existente.
        // Sin email -> create() lo normaliza a null (resolveCustomerEmail).
        const createdCustomer = await this.customersService.create(
          storeId,
          this.buildCreateDto(customerData),
        );
        if (docKey && createdCustomer?.id !== undefined) {
          customerIdByDoc.set(docKey, createdCustomer.id);
        }

        let message = 'Cliente creado exitosamente';
        let status: 'success' | 'warning' = 'success';
        if (withAddress && createdCustomer?.id !== undefined) {
          try {
            if (await addLocation(createdCustomer.id)) locationsAdded++;
          } catch (locError) {
            status = 'warning';
            warnings++;
            message = `Cliente creado, pero la ubicación no se pudo guardar: ${this.errorMessage(locError)}`;
          }
        }

        results.push({
          customer: createdCustomer,
          status,
          message,
          row_number: rowNum,
        });
        successful++;
      } catch (error) {
        // Si viene de un `VendixHttpException` (lanzado por `customers.service.ts`
        // o por la validación `CUST_BULK_002` de arriba), usamos su `errorCode`
        // + `details` para producir el `BulkRowError` canónico en español.
        // Si es un error inesperado, caemos al genérico.
        const isVendix = error instanceof VendixHttpException;
        const errorCode = isVendix
          ? (error as VendixHttpException).errorCode
          : 'INTERNAL';
        // `getResponse()` devuelve el body de NestJS: { error_code, message, details }
        const responseBody: { message?: string; details?: Record<string, unknown> } = isVendix
          ? ((error as VendixHttpException).getResponse() as {
              message?: string;
              details?: Record<string, unknown>;
            })
          : { message: error?.message };
        const details = responseBody.details;

        // Carrera / otra página: el documento ya existe y la fila trae
        // dirección → es una ubicación nueva, no un duplicado.
        if (
          errorCode === 'SYS_CONFLICT_001' &&
          details?.kind === 'document' &&
          withAddress &&
          typeof details.existing_customer_id === 'number'
        ) {
          if (docKey) customerIdByDoc.set(docKey, details.existing_customer_id);
          await reportExistingCustomerLocation(details.existing_customer_id);
          continue;
        }

        // El mapper es la fuente de verdad del copy en español.
        // `baseMessage` solo es un fallback si el mapper no devuelve nada
        // útil (p.ej. para códigos que todavía no cubre).
        const userCopy = mapBulkErrorToUserCopy(errorCode, details);
        const baseMessage =
          typeof responseBody?.message === 'string'
            ? responseBody.message
            : undefined;
        const message = userCopy.message || baseMessage || 'Error desconocido';

        const { field, column } = getFieldAndColumnForCode(userCopy.code);
        const rowError: BulkRowError = {
          row: rowNum,
          column,
          field,
          value: details?.value ?? null,
          code: userCopy.code,
          message,
        };
        if (userCopy.suggestion) rowError.suggestion = userCopy.suggestion;

        results.push({
          customer: null,
          status: 'error',
          message,
          error: errorCode,
          row_number: rowNum,
          row_error: rowError,
        });
        failed++;
      }
    }

    return {
      success: failed === 0,
      total_processed: customers.length,
      successful,
      failed,
      locations_added: locationsAdded,
      warnings,
      results,
    };
  }

  private hasAddress(customer: BulkCustomerItemDto): boolean {
    return !!customer.address_line_1?.trim();
  }

  private errorMessage(error: unknown): string {
    if (error instanceof VendixHttpException) {
      const body = error.getResponse() as { message?: unknown };
      if (typeof body?.message === 'string') return body.message;
    }
    return error instanceof Error ? error.message : 'Error desconocido';
  }

  /**
   * Payload de `CustomersService.create`. Las columnas nuevas solo se envían
   * cuando vienen en la fila, para que una plantilla antigua produzca
   * exactamente el mismo payload de siempre.
   */
  private buildCreateDto(customer: BulkCustomerItemDto) {
    const isJuridica = customer.person_type === 'JURIDICA';
    const dto: Record<string, unknown> = {
      email: customer.email?.trim() || null,
      first_name: isJuridica ? '' : customer.first_name?.trim() || '',
      last_name: isJuridica ? '' : customer.last_name?.trim() || '',
      document_number: customer.document_number?.trim() || '',
      document_type: (customer.document_type?.trim() ||
        (isJuridica ? 'NIT' : 'CC')) as any,
      phone: customer.phone?.trim(),
    };
    if (customer.person_type) dto.person_type = customer.person_type;
    if (isJuridica) dto.legal_name = customer.legal_name?.trim();
    if (customer.verification_digit?.trim()) {
      dto.verification_digit = customer.verification_digit.trim();
    }
    return dto as unknown as Parameters<CustomersService['create']>[1];
  }

  private buildLocationDto(customer: BulkCustomerItemDto) {
    const dto: Record<string, unknown> = {
      address_line_1: customer.address_line_1!.trim(),
      city: customer.city!.trim(),
      state: customer.state?.trim() || '',
      country: customer.country?.trim().toUpperCase() || 'CO',
    };
    if (customer.address_line_2?.trim()) {
      dto.address_line_2 = customer.address_line_2.trim();
    }
    if (customer.municipality_code?.trim()) {
      dto.municipality_code = customer.municipality_code.trim();
    }
    if (customer.location_name?.trim()) dto.label = customer.location_name.trim();
    if (customer.location_phone?.trim()) {
      dto.phone_number = customer.location_phone.trim();
    }
    return dto as unknown as Parameters<AddressesService['addCustomerLocation']>[1];
  }
}
