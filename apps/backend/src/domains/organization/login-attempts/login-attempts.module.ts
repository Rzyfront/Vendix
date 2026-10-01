import { Module } from '@nestjs/common';
import { LoginAttemptsController } from './login-attempts.controller';
import { LoginAttemptsService } from './login-attempts.service';

@Module({
  imports: [],
  controllers: [LoginAttemptsController],
  providers: [LoginAttemptsService],
  exports: [LoginAttemptsService],
})
export class LoginAttemptsModule {}
