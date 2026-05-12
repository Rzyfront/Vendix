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
import { ResponseService } from '../../../../common/responses/response.service';
import { S3Service } from '../../../../common/services/s3.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateDianConfigDto } from '../../../store/invoicing/dian-config/dto/create-dian-config.dto';
import { UpdateDianConfigDto } from '../../../store/invoicing/dian-config/dto/update-dian-config.dto';
import { DianXmlSignerService } from '../../../store/invoicing/providers/dian-direct/dian-xml-signer.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Controller('organization/invoicing/dian-config')
@UseGuards(PermissionsGuard)
export class OrgDianConfigController {
  constructor(
    private readonly dian_config_service: OrgDianConfigService,
    private readonly xml_signer: DianXmlSignerService,
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
    await this.dian_config_service.getConfigById(config_id_int);

    const validation = await this.xml_signer.validateCertificate(
      file.buffer,
      password,
    );

    if (!validation.valid) {
      if (validation.error?.includes('expired')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_003);
      }
      if (validation.error?.includes('password')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_002);
      }
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_001, validation.error);
    }

    const s3_key = `dian/certificates/${config_id_int}/certificate.p12`;
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
    );

    return this.response_service.success({
      ...result,
      certificate_info: {
        subject: validation.subject,
        issuer: validation.issuer,
        expires: validation.expires,
      },
    });
  }
}
