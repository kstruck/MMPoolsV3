// The Help panel's pieces — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// Presentational only: every one of these takes what it renders and a click
// handler. No registry lookups, no routing, no state beyond "is this accordion
// open" — so the resolution rules stay in `useHelpPanel.ts` where they can be
// tested without a drawer.

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GlossaryTerm, HelpPage, HelpSearchResult, HelpTopic } from '../../help/types';
import { resolveCopy } from '../../help/registry';
import type { PoolType } from '@shared/poolTypes';
import { cn } from '../ui/cn';

/** The DOM id a topic is anchored at, so `openTo` can scroll to it. */
export function topicAnchorId(topicId: string): string {
  // Ids carry dots and colons (`NFL_SURVIVOR:settings.entryFee`), which are
  // legal in an id attribute but not in a CSS selector — so the panel scrolls
  // via `getElementById`, never `querySelector`.
  return `help-topic-${topicId}`;
}

export function PanelSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted">{children}</h3>
  );
}

/** One expandable group of topics inside "On this page". */
export function SectionAccordion(props: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { title, defaultOpen = false, children } = props;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-card px-3 py-2 text-left font-display font-bold uppercase text-[12px] tracking-[0.06em] text-[color:var(--text)]"
      >
        {title}
        <ChevronDown size={14} className={cn('shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? <div className="space-y-3 px-3 py-3">{children}</div> : null}
    </div>
  );
}

/**
 * One topic's full copy. `highlighted` is the topic `openTo` was called with —
 * it is what the panel scrolls to and it is announced by being focusable, so a
 * screen-reader user landing here is told which one they asked for.
 */
export function TopicCard(props: {
  topic: HelpTopic;
  poolType?: PoolType;
  highlighted?: boolean;
  /** Resolved here rather than in the card, so it renders a title, not an id. */
  related?: readonly { id: string; title: string }[];
  onOpenRelated?: (topicId: string) => void;
}) {
  const { topic, poolType, highlighted, related, onOpenRelated } = props;
  return (
    <section
      id={topicAnchorId(topic.id)}
      tabIndex={-1}
      className={cn(
        'scroll-mt-4 rounded-md border border-transparent px-2 py-1.5',
        highlighted && 'border-gold-500 bg-gold-500/5',
      )}
    >
      <h4 className="font-display font-bold text-[13px] text-[color:var(--text)]">{topic.title}</h4>
      <p className="mt-1 font-body text-[13px] leading-relaxed text-muted">
        {resolveCopy(topic.long, { poolType })}
      </p>
      {topic.tips && topic.tips.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 font-body text-[12px] leading-relaxed text-muted">
          {topic.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      ) : null}
      {related && related.length > 0 && onOpenRelated ? (
        <p className="mt-2 flex flex-wrap gap-2">
          {related.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpenRelated(r.id)}
              className="font-display text-[11px] font-bold uppercase tracking-[0.05em] text-gold-600 hover:underline dark:text-gold-400"
            >
              {r.title}
            </button>
          ))}
        </p>
      ) : null}
    </section>
  );
}

export function SearchResults(props: {
  query: string;
  results: readonly HelpSearchResult[];
  onSelect: (result: HelpSearchResult) => void;
}) {
  const { query, results, onSelect } = props;
  if (results.length === 0) {
    return (
      <p className="font-body text-[13px] text-muted">
        Nothing in Help matches “{query}”. Try a shorter word, or the name of the setting.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {results.map((result) => (
        <li key={`${result.kind}:${result.id}`}>
          <button
            type="button"
            onClick={() => onSelect(result)}
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-left hover:border-gold-500"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-display font-bold text-[13px] text-[color:var(--text)]">{result.title}</span>
              <span className="font-display text-[10px] uppercase tracking-[0.08em] text-faint">{result.kind}</span>
            </span>
            <span className="mt-1 block font-body text-[12px] leading-relaxed text-muted">{result.snippet}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The DOM id a glossary term is anchored at, so a search hit can scroll to it. */
export function termAnchorId(termId: string): string {
  return `help-term-${termId}`;
}

/**
 * One glossary card: `short` always, `long` on click.
 *
 * `defaultOpen` is honoured at MOUNT, so the caller remounts the card (by
 * varying its key) when a search hit selects it — the alternative is a
 * controlled/uncontrolled hybrid, and this card has exactly one piece of state.
 */
export function GlossaryCard({ term, defaultOpen = false }: { term: GlossaryTerm; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={termAnchorId(term.id)} tabIndex={-1} className="scroll-mt-4 rounded-lg border border-line bg-card px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="font-display font-bold text-[13px] text-[color:var(--text)]">{term.term}</span>
        <ChevronDown size={13} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">{term.short}</p>
      {open ? <p className="mt-2 font-body text-[12px] leading-relaxed text-muted">{term.long}</p> : null}
    </div>
  );
}

/** The audience buckets "All pages" groups by, in the order D3 lists them. */
export const PAGE_GROUPS: readonly { id: string; label: string }[] = [
  { id: 'pool', label: 'This pool' },
  { id: 'account', label: 'My account' },
  { id: 'create', label: 'Create a pool' },
  { id: 'admin', label: 'Admin' },
];

/** Which bucket a page belongs to, from its own route. */
export function pageGroup(page: HelpPage): string {
  if (page.route.startsWith('/create')) return 'create';
  if (page.route.startsWith('/super-admin') || page.route.startsWith('/tournament-sim')) return 'admin';
  if (page.route.startsWith('/pool/') || page.route.startsWith('/admin/')) return 'pool';
  return 'account';
}

export function AllPages(props: {
  pages: readonly HelpPage[];
  currentPageId?: string;
  /**
   * Can the reader actually be taken to this page from here? A page for ANOTHER
   * pool type, reached through the "Show all pool types" expander, cannot be:
   * the reader is standing in a different pool. Those rows are LISTED and not
   * linked — the same treatment K13 gives the super-admin sub-tabs — because
   * showing them Bracket guidance while they look at an NFL screen is worse than
   * showing them the title of a page they could visit from a Bracket pool.
   */
  isReachable: (page: HelpPage) => boolean;
  onSelect: (pageId: string) => void;
}) {
  const { pages, currentPageId, isReachable, onSelect } = props;
  return (
    <div className="space-y-3">
      {PAGE_GROUPS.map((group) => {
        const inGroup = pages.filter((p) => pageGroup(p) === group.id);
        if (inGroup.length === 0) return null;
        return (
          <div key={group.id}>
            <PanelSectionHeading>{group.label}</PanelSectionHeading>
            <ul className="mt-1 space-y-1">
              {inGroup.map((p) =>
                isReachable(p) ? (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      aria-current={p.id === currentPageId ? 'true' : undefined}
                      className={cn(
                        'w-full rounded px-2 py-1 text-left font-body text-[12.5px] hover:bg-card',
                        p.id === currentPageId ? 'text-[color:var(--text)]' : 'text-muted',
                      )}
                    >
                      {p.title}
                    </button>
                  </li>
                ) : (
                  <li key={p.id} className="px-2 py-1 font-body text-[12.5px] text-faint">
                    {p.title}
                  </li>
                ),
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
