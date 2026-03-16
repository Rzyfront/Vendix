import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CustomersService } from './customers.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  BulkCustomerUploadDto,
  BulkCustomerUploadResultDto,
  BulkCustomerUploadItemResultDto,
} from './dto/bulk-customer.dto';
import * as XLSX from 'xlsx';

@Injectable()
export class CustomersBulkService {
  private readonly MAX_BATCH_SIZE = 1000;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly customersService: CustomersService,
  ) {}

  /**
   * Genera la plantilla de carga masiva en formato Excel (.xlsx)
   * Incluye ejemplos con y sin email para mostrar que es opcional
   */
  async generateExcelTemplate(): Promise<Buffer> {
    const headers = [
      'Correo',
      'Nombre',
      'Apellido',
      'Documento',
      'Tipo Documento',
      'Teléfono',
    ];

    const exampleData = [
      {
        Correo: 'maria.garcia@email.com',
        Nombre: 'Maria',
        Apellido: 'Garcia',
        Documento: '12345678',
        'Tipo Documento': 'CC',
        Teléfono: '3001234567',
      },
      {
        Correo: 'juan.perez@email.com',
        Nombre: 'Juan',
        Apellido: 'Perez',
        Documento: '23456789',
        'Tipo Documento': 'CC',
        Teléfono: '3012345678',
      },
      {
        Correo: '',
        Nombre: 'Ana',
        Apellido: 'Martinez',
        Documento: '34567890',
        'Tipo Documento': 'CC',
        Teléfono: '3023456789',
      },
      {
        Correo: 'carlos.rodriguez@email.com',
        Nombre: 'Carlos',
        Apellido: 'Rodriguez',
        Documento: '45678901',
        'Tipo Documento': 'CE',
        Teléfono: '3034567890',
      },
      {
        Correo: '',
        Nombre: 'Laura',
        Apellido: 'Sanchez',
        Documento: '56789012',
        'Tipo Documento': 'CC',
        Teléfono: '3045678901',
      },
      {
        Correo: 'pedro.gomez@email.com',
        Nombre: 'Pedro',
        Apellido: 'Gomez',
        Documento: '67890123',
        'Tipo Documento': 'CC',
        Teléfono: '3056789012',
      },
      {
        Correo: 'sofia.lopez@email.com',
        Nombre: 'Sofia',
        Apellido: 'Lopez',
        Documento: '78901234',
        'Tipo Documento': 'TI',
        Teléfono: '3067890123',
      },
      {
        Correo: 'andres.diaz@email.com',
        Nombre: 'Andres',
        Apellido: 'Diaz',
        Documento: '89012345',
        'Tipo Documento': 'CC',
        Teléfono: '3078901234',
      },
      {
        Correo: '',
        Nombre: 'Valentina',
        Apellido: 'Hernandez',
        Documento: '90123456',
        'Tipo Documento': 'CC',
        Teléfono: '3089012345',
      },
      {
        Correo: 'diego.torres@email.com',
        Nombre: 'Diego',
        Apellido: 'Torres',
        Documento: '01234567',
        'Tipo Documento': 'PP',
        Teléfono: '3090123456',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(exampleData, { header: headers });

    // Ajustar ancho de columnas
    const colWidths = headers.map((h) => ({ wch: Math.max(h.length + 5, 20) }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Clientes');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Procesa la carga masiva de clientes
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

    // Validar duplicados en el archivo (solo emails que existan)
    const emailsInFile = new Set<string>();
    const duplicateEmails: string[] = [];

    for (const customer of customers) {
      if (!customer.email) continue;
      const normalizedEmail = customer.email.toLowerCase().trim();
      if (emailsInFile.has(normalizedEmail)) {
        duplicateEmails.push(customer.email);
      } else {
        emailsInFile.add(normalizedEmail);
      }
    }

    if (duplicateEmails.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.CUST_BULK_003,
        `Emails duplicados en el archivo: ${duplicateEmails.slice(0, 5).join(', ')}${duplicateEmails.length > 5 ? '...' : ''}`,
      );
    }

    const results: BulkCustomerUploadItemResultDto[] = [];
    let successful = 0;
    let failed = 0;

    for (const customerData of customers) {
      const rowNum = customerData.row_number;

      try {
        // Validar: requiere al menos nombre O documento
        if (!customerData.first_name && !customerData.document_number) {
          throw new VendixHttpException(
            ErrorCodes.CUST_BULK_002,
            'Se requiere al menos el nombre o el número de documento',
          );
        }

        // Generar placeholder email si no hay email
        const email =
          customerData.email?.toLowerCase().trim() ||
          `noemail-${crypto.randomUUID()}@placeholder.vendix`;

        // Crear el cliente usando el servicio existente
        const createdCustomer = await this.customersService.create(storeId, {
          email,
          first_name: customerData.first_name?.trim() || '',
          last_name: customerData.last_name?.trim() || '',
          document_number: customerData.document_number?.trim() || '',
          document_type: customerData.document_type?.trim() || 'CC',
          phone: customerData.phone?.trim(),
        });

        results.push({
          customer: createdCustomer,
          status: 'success',
          message: 'Cliente creado exitosamente',
          row_number: rowNum,
        });
        successful++;
      } catch (error) {
        results.push({
          customer: null,
          status: 'error',
          message: error.message || 'Error desconocido',
          error: error.constructor.name,
          row_number: rowNum,
        });
        failed++;
      }
    }

    return {
      success: failed === 0,
      total_processed: customers.length,
      successful,
      failed,
      results,
    };
  }
}
