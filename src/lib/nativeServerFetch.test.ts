import { describe, expect, it } from 'vitest';
import { toNativeServerUrl, NATIVE_SERVER_ORIGIN } from './nativeServerFetch';
import { normalizeSuggestions } from '@/hooks/useYtmSuggestions';

describe('phone app server calls', () => {
  it('sends relative server calls to the live website', () => {
    expect(toNativeServerUrl('/_serverFn/abc?x=1')).toBe(`${NATIVE_SERVER_ORIGIN}/_serverFn/abc?x=1`);
    expect(NATIVE_SERVER_ORIGIN).toBe('https://universflow.in');
  });
  it('leaves absolute URLs alone', () => {
    expect(toNativeServerUrl('https://example.com/a')).toBe('https://example.com/a');
  });
});

describe('typing suggestions never crash Search', () => {
  it('turns an HTML page reply into empty suggestions', () => {
    expect(normalizeSuggestions(new Response('<html></html>'))).toEqual({ queries: [], items: [] });
    expect(normalizeSuggestions('<html></html>')).toEqual({ queries: [], items: [] });
    expect(normalizeSuggestions(null)).toEqual({ queries: [], items: [] });
  });
  it('keeps valid suggestions and drops broken rows', () => {
    const r = normalizeSuggestions({ queries: ['sidhu', 'sidhu', 5], items: [{ kind: 'song', title: '295' }, { kind: 'song' }] });
    expect(r.queries).toEqual(['sidhu']);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].subtitle).toBe('');
  });
});
