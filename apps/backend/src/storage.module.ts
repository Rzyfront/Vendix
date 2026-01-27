import { Global, Module } from '@nestjs/common';
import { S3Service } from './common/services/s3.service';
import { S3PathHelper } from './common/helpers/s3-path.helper';

@Global()
@Module({
    providers: [S3Service, S3PathHelper],
    exports: [S3Service, S3PathHelper],
})
export class StorageModule { }
