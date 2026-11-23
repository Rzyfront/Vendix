import { describePurgeCounts, purgeConfirmMessage } from './vex-conversation-purge.util';

const BASE = { messages: 0, attachments: 0, blocks: 0, memories: 0, has_running_task: false };

describe('describePurgeCounts', () => {
  it('lists messages, files and memories with correct plurals', () => {
    expect(describePurgeCounts({ ...BASE, messages: 42, attachments: 3, memories: 1 })).toBe(
      '42 mensajes, 3 archivos y 1 recuerdo',
    );
  });

  it('uses the singular for one of each', () => {
    expect(describePurgeCounts({ ...BASE, messages: 1, attachments: 1, blocks: 1, memories: 1 })).toBe(
      '1 mensaje, 1 archivo, 1 tabla o gráfico y 1 recuerdo',
    );
  });

  it('omits zero parts except the messages', () => {
    expect(describePurgeCounts({ ...BASE, messages: 0 })).toBe('0 mensajes');
    expect(describePurgeCounts({ ...BASE, messages: 5, memories: 2 })).toBe('5 mensajes y 2 recuerdos');
  });
});

describe('purgeConfirmMessage', () => {
  it('states the figures, irreversibility and what is kept', () => {
    const text = purgeConfirmMessage({ ...BASE, messages: 42, attachments: 3, memories: 1 });
    expect(text).toContain('Se borrarán 42 mensajes, 3 archivos y 1 recuerdo. No se puede deshacer.');
    expect(text).toContain('Los recordatorios y notas de bitácora que guardaste desde esta conversación se conservan.');
    expect(text).toContain('Lo que Vex ya aplicó en tu negocio no se deshace.');
  });
});
