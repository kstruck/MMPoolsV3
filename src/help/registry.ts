// The help registry — PLAN-HELP-SYSTEM.md §3 D1.
//
// `buildRegistry` takes the hand-authored content, VALIDATES it, and returns a
// frozen lookup. It throws on invalid content rather than degrading, so a bad
// reference fails at import (in dev, in the test, and in the build) instead of
// rendering an empty tooltip in production.
//
// The registry is a pure function of its input, which is what lets the
// invariant tests build small fixture registries instead of asserting against
// the real content.

import { POOL_TYPES } from '@shared/poolTypes';
import type { PoolType } from '@shared/poolTypes';
import type {
  Audience,
  GlossaryTerm,
  HelpContentInput,
  HelpCopy,
  HelpCopyContext,
  HelpPage,
  HelpScope,
  HelpSearchResult,
  HelpTopic,
  PoolTypeScope,
  ResolvedPlacement,
} from './types';
import { DEFAULT_SECTION } from './types';
import { PAGES } from './pages';
import { GLOSSARY } from './glossary';

/** Max results returned by `search`, matching the Spectrum reference. */
export const SEARCH_RESULT_LIMIT = 20;
/** Characters of context either side of a search match. */
const SNIPPET_RADIUS = 60;

/**
 * A form path with array indices normalised: `props.questions.3.text` and
 * `props.questions.0.text` both resolve to `props.questions.*.text`.
 *
 * Applied to `HelpTopic.id`, `HelpTopic.fields[]`, and every id a caller looks
 * up, so a repeated row does not need one topic per index.
 */
export function normalizePath(path: string): string {
  return path.replace(/\.\d+(?=\.|$)/g, '.*');
}

/** Split a possibly pool-type-qualified id into its parts. */
function splitQualifiedId(id: string): { poolType?: PoolType; base: string } {
  const colon = id.indexOf(':');
  if (colon === -1) return { base: id };
  const prefix = id.slice(0, colon);
  if (!(POOL_TYPES as readonly string[]).includes(prefix)) return { base: id };
  return { poolType: prefix as PoolType, base: id.slice(colon + 1) };
}

/**
 * A topic id with any pool-type qualifier removed and array indices
 * normalised: `NFL_SURVIVOR:settings.entryFee` → `settings.entryFee`.
 *
 * This is the id a PLACEMENT and a schema `fields[]` path are written in — a
 * scoped variant explains the same setting as its unqualified sibling and is
 * placed on the same pages. Anything joining a topic to a placement or to a
 * schema path has to go through here, or a scoped variant silently matches
 * nothing.
 */
export function baseTopicId(id: string): string {
  return splitQualifiedId(normalizePath(id)).base;
}

/**
 * Render a `HelpCopy` for a given pool context.
 *
 * A template runs only when the pool's `settings` are in scope. Everywhere
 * else — the wizard, the site pages, the search index — the static `fallback`
 * is returned, because a template with nothing to read renders the word
 * "undefined" in front of a reader.
 *
 * KNOWING THE POOL TYPE IS NOT ENOUGH. The wizard knows the type from the
 * moment the format is chosen and has no settings until the pool is created,
 * which is exactly the surface `fallback` was written for. Every template this
 * model is designed to absorb — `survivorModeRulesCopy`, `tieOutcomeRuleCopy`,
 * `teamReuseRuleCopy`, `tiebreakerCopy` — reads settings, so `settings` is the
 * honest gate.
 */
export function resolveCopy(copy: HelpCopy, ctx: HelpCopyContext = {}): string {
  if (typeof copy === 'string') return copy;
  if (ctx.settings === undefined) return copy.fallback;
  return copy.template(ctx);
}

/**
 * The copy to INDEX and to show when no pool is in scope — a template's
 * static fallback. Search runs on the wizard and on site pages, where no
 * pool's settings exist to render against.
 */
export function staticCopy(copy: HelpCopy): string {
  return typeof copy === 'string' ? copy : copy.fallback;
}

/**
 * What each viewer may read (K9: one registry, `audience[]`).
 *
 * A commissioner IS a member — they submit picks in their own pool — so
 * commissioner-scoped viewing includes member copy. An admin sees everything.
 * Without this widening, a commissioner reading their own pick sheet would get
 * no help on it, and every member-facing setting would need a duplicate
 * commissioner topic, which is the duplication K9 rejected.
 */
const AUDIENCE_SEES: Readonly<Record<Audience, readonly Audience[]>> = {
  member: ['member'],
  commissioner: ['member', 'commissioner'],
  admin: ['member', 'commissioner', 'admin'],
};

function audienceSatisfies(entry: readonly Audience[], viewer: Audience): boolean {
  const visible = AUDIENCE_SEES[viewer];
  return entry.some((a) => visible.includes(a));
}

function scopeIncludesPoolType(scope: PoolTypeScope, poolType: PoolType | undefined): boolean {
  if (scope === 'all') return true;
  // A viewer with no pool in scope (the wizard picker, site pages) sees only
  // type-agnostic entries; a type-scoped one has no pool to be about.
  if (!poolType) return false;
  return scope.includes(poolType);
}

function extractSnippet(haystack: string, needle: string): string {
  const at = haystack.toLowerCase().indexOf(needle);
  if (at === -1) return haystack.slice(0, SNIPPET_RADIUS * 2).trim();
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, at + needle.length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end).trim()}${end < haystack.length ? '…' : ''}`;
}

export interface Registry {
  readonly topics: ReadonlyMap<string, HelpTopic>;
  readonly pages: ReadonlyMap<string, HelpPage>;
  readonly glossary: readonly GlossaryTerm[];
  readonly placements: readonly ResolvedPlacement[];

  /** Exact lookup by (already normalised) id. No scope resolution. */
  getTopic(id: string): HelpTopic | undefined;

  /**
   * Scoped lookup: `${poolType}:${id}` wins over the bare `${id}`.
   *
   * BOTH the tooltip and the panel resolve through this, so a placement
   * written as `settings.entryFee` renders the `NFL_SURVIVOR:` variant for a
   * Survivor viewer on both surfaces. That is the whole point of it being one
   * function rather than two lookups.
   */
  resolveTopic(scope: Pick<HelpScope, 'poolType'>, id: string): HelpTopic | undefined;

  getPage(id: string): HelpPage | undefined;
  getTerm(id: string): GlossaryTerm | undefined;

  /**
   * Every placement on a page, resolved through `scope` and filtered to what
   * the viewer may see, grouped by section in `order` then insertion order.
   */
  placementsForPage(
    pageId: string,
    scope: Pick<HelpScope, 'poolType' | 'audience'>,
  ): { section: string; topics: HelpTopic[] }[];

  /** Case-insensitive substring search, capped at `SEARCH_RESULT_LIMIT`. */
  search(query: string, scope: Pick<HelpScope, 'poolType' | 'audience'>): HelpSearchResult[];
}

class RegistryImpl implements Registry {
  readonly topics: ReadonlyMap<string, HelpTopic>;
  readonly pages: ReadonlyMap<string, HelpPage>;
  readonly glossary: readonly GlossaryTerm[];
  readonly placements: readonly ResolvedPlacement[];
  private readonly terms: ReadonlyMap<string, GlossaryTerm>;
  private readonly byPage: ReadonlyMap<string, ResolvedPlacement[]>;

  constructor(input: HelpContentInput) {
    const topics = new Map<string, HelpTopic>();
    for (const topic of input.topics) {
      const id = normalizePath(topic.id);
      if (topics.has(id)) throw new Error(`help: duplicate topic id "${id}"`);
      topics.set(id, topic);
    }

    const pages = new Map<string, HelpPage>();
    for (const page of input.pages) {
      if (pages.has(page.id)) throw new Error(`help: duplicate page id "${page.id}"`);
      pages.set(page.id, page);
    }

    const terms = new Map<string, GlossaryTerm>();
    for (const term of input.glossary) {
      if (terms.has(term.id)) throw new Error(`help: duplicate glossary id "${term.id}"`);
      terms.set(term.id, term);
    }

    // Placements are keyed by BASE id: a setting is explained in one place
    // whether or not one pool type words it differently, and `resolveTopic`
    // picks the variant at render time.
    //
    // So the target may be a topic that exists ONLY in qualified form — a
    // Survivor-only setting like `settings.maxStrikes` has no unqualified
    // topic to point at, and demanding one would make scoped-only content
    // impossible to place. Writing the placement qualified instead does not
    // help either: it would then never match the base id everything else
    // joins on. Both spellings are accepted here and stored as the base.
    const baseIds = new Set([...topics.keys()].map(baseTopicId));
    const placements: ResolvedPlacement[] = input.placements.map((p, i) => {
      const topicId = baseTopicId(p.topic);
      if (!topics.has(topicId) && !baseIds.has(topicId)) {
        throw new Error(`help: placement references unknown topic "${p.topic}"`);
      }
      if (!pages.has(p.page)) {
        throw new Error(`help: placement for "${p.topic}" references unknown page "${p.page}"`);
      }
      return { ...p, topic: topicId, section: p.section ?? DEFAULT_SECTION, order: p.order ?? i };
    });

    // A pool-type variant must be REACHABLE and must be visible to exactly the
    // readers its base topic is.
    //
    // `resolveTopic` prefers the variant, and `placementsForPage` and `search`
    // then drop anything the reader may not see. So a variant scoped to a
    // narrower audience than its base does not fall back — it silently hides
    // help the reader is entitled to, on every surface at once. Making
    // resolution visibility-aware would spread that rule across three call
    // sites; refusing the content is one rule in one place.
    //
    // A variant that needs a different audience is a different topic and gets
    // its own id, not a variant of somebody else's.
    for (const [id, topic] of topics) {
      const { poolType: qualifier, base } = splitQualifiedId(id);
      if (!qualifier) continue;
      // EXACTLY its own type, not merely including it. `resolveTopic` selects
      // a qualified topic only for its qualifier, so a wider `poolTypes` is a
      // claim the registry will never honour — and the schema audit, which
      // credits coverage from a topic's declared scope, would then report a
      // setting as explained for pool types that in fact show nothing. That is
      // the one way an allowlist row could be deleted while the option it
      // covered stayed unexplained.
      const scopedToItself =
        topic.poolTypes !== 'all' &&
        topic.poolTypes.length === 1 &&
        topic.poolTypes[0] === qualifier;
      if (!scopedToItself) {
        throw new Error(
          `help: topic "${id}" is scoped to ${qualifier}, so its poolTypes must be exactly ["${qualifier}"] — it is never resolved for any other type`,
        );
      }
      const baseTopic = topics.get(base);
      if (baseTopic) {
        const a = [...topic.audience].sort().join(',');
        const b = [...baseTopic.audience].sort().join(',');
        if (a !== b) {
          throw new Error(
            `help: topic "${id}" has audience [${a}] but its base "${base}" has [${b}]; a variant would hide the base from readers it does not cover`,
          );
        }
      }
    }

    // Cross-references resolve, or the content is wrong.
    for (const topic of topics.values()) {
      for (const termId of topic.terms ?? []) {
        if (!terms.has(termId)) {
          throw new Error(`help: topic "${topic.id}" references unknown glossary term "${termId}"`);
        }
      }
      for (const relatedId of topic.related ?? []) {
        // Same two spellings a placement accepts: the exact id (a `related`
        // entry may deliberately name one variant, which `resolveTopic`
        // honours) or the base id, which may exist only in qualified form.
        // Requiring an exact match here would reject a link to a Survivor-only
        // setting for the same reason placements used to reject one.
        if (!topics.has(normalizePath(relatedId)) && !baseIds.has(baseTopicId(relatedId))) {
          throw new Error(`help: topic "${topic.id}" references unknown related topic "${relatedId}"`);
        }
      }
    }
    for (const term of terms.values()) {
      for (const relatedId of term.related ?? []) {
        if (!terms.has(relatedId)) {
          throw new Error(`help: glossary "${term.id}" references unknown related term "${relatedId}"`);
        }
      }
    }

    const byPage = new Map<string, ResolvedPlacement[]>();
    for (const p of placements) {
      const list = byPage.get(p.page);
      if (list) list.push(p);
      else byPage.set(p.page, [p]);
    }
    for (const list of byPage.values()) list.sort((a, b) => a.order - b.order);

    this.topics = topics;
    this.pages = pages;
    this.terms = terms;
    this.glossary = Object.freeze([...input.glossary]);
    this.placements = Object.freeze(placements);
    this.byPage = byPage;
  }

  getTopic(id: string): HelpTopic | undefined {
    return this.topics.get(normalizePath(id));
  }

  resolveTopic(scope: Pick<HelpScope, 'poolType'>, id: string): HelpTopic | undefined {
    // An id that already names a type is used as written — callers that hold a
    // qualified id (a deep link, a `related` entry) mean that exact variant.
    const { poolType: qualified, base } = splitQualifiedId(normalizePath(id));
    if (qualified) return this.topics.get(`${qualified}:${base}`);
    if (scope.poolType) {
      const scoped = this.topics.get(`${scope.poolType}:${base}`);
      if (scoped) return scoped;
    }
    return this.topics.get(base);
  }

  getPage(id: string): HelpPage | undefined {
    return this.pages.get(id);
  }

  getTerm(id: string): GlossaryTerm | undefined {
    return this.terms.get(id);
  }

  placementsForPage(
    pageId: string,
    scope: Pick<HelpScope, 'poolType' | 'audience'>,
  ): { section: string; topics: HelpTopic[] }[] {
    const sections: { section: string; topics: HelpTopic[] }[] = [];
    const index = new Map<string, HelpTopic[]>();
    for (const placement of this.byPage.get(pageId) ?? []) {
      const topic = this.resolveTopic(scope, placement.topic);
      if (!topic) continue;
      if (!isVisible(topic.poolTypes, topic.audience, scope)) continue;
      let bucket = index.get(placement.section);
      if (!bucket) {
        bucket = [];
        index.set(placement.section, bucket);
        sections.push({ section: placement.section, topics: bucket });
      }
      // A topic placed twice in one section is listed once.
      if (!bucket.includes(topic)) bucket.push(topic);
    }
    return sections;
  }

  search(query: string, scope: Pick<HelpScope, 'poolType' | 'audience'>): HelpSearchResult[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const results: HelpSearchResult[] = [];

    // A scoped variant (`NFL_SURVIVOR:settings.entryFee`) is placed under its
    // BASE id, because the placement says where the setting is explained and
    // both variants are explained in the same place. Looking only for the
    // exact id would return no page, and the search result would render with
    // nowhere to navigate — while the panel, resolving the same placement,
    // shows it correctly.
    //
    // The chosen placement must also be on a page THIS reader can open. A
    // topic explained on both a commissioner page and a member page would
    // otherwise send a member to the page they cannot reach, purely because it
    // was placed first.
    const pageForResult = (topicId: string): string | undefined => {
      const base = baseTopicId(topicId);
      const candidates = this.placements.filter((p) => p.topic === topicId || p.topic === base);
      for (const placement of candidates) {
        const page = this.pages.get(placement.page);
        if (page && isVisible(page.poolTypes, page.audience, scope)) return placement.page;
      }
      return undefined;
    };

    const topicHits: HelpSearchResult[] = [];
    const pageHits: HelpSearchResult[] = [];
    const glossaryHits: HelpSearchResult[] = [];

    for (const [id, topic] of this.topics) {
      if (!isVisible(topic.poolTypes, topic.audience, scope)) continue;
      // Both `settings.entryFee` and `NFL_SURVIVOR:settings.entryFee` are
      // visible to a Survivor reader, and a query matching both would return
      // the same setting twice with two different explanations. Only the
      // variant `resolveTopic` would pick — the one the tooltip and the panel
      // show — is listed.
      if (this.resolveTopic(scope, baseTopicId(id)) !== topic) continue;
      const haystack = [
        topic.title,
        staticCopy(topic.short),
        staticCopy(topic.long),
        ...(topic.tips ?? []),
      ].join('\n');
      if (!haystack.toLowerCase().includes(needle)) continue;
      topicHits.push({
        kind: 'topic',
        id,
        title: topic.title,
        snippet: extractSnippet(haystack, needle),
        pageId: pageForResult(id),
      });
    }

    for (const [id, page] of this.pages) {
      if (!isVisible(page.poolTypes, page.audience, scope)) continue;
      const haystack = `${page.title}\n${page.summary}`;
      if (!haystack.toLowerCase().includes(needle)) continue;
      pageHits.push({ kind: 'page', id, title: page.title, snippet: extractSnippet(haystack, needle), pageId: id });
    }

    for (const term of this.glossary) {
      if (!audienceSatisfies(term.audience, scope.audience)) continue;
      const haystack = `${term.term}\n${term.short}\n${term.long}`;
      if (!haystack.toLowerCase().includes(needle)) continue;
      glossaryHits.push({ kind: 'glossary', id: term.id, title: term.term, snippet: extractSnippet(haystack, needle) });
    }

    // Interleaved, NOT concatenated then truncated. Appending topics first and
    // slicing at the end starves the other two kinds completely: once content
    // lands, a broad query like "pool" matches more than the limit in topics
    // alone, and the glossary and page results become unreachable — the
    // glossary search would look broken while working perfectly.
    const queues = [topicHits, pageHits, glossaryHits];
    for (let i = 0; results.length < SEARCH_RESULT_LIMIT; i++) {
      if (!queues.some((q) => q.length > i)) break;
      for (const queue of queues) {
        if (results.length >= SEARCH_RESULT_LIMIT) break;
        if (queue.length > i) results.push(queue[i]);
      }
    }
    return results;
  }
}

function isVisible(
  poolTypes: PoolTypeScope,
  audience: readonly Audience[],
  scope: Pick<HelpScope, 'poolType' | 'audience'>,
): boolean {
  return scopeIncludesPoolType(poolTypes, scope.poolType) && audienceSatisfies(audience, scope.audience);
}

export function buildRegistry(input: HelpContentInput): Registry {
  return new RegistryImpl(input);
}

/**
 * The live registry.
 *
 * Topics and placements are empty in T0 — the content files land with the
 * components that read them (T1 onwards), and every schema path they will
 * cover is currently declared in `SCHEMA_PATH_ALLOWLIST` with its ticket. The
 * glossary is NOT empty: K1's invariant against CONTEXT.md is the one guard
 * that has content to guard from day one.
 */
export const helpRegistry: Registry = buildRegistry({
  topics: [],
  placements: [],
  pages: PAGES,
  glossary: GLOSSARY,
});
