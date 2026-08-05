import { Test, TestingModule } from '@nestjs/testing';
import { ProductsBulkController } from './products-bulk.controller';
import { ProductsBulkService } from './products-bulk.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { BulkProductUploadDto } from './dto';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('ProductsBulkController', () => {
  let controller: ProductsBulkController;
  let productsBulkService: ProductsBulkService;
  let responseService: ResponseService;

  const mockProductsBulkService = {
    uploadProducts: jest.fn(),
    validateBulkProducts: jest.fn(),
    // La plantilla dejó de ser CSV armado en el controller: es un XLSX que el
    // servicio construye (`generateExcelTemplate`) y el controller solo
    // streamea. `getBulkUploadTemplate` quedó como stub deprecado sin ruta.
    generateExcelTemplate: jest.fn(),
    getBulkUploadTemplate: jest.fn(),
    // `parseFile` es síncrono: convierte el buffer subido en filas antes de
    // cualquier validación.
    parseFile: jest.fn(),
  };

  // `downloadTemplate` y `export` responden con @Res(): escriben cabeceras y
  // cierran el stream ellos mismos, así que no devuelven un envelope. El doble
  // registra qué se escribió.
  const makeResponseDouble = () => {
    const res: any = {
      set: jest.fn(() => res),
      end: jest.fn(() => res),
      json: jest.fn(() => res),
    };
    res.status = jest.fn(() => res);
    return res;
  };

  const mockResponseService = {
    created: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  };

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    organization_id: 1,
    store_id: 1,
    roles: ['admin'],
  };

  const mockRequest = {
    user: mockUser,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsBulkController],
      providers: [
        {
          provide: ProductsBulkService,
          useValue: mockProductsBulkService,
        },
        {
          provide: ResponseService,
          useValue: mockResponseService,
        },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProductsBulkController>(ProductsBulkController);
    productsBulkService = module.get<ProductsBulkService>(ProductsBulkService);
    responseService = module.get<ResponseService>(ResponseService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('uploadProducts', () => {
    it('should process bulk upload successfully', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
          },
          {
            name: 'Product 2',
            base_price: 149.99,
            sku: 'PROD-002',
          },
        ],
      };

      const uploadResult = {
        success: true,
        total_processed: 2,
        successful: 2,
        failed: 0,
        results: [
          {
            product: {
              id: 1,
              name: 'Product 1',
              slug: 'product-1',
              base_price: 99.99,
              state: 'active',
            },
            status: 'success',
            message: 'Product created successfully',
          },
          {
            product: {
              id: 2,
              name: 'Product 2',
              slug: 'product-2',
              base_price: 149.99,
              state: 'active',
            },
            status: 'success',
            message: 'Product created successfully',
          },
        ],
      };

      const expectedResponse = {
        data: uploadResult,
        message: 'Carga masiva completada exitosamente',
      };

      mockProductsBulkService.uploadProducts.mockResolvedValue(uploadResult);
      mockResponseService.created.mockReturnValue(expectedResponse);

      const result = await controller.uploadProducts(
        bulkUploadDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockProductsBulkService.uploadProducts).toHaveBeenCalledWith(
        bulkUploadDto,
        mockUser,
      );
      expect(mockResponseService.created).toHaveBeenCalledWith(
        uploadResult,
        'Carga masiva completada exitosamente',
      );
    });

    it('should handle partial failures in bulk upload', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
          },
          {
            name: 'Product 2',
            base_price: 149.99,
            sku: 'PROD-001', // Duplicate SKU
          },
        ],
      };

      const uploadResult = {
        success: true,
        total_processed: 2,
        successful: 1,
        failed: 1,
        results: [
          {
            product: {
              id: 1,
              name: 'Product 1',
              slug: 'product-1',
              base_price: 99.99,
              state: 'active',
            },
            status: 'success',
            message: 'Product created successfully',
          },
          {
            product: null,
            status: 'error',
            message: 'El SKU ya está en uso',
            error: 'ConflictException',
          },
        ],
      };

      const expectedResponse = {
        data: uploadResult,
        message: 'Carga masiva completada con algunos errores',
      };

      mockProductsBulkService.uploadProducts.mockResolvedValue(uploadResult);
      mockResponseService.created.mockReturnValue(expectedResponse);

      const result = await controller.uploadProducts(
        bulkUploadDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockResponseService.created).toHaveBeenCalledWith(
        uploadResult,
        'Carga masiva completada con algunos errores',
      );
    });

    it('should handle validation errors before processing', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: '', // Empty name
            base_price: 99.99,
            sku: 'PROD-001',
          },
        ],
      };

      const error = new BadRequestException('Product name is required');
      const expectedErrorResponse = {
        error: 'Product name is required',
        message: 'Product name is required',
        statusCode: 400,
      };

      mockProductsBulkService.uploadProducts.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.uploadProducts(
        bulkUploadDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Product name is required',
        'Product name is required',
        400,
      );
    });

    it('should handle database conflicts', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'EXISTING-SKU',
          },
        ],
      };

      const error = new ConflictException('El SKU ya está en uso');
      const expectedErrorResponse = {
        error: 'El SKU ya está en uso',
        message: 'El SKU ya está en uso',
        statusCode: 409,
      };

      mockProductsBulkService.uploadProducts.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.uploadProducts(
        bulkUploadDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'El SKU ya está en uso',
        'El SKU ya está en uso',
        409,
      );
    });

    it('should handle empty products array', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [],
      };

      const uploadResult = {
        success: true,
        total_processed: 0,
        successful: 0,
        failed: 0,
        results: [],
      };

      const expectedResponse = {
        data: uploadResult,
        message: 'Carga masiva completada exitosamente',
      };

      mockProductsBulkService.uploadProducts.mockResolvedValue(uploadResult);
      mockResponseService.created.mockReturnValue(expectedResponse);

      const result = await controller.uploadProducts(
        bulkUploadDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockResponseService.created).toHaveBeenCalledWith(
        uploadResult,
        'Carga masiva completada exitosamente',
      );
    });
  });

  // NOTE (deriva detectada, NO bendecida): estas dos rutas HTTP ya no existen en
  // `products-bulk.controller.ts`. Sus superficies actuales son `POST upload`,
  // `POST upload/file`, `POST analyze`, `POST upload-session`, `GET
  // template/download`, `GET export` y `DELETE session/:id`. Los métodos de
  // servicio `validateBulkProducts` y `getBulkUploadTemplate` siguen vivos en
  // `products-bulk.service.ts` pero ya no tienen consumidor: o son código
  // muerto a eliminar, o falta reexponerlos. Los bloques quedan en `skip` (no
  // borrados) hasta que se decida cuál de las dos cosas es.
  describe.skip('validateProducts', () => {
    it('should validate products successfully', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
          },
          {
            name: 'Product 2',
            base_price: 149.99,
            sku: 'PROD-002',
          },
        ],
      };

      const validationResult = {
        isValid: true,
        errors: [],
        validProducts: bulkUploadDto.products,
      };

      const expectedResponse = {
        data: validationResult,
        message: 'Validación de productos completada exitosamente',
      };

      mockProductsBulkService.validateBulkProducts.mockResolvedValue(
        validationResult,
      );
      mockResponseService.success.mockReturnValue(expectedResponse);

      const result = await (controller as any).validateProducts(
        bulkUploadDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockProductsBulkService.validateBulkProducts).toHaveBeenCalledWith(
        bulkUploadDto.products,
        mockUser,
      );
      expect(mockResponseService.success).toHaveBeenCalledWith(
        validationResult,
        'Validación de productos completada exitosamente',
      );
    });

    it('should return validation errors when products are invalid', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: '', // Empty name
            base_price: 99.99,
            sku: 'PROD-001',
          },
        ],
      };

      const validationResult = {
        isValid: false,
        errors: ['Product name is required'],
        validProducts: [],
      };

      const expectedResponse = {
        data: validationResult,
        message: 'Se encontraron errores en la validación',
      };

      mockProductsBulkService.validateBulkProducts.mockResolvedValue(
        validationResult,
      );
      mockResponseService.success.mockReturnValue(expectedResponse);

      const result = await (controller as any).validateProducts(
        bulkUploadDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockResponseService.success).toHaveBeenCalledWith(
        validationResult,
        'Se encontraron errores en la validación',
      );
    });

    it('should handle validation service errors', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
          },
        ],
      };

      const error = new Error('Validation service error');
      const expectedErrorResponse = {
        error: 'Validation service error',
        message: 'Validation service error',
        statusCode: 400,
      };

      mockProductsBulkService.validateBulkProducts.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await (controller as any).validateProducts(
        bulkUploadDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Validation service error',
        'Validation service error',
        400,
      );
    });
  });

  // NOTE (deriva detectada, NO bendecida): estas dos rutas HTTP ya no existen en
  // `products-bulk.controller.ts`. Sus superficies actuales son `POST upload`,
  // `POST upload/file`, `POST analyze`, `POST upload-session`, `GET
  // template/download`, `GET export` y `DELETE session/:id`. Los métodos de
  // servicio `validateBulkProducts` y `getBulkUploadTemplate` siguen vivos en
  // `products-bulk.service.ts` pero ya no tienen consumidor: o son código
  // muerto a eliminar, o falta reexponerlos. Los bloques quedan en `skip` (no
  // borrados) hasta que se decida cuál de las dos cosas es.
  describe.skip('getTemplate', () => {
    it('should return bulk upload template', async () => {
      const templateData = {
        headers: [
          'name',
          'base_price',
          'sku',
          'description',
          'brand_id',
          'category_ids',
          'stock_quantity',
        ],
        sample_data: [
          {
            name: 'Sample Product',
            base_price: '99.99',
            sku: 'SAMPLE-001',
            description: 'Sample product description',
            brand_id: '1',
            category_ids: '1,2',
            stock_quantity: '10',
          },
        ],
        instructions: 'Use this template to upload products in bulk',
      };

      const expectedResponse = {
        data: templateData,
        message: 'Plantilla de carga masiva obtenida exitosamente',
      };

      mockProductsBulkService.getBulkUploadTemplate.mockResolvedValue(
        templateData,
      );
      mockResponseService.success.mockReturnValue(expectedResponse);

      const result = await (controller as any).getTemplate();

      expect(result).toEqual(expectedResponse);
      expect(mockProductsBulkService.getBulkUploadTemplate).toHaveBeenCalled();
      expect(mockResponseService.success).toHaveBeenCalledWith(
        templateData,
        'Plantilla de carga masiva obtenida exitosamente',
      );
    });

    it('should handle template service errors', async () => {
      const error = new Error('Template service error');
      const expectedErrorResponse = {
        error: 'Template service error',
        message: 'Template service error',
        statusCode: 500,
      };

      mockProductsBulkService.getBulkUploadTemplate.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await (controller as any).getTemplate();

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Template service error',
        'Template service error',
        500,
      );
    });
  });

  describe('downloadTemplate', () => {
    it('streams the XLSX template with attachment headers', async () => {
      const buffer = Buffer.from('fake-xlsx');
      mockProductsBulkService.generateExcelTemplate.mockResolvedValue(buffer);
      const res = makeResponseDouble();

      await controller.downloadTemplate('products', res);

      expect(mockProductsBulkService.generateExcelTemplate).toHaveBeenCalledWith(
        'products',
      );
      const headers = res.set.mock.calls[0][0];
      expect(headers['Content-Type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      // El Content-Disposition decide el nombre con que el archivo cae en la
      // máquina del usuario; sin él el navegador lo abre en vez de bajarlo.
      expect(headers['Content-Disposition']).toMatch(
        /attachment; filename="plantilla_productos_\d{4}-\d{2}-\d{2}\.xlsx"/,
      );
      expect(headers['Content-Length']).toBe(buffer.length);
      expect(res.end).toHaveBeenCalledWith(buffer);
    });

    it('names the file after the services variant when type=services', async () => {
      mockProductsBulkService.generateExcelTemplate.mockResolvedValue(
        Buffer.from('x'),
      );
      const res = makeResponseDouble();

      await controller.downloadTemplate('services', res);

      expect(res.set.mock.calls[0][0]['Content-Disposition']).toContain(
        'plantilla_servicios_',
      );
    });

    it('answers 500 through res, not through the envelope', async () => {
      mockProductsBulkService.generateExcelTemplate.mockRejectedValue(
        new Error('Template generation error'),
      );
      const res = makeResponseDouble();

      await controller.downloadTemplate('products', res);

      // Una ruta @Res() no puede delegar en ResponseService: ya tomó control del
      // stream, así que el error viaja como body JSON con status explícito.
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { message: 'Template generation error' },
      });
      expect(mockResponseService.error).not.toHaveBeenCalled();
    });
  });

  describe('uploadProductsFromFile', () => {
    it('should process file upload successfully', async () => {
      const mockFile = {
        buffer: Buffer.from('name,base_price,sku\nProduct 1,99.99,PROD-001'),
        originalname: 'products.csv',
        mimetype: 'text/csv',
      };

      const uploadResult = {
        success: true,
        total_processed: 1,
        successful: 1,
        failed: 0,
        results: [
          {
            product: {
              id: 1,
              name: 'Product 1',
              slug: 'product-1',
              base_price: 99.99,
              state: 'active',
            },
            status: 'success',
            message: 'Product created successfully',
          },
        ],
      };

      const expectedResponse = {
        data: uploadResult,
        message: 'Archivo procesado exitosamente',
      };

      // parseFile es lo primero que corre: sin él el controller cae en el catch
      // con "parseFile is not a function" y toda la aserción se vuelve vacua.
      mockProductsBulkService.parseFile.mockReturnValue([
        { name: 'Product 1', base_price: 99.99, sku: 'PROD-001' },
      ]);
      mockProductsBulkService.validateBulkProducts.mockResolvedValue({
        isValid: true,
        errors: [],
        validProducts: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
          },
        ],
      });
      mockProductsBulkService.uploadProducts.mockResolvedValue(uploadResult);
      mockResponseService.created.mockReturnValue(expectedResponse);

      const result = await controller.uploadProductsFromFile(
        mockFile as any,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockProductsBulkService.parseFile).toHaveBeenCalledWith(
        mockFile.buffer,
      );
      // Solo las filas que la pre-validación aprobó llegan a la carga.
      expect(mockProductsBulkService.uploadProducts).toHaveBeenCalledWith(
        { products: [{ name: 'Product 1', base_price: 99.99, sku: 'PROD-001' }] },
        mockUser,
      );
      expect(mockResponseService.created).toHaveBeenCalledWith(
        uploadResult,
        'Archivo procesado exitosamente',
      );
    });

    // El controller ya no valida mime type ni vaciedad ni formato CSV por su
    // cuenta: el tamaño lo corta `ParseFilePipe` (5MB) antes del handler, y el
    // parseo/estructura los resuelve `parseFile` + `validateBulkProducts`. Las
    // tres pruebas que exigían mensajes propios del controller ("Solo se
    // permiten archivos CSV", "El archivo está vacío", "Formato de archivo CSV
    // inválido") describían una superficie que ya no existe. Lo que sí sigue
    // siendo contrato del controller es CÓMO propaga el fallo del parser y qué
    // hace cuando la pre-validación rechaza el archivo.
    it('propagates a parser failure as an error envelope with its status', async () => {
      const mockFile = {
        buffer: Buffer.from('invalid'),
        originalname: 'invalid.csv',
        mimetype: 'text/csv',
      };

      mockProductsBulkService.parseFile.mockImplementation(() => {
        throw Object.assign(
          new Error(
            'El archivo CSV debe contener al menos una fila de encabezados y una fila de datos',
          ),
          { status: 400 },
        );
      });
      mockResponseService.error.mockReturnValue({ success: false });

      await controller.uploadProductsFromFile(
        mockFile as any,
        mockRequest as any,
      );

      expect(mockResponseService.error).toHaveBeenCalledWith(
        'El archivo CSV debe contener al menos una fila de encabezados y una fila de datos',
        'El archivo CSV debe contener al menos una fila de encabezados y una fila de datos',
        400,
      );
      expect(mockProductsBulkService.uploadProducts).not.toHaveBeenCalled();
    });

    it('returns the validation report WITHOUT uploading when the file is invalid', async () => {
      const mockFile = {
        buffer: Buffer.from('x'),
        originalname: 'products.csv',
        mimetype: 'text/csv',
      };
      const validationResult = {
        isValid: false,
        errors: ['Fila 1: Faltan datos obligatorios (Nombre, SKU o Precio)'],
        validProducts: [],
      };

      mockProductsBulkService.parseFile.mockReturnValue([{ name: '' }]);
      mockProductsBulkService.validateBulkProducts.mockResolvedValue(
        validationResult,
      );
      mockResponseService.success.mockReturnValue({ success: true });

      await controller.uploadProductsFromFile(
        mockFile as any,
        mockRequest as any,
      );

      // 200 con el informe, no un error: el usuario necesita la lista completa
      // de filas malas para corregir su Excel de una sola pasada.
      expect(mockResponseService.success).toHaveBeenCalledWith(
        validationResult,
        'Se encontraron errores en el archivo',
      );
      expect(mockProductsBulkService.uploadProducts).not.toHaveBeenCalled();
    });
  });
});
