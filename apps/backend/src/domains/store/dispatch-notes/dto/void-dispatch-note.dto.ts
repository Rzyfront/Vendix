import { IsString, MinLength } from 'class-validator';

export class VoidDispatchNoteDto {
  @IsString()
  @MinLength(1)
  void_reason: string;
}
