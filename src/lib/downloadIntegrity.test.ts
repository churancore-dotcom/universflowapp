import { describe, it, expect } from 'vitest';
import { downloadProblem } from './downloadIntegrity';
describe('downloadProblem', () => {
  it('accepts complete audio', () => expect(downloadProblem(4_000_000, 'audio/mp4', 4_000_000)).toBeNull());
  it('rejects an html error page', () => expect(downloadProblem(4_000_000, 'text/html')).not.toBeNull());
  it('rejects tiny bodies', () => expect(downloadProblem(500, 'audio/mpeg')).not.toBeNull());
  it('rejects cut-off transfers', () => expect(downloadProblem(1_000_000, 'audio/mp4', 4_000_000)).not.toBeNull());
});
