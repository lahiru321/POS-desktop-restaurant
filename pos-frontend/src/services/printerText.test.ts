import { describe, expect, it } from 'vitest';
import { rawBytes, toPrinterText } from './printerText';

describe('toPrinterText', () => {
  it('drops accents rather than printing a stray byte', () => {
    expect(toPrinterText('Crème brûlée, jalapeño')).toBe('Creme brulee, jalapeno');
  });

  it('straightens typographic punctuation, keeping its meaning', () => {
    expect(toPrinterText('“No chilli” – Nimal’s table… Order 14 · T1')).toBe(
      '"No chilli" - Nimal\'s table... Order 14 - T1',
    );
  });

  it('prints "?" for what no ESC/POS font has — Sinhala, Tamil, emoji', () => {
    expect(toPrinterText('කොත්තු')).toMatch(/^\?+$/);
    expect(toPrinterText('Kottu 🔥')).toBe('Kottu ?');
  });

  it('turns the narrow no-break space toLocaleString puts before AM into a space', () => {
    expect(toPrinterText('11:37 AM')).toBe('11:37 AM');
  });

  it('leaves ESC/POS control bytes exactly as they are', () => {
    const command = '\x1B\x40\x1C\x2E\x1D\x21\x11BIG\n\x1D\x56\x42\x00';
    expect(toPrinterText(command)).toBe(command);
  });
});

describe('rawBytes', () => {
  it('wraps bytes as a hex command, so 0xFA reaches the printer as one byte', () => {
    expect(rawBytes([27, 112, 0, 25, 250])).toEqual({
      type: 'raw',
      format: 'command',
      flavor: 'hex',
      data: '1b700019fa',
    });
  });
});
