import { Injectable } from '@nestjs/common';

@Injectable()
export class JonathanService {
  saludar(): string {
    return 'Hola Jonathan';
  }
}
