// What the Help panel shows — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// Sections in order: search box; results when a query is active, otherwise the
// current page's title and summary, "On this page", "Key Concepts & Glossary",
// and "All pages".
//
// REMOUNTED PER PAGE by a `key={page.id}` on the caller's side, so the search
// box, the accordions and the scroll position do not survive a page change —
// leftover state from the previous screen is worse than none.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { HelpSearchResult } from '../../help/types';
import { SEARCH_RESULT_LIMIT } from '../../help/registry';
import { audienceSatisfies, isEntryVisible } from '../../help/visibility';
import { canOpenPage, isPageOffered } from '../../help/route-match';
import type { HelpPanelState } from './useHelpPanel';
import {
  AllPages,
  GlossaryCard,
  PanelSectionHeading,
  SearchResults,
  SectionAccordion,
  TopicCard,
  termAnchorId,
  topicAnchorId,
} from './HelpPanel.components';

/** `general` is the section every placement lands in when it names none. */
function sectionLabel(section: string): string {
  if (section === 'general') return 'On this page';
  return section.charAt(0).toUpperCase() + section.slice(1);
}

export function HelpPanelBody({ state, searchInputRef }: {
  state: HelpPanelState;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { registry, scope, page, activeTopicId, clearActiveTopic, openTo, openPage, routeContext } = state;
  const [query, setQuery] = useState('');
  const [showAllPoolTypes, setShowAllPoolTypes] = useState(false);
  // The glossary term a search hit asked for: expanded, scrolled to, focused.
  // Held here rather than in the panel state because it never survives a page
  // change and nothing outside this body reads it.
  const [activeTermId, setActiveTermId] = useState<string | undefined>(undefined);
  const scrolledFor = useRef<string | undefined>(undefined);
  const scrolledForTerm = useRef<string | undefined>(undefined);

  /**
   * Search hits, minus anything that lands on a screen this pool has no tab for
   * (codex R5). A Survivor member searching "Results" would otherwise be handed
   * a row for the NFL Results page, and the click could only show a page they
   * cannot open. `registry.search` cannot do this filtering itself — it knows
   * the reader's audience and pool type, not which tabs the surface rendered.
   */
  const results = useMemo<HelpSearchResult[]>(
    () =>
      query.trim()
        ? registry.search(query, scope).filter((hit) => {
            const hitPage = hit.pageId ? registry.getPage(hit.pageId) : undefined;
            return !hitPage || isPageOffered(hitPage, routeContext);
          })
        : [],
    [registry, query, scope, routeContext],
  );

  const sections = useMemo(
    () => (page ? registry.placementsForPage(page.id, scope) : []),
    [registry, page, scope],
  );

  /**
   * The glossary, this page's terms first (D3). A page's terms are the ones its
   * own topics reference; everything else follows under "All terms".
   */
  const { pageTerms, otherTerms } = useMemo(() => {
    const onPage = new Set(sections.flatMap((s) => s.topics).flatMap((t) => t.terms ?? []));
    const visible = registry.glossary.filter((t) => isEntryVisible('all', t.audience, scope));
    return {
      pageTerms: visible.filter((t) => onPage.has(t.id)),
      otherTerms: visible.filter((t) => !onPage.has(t.id)),
    };
  }, [registry, sections, scope]);

  /**
   * "All pages", filtered to what this reader can reach and — K5 — to the pool
   * type they are inside, with an expander for the rest. A Survivor member
   * never needs the Bracket tabs listed.
   */
  const allPages = useMemo(
    () =>
      registry.pages
        .filter((p) =>
          showAllPoolTypes
            ? audienceSatisfies(p.audience, scope.audience)
            : isEntryVisible(p.poolTypes, p.audience, scope),
        )
        // A tab this pool does not offer is not a screen the reader can open —
        // a Survivor pool has no Results tab. Same predicate `hrefForPage`
        // uses, so listed and linkable cannot disagree.
        .filter((p) => isPageOffered(p, routeContext)),
    [registry, scope, showAllPoolTypes, routeContext],
  );

  /** Is there anything the K5 filter is currently hiding? Nothing to expand if not. */
  const hasOtherPoolTypes = useMemo(
    () =>
      registry.pages.some(
        (p) => audienceSatisfies(p.audience, scope.audience) && !isEntryVisible(p.poolTypes, p.audience, scope),
      ),
    [registry, scope],
  );

  // Scroll the requested topic into view and move focus to it, once per
  // request. Keyed on the id so re-renders do not re-scroll a reader who has
  // since scrolled away.
  useEffect(() => {
    if (!activeTopicId || scrolledFor.current === activeTopicId) return;
    const topic = registry.resolveTopic(scope, activeTopicId);
    if (!topic) return;
    const el = document.getElementById(topicAnchorId(topic.id));
    if (!el) return;
    scrolledFor.current = activeTopicId;
    el.scrollIntoView({ block: 'nearest' });
    el.focus({ preventScroll: true });
  }, [activeTopicId, registry, scope, sections]);

  // Same treatment for a glossary hit as for a topic hit: expand, scroll, focus,
  // once per request.
  useEffect(() => {
    if (!activeTermId || scrolledForTerm.current === activeTermId) return;
    const el = document.getElementById(termAnchorId(activeTermId));
    if (!el) return;
    scrolledForTerm.current = activeTermId;
    el.scrollIntoView({ block: 'nearest' });
    el.focus({ preventScroll: true });
  }, [activeTermId, pageTerms, otherTerms]);

  const activeTopic = activeTopicId ? registry.resolveTopic(scope, activeTopicId) : undefined;
  // Which section holds the requested topic, so its accordion opens with it.
  const activeSection = activeTopic
    ? sections.find((s) => s.topics.includes(activeTopic))?.section
    : undefined;

  const relatedOf = (ids: readonly string[] | undefined) =>
    (ids ?? [])
      .map((id) => registry.resolveTopic(scope, id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({ id: t.id, title: t.title }));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 pb-6">
      <label className="relative block">
        <span className="sr-only">Search help</span>
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help"
          className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 font-body text-[13px] text-[color:var(--text)] placeholder:text-faint"
        />
      </label>

      {query.trim() ? (
        <>
          <PanelSectionHeading>
            {results.length >= SEARCH_RESULT_LIMIT ? `First ${SEARCH_RESULT_LIMIT} results` : 'Results'}
          </PanelSectionHeading>
          <SearchResults
            query={query}
            results={results}
            onSelect={(result) => {
              setQuery('');
              if (result.kind === 'topic') openTo({ topicId: result.id, pageId: result.pageId });
              else if (result.kind === 'page') openPage(result.id);
              // A glossary hit has nowhere to NAVIGATE, but it still has to be
              // opened (codex R9). Clearing the query alone left the reader
              // looking at a collapsed card — possibly inside the collapsed
              // "All terms" accordion — so the result was clickable and did
              // nothing. Naming the term expands it, scrolls to it and focuses
              // it, the same treatment a topic hit gets.
              else setActiveTermId(result.id);
            }}
          />
        </>
      ) : (
        <>
          {page ? (
            <section>
              <h3 className="font-display font-bold text-[15px] text-[color:var(--text)]">{page.title}</h3>
              <p className="mt-1 font-body text-[13px] leading-relaxed text-muted">{page.summary}</p>
            </section>
          ) : (
            <p className="font-body text-[13px] leading-relaxed text-muted">
              There is no guide for this screen yet. Search above, or pick a screen from the list below.
            </p>
          )}

          {sections.length > 0 ? (
            <section className="space-y-2">
              <PanelSectionHeading>On this page</PanelSectionHeading>
              {sections.map((group) => (
                <SectionAccordion
                  key={group.section}
                  title={sectionLabel(group.section)}
                  defaultOpen={sections.length === 1 || group.section === activeSection}
                >
                  {group.topics.map((topic) => (
                    <TopicCard
                      key={topic.id}
                      topic={topic}
                      poolType={scope.poolType}
                      settings={scope.settings}
                      highlighted={topic === activeTopic}
                      related={relatedOf(topic.related)}
                      onOpenRelated={(id) => {
                        clearActiveTopic();
                        openTo({ topicId: id });
                      }}
                    />
                  ))}
                </SectionAccordion>
              ))}
            </section>
          ) : null}

          <section className="space-y-2">
            <PanelSectionHeading>Key concepts &amp; glossary</PanelSectionHeading>
            {/* The keys carry `activeTermId` so the selected card REMOUNTS and its
                `defaultOpen` takes effect; the accordion is keyed for the same
                reason, because a term the reader searched for may be inside it. */}
            {pageTerms.map((term) => (
              <GlossaryCard
                key={`${term.id}:${term.id === activeTermId}`}
                term={term}
                defaultOpen={term.id === activeTermId}
              />
            ))}
            {otherTerms.length > 0 ? (
              <SectionAccordion
                key={`all-terms:${otherTerms.some((t) => t.id === activeTermId) ? activeTermId : ''}`}
                title={pageTerms.length > 0 ? 'All terms' : `All terms (${otherTerms.length})`}
                defaultOpen={otherTerms.some((t) => t.id === activeTermId)}
              >
                {otherTerms.map((term) => (
                  <GlossaryCard
                    key={`${term.id}:${term.id === activeTermId}`}
                    term={term}
                    defaultOpen={term.id === activeTermId}
                  />
                ))}
              </SectionAccordion>
            ) : null}
          </section>

          <section className="space-y-2">
            <PanelSectionHeading>All pages</PanelSectionHeading>
            <AllPages
              pages={allPages}
              currentPageId={page?.id}
              // Listed, not linked, unless the reader can actually get there.
              isReachable={(p) => canOpenPage(p, routeContext, scope.audience)}
              onSelect={openPage}
            />
            {hasOtherPoolTypes ? (
              <button
                type="button"
                onClick={() => setShowAllPoolTypes((v) => !v)}
                className="font-display text-[11px] font-bold uppercase tracking-[0.05em] text-gold-600 hover:underline dark:text-gold-400"
              >
                {showAllPoolTypes ? 'Show this pool only' : 'Show all pool types'}
              </button>
            ) : null}
          </section>
        </>
      )}

      <p className="mt-auto pt-2 font-body text-[11px] text-faint">
        Press <kbd className="font-display">?</kbd> to toggle · <kbd className="font-display">Esc</kbd> to close
      </p>
    </div>
  );
}
