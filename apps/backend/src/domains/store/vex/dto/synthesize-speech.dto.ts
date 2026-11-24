import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /store/vex/speech`: texto de un mensaje de Vex a sintetizar
 * bajo demanda al hacer clic en «Escuchar».
 */
export class SynthesizeVexSpeechDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(12000)
  text!: string;
}
