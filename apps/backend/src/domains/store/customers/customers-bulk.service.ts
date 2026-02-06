import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CustomersService } from './customers.service';
import { RequestContextService } from '@common/context/request-context.service';
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
   * Incluye 10 clientes de ejemplo con datos realistas
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
        Correo: 'ana.martinez@email.com',
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
        Correo: 'laura.sanchez@email.com',
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
        Correo: 'valentina.hernandez@email.com',
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
      throw new BadRequestException(
        `El lote excede el tamaño máximo permitido de ${this.MAX_BATCH_SIZE} clientes`,
      );
    }

    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('No se pudo determinar la tienda actual');
    }

    // Validar duplicados en el archivo
    const emailsInFile = new Set<string>();
    const duplicateEmails: string[] = [];

    for (const customer of customers) {
      const normalizedEmail = customer.email.toLowerCase().trim();
      if (emailsInFile.has(normalizedEmail)) {
        duplicateEmails.push(customer.email);
      } else {
        emailsInFile.add(normalizedEmail);
      }
    }

    if (duplicateEmails.length > 0) {
      throw new BadRequestException(
        `Emails duplicados en el archivo: ${duplicateEmails.slice(0, 5).join(', ')}${duplicateEmails.length > 5 ? '...' : ''}`,
      );
    }

    const results: BulkCustomerUploadItemResultDto[] = [];
    let successful = 0;
    let failed = 0;

    for (const customerData of customers) {
      try {
        // Validar datos básicos
        if (!customerData.email) {
          throw new BadRequestException('El correo es requerido');
        }
        if (!customerData.first_name) {
          throw new BadRequestException('El nombre es requerido');
        }
        if (!customerData.last_name) {
          throw new BadRequestException('El apellido es requerido');
        }
        if (!customerData.document_number) {
          throw new BadRequestException('El documento es requerido');
        }

        // Crear el cliente usando el servicio existente
        const createdCustomer = await this.customersService.create(storeId, {
          email: customerData.email.toLowerCase().trim(),
          first_name: customerData.first_name.trim(),
          last_name: customerData.last_name.trim(),
          document_number: customerData.document_number.trim(),
          document_type: customerData.document_type?.trim() || 'CC',
          phone: customerData.phone?.trim(),
        });

        results.push({
          customer: createdCustomer,
          status: 'success',
          message: 'Cliente creado exitosamente',
        });
        successful++;
      } catch (error) {
        results.push({
          customer: null,
          status: 'error',
          message: error.message || 'Error desconocido',
          error: error.constructor.name,
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
