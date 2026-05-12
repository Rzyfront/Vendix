import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '@common/decorators/public.decorator';
import { SubmissionsService } from '../../store/data-collection/submissions.service';
import { SubmitStepResponseDto } from '../../store/data-collection/dto/submit-response.dto';
import { ResponseService } from '@common/responses/response.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Controller('ecommerce/data-collection')
export class EcommerceDataCollectionController {
  private readonly logger = new Logger(EcommerceDataCollectionController.name);

  constructor(
    private readonly submissionsService: SubmissionsService,
    private readonly responseService: ResponseService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
    private readonly prisma: GlobalPrismaService,
  ) {}

  @Public()
  @Get(':token')
  async getByToken(@Param('token') token: string) {
    const result = await this.submissionsService.getByToken(token);
    return this.responseService.success(result);
  }

  @Public()
  @Post(':token/step/:stepIndex')
  async saveStep(
    @Param('token') token: string,
    @Param('stepIndex', ParseIntPipe) stepIndex: number,
    @Body() dto: SubmitStepResponseDto,
  ) {
    const result = await this.submissionsService.saveStepResponses(
      token,
      stepIndex,
      dto.responses,
    );
    return this.responseService.success(result, 'Paso guardado correctamente');
  }

  @Public()
  @Post(':token/submit')
  async submitFinal(@Param('token') token: string) {
    const result = await this.submissionsService.submitFinal(token);
    return this.responseService.success(
      result,
      'Formulario enviado correctamente',
    );
  }

  @Public()
  @Post(':token/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@Param('token') token: string, @UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate token and get submission with store context
    const submission = await this.submissionsService.getByToken(token);

    // Resolve store + org for S3 path
    const store = await this.prisma.stores.findUnique({
      where: { id: submission.store_id },
      select: { id: true, slug: true, organization_id: true },
    });
    if (!store) throw new BadRequestException('Store not found');

    const org = await this.prisma.organizations.findUnique({
      where: { id: store.organization_id },
      select: { id: true, slug: true },
    });
    if (!org) throw new BadRequestException('Organization not found');

    const basePath = this.s3PathHelper.buildStorePath(org, store);
    const sanitizedName = file.originalname.replace(/\s+/g, '_');
    const fileName = `${Date.now()}-${sanitizedName}`;
    const key = `${basePath}/data-collection/${submission.id}/${fileName}`;

    let uploadedKey: string;

    if (file.mimetype?.startsWith('image/')) {
      const result = await this.s3Service.uploadImage(file.buffer, key);
      uploadedKey = result.key;
    } else {
      uploadedKey = await this.s3Service.uploadFile(
        file.buffer,
        key,
        file.mimetype,
      );
    }

    const url = await this.s3Service.signUrl(uploadedKey);

    this.logger.log(
      `Public file uploaded for submission ${submission.id}: ${uploadedKey}`,
    );

    return this.responseService.success(
      { key: uploadedKey, url, originalName: file.originalname },
      'Archivo subido correctamente',
    );
  }
}
