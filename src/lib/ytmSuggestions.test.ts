import { describe, it, expect } from 'vitest';
import { parseYtmSuggestions } from './ytmSuggestions';

const song = (title: string, sub: string, videoId: string) => ({ musicResponsiveListItemRenderer: {
  flexColumns: [title, sub].map((t) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: t }] } } })),
  navigationEndpoint: { watchEndpoint: { videoId } },
} });

describe('YouTube Music typing suggestions', () => {
  it('returns search terms and real songs with artist, without the "Song" label', () => {
    const r = parseYtmSuggestions({ contents: [
      { searchSuggestionsSectionRenderer: { contents: [{ searchSuggestionRenderer: { suggestion: { runs: [{ text: 'kesari' }, { text: 'ya' }] } } }] } },
      { searchSuggestionsSectionRenderer: { contents: [song('Kesariya', 'Song • Arijit Singh • 973M plays', 'NJAv_7lHUIU')] } },
    ] });
    expect(r.queries).toEqual(['kesariya']);
    expect(r.items[0]).toMatchObject({ kind: 'song', title: 'Kesariya', subtitle: 'Arijit Singh • 973M plays', videoId: 'NJAv_7lHUIU' });
  });
});
