import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { BusinessHours } from './interfaces/store-settings.interface';
import { mergeStoreSettingsWithDefaults } from './defaults/default-store-settings';

export interface ScheduleValidationResult {
  isWithinBusinessHours: boolean;
  currentDay: string;
  currentTime: string;
  openTime?: string;
  closeTime?: string;
  nextOpenTime?: string;
  message?: string;
}

@Injectable()
export class ScheduleValidationService {
  private readonly logger = new Logger(ScheduleValidationService.name);

  constructor(private prisma: StorePrismaService) {}

  /**
   * Valida si el usuario actual puede acceder al POS fuera de horario
   * Los usuarios con rol admin pueden acceder siempre
   */
  async canBypassScheduleCheck(): Promise<boolean> {
    const context = RequestContextService.getContext();
    const userId = context?.user_id;
    const storeId = context?.store_id;

    if (!userId || !storeId) {
      return false;
    }

    // Verificar si el usuario pertenece a esta tienda
    const storeUser = await this.prisma.store_users.findFirst({
      where: {
        user_id: userId,
        store_id: storeId,
      },
    });

    if (!storeUser) {
      return false;
    }

    // Verificar si tiene rol de admin (owner, admin, manager)
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      include: { roles: true },
    });

    const hasAdminRole = userRoles.some((ur) =>
      ['owner', 'admin', 'manager'].includes(
        ur.roles?.name?.toLowerCase() || '',
      ),
    );

    return hasAdminRole;
  }

  /**
   * Valida si el POS está dentro del horario de atención
   * Returns ScheduleValidationResult con detalles
   */
  async validateBusinessHours(
    storeId: number,
  ): Promise<ScheduleValidationResult> {
    // Obtener configuración de la tienda
    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
      select: { settings: true },
    });

    const settings = mergeStoreSettingsWithDefaults(storeSettings?.settings);
    const posSettings = settings?.pos || {};
    const enableScheduleValidation =
      posSettings.enable_schedule_validation || false;
    const businessHours = posSettings.business_hours || {};
    const timezone = settings?.general?.timezone || 'America/Bogota';

    // Si no está habilitado, permitir acceso
    if (!enableScheduleValidation) {
      return {
        isWithinBusinessHours: true,
        currentDay: this.getCurrentDayName(timezone),
        currentTime: this.getCurrentTime(timezone),
        message: 'Horario de atención no está habilitado',
      };
    }

    const { day, hours, minutes } = this.getDateInTimezone(timezone);
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const currentDayName = dayNames[day];
    const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    const todayHours = businessHours[currentDayName] as
      | BusinessHours
      | undefined;
    const curMinutes = hours * 60 + minutes;

    // Si no hay horario para hoy, permitir
    if (!todayHours) {
      return {
        isWithinBusinessHours: true,
        currentDay: this.getCurrentDayNameSpanish(currentDayName),
        currentTime,
        message: 'No hay horario configurado para hoy',
      };
    }

    // Verificar si está cerrado
    if (todayHours.open === 'closed' || todayHours.close === 'closed') {
      const nextOpen = this.getNextOpenDay(businessHours, day, curMinutes);
      return {
        isWithinBusinessHours: false,
        currentDay: this.getCurrentDayNameSpanish(currentDayName),
        currentTime,
        openTime: undefined,
        closeTime: undefined,
        nextOpenTime: nextOpen,
        message: `El establecimiento está cerrado hoy (${this.getCurrentDayNameSpanish(currentDayName)}). Horario próximo: ${nextOpen}`,
      };
    }

    // Validar horario
    const isWithin = this.isTimeWithinRange(
      currentTime,
      todayHours.open,
      todayHours.close,
    );

    if (isWithin) {
      return {
        isWithinBusinessHours: true,
        currentDay: this.getCurrentDayNameSpanish(currentDayName),
        currentTime,
        openTime: todayHours.open,
        closeTime: todayHours.close,
        message: `Horario de atención: ${todayHours.open} - ${todayHours.close}`,
      };
    }

    // Está fuera de horario
    const nextOpen = this.getNextOpenDay(businessHours, day, curMinutes);
    return {
      isWithinBusinessHours: false,
      currentDay: this.getCurrentDayNameSpanish(currentDayName),
      currentTime,
      openTime: todayHours.open,
      closeTime: todayHours.close,
      nextOpenTime: nextOpen,
      message: `El horario de atención es de ${todayHours.open} a ${todayHours.close}. Fuera de horario. Próxima apertura: ${nextOpen}`,
    };
  }

  /**
   * Valida y lanza excepción si está fuera de horario (para usar en guards/middleware)
   */
  async validateOrThrow(
    storeId: number,
    bypassForAdmins: boolean = true,
  ): Promise<void> {
    // Verificar si puede saltarse la validación (admin)
    if (bypassForAdmins) {
      const canBypass = await this.canBypassScheduleCheck();
      if (canBypass) {
        this.logger.debug('Admin user bypassing schedule validation');
        return;
      }
    }

    const validation = await this.validateBusinessHours(storeId);

    if (!validation.isWithinBusinessHours) {
      throw new ForbiddenException({
        message: 'POS fuera de horario de atención',
        code: 'POS_OUTSIDE_BUSINESS_HOURS',
        details: validation,
      });
    }
  }

  /**
   * Extracts day-of-week, hours and minutes in the store's timezone
   * using Intl.DateTimeFormat (no external dependencies).
   */
  private getDateInTimezone(timezone: string): {
    day: number;
    hours: number;
    minutes: number;
  } {
    const now = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(now);

      const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';
      const hoursVal = parseInt(
        parts.find((p) => p.type === 'hour')?.value || '0',
        10,
      );
      const minutesVal = parseInt(
        parts.find((p) => p.type === 'minute')?.value || '0',
        10,
      );

      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const dayVal = weekdayMap[weekdayStr] ?? now.getDay();

      return { day: dayVal, hours: hoursVal, minutes: minutesVal };
    } catch {
      // Fallback to local time if timezone is invalid
      return {
        day: now.getDay(),
        hours: now.getHours(),
        minutes: now.getMinutes(),
      };
    }
  }

  private getCurrentDayName(timezone?: string): string {
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    if (timezone) {
      const { day } = this.getDateInTimezone(timezone);
      return dayNames[day];
    }
    return dayNames[new Date().getDay()];
  }

  private getCurrentDayNameSpanish(day: string): string {
    const translations: Record<string, string> = {
      sunday: 'Domingo',
      monday: 'Lunes',
      tuesday: 'Martes',
      wednesday: 'Miércoles',
      thursday: 'Jueves',
      friday: 'Viernes',
      saturday: 'Sábado',
    };
    return translations[day] || day;
  }

  private getCurrentTime(timezone?: string): string {
    if (timezone) {
      const { hours, minutes } = this.getDateInTimezone(timezone);
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private isTimeWithinRange(
    current: string,
    open: string,
    close: string,
  ): boolean {
    const [curH, curM] = current.split(':').map(Number);
    const [openH, openM] = open.split(':').map(Number);
    const [closeH, closeM] = close.split(':').map(Number);

    const curMinutes = curH * 60 + curM;
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    return curMinutes >= openMinutes && curMinutes <= closeMinutes;
  }

  /**
   * Finds the next open day/time. If current time is before today's
   * opening hour, returns TODAY as the next open time.
   */
  private getNextOpenDay(
    businessHours: Record<string, BusinessHours>,
    currentDay: number,
    currentMinutes: number,
  ): string {
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const spanishDays: Record<string, string> = {
      sunday: 'Domingo',
      monday: 'Lunes',
      tuesday: 'Martes',
      wednesday: 'Miércoles',
      thursday: 'Jueves',
      friday: 'Viernes',
      saturday: 'Sábado',
    };

    // First check if today opens later (before opening hour)
    const todayName = dayNames[currentDay];
    const todayHours = businessHours[todayName];
    if (
      todayHours &&
      todayHours.open !== 'closed' &&
      todayHours.close !== 'closed'
    ) {
      const [openH, openM] = todayHours.open.split(':').map(Number);
      const openMinutes = openH * 60 + openM;
      if (currentMinutes < openMinutes) {
        return `Hoy ${todayHours.open} - ${todayHours.close}`;
      }
    }

    // Check next 7 days
    for (let i = 1; i <= 7; i++) {
      const dayIndex = (currentDay + i) % 7;
      const dayName = dayNames[dayIndex];
      const hours = businessHours[dayName];

      if (hours && hours.open !== 'closed' && hours.close !== 'closed') {
        return `${spanishDays[dayName]} ${hours.open} - ${hours.close}`;
      }
    }

    return 'Consultar configuración';
  }
}
