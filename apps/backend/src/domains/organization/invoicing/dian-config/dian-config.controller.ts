import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrgDianConfigService } from './dian-config.service';
import { DianTestService } from '../../../store/invoicing/dian-config/dian-test.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { S3Service } from '../../../../common/services/s3.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateDianConfigDto } from '../../../store/invoicing/dian-config/dto/create-dian-config.dto';
import { UpdateDianConfigDto } from '../../../store/invoicing/dian-config/dto/update-dian-config.dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { ManualCertificateIssuerAdapter } from '../../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { buildDianCertificateS3Key } from '../../../store/invoicing/dian-config/certificates/certificate-s3-key.util';

@Controller('organization/invoicing/dian-config')
@UseGuards(PermissionsGuard)
export class OrgDianConfigController {
  constructor(
    private readonly dian_config_service: OrgDianConfigService,
    private readonly dian_test_service: DianTestService,
    private readonly certificate_adapter: ManualCertificateIssuerAdapter,
    private readonly response_service: ResponseService,
    private readonly s3_service: S3Service,
  ) {}

  @Get()
  @Permissions('organization:invoicing:dian:read')
  async getConfigs(@Query('store_id') store_id?: string) {
    const result = await this.dian_config_service.getConfigs(
      store_id ? parseInt(store_id, 10) : undefined,
    );
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('organization:invoicing:dian:read')
  async getConfigById(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.getConfigById(id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('organization:invoicing:dian:write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateDianConfigDto & { store_id?: number },
  ) {
    const result = await this.dian_config_service.create(dto);
    return this.response_service.success(result);
  }

  @Patch(':id')
  @Permissions('organization:invoicing:dian:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDianConfigDto,
  ) {
    const result = await this.dian_config_service.update(id, dto);
    return this.response_service.success(result);
  }

  @Delete(':id')
  @Permissions('organization:invoicing:dian:write')
  async deleteConfig(@Param('id', ParseIntPipe) id: number) {
    await this.dian_config_service.deleteConfig(id);
    return this.response_service.success(null, 'Configuration deleted');
  }

  @Patch(':id/set-default')
  @Permissions('organization:invoicing:dian:write')
  async setDefault(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.setDefault(id);
    return this.response_service.success(result);
  }

  /**
   * Upload a .p12 certificate file at organization level.
   * Resolves the target config (which still belongs to a store) and validates org ownership.
   */
  @Post('upload-certificate')
  @Permissions('organization:invoicing:dian:write')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('certificate'))
  async uploadCertificate(
    @UploadedFile() file: Express.Multer.File,
    @Body('password') password: string,
    @Body('config_id') config_id: string,
  ) {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_001);
    }

    if (!password) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_002,
        'Certificate password is required',
      );
    }

    const config_id_int = parseInt(config_id, 10);

    // Ensure the config belongs to the org context before letting the cert in.
    const config = await this.dian_config_service.getConfigById(config_id_int);

    const validation = await this.certificate_adapter.validateCertificate({
      p12_buffer: file.buffer,
      password,
      expected_tax_id: config.nit,
      expected_dv: config.nit_dv,
    });

    if (!validation.valid) {
      if (validation.error?.includes('tax identifier')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_004);
      }
      if (validation.error?.includes('expired')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_003);
      }
      if (validation.error?.includes('password')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_002);
      }
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_001, validation.error);
    }

    // Misma clave que en tienda y en la consola de tenants: el prefijo nombra al
    // dueño (organización + tienda o `org`), no solo al id de configuración.
    const s3_key = buildDianCertificateS3Key({
      organization_id: config.organization_id,
      store_id: config.store_id,
      dian_configuration_id: config_id_int,
    });
    await this.s3_service.uploadFile(
      file.buffer,
      s3_key,
      'application/x-pkcs12',
    );

    const result = await this.dian_config_service.updateCertificate(
      config_id_int,
      s3_key,
      password,
      validation.expires || null,
      validation,
    );

    return this.response_service.success({
      ...result,
      certificate_info: {
        subject: validation.subject,
        issuer: validation.issuer,
        expires: validation.expires,
        fingerprint: validation.fingerprint,
        serial_number: validation.serial_number,
        tax_id: validation.tax_id,
      },
    });
  }

  /**
   * Tests connectivity to DIAN web services for an org-scoped configuration.
   * Delegates to the shared DianTestService, which resolves the config by id
   * regardless of scope.
   */
  @Post(':id/test-connection')
  @Permissions('organization:invoicing:dian:write')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_test_service.testConnection(id);
    return this.response_service.success(result);
  }

  /**
   * Runs the DIAN enablement test set for an org-scoped configuration.
   * Delegates to the shared DianTestService, which resolves the config by id
   * regardless of scope.
   */
  @Post(':id/run-test-set')
  @Permissions('organization:invoicing:dian:write')
  @HttpCode(HttpStatus.ACCEPTED)
  async runTestSet(
    @Param('id', ParseIntPipe) id: number,
    @Body('resolution_id', ParseIntPipe) resolution_id: number,
    // Las dos vías de diagnóstico se exponen aquí también: una configuración de
    // organización se habilita por el mismo camino, y dejarla sin ellas obligaría
    // a diagnosticarla desde otra superficie con otro contexto fiscal.
    @Query('smoke') smoke?: string,
    @Query('validate') validate?: string,
  ) {
    const result = await this.dian_test_service.enqueueTestSet(
      id,
      resolution_id,
      {
        smoke: smoke === 'true' || smoke === '1',
        validate_only: validate === 'true' || validate === '1',
      },
    );
    return this.response_service.success(result);
  }

  /**
   * Sondeo del job. Misma guardia que en tienda: la `id` de configuración de la
   * ruta es lo que autoriza leer el resultado, porque los ids de BullMQ son
   * globales y `job.returnvalue` vive en Redis, fuera del scope de Prisma.
   */
  @Get(':id/run-test-set/:jobId')
  @Permissions('organization:invoicing:dian:read')
  async getTestSetJobStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('jobId') job_id: string,
  ) {
    const result = await this.dian_test_service.getTestSetJobStatus(job_id, id);
    return this.response_service.success(result);
  }
}
