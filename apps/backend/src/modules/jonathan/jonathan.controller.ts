import { Controller, Get } from '@nestjs/common';
import { JonathanService } from "./jonathan.service";

@Controller("jonathan")
export class JonathanController {
    constructor(private readonly jonathanService: JonathanService) {}

    @Get("saludar")
    saludar(): string {
        return this.jonathanService.saludar();
        
    }
}