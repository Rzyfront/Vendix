import { Test, TestingModule } from '@nestjs/testing';
import { ProductsBulkController } from './products-bulk.controller';
import { ProductsBulkService } from './products-bulk.service';
import { ResponseService } from '../../common/responses/response.service';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { BulkProductUploadDto } from './dto';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('ProductsBulkController', () => {
  let controller: ProductsBulkController;
  let productsBulkService: ProductsBulkService;
  let responseService: ResponseService;

  const mockProductsBulkService = {
    uploadProducts: jest.fn(),
    validateBulkProducts: jest.fn(),
    getBulkUploadTemplate: jest.fn(),
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
        message: 'Carga masiva de productos completada exitosamente',
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
        'Carga masiva de productos completada exitosamente',
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
        message: 'Carga masiva de productos completada con algunos errores',
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
        'Carga masiva de productos completada con algunos errores',
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
        message: 'Carga masiva de productos completada exitosamente',
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
        'Carga masiva de productos completada exitosamente',
      );
    });
  });

  describe('validateProducts', () => {
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

      const result = await controller.validateProducts(
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

      const result = await controller.validateProducts(
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

      const result = await controller.validateProducts(
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

  describe('getTemplate', () => {
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

      const result = await controller.getTemplate();

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

      const result = await controller.getTemplate();

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Template service error',
        'Template service error',
        500,
      );
    });
  });

  describe('downloadTemplate', () => {
    it('should return CSV template download', async () => {
      const templateData = {
        headers: ['name', 'base_price', 'sku'],
        sample_data: [
          {
            name: 'Sample Product',
            base_price: '99.99',
            sku: 'SAMPLE-001',
          },
        ],
        instructions: 'Use this template to upload products in bulk',
      };

      const expectedCsvContent = `name,base_price,sku\nSample Product,99.99,SAMPLE-001`;

      mockProductsBulkService.getBulkUploadTemplate.mockResolvedValue(
        templateData,
      );

      const result = await controller.downloadTemplate();

      expect(result).toHaveProperty('csv');
      expect((result as any).csv).toContain('name,base_price,sku');
      expect((result as any).csv).toContain('Sample Product,99.99,SAMPLE-001');
      expect((result as any).filename).toContain('product-bulk-template');
      expect((result as any).filename).toContain('.csv');
    });

    it('should handle template generation errors', async () => {
      const error = new Error('Template generation error');
      const expectedErrorResponse = {
        error: 'Template generation error',
        message: 'Template generation error',
        statusCode: 500,
      };

      mockProductsBulkService.getBulkUploadTemplate.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.downloadTemplate();

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Template generation error',
        'Template generation error',
        500,
      );
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

      // Mock CSV parsing and service call
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
      expect(mockProductsBulkService.uploadProducts).toHaveBeenCalled();
      expect(mockResponseService.created).toHaveBeenCalledWith(
        uploadResult,
        'Archivo procesado exitosamente',
      );
    });

    it('should handle unsupported file types', async () => {
      const mockFile = {
        buffer: Buffer.from('test content'),
        originalname: 'products.txt',
        mimetype: 'text/plain',
      };

      const expectedErrorResponse = {
        error: 'Tipo de archivo no soportado',
        message: 'Solo se permiten archivos CSV',
        statusCode: 400,
      };

      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.uploadProductsFromFile(
        mockFile as any,
        mockRequest as any,
      );

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Solo se permiten archivos CSV',
        'Solo se permiten archivos CSV',
        400,
      );
    });

    it('should handle empty file upload', async () => {
      const mockFile = {
        buffer: Buffer.from(''),
        originalname: 'empty.csv',
        mimetype: 'text/csv',
      };

      const expectedErrorResponse = {
        error: 'Archivo vacío',
        message: 'El archivo está vacío',
        statusCode: 400,
      };

      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.uploadProductsFromFile(
        mockFile as any,
        mockRequest as any,
      );

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'El archivo está vacío',
        'El archivo está vacío',
        400,
      );
    });

    it('should handle CSV parsing errors', async () => {
      const mockFile = {
        buffer: Buffer.from('invalid,csv,content'),
        originalname: 'invalid.csv',
        mimetype: 'text/csv',
      };

      const expectedErrorResponse = {
        error: 'Error al procesar el archivo CSV',
        message: 'Formato de archivo CSV inválido',
        statusCode: 400,
      };

      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.uploadProductsFromFile(
        mockFile as any,
        mockRequest as any,
      );

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Error al procesar el archivo CSV: El archivo CSV debe contener al menos una fila de encabezados y una fila de datos',
        'Error al procesar el archivo CSV: El archivo CSV debe contener al menos una fila de encabezados y una fila de datos',
        400,
      );
    });
  });
});
