/**
 * Ventana de la "semana Vendix" (domingo 07:00 Colombia → domingo siguiente 06:59).
 *
 * La regla de negocio dice: el reporte cubre la semana cerrada justo ANTES
 * del domingo 07:00 hora Colombia (UTC-05:00, sin horario de verano). El
 * snapshot se persiste y se notifica a esa hora.
 *
 * Importante: Colombia = America/Bogota = UTC-05:00 (fijo). No usamos
 * Intl ni Date#getTimezoneOffset para evitar drift por DST.
 */

const COLOMBIA_OFFSET_MINUTES = -5 * 60; // UTC-05:00

function toColombiaWallClock(d: Date): {
  y: number;
  m: number; // 0..11
  day: number;
  hour: number;
} {
  // Convertir UTC a hora local Colombia sumando el offset.
  const utc = d.getTime();
  const localMs = utc + COLOMBIA_OFFSET_MINUTES * 60_000;
  const local = new Date(localMs);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth(),
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
  };
}

function fromColombiaWallClock(
  y: number,
  m: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  // Construir el timestamp UTC correspondiente a esa hora local Colombia.
  const utc = Date.UTC(y, m, day, hour, minute, second, ms);
  return new Date(utc - COLOMBIA_OFFSET_MINUTES * 60_000);
}

/**
 * Devuelve la ventana de la semana cerrada (la que ya terminó antes de `now`).
 *
 * Domingo 00:00 Colombia (semana en curso, aún no termina) → devolver semana anterior.
 * Domingo 07:00 Colombia (o después) → la semana anterior está cerrada.
 *
 * "Semana Vendix" va de domingo 00:00 a domingo siguiente 00:00 hora Colombia.
 * El reporte se ejecuta domingo 07:00 y cubre la semana que terminó ese día
 * a las 00:00 (es decir, la semana anterior, 7 días atrás).
 */
export function getClosedWeekWindow(now: Date = new Date()): {
  weekStart: Date; // domingo 00:00 CO de la semana cerrada
  weekEnd: Date; // sábado 23:59:59.999 CO (incluyente)
  weekStartIso: string; // YYYY-MM-DD del weekStart
  weekEndIso: string; // YYYY-MM-DD del weekEnd
} {
  const wall = toColombiaWallClock(now);

  // Domingo 00:00 CO de la semana actual (en curso).
  // getUTCDay(): 0=Dom, 1=Lun, ... 6=Sáb
  const todayDow = new Date(Date.UTC(wall.y, wall.m, wall.day)).getUTCDay();
  // Si NO es domingo, retroceder hasta el domingo anterior.
  // Si ES domingo, usar hoy.
  let sundayOffset = todayDow; // 0 si es domingo

  const currentSunday = fromColombiaWallClock(
    wall.y,
    wall.m,
    wall.day - sundayOffset,
  );

  // El reporte se ejecuta domingo 07:00. Si todavía no son las 07:00 del domingo,
  // la semana cerrada es la anterior.
  let closedSunday: Date;
  if (wall.hour < 7 && todayDow === 0) {
    closedSunday = new Date(currentSunday.getTime() - 7 * 86_400_000);
  } else {
    closedSunday = currentSunday;
  }

  // weekStart = closedSunday 00:00 CO
  // weekEnd   = closedSunday + 6 días, 23:59:59.999 CO
  const weekStart = fromColombiaWallClock(
    wall.y,
    wall.m,
    wall.day - sundayOffset -
      (wall.hour < 7 && todayDow === 0 ? 7 : 0),
  );
  const weekEndMs = weekStart.getTime() + 7 * 86_400_000 - 1;
  const weekEnd = new Date(weekEndMs);

  return {
    weekStart,
    weekEnd,
    weekStartIso: toIsoDate(weekStart),
    weekEndIso: toIsoDate(weekEnd),
  };
}

/**
 * Devuelve la ventana móvil de las 4 semanas anteriores a `weekStart`
 * (es decir, los 28 días previos al inicio de la semana cerrada).
 */
export function getRolling4WeekWindow(weekStart: Date): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(weekStart.getTime() - 28 * 86_400_000),
    end: new Date(weekStart.getTime() - 1),
  };
}

export function toIsoDate(d: Date): string {
  // Devuelve YYYY-MM-DD en hora local Colombia.
  const wall = toColombiaWallClock(d);
  const yyyy = wall.y.toString().padStart(4, '0');
  const mm = (wall.m + 1).toString().padStart(2, '0');
  const dd = wall.day.toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
