import { Module } from '@nestjs/common';
import { JonathanController } from './jonathan.controller';
import { JonathanService } from './jonathan.service';

@Module({
  controllers: [JonathanController],
  providers: [JonathanService],
})
export class JonathanModule {}
