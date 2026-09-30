import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from './navigation';

describe('isSafeExternalUrl', () => {
  it('lets real web pages out to the browser', () => {
    expect(isSafeExternalUrl('https://qz.io/download/')).toBe(true);
    expect(isSafeExternalUrl('https://lumora-k-ten.vercel.app/help')).toBe(true);
  });

  it('keeps everything Windows would run or open locally', () => {
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=secret',
      'javascript:alert(1)',
      'about:blank',
      '',
      'http://example.com', // plain http can be rewritten in transit
      'https://user:pass@example.com',
      'not a url',
    ]) {
      expect(isSafeExternalUrl(url), url).toBe(false);
    }
  });
});
