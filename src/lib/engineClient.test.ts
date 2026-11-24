import { describe, expect, it } from 'vitest';
import { DEMO_URLS } from './demoFixtures';
import { runQuery } from './engineClient';

/**
 * A smoke test over the exact path the interface takes.
 *
 * The engine has its own exhaustive suite; what this covers is the wiring between
 * the components and the engine — dependency selection, the demo source set, and
 * the three outcomes the UI has to render (a table cell, a structured value, and a
 * correct abstention). It runs with no network, like everything else here.
 */
describe('engineClient (demo sources)', () => {
  it('answers a table question with the cell value', async () => {
    const response = await runQuery(
      { question: 'What is the peak throughput in Chile?', startUrl: DEMO_URLS.spec },
      'demo',
    );

    expect(response.abstained).toBe(false);
    expect(response.answerType).toBe('table_cell');
    expect(response.answer).toBe('640 Gbit/s');
    expect(response.evidence[0]?.locator.rowHeader).toBe('Chile');
    expect(response.evidence[0]?.locator.columnHeader).toBe('Peak throughput');
  });

  it('finds a version with no start URL, by discovering the saved pages first', async () => {
    const response = await runQuery({ question: 'What version is the Nimbus Relay?' }, 'demo');

    expect(response.abstained).toBe(false);
    expect(response.answer).toBe('4.2.1');
    // Discovery ran, so sources were found by search rather than being supplied.
    expect(response.sources.some((source) => source.via === 'search')).toBe(true);
  });

  it('abstains rather than answering a question the saved pages do not address', async () => {
    const response = await runQuery(
      { question: 'What is the peak throughput of the Nimbus Relay in Antarctica?', startUrl: DEMO_URLS.spec },
      'demo',
    );

    expect(response.abstained).toBe(true);
    expect(response.abstainReason).toBe('no_evidence');
    expect(response.answer).toBeNull();
  });

  it('never throws, whatever it is asked', async () => {
    await expect(runQuery({ question: '' }, 'demo')).resolves.toBeDefined();
    await expect(runQuery({ question: '???', startUrl: 'not-a-url' }, 'demo')).resolves.toBeDefined();
  });
});
