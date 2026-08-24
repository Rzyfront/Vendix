/**
 * Diff campo por campo entre dos snapshots de configuración de perfil.
 *
 * ## Por qué existe
 *
 * El requerimiento 13 pide que el historial diga «qué cambió», no sólo «cambió».
 * Un diff que muestre cambios inexistentes —o que se coma uno real— desorienta
 * una investigación fiscal, que es el único momento en que alguien abre esta
 * pantalla. De ahí las tres reglas de abajo.
 *
 * ## Regla 1 — comparar por VALOR normalizado, no por texto
 *
 * `JSON.stringify` de dos objetos con las mismas claves en otro orden da
 * cadenas distintas. Comparar así marcaría como «cambiado» un snapshot que
 * nadie tocó, sólo porque el backend serializó las claves en otro orden. Se
 * aplana a rutas y se compara valor contra valor.
 *
 * ## Regla 2 — `null`, `undefined` y ausente son lo mismo acá
 *
 * El snapshot declara decenas de campos opcionales, y el normalizador del
 * contrato convierte el vacío en `null`. Una versión guardada antes de ese
 * normalizador puede tener la clave ausente donde otra tiene `null`. Tratarlas
 * como distintas produciría un diff lleno de cambios que nunca ocurrieron.
 *
 * ## Regla 3 — los arreglos se comparan por índice, y el índice se publica
 *
 * `taxes.rules` y `model_lines` son arreglos. Comparar «el arreglo entero» sólo
 * puede decir que algo cambió; comparar por índice dice CUÁL regla cambió y en
 * qué campo, que es lo que se necesita para explicar por qué una factura salió
 * con otra base gravable. Un arreglo que cambia de longitud produce entradas
 * `added` / `removed` con su índice.
 */

/** Un cambio entre dos snapshots. */
export interface ConfigDiffEntry {
    /** Ruta con puntos dentro del snapshot: `aiu.components.utilidad`. */
    path: string;
    kind: 'added' | 'removed' | 'changed';
    before: unknown;
    after: unknown;
}

/** `true` si el valor cuenta como «sin dato» a efectos de comparación. */
function isEmpty(value: unknown): boolean {
    return value === null || value === undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    );
}

/**
 * Aplana un valor a un mapa de ruta → valor hoja.
 *
 * Los arreglos se aplanan con el índice entre corchetes para que el diff pueda
 * nombrar la fila exacta (`taxes.rules[2].rate`).
 */
function flatten(
    value: unknown,
    prefix: string,
    output: Map<string, unknown>,
): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            flatten(item, prefix + '[' + index + ']', output);
        });
        // Se publica también la longitud: un arreglo que se vacía por completo
        // no dejaría ninguna hoja y el diff no diría nada.
        output.set(prefix + '.length', value.length);
        return;
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        if (keys.length === 0) {
            output.set(prefix, {});
            return;
        }
        for (const key of keys) {
            flatten(value[key], prefix ? prefix + '.' + key : key, output);
        }
        return;
    }
    output.set(prefix, value ?? null);
}

/**
 * Compara dos snapshots y devuelve los cambios, ordenados por ruta.
 *
 * `before` es la versión más antigua. El orden importa para leer el resultado:
 * `added` significa que la versión nueva trae un dato que la vieja no tenía.
 */
export function diffProfileConfig(
    before: unknown,
    after: unknown,
): ConfigDiffEntry[] {
    const left = new Map<string, unknown>();
    const right = new Map<string, unknown>();
    flatten(before, '', left);
    flatten(after, '', right);

    const paths = new Set<string>([...left.keys(), ...right.keys()]);
    const entries: ConfigDiffEntry[] = [];

    for (const path of paths) {
        const hasLeft = left.has(path);
        const hasRight = right.has(path);
        const leftValue = left.get(path);
        const rightValue = right.get(path);

        // Ausente en un lado y vacío en el otro NO es un cambio: es la misma
        // ausencia escrita de dos formas.
        if (!hasLeft && isEmpty(rightValue)) continue;
        if (!hasRight && isEmpty(leftValue)) continue;

        if (!hasLeft) {
            entries.push({ path, kind: 'added', before: null, after: rightValue });
            continue;
        }
        if (!hasRight) {
            entries.push({ path, kind: 'removed', before: leftValue, after: null });
            continue;
        }
        if (isEmpty(leftValue) && isEmpty(rightValue)) continue;
        if (JSON.stringify(leftValue) === JSON.stringify(rightValue)) continue;

        entries.push({ path, kind: 'changed', before: leftValue, after: rightValue });
    }

    return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Etiqueta legible de una ruta del snapshot.
 *
 * Se traduce el primer segmento —la sección— y se deja el resto tal cual: la
 * ruta técnica es lo que permite encontrar el campo en el editor, y ocultarla
 * detrás de una etiqueta bonita obligaría a adivinar dónde mirar.
 */
export function describeConfigPath(path: string): string {
    const section = path.split(/[.[]/)[0] ?? path;
    const labels: Record<string, string> = {
        general: 'General',
        aiu: 'AIU',
        accounting: 'Contabilidad',
        taxes: 'Impuestos',
        model_lines: 'Líneas modelo',
        format: 'Formato',
        dian: 'DIAN',
        config_version: 'Versión del contrato',
    };
    const label = labels[section];
    return label ? label + ' · ' + path : path;
}

/** Representación imprimible de un valor del snapshot. */
export function formatConfigValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'sí' : 'no';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
