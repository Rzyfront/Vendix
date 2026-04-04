import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { EmployeesService } from './employees.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { DefaultPanelUIService } from '../../../../common/services/default-panel-ui.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  BulkEmployeeUploadDto,
  BulkEmployeeItemDto,
  BulkEmployeeUploadResultDto,
  BulkEmployeeItemResultDto,
} from './dto/bulk-employee.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';

@Injectable()
export class EmployeesBulkService {
  private readonly MAX_BATCH_SIZE = 1000;

  private readonly HEADER_MAP: Record<string, string> = {
    nombre: 'first_name',
    'first name': 'first_name',
    apellido: 'last_name',
    'last name': 'last_name',
    'tipo documento': 'document_type',
    'document type': 'document_type',
    'número documento': 'document_number',
    'numero documento': 'document_number',
    'document number': 'document_number',
    'fecha contratación': 'hire_date',
    'fecha contratacion': 'hire_date',
    'hire date': 'hire_date',
    'tipo contrato': 'contract_type',
    'contract type': 'contract_type',
    'salario base': 'base_salary',
    'base salary': 'base_salary',
    cargo: 'position',
    position: 'position',
    departamento: 'department',
    department: 'department',
    'frecuencia pago': 'payment_frequency',
    'payment frequency': 'payment_frequency',
    banco: 'bank_name',
    bank: 'bank_name',
    'número cuenta': 'bank_account_number',
    'numero cuenta': 'bank_account_number',
    'account number': 'bank_account_number',
    'tipo cuenta': 'bank_account_type',
    'account type': 'bank_account_type',
    eps: 'health_provider',
    'health provider': 'health_provider',
    'fondo pensión': 'pension_fund',
    'fondo pension': 'pension_fund',
    'pension fund': 'pension_fund',
    'nivel riesgo arl': 'arl_risk_level',
    'arl risk level': 'arl_risk_level',
    'fondo cesantías': 'severance_fund',
    'fondo cesantias': 'severance_fund',
    'severance fund': 'severance_fund',
    'caja compensación': 'compensation_fund',
    'caja compensacion': 'compensation_fund',
    'compensation fund': 'compensation_fund',
    '¿es usuario?': 'is_user',
    'es usuario': 'is_user',
    'is user': 'is_user',
    email: 'email',
    correo: 'email',
    teléfono: 'phone',
    telefono: 'phone',
    phone: 'phone',
  };

  private readonly CONTRACT_TYPE_MAP: Record<string, string> = {
    indefinido: 'indefinite',
    indefinite: 'indefinite',
    'término fijo': 'fixed_term',
    'termino fijo': 'fixed_term',
    fixed_term: 'fixed_term',
    'prestación de servicios': 'service',
    'prestacion de servicios': 'service',
    service: 'service',
    aprendiz: 'apprentice',
    apprentice: 'apprentice',
  };

  private readonly PAYMENT_FREQUENCY_MAP: Record<string, string> = {
    mensual: 'monthly',
    monthly: 'monthly',
    quincenal: 'biweekly',
    biweekly: 'biweekly',
    semanal: 'weekly',
    weekly: 'weekly',
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly employeesService: EmployeesService,
    private readonly responseService: ResponseService,
    private readonly defaultPanelUIService: DefaultPanelUIService,
  ) {}

  generateExcelTemplate(): Buffer {
    const headers = [
      'Nombre',
      'Apellido',
      'Tipo Documento',
      'Número Documento',
      'Fecha Contratación',
      'Tipo Contrato',
      'Salario Base',
      'Cargo',
      'Departamento',
      'Frecuencia Pago',
      'Banco',
      'Número Cuenta',
      'Tipo Cuenta',
      'EPS',
      'Fondo Pensión',
      'Nivel Riesgo ARL',
      'Fondo Cesantías',
      'Caja Compensación',
      '¿Es Usuario?',
      'Email',
      'Teléfono',
    ];

    const exampleData = [
      { Nombre: 'Juan Carlos', Apellido: 'Pérez López', 'Tipo Documento': 'CC', 'Número Documento': '1020304050', 'Fecha Contratación': '2024-01-15', 'Tipo Contrato': 'Indefinido', 'Salario Base': 2500000, Cargo: 'Vendedor', Departamento: 'Ventas', 'Frecuencia Pago': 'Quincenal', Banco: 'Bancolombia', 'Número Cuenta': '12345678901', 'Tipo Cuenta': 'Ahorros', EPS: 'Sura', 'Fondo Pensión': 'Protección', 'Nivel Riesgo ARL': 1, 'Fondo Cesantías': 'Porvenir', 'Caja Compensación': 'Comfama', '¿Es Usuario?': 'No', Email: '', Teléfono: '3001234567' },
      { Nombre: 'María Fernanda', Apellido: 'García Rodríguez', 'Tipo Documento': 'CC', 'Número Documento': '1060708090', 'Fecha Contratación': '2024-03-01', 'Tipo Contrato': 'Término Fijo', 'Salario Base': 3200000, Cargo: 'Administradora', Departamento: 'Administración', 'Frecuencia Pago': 'Mensual', Banco: 'Davivienda', 'Número Cuenta': '98765432100', 'Tipo Cuenta': 'Corriente', EPS: 'Nueva EPS', 'Fondo Pensión': 'Porvenir', 'Nivel Riesgo ARL': 1, 'Fondo Cesantías': 'Protección', 'Caja Compensación': 'Compensar', '¿Es Usuario?': 'Si', Email: 'maria.garcia@empresa.com', Teléfono: '3109876543' },
      { Nombre: 'Andrés Felipe', Apellido: 'Martínez Ríos', 'Tipo Documento': 'CC', 'Número Documento': '1098765432', 'Fecha Contratación': '2023-06-10', 'Tipo Contrato': 'Indefinido', 'Salario Base': 4500000, Cargo: 'Contador', Departamento: 'Contabilidad', 'Frecuencia Pago': 'Mensual', Banco: 'BBVA', 'Número Cuenta': '55566677788', 'Tipo Cuenta': 'Ahorros', EPS: 'Sanitas', 'Fondo Pensión': 'Colfondos', 'Nivel Riesgo ARL': 1, 'Fondo Cesantías': 'FNA', 'Caja Compensación': 'Cafam', '¿Es Usuario?': 'Si', Email: 'andres.martinez@empresa.com', Teléfono: '3204567890' },
      { Nombre: 'Laura Camila', Apellido: 'Hernández Ospina', 'Tipo Documento': 'CE', 'Número Documento': 'E-456789', 'Fecha Contratación': '2025-01-08', 'Tipo Contrato': 'Prestación de Servicios', 'Salario Base': 6000000, Cargo: 'Diseñadora Gráfica', Departamento: 'Marketing', 'Frecuencia Pago': 'Mensual', Banco: 'Nequi', 'Número Cuenta': '3115551234', 'Tipo Cuenta': 'Ahorros', EPS: 'Compensar', 'Fondo Pensión': 'Protección', 'Nivel Riesgo ARL': 1, 'Fondo Cesantías': 'Porvenir', 'Caja Compensación': 'Colsubsidio', '¿Es Usuario?': 'No', Email: '', Teléfono: '3115551234' },
      { Nombre: 'Carlos Eduardo', Apellido: 'Ramírez Duarte', 'Tipo Documento': 'CC', 'Número Documento': '79856432', 'Fecha Contratación': '2023-11-20', 'Tipo Contrato': 'Indefinido', 'Salario Base': 1423500, Cargo: 'Bodeguero', Departamento: 'Logística', 'Frecuencia Pago': 'Quincenal', Banco: 'Banco de Bogotá', 'Número Cuenta': '33344455566', 'Tipo Cuenta': 'Ahorros', EPS: 'Famisanar', 'Fondo Pensión': 'Porvenir', 'Nivel Riesgo ARL': 3, 'Fondo Cesantías': 'Colfondos', 'Caja Compensación': 'Comfenalco', '¿Es Usuario?': 'No', Email: '', Teléfono: '3178889900' },
      { Nombre: 'Valentina', Apellido: 'Torres Mejía', 'Tipo Documento': 'TI', 'Número Documento': '1007654321', 'Fecha Contratación': '2025-02-01', 'Tipo Contrato': 'Aprendiz', 'Salario Base': 1300000, Cargo: 'Auxiliar Ventas', Departamento: 'Ventas', 'Frecuencia Pago': 'Quincenal', Banco: 'Bancolombia', 'Número Cuenta': '77788899900', 'Tipo Cuenta': 'Ahorros', EPS: 'Sura', 'Fondo Pensión': 'Protección', 'Nivel Riesgo ARL': 1, 'Fondo Cesantías': 'Protección', 'Caja Compensación': 'Comfama', '¿Es Usuario?': 'No', Email: '', Teléfono: '3229998877' },
      { Nombre: 'Santiago', Apellido: 'Moreno Castillo', 'Tipo Documento': 'CC', 'Número Documento': '1045678901', 'Fecha Contratación': '2024-07-15', 'Tipo Contrato': 'Indefinido', 'Salario Base': 2800000, Cargo: 'Cajero Principal', Departamento: 'Ventas', 'Frecuencia Pago': 'Semanal', Banco: 'Scotiabank Colpatria', 'Número Cuenta': '11122233344', 'Tipo Cuenta': 'Corriente', EPS: 'Salud Total', 'Fondo Pensión': 'Old Mutual', 'Nivel Riesgo ARL': 2, 'Fondo Cesantías': 'Porvenir', 'Caja Compensación': 'Cafam', '¿Es Usuario?': 'Si', Email: 'santiago.moreno@empresa.com', Teléfono: '3156667788' },
      { Nombre: 'Diana Marcela', Apellido: 'López Vargas', 'Tipo Documento': 'CC', 'Número Documento': '52987654', 'Fecha Contratación': '2023-03-12', 'Tipo Contrato': 'Indefinido', 'Salario Base': 8500000, Cargo: 'Gerente General', Departamento: 'Dirección', 'Frecuencia Pago': 'Mensual', Banco: 'Itaú', 'Número Cuenta': '99988877766', 'Tipo Cuenta': 'Corriente', EPS: 'Colsanitas', 'Fondo Pensión': 'Skandia', 'Nivel Riesgo ARL': 1, 'Fondo Cesantías': 'Colfondos', 'Caja Compensación': 'Compensar', '¿Es Usuario?': 'Si', Email: 'diana.lopez@empresa.com', Teléfono: '3013214567' },
      { Nombre: 'Pedro José', Apellido: 'Gómez Salazar', 'Tipo Documento': 'PP', 'Número Documento': 'AX123456', 'Fecha Contratación': '2024-09-01', 'Tipo Contrato': 'Término Fijo', 'Salario Base': 3800000, Cargo: 'Técnico Mantenimiento', Departamento: 'Operaciones', 'Frecuencia Pago': 'Quincenal', Banco: 'Banco Popular', 'Número Cuenta': '44455566677', 'Tipo Cuenta': 'Ahorros', EPS: 'Medimás', 'Fondo Pensión': 'Porvenir', 'Nivel Riesgo ARL': 4, 'Fondo Cesantías': 'FNA', 'Caja Compensación': 'Combarranquilla', '¿Es Usuario?': 'No', Email: '', Teléfono: '3007776655' },
      { Nombre: 'Natalia Andrea', Apellido: 'Restrepo Muñoz', 'Tipo Documento': 'CC', 'Número Documento': '1112223334', 'Fecha Contratación': '2024-11-18', 'Tipo Contrato': 'Indefinido', 'Salario Base': 2200000, Cargo: 'Asesora Comercial', Departamento: 'Ventas', 'Frecuencia Pago': 'Quincenal', Banco: 'Daviplata', 'Número Cuenta': '3142223344', 'Tipo Cuenta': 'Ahorros', EPS: 'Sura', 'Fondo Pensión': 'Protección', 'Nivel Riesgo ARL': 1, 'Fondo Cesantías': 'Protección', 'Caja Compensación': 'Comfama', '¿Es Usuario?': 'Si', Email: 'natalia.restrepo@empresa.com', Teléfono: '3142223344' },
    ];

    const ws = XLSX.utils.json_to_sheet(exampleData, { header: headers });

    const colWidths = headers.map((h) => ({
      wch: Math.max(h.length + 5, 20),
    }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Empleados');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  parseFile(buffer: Buffer): BulkEmployeeItemDto[] {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 2) {
        throw new BadRequestException(
          'El archivo debe contener al menos una fila de encabezados y una fila de datos',
        );
      }

      const rawHeaders = jsonData[0] as string[];
      const headerMap: Record<number, string> = {};

      rawHeaders.forEach((h, index) => {
        if (!h) return;
        const normalized = h.toString().trim().toLowerCase();
        const dtoKey = this.HEADER_MAP[normalized];
        if (dtoKey) {
          headerMap[index] = dtoKey;
        }
      });

      const employees: any[] = [];

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as any[];
        if (!row || row.length === 0) continue;

        const employee: Record<string, any> = {};
        let hasData = false;

        row.forEach((cellValue, index) => {
          const key = headerMap[index];
          if (key) {
            const val =
              cellValue === undefined || cellValue === null ? '' : cellValue;

            if (['base_salary', 'arl_risk_level'].includes(key)) {
              const num = parseFloat(val);
              employee[key] = isNaN(num) ? 0 : num;
            } else if (key === 'is_user') {
              if (typeof val === 'boolean') {
                employee[key] = val;
              } else {
                const strVal = String(val).trim().toLowerCase();
                employee[key] =
                  strVal === 'si' ||
                  strVal === 'yes' ||
                  strVal === 'true' ||
                  strVal === '1';
              }
            } else {
              employee[key] = typeof val === 'string' ? val.trim() : val;
            }

            if (val !== '') hasData = true;
          }
        });

        if (hasData && employee['first_name'] && employee['document_number']) {
          employees.push(employee);
        }
      }

      return employees;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Error al procesar el archivo: ' + error.message,
      );
    }
  }

  async uploadEmployees(
    dto: BulkEmployeeUploadDto,
    user: any,
  ): Promise<BulkEmployeeUploadResultDto> {
    const { employees } = dto;

    if (employees.length > this.MAX_BATCH_SIZE) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_BULK_001,
        `Batch size ${employees.length} exceeds max ${this.MAX_BATCH_SIZE}`,
      );
    }

    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const organizationId = context?.organization_id;

    if (!storeId || !organizationId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Detect duplicates within batch
    const docKeys = new Set<string>();
    const duplicatesInBatch = new Set<string>();
    for (const emp of employees) {
      const key = `${(emp.document_type || 'CC').toUpperCase()}-${emp.document_number}`;
      if (docKeys.has(key)) {
        duplicatesInBatch.add(key);
      }
      docKeys.add(key);
    }

    const results: BulkEmployeeItemResultDto[] = [];
    let successful = 0;
    let failed = 0;
    let users_created = 0;
    let users_linked = 0;

    for (const empData of employees) {
      try {
        // Normalize contract type
        const rawContract = (empData.contract_type || '').toString().trim().toLowerCase();
        const normalizedContract = this.CONTRACT_TYPE_MAP[rawContract] || 'indefinite';

        // Normalize payment frequency
        const rawFrequency = (empData.payment_frequency || '').toString().trim().toLowerCase();
        const normalizedFrequency = this.PAYMENT_FREQUENCY_MAP[rawFrequency] || 'monthly';

        // Normalize document type
        const docType = (empData.document_type || 'CC').toString().trim().toUpperCase();
        const docNumber = empData.document_number.toString().trim();

        // Check for batch duplicate
        const docKey = `${docType}-${docNumber}`;
        if (duplicatesInBatch.has(docKey)) {
          const firstOccurrenceIndex = employees.findIndex(
            (e) =>
              (e.document_type || 'CC').toString().trim().toUpperCase() === docType &&
              e.document_number.toString().trim() === docNumber,
          );
          const currentIndex = employees.indexOf(empData);
          if (currentIndex !== firstOccurrenceIndex) {
            throw new VendixHttpException(
              ErrorCodes.PAYROLL_BULK_003,
              `Documento ${docType} ${docNumber} duplicado en el archivo`,
            );
          }
        }

        // Validate required fields
        if (!empData.first_name || !empData.last_name) {
          throw new VendixHttpException(
            ErrorCodes.PAYROLL_BULK_002,
            'Nombre y apellido son requeridos',
          );
        }
        if (!empData.hire_date) {
          throw new VendixHttpException(
            ErrorCodes.PAYROLL_BULK_002,
            'Fecha de contratación es requerida',
          );
        }
        if (empData.base_salary === undefined || empData.base_salary < 0) {
          throw new VendixHttpException(
            ErrorCodes.PAYROLL_BULK_002,
            'Salario base debe ser mayor o igual a 0',
          );
        }
        if (
          empData.arl_risk_level !== undefined &&
          (empData.arl_risk_level < 1 || empData.arl_risk_level > 5)
        ) {
          throw new VendixHttpException(
            ErrorCodes.PAYROLL_BULK_002,
            'Nivel de riesgo ARL debe estar entre 1 y 5',
          );
        }

        // Check if employee already exists in DB (org-level unique constraint)
        const unscoped = this.prisma.withoutScope() as any;
        const existingEmployee = await unscoped.employees.findFirst({
          where: {
            organization_id: organizationId,
            document_type: docType,
            document_number: docNumber,
          },
        });

        // Handle user linking/creation
        let userId: number | undefined;
        let userCreated = false;
        let userLinked = false;

        if (empData.is_user && !existingEmployee) {
          if (!empData.email) {
            throw new VendixHttpException(
              ErrorCodes.PAYROLL_BULK_004,
              `Email requerido para ${empData.first_name} ${empData.last_name}`,
            );
          }

          // Search for existing user by document
          const existingUser = await this.prisma.users.findFirst({
            where: {
              organization_id: organizationId,
              document_type: docType,
              document_number: docNumber,
            },
          });

          if (existingUser) {
            // Check user isn't already linked to another employee
            const linkedEmployee = await this.prisma.employees.findFirst({
              where: {
                user_id: existingUser.id,
              },
            });

            if (linkedEmployee) {
              throw new VendixHttpException(
                ErrorCodes.PAYROLL_BULK_005,
                `Usuario ${docType} ${docNumber} ya vinculado a empleado ${linkedEmployee.employee_code}`,
              );
            }

            userId = existingUser.id;
            userLinked = true;
          } else {
            // Create new user
            const hashedPassword = await bcrypt.hash('Vendix2024!', 10);
            const username = `${empData.first_name.toLowerCase().replace(/\s+/g, '')}.${empData.last_name.toLowerCase().replace(/\s+/g, '')}`;

            const newUser = await this.prisma.users.create({
              data: {
                first_name: empData.first_name.trim(),
                last_name: empData.last_name.trim(),
                email: empData.email.trim().toLowerCase(),
                username,
                password: hashedPassword,
                organization_id: organizationId,
                document_type: docType,
                document_number: docNumber,
                phone: empData.phone || null,
                state: 'active',
                updated_at: new Date(),
              },
            });

            // Create user_settings with default panel UI
            const config = await this.defaultPanelUIService.generatePanelUI('STORE_ADMIN');
            await this.prisma.user_settings.create({
              data: {
                user_id: newUser.id,
                app_type: 'STORE_ADMIN',
                config,
              },
            });

            // Create store_users junction
            await this.prisma.store_users.create({
              data: {
                store_id: storeId,
                user_id: newUser.id,
              },
            });

            userId = newUser.id;
            userCreated = true;
          }
        }

        let employee: any;
        let wasUpdated = false;

        if (existingEmployee) {
          // Update existing employee
          const updateData: any = {
            first_name: empData.first_name.trim(),
            last_name: empData.last_name.trim(),
            hire_date: new Date(empData.hire_date),
            contract_type: normalizedContract,
            base_salary: new Prisma.Decimal(Number(empData.base_salary)),
            payment_frequency: normalizedFrequency,
            position: empData.position?.trim() || null,
            department: empData.department?.trim() || null,
            bank_name: empData.bank_name?.trim() || null,
            bank_account_number: empData.bank_account_number?.trim() || null,
            bank_account_type: empData.bank_account_type?.trim() || null,
            health_provider: empData.health_provider?.trim() || null,
            pension_fund: empData.pension_fund?.trim() || null,
            arl_risk_level: empData.arl_risk_level || 1,
            severance_fund: empData.severance_fund?.trim() || null,
            compensation_fund: empData.compensation_fund?.trim() || null,
          };

          employee = await this.prisma.employees.update({
            where: { id: existingEmployee.id },
            data: updateData,
          });
          wasUpdated = true;
        } else {
          // Create new employee
          const createDto: CreateEmployeeDto = {
            first_name: empData.first_name.trim(),
            last_name: empData.last_name.trim(),
            document_type: docType,
            document_number: docNumber,
            hire_date: empData.hire_date,
            contract_type: normalizedContract as CreateEmployeeDto['contract_type'],
            base_salary: Number(empData.base_salary),
            position: empData.position?.trim() || undefined,
            department: empData.department?.trim() || undefined,
            payment_frequency: normalizedFrequency as CreateEmployeeDto['payment_frequency'],
            bank_name: empData.bank_name?.trim() || undefined,
            bank_account_number: empData.bank_account_number?.trim() || undefined,
            bank_account_type: empData.bank_account_type?.trim() || undefined,
            health_provider: empData.health_provider?.trim() || undefined,
            pension_fund: empData.pension_fund?.trim() || undefined,
            arl_risk_level: empData.arl_risk_level || 1,
            severance_fund: empData.severance_fund?.trim() || undefined,
            compensation_fund: empData.compensation_fund?.trim() || undefined,
            user_id: userId,
          };

          employee = await this.employeesService.create(createDto);
        }

        if (userCreated) users_created++;
        if (userLinked) users_linked++;
        successful++;

        results.push({
          employee,
          status: 'success',
          message: wasUpdated
            ? `Empleado ${docType} ${docNumber} actualizado`
            : userCreated
              ? 'Empleado creado y usuario del sistema generado'
              : userLinked
                ? 'Empleado creado y vinculado a usuario existente'
                : 'Empleado creado exitosamente',
          user_created: userCreated,
          user_linked: userLinked,
        });
      } catch (error) {
        failed++;
        results.push({
          employee: null,
          status: 'error',
          message: error.message,
          error: error.constructor.name,
        });
      }
    }

    return {
      success: failed === 0,
      total_processed: employees.length,
      successful,
      failed,
      users_created,
      users_linked,
      results,
    };
  }

  validateBulkEmployees(
    employees: BulkEmployeeItemDto[],
  ): { isValid: boolean; errors: string[]; validEmployees: BulkEmployeeItemDto[] } {
    const errors: string[] = [];
    const validEmployees: BulkEmployeeItemDto[] = [];

    const docKeys = new Set<string>();
    const duplicates = new Set<string>();

    for (const emp of employees) {
      const key = `${(emp.document_type || 'CC').toUpperCase()}-${emp.document_number}`;
      if (docKeys.has(key)) duplicates.add(key);
      else docKeys.add(key);
    }

    if (duplicates.size > 0) {
      errors.push(
        `Documentos duplicados en el archivo: ${Array.from(duplicates).join(', ')}`,
      );
    }

    for (const [index, emp] of employees.entries()) {
      if (!emp.first_name || !emp.document_number) {
        errors.push(
          `Fila ${index + 1}: Faltan datos obligatorios (Nombre o Número Documento)`,
        );
        continue;
      }
      validEmployees.push(emp);
    }

    return {
      isValid: errors.length === 0,
      errors,
      validEmployees,
    };
  }
}
