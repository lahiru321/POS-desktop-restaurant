import { beforeEach, describe, expect, it, vi } from 'vitest';

const qz = vi.hoisted(() => ({
  api: { setPromiseType: vi.fn() },
  security: { setSignatureAlgorithm: vi.fn(), setCertificatePromise: vi.fn(), setSignaturePromise: vi.fn() },
  websocket: { isActive: vi.fn(() => true), connect: vi.fn() },
  printers: { getDefault: vi.fn(async () => 'Default printer') },
  configs: { create: vi.fn((printer: string, options: Record<string, unknown>) => ({ printer, options })) },
  print: vi.fn(async () => undefined),
}));

vi.mock('qz-tray', () => ({ default: qz }));
vi.mock('./api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import { qzTrayService } from './qzTrayService';
import { rawBytes } from './printerText';

beforeEach(() => vi.clearAllMocks());

describe('qzTrayService.printRaw', () => {
  it('sends one byte per character (ISO-8859-1), never UTF-8', async () => {
    await qzTrayService.printRaw('Kitchen', ['Hi\n']);
    expect(qz.configs.create).toHaveBeenCalledWith('Kitchen', { encoding: 'ISO-8859-1' });
  });

  it('cleans every text chunk to printable ASCII and passes raw elements through untouched', async () => {
    const kick = rawBytes([27, 112, 0, 25, 250]);
    await qzTrayService.printRaw('Till', ['\x1B\x40', 'Crème brûlée…\n', kick]);

    const [, data] = qz.print.mock.calls[0] as unknown as [unknown, unknown[]];
    expect(data).toEqual(['\x1B\x40', 'Creme brulee...\n', kick]);
  });

  it('falls back to the system default printer when none is chosen', async () => {
    await qzTrayService.printRaw('default', ['x']);
    expect(qz.configs.create).toHaveBeenCalledWith('Default printer', { encoding: 'ISO-8859-1' });
  });
});
