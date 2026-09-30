import type { PrintData } from 'qz-tray';

/**
 * What a thermal printer can actually print, and how to hand it raw bytes.
 *
 * The printers this ships with (DBL 822 and its ESC/POS kin) print ASCII
 * reliably and little else: most carry a Chinese GB18030 font and start in
 * Chinese double-byte mode, so a byte above 0x7F begins a two-byte Chinese
 * character; the rest use a single-byte code page (PC437) where it is some
 * other glyph. There is no Sinhala or Tamil font on any of them.
 *
 * So two rules, both enforced in `qzTrayService.printRaw`:
 *
 *  1. **Text is printable ASCII.** Accents are dropped (é → e), typographic
 *     punctuation is straightened (“ ” ‘ ’ – — … → " " ' ' - - ...), and
 *     anything else that cannot be printed becomes "?" — a visible gap rather
 *     than a burst of Chinese characters on a kitchen ticket.
 *  2. **Raw bytes never go through text.** A drawer kick ends in 0xFA; sent as a
 *     string it would be "cleaned" or re-encoded. {@link rawBytes} wraps bytes as
 *     a hex job element, which QZ writes exactly as given.
 */

/** Punctuation worth keeping the meaning of, not just replacing with "?". */
const REPLACEMENTS: Record<string, string> = {
  '‘': "'", // ‘
  '’': "'", // ’
  '‚': "'", // ‚
  '′': "'", // ′
  '“': '"', // “
  '”': '"', // ”
  '„': '"', // „
  '″': '"', // ″
  '‐': '-', // hyphen
  '‑': '-', // non-breaking hyphen
  '‒': '-', // figure dash
  '–': '-', // –
  '—': '-', // —
  '−': '-', // minus
  '…': '...', // …
  '·': '-', // ·  ("Order 14 · T1")
  '•': '*', // •
  '×': 'x', // ×
  ' ': ' ', // no-break space
  ' ': ' ', // narrow no-break space (toLocaleString puts one before "AM")
  ' ': ' ', // thin space
  '\t': ' ',
  '₨': 'Rs', // ₨
  '½': '1/2',
  '¼': '1/4',
  '¾': '3/4',
};

/**
 * Printable ASCII, for text that is about to be printed. Control characters
 * (ESC, GS, LF — every byte of an ESC/POS command we build) are left exactly
 * as they are, so this is safe to run over a whole command string.
 */
export function toPrinterText(s: string): string {
  let out = '';
  // NFKD splits "é" into "e" + a combining accent; the accent is then dropped.
  for (const ch of s.normalize('NFKD')) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x7e) out += ch;
    else if (code >= 0x0300 && code <= 0x036f) continue; // combining marks
    else out += REPLACEMENTS[ch] ?? '?';
  }
  return out;
}

/**
 * Raw bytes as a print job element that no text rule or encoding can touch.
 * QZ writes a `hex` flavoured command byte for byte.
 */
export function rawBytes(bytes: number[]): PrintData {
  return {
    type: 'raw',
    format: 'command',
    flavor: 'hex',
    data: bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(''),
  };
}
