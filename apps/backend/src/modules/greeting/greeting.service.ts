// apps/backend/src/modules/greeting/greeting.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGreetingDto, InsultLevel } from './dto';

@Injectable()
export class GreetingService {
    constructor(private readonly prismaService: PrismaService) { }

    // Base de datos de insultos graciosos
    private readonly funnyInsults = {
        [InsultLevel.SUAVE]: [
            '¡Hey {name}! ¿Sigues buscando ese cerebro que perdiste?',
            '{name}, si fueras un libro, serías uno de esos que nadie quiere leer dos veces',
            '¡Hola {name}! ¿Practicas para ser estatua? ¡Estás tieso como una!',
            '{name}, tu velocidad de procesamiento es inversamente proporcional a tu consumo de café ☕',
            '¡Ey {name}! ¿Tu foto de perfil es de cuando eras más joven o es un filtro muy bueno?',
        ],
        [InsultLevel.MODERADO]: [
            '{name}, eres como un código sin comentarios: nadie entiende cómo funcionas',
            '¡Hola {name}! Tu sentido del humor es como tu conexión a internet: intermitente',
            '{name}, si la inteligencia fuera dinero, tú estarías pidiendo limosna',
            '{name}, eres más lento que un caracol en una montaña de melaza',
            '¡Ey {name}! ¿Tu familia sabe que sales de casa así?',
        ],
        [InsultLevel.PICANTE]: [
            '{name}, eres tan brillante que hasta las bombillas te tienen envidia... de lo poco que alumbras',
            '¡Hola {name}! Si los tontos volaran, tú serías el capitán del aeropuerto',
            '{name}, tu coeficiente intelectual debe estar en la lista de especies en extinción',
            '{name}, eres como un error 404: no encontrado en el servidor de inteligencia',
            '¡Ey {name}! ¿Naciste así de especial o practicaste mucho?',
        ]
    };

    private readonly themeInsults = {
        programador: [
            '{name}, tu código tiene más bugs que un jardín tiene insectos 🐛',
            '¡Hola {name}! ¿Sigues usando console.log para debuggear? ¡Qué vintage!',
            '{name}, si programar fuera fácil, hasta tú podrías hacerlo... ah wait',
        ],
        estudiante: [
            '{name}, estudias tanto que hasta los libros te tienen miedo 📚',
            '¡Ey {name}! ¿Tus notas son tan bajas que cavan hoyos?',
        ],
        general: [
            '{name}, eres único... nadie más querría ser como tú',
            '¡Hola {name}! ¿Tu espejo se rompe cuando te ve?',
        ]
    };

    async createFunnyGreeting(createGreetingDto: CreateGreetingDto) {
        const { name, intensity = InsultLevel.SUAVE, theme = 'general' } = createGreetingDto;


        // Seleccionar insulto gracioso
        let insult: string;

        if (theme !== 'general' && this.themeInsults[theme]) {
            const themeInsults = this.themeInsults[theme];
            insult = themeInsults[Math.floor(Math.random() * themeInsults.length)];
        } else {
            const levelInsults = this.funnyInsults[intensity];
            insult = levelInsults[Math.floor(Math.random() * levelInsults.length)];
        }

        // Reemplazar {name} con el nombre real
        const personalizedInsult = insult.replace('{name}', name);

        // Crear respuesta estructurada
        const response = {
            message: personalizedInsult,
            data: {
                victim_name: name,
                insult_level: intensity,
                theme: theme,
                timestamp: new Date().toISOString(),
                disclaimer: 'Esto es solo una broma, ¡no te lo tomes en serio! 😄'
            }
        };


        return response;
    }

    async getInsultLevels() {
        return {
            levels: Object.values(InsultLevel),
            descriptions: {
                [InsultLevel.SUAVE]: 'Insultos suaves y amigables',
                [InsultLevel.MODERADO]: 'Insultos con un poco más de picante',
                [InsultLevel.PICANTE]: 'Insultos para valientes con sentido del humor'
            },
            available_themes: Object.keys(this.themeInsults)
        };
    }
}
