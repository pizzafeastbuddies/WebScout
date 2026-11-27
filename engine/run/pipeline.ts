import { abstainResponse } from '../answer/abstain';
import { select } from '../answer/select';
import { selectWithModel } from '../answer/synthesize';
import { isRejected, verifyCandidate, type RejectedCandidate, type VerifiedCandidate } from '../answer/verify';
import { MAX_EVIDENCE_ITEMS, resolveRetrievalRequest, type RetrievalResponse, type RetrievalRunner } from '../contract/internal';
import { extractLinks } from '../discovery/links';
import { DEFAULT_SEARCH_LIMIT } from '../discovery/search';
import { parseDocument, type Document } from '../dom/parseHtml';
import type { Candidate } from '../extract/candidate';
import { documentTitle, groundingText } from '../extract/sourceText';
import { extractStructuredCandidates } from '../extract/structured';
import { extractTableCandidates } from '../extract/tables';
import { extractTextCandidates } from '../extract/text';
import { formatResponse } from '../format/result';
import { understand } from '../query/understand';
import type { AbstainReason, AnswerType, Evidence, SourceDiscovery, SourceReport, SearchResult, TraceEvent } from '../types';
import { round } from '../util/text';

/**
 * The pipeline: understand → discover → fetch → extract → select → verify → format.
 *
 * Every step appends to `trace`, which is the run's only means of explaining
 * itself. Progress is not streamed — it arrives with the completed response — so
 * the trace has to be rich enough that a finished run can be replayed stage by
 * stage in the UI, including the candidates the verification gate rejected.
 *
 * The orchestrator owns no network code and no runtime-specific API: it talks to
 * the injected `Fetcher` and `SearchProvider` only. That is what lets the identical
 * file drive fixtures in a test, live HTTP behind the Edge Function, and the AMD
 * container.
 */

/** Words that describe the SHAPE of the answer wanted, not the subject: useless in a search query. */
const SEARCH_NOISE: ReadonlySet<string> = new Set([
  'year', 'years', 'date', 'many', 'much', 'tall', 'high', 'long', 'old', 'big', 'large', 'number',
  'name', 'called', 'metres', 'meters', 'kilometres', 'percent', 'default',
]);

/** How many ranked candidates are put through the (more expensive) verification gate. */
const SHORTLIST_SIZE = 25;

interface QueueItem {
  url: string;
  via: SourceDiscovery;
  depth: number;
}

function extractCandidates(doc: Document, sourceUrl: string): Candidate[] {
  return [
    ...extractTableCandidates(doc, sourceUrl),
    ...extractStructuredCandidates(doc, sourceUrl),
    ...extractTextCandidates(doc, sourceUrl),
  ];
}

/**
 * How close two rival answers must score to count as a disagreement worth
 * reporting. Roughly one keyword's weight: both sources answer the question about
 * equally well, but they do not agree.
 */
const CONFLICT_TOLERANCE = 2.5;

/**
 * True when another *source* offers a different answer at a comparable score.
 *
 * Restricted to different sources on purpose: within one table, many cells
 * legitimately score similarly, and they are not disagreeing with each other.
 */
function detectConflict(verified: readonly VerifiedCandidate[]): boolean {
  const best = verified[0];
  if (!best || verified.length < 2) {
    return false;
  }
  return verified.some(
    (item) =>
      item.answer !== best.answer &&
      item.candidate.sourceUrl !== best.candidate.sourceUrl &&
      Math.abs(item.score - best.score) <= CONFLICT_TOLERANCE,
  );
}

/**
 * A conflict that cannot be broken: two sources answered the question equally
 * well, and got different answers. There is no principled way to choose between
 * them, so the run abstains rather than picking the one that happened to sort
 * first.
 */
function isUnresolved(verified: readonly VerifiedCandidate[]): boolean {
  const best = verified[0];
  if (!best) {
    return false;
  }
  return verified.some(
    (item) =>
      item.answer !== best.answer &&
      item.candidate.sourceUrl !== best.candidate.sourceUrl &&
      item.matchedKeywords.length === best.matchedKeywords.length &&
      Math.abs(item.score - best.score) < 0.01,
  );
}

function contradictionEvidence(verified: readonly VerifiedCandidate[]): Evidence[] {
  const seen = new Set<string>();
  const evidence: Evidence[] = [];
  for (const item of verified) {
    if (seen.has(item.answer)) {
      continue;
    }
    seen.add(item.answer);
    evidence.push({
      id: `ev-${evidence.length + 1}`,
      snippet: item.candidate.text,
      sourceUrl: item.candidate.sourceUrl,
      locator: item.candidate.locator,
      matchType: item.matchType,
      score: round(item.score, 2),
    });
    if (evidence.length >= MAX_EVIDENCE_ITEMS) {
      break;
    }
  }
  return evidence;
}

export const runRetrieval: RetrievalRunner = async (request, deps) => {
  const resolved = resolveRetrievalRequest(request);
  const trace: TraceEvent[] = [];
  const understanding = understand(resolved.question);

  const abstain = (
    answerType: AnswerType,
    reason: AbstainReason,
    sources: SourceReport[],
    evidence?: Evidence[],
  ): RetrievalResponse => {
    trace.push({ stage: 'format', status: 'ok', detail: `Abstained: ${reason}` });
    return abstainResponse({ question: resolved.question, answerType, reason, sources, trace, evidence });
  };

  // ---- UNDERSTAND ---------------------------------------------------------
  if (!understanding.question) {
    trace.push({ stage: 'understand', status: 'failed', detail: 'No question was supplied' });
    return abstain('unknown', 'no_sources', []);
  }

  trace.push({
    stage: 'understand',
    status: 'ok',
    detail: `Looking for a ${understanding.answerType} answer`,
    counts: { keywords: understanding.keywords.length },
  });

  if (understanding.keywords.length === 0) {
    trace.push({ stage: 'understand', status: 'failed', detail: 'The question contains no searchable terms' });
    return abstain(understanding.answerType, 'no_evidence', []);
  }

  // ---- DISCOVER -----------------------------------------------------------
  const queue: QueueItem[] = [];

  if (resolved.startUrl) {
    queue.push({ url: resolved.startUrl, via: 'start_url', depth: 0 });
    trace.push({ stage: 'discover', status: 'ok', detail: 'Seeded from the supplied start URL', counts: { seeds: 1 } });
  } else if (resolved.options.allowSearch) {
    const provider = deps.searchProviders?.[resolved.options.searchProvider];
    if (!provider) {
      trace.push({
        stage: 'discover',
        status: 'failed',
        detail: `No "${resolved.options.searchProvider}" search provider is available in this runtime`,
      });
      return abstain(understanding.answerType, 'no_sources', []);
    }

    trace.push({ stage: 'discover', status: 'start', detail: `Searching with ${provider.id}` });

    let results: SearchResult[] = [];
    try {
      const limit = Math.min(resolved.options.maxPages, DEFAULT_SEARCH_LIMIT);
      // Search on the question's content words: a whole question ("In what year was the
      // Eiffel Tower completed?") ranks worse than "eiffel tower completed". Words that
      // only describe the kind of answer wanted ("year", "tall") are left out.
      const searchWords = understanding.keywords.filter((word) => !SEARCH_NOISE.has(word));
      const keywordQuery = searchWords.length >= 2 ? searchWords.join(' ') : resolved.question;
      results = await provider.search(keywordQuery, limit);
      if (results.length === 0 && keywordQuery !== resolved.question) {
        results = await provider.search(resolved.question, limit);
      }
    } catch {
      // Providers are contractually soft. If one throws anyway, discovery simply
      // yields nothing and the run abstains rather than failing.
      results = [];
    }

    for (const result of results.slice(0, resolved.options.maxPages)) {
      queue.push({ url: result.url, via: 'search', depth: 0 });
    }

    if (queue.length === 0) {
      trace.push({ stage: 'discover', status: 'failed', detail: 'Search returned nothing usable' });
      return abstain(understanding.answerType, 'no_sources', []);
    }

    trace.push({
      stage: 'discover',
      status: 'ok',
      detail: `Took ${queue.length} result(s) from ${provider.id}`,
      counts: { seeds: queue.length },
    });
  } else {
    trace.push({ stage: 'discover', status: 'skipped', detail: 'No start URL was supplied and search is disabled' });
    return abstain(understanding.answerType, 'no_sources', []);
  }

  // ---- FETCH + EXTRACT ----------------------------------------------------
  const reports = new Map<string, SourceReport>();
  const grounding = new Map<string, string>();
  const candidates: Candidate[] = [];
  const visited = new Set<string>();
  let fetched = 0;
  let failed = 0;

  trace.push({ stage: 'fetch', status: 'start', detail: `Reading up to ${resolved.options.maxPages} page(s)` });

  while (queue.length > 0 && visited.size < resolved.options.maxPages) {
    const item = queue.shift();
    if (!item || visited.has(item.url)) {
      continue;
    }
    visited.add(item.url);

    const result = await deps.fetcher.get(item.url);

    if (!result.ok) {
      failed += 1;
      reports.set(item.url, {
        url: item.url,
        status: 'failed',
        via: item.via,
        error: result.error,
        httpStatus: result.status,
        contentType: result.contentType,
        detail: result.detail,
      });
      continue;
    }

    fetched += 1;
    const report: SourceReport = {
      url: item.url,
      status: 'fetched',
      via: item.via,
      finalUrl: result.finalUrl,
      contentType: result.contentType,
      bytes: result.bytes,
    };
    reports.set(item.url, report);

    const doc = parseDocument(result.body);
    report.title = documentTitle(doc);
    grounding.set(result.finalUrl, groundingText(doc));

    const page = extractCandidates(doc, result.finalUrl);
    report.candidatesFound = page.length;
    candidates.push(...page);

    if (item.depth < resolved.options.maxDepth) {
      for (const link of extractLinks(doc, result.finalUrl, understanding.keywords)) {
        if (!visited.has(link.url)) {
          queue.push({ url: link.url, via: 'link', depth: item.depth + 1 });
        }
      }
    }
  }

  // Anything discovered but never read is reported as skipped, so a thin run is
  // never mistaken for a site that had nothing to offer.
  for (const item of queue) {
    if (!visited.has(item.url) && !reports.has(item.url)) {
      reports.set(item.url, {
        url: item.url,
        status: 'skipped',
        via: item.via,
        error: 'budget_exhausted',
        detail: 'Left unread: the page budget was reached',
      });
    }
  }

  const sources = [...reports.values()];

  trace.push({
    stage: 'fetch',
    status: fetched > 0 ? 'ok' : 'failed',
    detail: `Read ${fetched} page(s); ${failed} failed`,
    counts: { fetched, failed },
  });

  if (fetched === 0) {
    trace.push({ stage: 'extract', status: 'skipped', detail: 'No page could be read' });
    return abstain(understanding.answerType, 'fetch_failed', sources);
  }

  trace.push({
    stage: 'extract',
    status: candidates.length > 0 ? 'ok' : 'failed',
    detail: `Found ${candidates.length} candidate passage(s)`,
    counts: { candidates: candidates.length, pages: fetched },
  });

  if (candidates.length === 0) {
    trace.push({ stage: 'select', status: 'skipped', detail: 'Nothing to rank' });
    trace.push({ stage: 'verify', status: 'skipped', detail: 'Nothing to check' });
    return abstain(understanding.answerType, 'no_evidence', sources);
  }

  // ---- SELECT -------------------------------------------------------------
  const shortlist = select(candidates, understanding).slice(0, SHORTLIST_SIZE);

  trace.push({
    stage: 'select',
    status: shortlist.length > 0 ? 'ok' : 'failed',
    detail: `Ranked ${shortlist.length} relevant passage(s)`,
    counts: { shortlisted: shortlist.length },
  });

  if (shortlist.length === 0) {
    trace.push({ stage: 'verify', status: 'skipped', detail: 'No passage was relevant enough to check' });
    return abstain(understanding.answerType, 'no_evidence', sources);
  }

  // ---- VERIFY -------------------------------------------------------------
  const verified: VerifiedCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const item of shortlist) {
    const verdict = verifyCandidate(item, understanding.answerType, grounding.get(item.candidate.sourceUrl) ?? '', resolved.question);
    if (isRejected(verdict)) {
      rejected.push(verdict);
    } else {
      verified.push(verdict);
    }
  }

  trace.push({
    stage: 'verify',
    status: verified.length > 0 ? 'ok' : 'failed',
    detail: `${verified.length} grounded, ${rejected.length} rejected`,
    counts: { accepted: verified.length, rejected: rejected.length },
  });

  if (rejected.length > 0) {
    trace.push({
      stage: 'verify',
      status: 'ok',
      detail: `Rejected: ${rejected
        .slice(0, 3)
        .map((item) => item.reason)
        .join('; ')}`,
    });
  }

  if (verified.length === 0) {
    return abstain(understanding.answerType, 'no_evidence', sources);
  }

  // ---- OPTIONAL MODEL STEP ------------------------------------------------
  // A model may pick the exact value from the verified passages. Its value must still
  // occur in the passage and in the page (see selectWithModel), so it cannot add facts.
  const modelOutcome = await selectWithModel(deps.llm, understanding, verified, (url) => grounding.get(url) ?? '');

  if (modelOutcome.kind === 'declined') {
    trace.push({ stage: 'verify', status: 'failed', detail: `Model step: ${modelOutcome.reason}` });
    return abstain(understanding.answerType, 'no_evidence', sources);
  }

  if (modelOutcome.kind === 'answered') {
    trace.push({
      stage: 'verify',
      status: 'ok',
      detail: `Model picked the value; it is grounded in ${modelOutcome.evidenceId} and in the page`,
    });
    trace.push({ stage: 'format', status: 'ok', detail: 'Answer returned with evidence' });
    return formatResponse({
      question: resolved.question,
      understanding,
      verified: modelOutcome.ranked,
      rejected,
      sources,
      trace,
      conflict: false,
    });
  }

  const conflict = detectConflict(verified);

  if (conflict && isUnresolved(verified)) {
    trace.push({
      stage: 'verify',
      status: 'failed',
      detail: 'Sources disagree at equal strength, so no answer can be justified',
    });
    return abstain(understanding.answerType, 'contradictory_evidence', sources, contradictionEvidence(verified));
  }

  if (conflict) {
    trace.push({
      stage: 'verify',
      status: 'ok',
      detail: 'Sources disagree; the best-grounded answer is returned at reduced confidence',
    });
  }

  // ---- FORMAT -------------------------------------------------------------
  trace.push({ stage: 'format', status: 'ok', detail: 'Answer returned with evidence' });

  return formatResponse({
    question: resolved.question,
    understanding,
    verified,
    rejected,
    sources,
    trace,
    conflict,
  });
};
