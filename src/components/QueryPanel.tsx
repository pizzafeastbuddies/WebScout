import { OPTION_BOUNDS } from '../../engine/contract/internal';
import type { Example } from '../lib/display';
import type { SourceMode } from '../lib/engineClient';
import { ChevronDownIcon, SearchIcon } from './icons';

export interface QueryPanelValues {
  question: string;
  startUrl: string;
  mode: SourceMode;
  maxPages: number;
  maxDepth: number;
  allowSearch: boolean;
}

interface QueryPanelProps {
  values: QueryPanelValues;
  onChange: (patch: Partial<QueryPanelValues>) => void;
  onSubmit: () => void;
  running: boolean;
  examples: Example[];
  onUseExample: (example: Example) => void;
}

const FIELD =
  'w-full rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/60 transition-colors duration-150 outline-none ' +
  'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const LABEL = 'block text-xs font-semibold uppercase tracking-wider text-muted-foreground';

export function QueryPanel({ values, onChange, onSubmit, running, examples, onUseExample }: QueryPanelProps) {
  const canSubmit = values.question.trim().length > 0 && !running;

  return (
    <section aria-labelledby="query-heading" className="rounded-2xl border border-border/60 bg-primary/70 p-5 sm:p-6">
      <h2 id="query-heading" className="sr-only">
        Ask a question
      </h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="space-y-2">
          <label className={LABEL} htmlFor="question">
            Question
          </label>
          <textarea
            id="question"
            name="question"
            rows={2}
            value={values.question}
            onChange={(event) => onChange({ question: event.target.value })}
            placeholder="What do you want to find out?"
            className={`${FIELD} resize-y leading-relaxed`}
          />
        </div>

        <div className="mt-4 space-y-2">
          <label className={LABEL} htmlFor="start-url">
            Start from a page <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <input
            id="start-url"
            name="startUrl"
            type="url"
            inputMode="url"
            value={values.startUrl}
            onChange={(event) => onChange({ startUrl: event.target.value })}
            placeholder="https://example.com/spec"
            aria-describedby="start-url-hint"
            className={FIELD}
          />
          <p id="start-url-hint" className="text-xs text-muted-foreground">
            Leave this empty and WebScout will search for pages itself, then follow links from what it finds.
          </p>
        </div>

        <div className="mt-5 space-y-2">
          <fieldset>
            <legend className={LABEL}>Sources</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: 'demo', title: 'Saved page snapshots', note: 'Offline set — always works' },
                  { value: 'live', title: 'The live web', note: 'Bounds by CORS in the browser' },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors duration-150 ${
                    values.mode === option.value ? 'border-accent/70 bg-accent/10' : 'border-border/60 hover:border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="source-mode"
                    value={option.value}
                    checked={values.mode === option.value}
                    onChange={() => onChange({ mode: option.value })}
                    className="mt-0.5 h-4 w-4 accent-accent"
                  />
                  <span>
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="block text-xs text-muted-foreground">{option.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <details className="group mt-5">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors duration-150 hover:text-foreground">
            <ChevronDownIcon className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
            Advanced options
          </summary>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className={LABEL} htmlFor="max-pages">
                Pages to read
              </label>
              <input
                id="max-pages"
                type="number"
                min={OPTION_BOUNDS.maxPages.min}
                max={OPTION_BOUNDS.maxPages.max}
                value={values.maxPages}
                onChange={(event) => onChange({ maxPages: Number(event.target.value) })}
                className={FIELD}
              />
            </div>
            <div className="space-y-2">
              <label className={LABEL} htmlFor="max-depth">
                Link hops to follow
              </label>
              <input
                id="max-depth"
                type="number"
                min={OPTION_BOUNDS.maxDepth.min}
                max={OPTION_BOUNDS.maxDepth.max}
                value={values.maxDepth}
                onChange={(event) => onChange({ maxDepth: Number(event.target.value) })}
                className={FIELD}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={values.allowSearch}
                onChange={(event) => onChange({ allowSearch: event.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              <span className="text-sm text-muted-foreground">
                Allow searching when no start URL is given
              </span>
            </label>
          </div>
        </details>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition duration-150 ease-out hover:brightness-110 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45"
          >
            <SearchIcon className="h-4 w-4" />
            {running ? 'Running…' : 'Run retrieval'}
          </button>
          <p className="text-xs text-muted-foreground">Answers are quoted from pages WebScout actually read.</p>
        </div>
      </form>

      <div className="mt-6 border-t border-border/40 pt-4">
        <p className={LABEL}>Try one</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {examples.map((example) => (
            <li key={example.label}>
              <button
                type="button"
                onClick={() => onUseExample(example)}
                className="cursor-pointer rounded-full border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition duration-150 hover:border-accent/60 hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
