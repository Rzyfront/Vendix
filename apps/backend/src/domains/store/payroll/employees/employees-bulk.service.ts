import {
  Injectable,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import * as bcrypt from 'bcryptjs';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { EmployeesService } from './employees.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { DefaultPanelUIService } from '../../../../common/services/default-panel-ui.service';
import { S3Service } from '@common/services/s3.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  BulkEmployeeUploadDto,
  BulkEmployeeItemDto,
  BulkEmployeeUploadResultDto,
  BulkEmployeeItemResultDto,
  BulkEmployeeAnalysisResultDto,
  BulkEmployeeAnalysisItemDto,
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
    private readonly s3Service: S3Service,
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

  /**
   * Analiza un archivo Excel/CSV sin procesar los empleados.
   * Retorna un analisis detallado por empleado con status ready/warning/error.
   * Almacena el archivo en S3 temporal para posterior procesamiento.
   */
  async analyzeEmployees(
    fileBuffer: Buffer,
    storeId: number,
    organizationId: number,
  ): Promise<BulkEmployeeAnalysisResultDto> {
    // 1. Parse file
    let employees: any[];
    try {
      employees = this.parseFile(fileBuffer);
    } catch (error) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_FILE_INVALID);
    }

    if (!employees || employees.length === 0) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_EMPTY_FILE);
    }

    if (employees.length > this.MAX_BATCH_SIZE) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_LIMIT_EXCEEDED);
    }

    // 2. Pre-fetch existing employees by document number (org-scoped)
    const unscoped = this.prisma.withoutScope() as any;
    const existingEmployees = await unscoped.employees.findMany({
      where: { organization_id: organizationId },
      select: {
        id: true,
        document_type: true,
        document_number: true,
        first_name: true,
        last_name: true,
        employee_stores: {
          select: { store_id: true, status: true },
        },
      },
    });
    const employeeDocMap = new Map<string, { id: number; first_name: string; last_name: string; store_ids: number[] }>();
    for (const e of existingEmployees) {
      const key = `${e.document_type}-${e.document_number}`;
      const store_ids = e.employee_stores
        .filter((es: any) => es.status === 'active')
        .map((es: any) => es.store_id);
      employeeDocMap.set(key, { id: e.id, first_name: e.first_name, last_name: e.last_name, store_ids });
    }

    // 3. Pre-fetch existing users by document number for user linking warnings
    const existingUsers = await this.prisma.users.findMany({
      where: { organization_id: organizationId },
      select: { id: true, document_type: true, document_number: true, email: true },
    });
    const userDocMap = new Map<string, { id: number; email: string }>();
    for (const u of existingUsers) {
      if (u.document_type && u.document_number) {
        const key = `${u.document_type}-${u.document_number}`;
        userDocMap.set(key, { id: u.id, email: u.email });
      }
    }

    // 4. Track duplicate documents in batch
    const seenDocs = new Map<string, number>(); // docKey -> first row number

    // 5. Analyze each employee
    const analysisItems: BulkEmployeeAnalysisItemDto[] = [];
    let ready = 0;
    let withWarnings = 0;
    let withErrors = 0;

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const docType = (emp.document_type || 'CC').toString().trim().toUpperCase();
      const docNumber = (emp.document_number || '').toString().trim();
      const docKey = `${docType}-${docNumber}`;

      const item: BulkEmployeeAnalysisItemDto = {
        row_number: i + 2, // +2 because row 1 is header, data starts at row 2
        name: emp.first_name || '',
        last_name: emp.last_name || '',
        document_type: docType,
        document_number: docNumber,
        base_salary: parseFloat(emp.base_salary) || 0,
        position: emp.position || undefined,
        department: emp.department || undefined,
        contract_type: emp.contract_type || '',
        is_user: !!emp.is_user,
        email: emp.email || undefined,
        action: 'create',
        status: 'ready',
        warnings: [],
        errors: [],
      };

      // Validate required fields
      if (!item.name) {
        item.errors.push('Nombre es requerido');
      }
      if (!item.last_name) {
        item.errors.push('Apellido es requerido');
      }
      if (!item.document_number) {
        item.errors.push('Numero de documento es requerido');
      }
      if (!emp.hire_date) {
        item.errors.push('Fecha de contratacion es requerida');
      }
      if (!item.contract_type) {
        item.warnings.push('Tipo de contrato no especificado, se usara "indefinido" por defecto');
      }
      if (item.base_salary <= 0) {
        item.warnings.push('Salario base es 0 o no especificado');
      }

      // Check is_user requires email
      if (item.is_user && !item.email) {
        item.errors.push('Email es requerido cuando el empleado sera usuario del sistema');
      }

      // Check duplicate document in batch
      if (docNumber) {
        if (seenDocs.has(docKey)) {
          item.warnings.push(
            `Documento duplicado en el archivo (primera aparicion en fila ${seenDocs.get(docKey)})`,
          );
        } else {
          seenDocs.set(docKey, item.row_number);
        }

        // Check if document exists in organization employees
        const existingEmp = employeeDocMap.get(docKey);
        if (existingEmp) {
          if (existingEmp.store_ids.includes(storeId)) {
            item.action = 'update';
            item.warnings.push(
              `Ya existe en esta tienda: ${existingEmp.first_name} ${existingEmp.last_name}. Se actualizarán sus datos.`,
            );
          } else {
            item.action = 'associate';
            item.warnings.push(
              `Existe en otra tienda: ${existingEmp.first_name} ${existingEmp.last_name}. Se vinculará a esta tienda sin modificar sus datos.`,
            );
          }
        }

        // Check if user exists for this document (for is_user warning)
        if (item.is_user && userDocMap.has(docKey)) {
          const existingUser = userDocMap.get(docKey)!;
          item.warnings.push(
            `Se vinculara al usuario existente (${existingUser.email})`,
          );
        }
      }

      // Determine final status
      if (item.errors.length > 0) {
        item.status = 'error';
        withErrors++;
      } else if (item.warnings.length > 0) {
        item.status = 'warning';
        withWarnings++;
      } else {
        item.status = 'ready';
        ready++;
      }

      analysisItems.push(item);
    }

    // 6. Store file in S3 temp
    const sessionId = uuidv4();
    const s3Key = `tmp/bulk-employees/${storeId}/${sessionId}.xlsx`;
    await this.s3Service.uploadFile(
      fileBuffer,
      s3Key,
      'application/octet-stream',
    );

    // 7. Return analysis result
    return {
      session_id: sessionId,
      total_employees: employees.length,
      ready,
      with_warnings: withWarnings,
      with_errors: withErrors,
      employees: analysisItems,
    };
  }

  /**
   * Procesa la carga masiva desde una sesion de analisis previa.
   * Descarga el archivo temporal de S3, lo procesa y limpia.
   */
  async uploadFromSession(
    sessionId: string,
    storeId: number,
    user: any,
  ): Promise<BulkEmployeeUploadResultDto> {
    const s3Key = `tmp/bulk-employees/${storeId}/${sessionId}.xlsx`;

    let fileBuffer: Buffer;
    try {
      fileBuffer = await this.s3Service.downloadImage(s3Key);
    } catch (error) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED);
    }

    try {
      const employees = this.parseFile(fileBuffer);
      const result = await this.uploadEmployees({ employees }, user);
      return result;
    } finally {
      // Clean up temp file
      try {
        await this.s3Service.deleteFile(s3Key);
      } catch (e) {
        // Silent cleanup failure
      }
    }
  }

  /**
   * Cancela una sesion de analisis y limpia el archivo temporal.
   */
  async cancelSession(sessionId: string, storeId: number): Promise<void> {
    const s3Key = `tmp/bulk-employees/${storeId}/${sessionId}.xlsx`;
    try {
      await this.s3Service.deleteFile(s3Key);
    } catch (e) {
      // File may not exist, silently ignore
    }
  }

  /**
   * Removes abandoned temp files older than the specified TTL.
   * Should be called periodically (e.g., via cron/scheduler).
   * Note: Requires S3 lifecycle rule on `tmp/` prefix for full coverage.
   */
  async cleanupExpiredSessions(_olderThanHours: number = 24): Promise<number> {
    // TODO: Implement with S3 listObjects when available.
    // For now, rely on S3 lifecycle rules configured at infrastructure level
    // to auto-expire objects under tmp/ prefix after 24 hours.
    return 0;
  }

  parseFile(buffer: Buffer): BulkEmployeeItemDto[] {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 2) {
        throw new VendixHttpException(
          ErrorCodes.PAYROLL_BULK_002,
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
      if (error instanceof VendixHttpException) throw error;
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_BULK_002,
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
    let updated = 0;
    let associated = 0;
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

        // Check if employee already exists (org-scoped) to determine if user handling should run
        const unscopedUpload = this.prisma.withoutScope() as any;
        const existingEmployee = await unscopedUpload.employees.findFirst({
          where: {
            organization_id: organizationId,
            document_type: docType,
            document_number: docNumber,
          },
        });
        const isNewEmployee = !existingEmployee;

        // Handle user linking/creation (only for new employees)
        let userId: number | undefined;
        let userCreated = false;
        let userLinked = false;

        if (isNewEmployee && empData.is_user) {
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
            const linkedEmployee = await unscopedUpload.employees.findFirst({
              where: {
                organization_id: organizationId,
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
            let username = `${empData.first_name.toLowerCase().replace(/\s+/g, '')}.${empData.last_name.toLowerCase().replace(/\s+/g, '')}`;

            // Check if username already exists in the organization
            const existingUsername = await this.prisma.users.findFirst({
              where: {
                username,
                organization_id: organizationId,
              },
              select: { id: true },
            });

            if (existingUsername) {
              let suffix = 2;
              let candidateUsername = `${username}${suffix}`;
              while (
                await this.prisma.users.findFirst({
                  where: { username: candidateUsername, organization_id: organizationId },
                  select: { id: true },
                })
              ) {
                suffix++;
                candidateUsername = `${username}${suffix}`;
              }
              username = candidateUsername;
            }

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

        // Create/update/associate employee using EmployeesService
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

        const result = await this.employeesService.createOrAssociate(createDto);
        const employee = result.employee;
        const action = result.action;

        if (userCreated) users_created++;
        if (userLinked) users_linked++;
        if (action === 'created') successful++;
        if (action === 'updated') { successful++; updated++; }
        if (action === 'associated') { successful++; associated++; }

        results.push({
          employee,
          status: 'success',
          action: action,
          message: action === 'created'
            ? (userCreated ? 'Empleado creado y usuario del sistema generado'
               : userLinked ? 'Empleado creado y vinculado a usuario existente'
               : 'Empleado creado exitosamente')
            : action === 'updated'
              ? 'Datos del empleado actualizados'
              : 'Empleado vinculado a esta tienda',
          user_created: userCreated,
          user_linked: userLinked,
        });
      } catch (error) {
        failed++;

        let safeMessage = 'Error al procesar el empleado. Verifique los datos e intente de nuevo.';

        if (error?.code === 'P2002') {
          const target = error.meta?.target as string[] | undefined;
          const field = target?.[0] ?? '';
          if (field.includes('username')) {
            safeMessage = 'Ya existe un usuario con ese nombre de usuario en la organizacion.';
          } else if (field.includes('email')) {
            safeMessage = 'Ya existe un usuario con ese correo electronico en la organizacion.';
          } else {
            safeMessage = `Ya existe un registro con el campo duplicado: ${field}`;
          }
        } else if (error instanceof VendixHttpException) {
          safeMessage = error.message;
        }

        results.push({
          employee: null,
          status: 'error',
          message: safeMessage,
          error: error.constructor.name,
        });
      }
    }

    return {
      success: failed === 0,
      total_processed: employees.length,
      successful,
      failed,
      updated,
      associated,
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
