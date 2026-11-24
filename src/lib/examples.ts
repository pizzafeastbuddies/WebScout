import type { Example } from './display';
import { DEMO_URLS } from './demoFixtures';

/**
 * Starter questions.
 *
 * Two sets, because the two source modes can reach different things. The demo set
 * is chosen to show the three outcomes that matter — a table cell with row and
 * column headers, a structured-data value, and a correct abstention — and it works
 * offline, so a first-time visitor always sees the engine do something real.
 */

export const DEMO_EXAMPLES: Example[] = [
  { label: 'A table cell', question: 'What is the peak throughput in Chile?', startUrl: DEMO_URLS.spec },
  { label: 'A structured value', question: 'What version is the Nimbus Relay?', startUrl: DEMO_URLS.product },
  { label: 'A correct abstention', question: 'What is the peak throughput of the Nimbus Relay in Antarctica?', startUrl: DEMO_URLS.spec },
];

export const LIVE_EXAMPLES: Example[] = [
  { label: 'Search the web', question: 'What is the capital of Chile?' },
  { label: 'A date', question: 'When was the Eiffel Tower completed?' },
  { label: 'A number', question: 'How many countries are in the European Union?' },
];
