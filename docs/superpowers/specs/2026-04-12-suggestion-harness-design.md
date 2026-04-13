# Subtask Suggestion Harness Design

- Date: 2026-04-12
- Status: Draft
- Audience: Tracker contributors working on suggestion, AI, and data pipelines
- Document type: Explanation + design spec

## 1. Background

The repository already contains a mixed local-and-AI suggestion pipeline for task subtasks:

- Title keyword extraction via C3 in `src/services/suggestion/keywordExtractor.ts`
- Local retrieval via pattern templates and learn-log history
- Confidence-based routing in `src/services/suggestion/confidenceScorer.ts`
- AI supplementation through `task_decompose` skills and the async AI queue

This is already close to an agentic system, but it is not yet a coherent harness:

- Retrieval, generation, filtering, and feedback are spread across several modules
- Most stages exchange strings, not structured evidence
- Local sources do not participate in a unified ranking step
- AI jobs return actions, but not traceable intermediate reasoning or scoreable evidence
- Feedback is recorded, but evaluation is still implicit instead of systematic

The result is workable, but hard to evolve. Improving only segmentation or only prompts would raise quality slightly, but would not solve the structural problem.

## 2. Problem Statement

The current suggestion system has four core limitations.

### 2.1 Keyword extraction is doing too much

The current extractor is both:

- a tokenizer
- the primary semantic representation used by retrieval

This works for narrow matching, but it cannot reliably represent:

- task intent
- objects and entities
- project context
- temporal hints that should influence generation but not retrieval

### 2.2 Local retrieval is not fused

`suggestionPipeline.ts` currently short-circuits:

- pattern match first
- learning second
- AI last

This reduces diversity and misses the chance to compare evidence from multiple local sources in one place.

### 2.3 AI is used as a generator, not as a bounded node

The current `task_decompose` path is useful, but it still behaves like a single opaque generation step:

- structured local evidence is compressed into prompt strings
- AI returns actions directly
- there is no critique/ranking phase after generation

### 2.4 Feedback exists, but evaluation is weak

The project stores:

- `subtask_learn_log`
- `suggestion_feedback`
- `task_subtask_history`

This is enough to build an evaluation harness, but today these datasets are not yet used as a formal benchmark loop.

## 3. Goals

This design aims to improve the system on three levels at once.

### 3.1 Product goals

- Improve subtask suggestion acceptance rate
- Reduce vague and repetitive suggestions
- Improve Chinese title understanding without requiring heavy external NLP models
- Keep local-first responsiveness for desktop use

### 3.2 Engineering goals

- Introduce a single harness-like execution model
- Preserve compatibility with the current Tauri + Vue architecture
- Make suggestion runs observable, debuggable, and comparable
- Allow agentic capabilities to be added incrementally instead of through a rewrite

### 3.3 Non-goals

- Replacing the entire suggestion stack with a third-party agent framework
- Introducing a large local NLP model into the desktop bundle
- Turning all task creation into a fully autonomous agent workflow

## 4. Options Considered

Three architecture directions are realistic.

### Option A. Keep the current architecture and tune rules/prompts

Changes:

- Improve C3 keyword extraction rules
- Tune learn-log fuzzy matching
- Continue iterating on the `task_decompose` prompts

Advantages:

- Lowest implementation cost
- Minimal schema and flow changes

Disadvantages:

- Quality gains are incremental only
- Retrieval and ranking remain fragmented
- Difficult to evaluate changes cleanly
- Does not solve observability or traceability

Assessment:

Useful for short-term fixes, but insufficient as the main direction.

### Option B. Replace the system with a full external agent framework

Candidates:

- OpenAI Agents SDK
- LangGraph
- Google ADK

Advantages:

- Gains formal orchestration concepts quickly
- Better built-in ideas for tools, handoffs, traces, and approvals

Disadvantages:

- High migration cost for a Tauri desktop app
- Current local retrieval and DB-backed feedback paths would still need custom integration
- Risk of framework-driven architecture instead of product-driven architecture

Assessment:

Good as a reference model, poor as a first migration step.

### Option C. Build an internal Suggestion Harness and treat AI as bounded nodes

Changes:

- Keep local retrieval and current AI queue
- Refactor the suggestion system into explicit stages
- Add structured analysis, fused candidate retrieval, ranking, and evaluation
- Let AI operate as one or two nodes inside the harness, not as the whole system

Advantages:

- Preserves existing assets and data
- Matches desktop constraints
- Creates a clean path toward future agent expansion
- Provides the biggest quality gain per unit of risk

Disadvantages:

- Requires refactoring several core modules
- Needs new trace/eval data structures

Assessment:

This is the recommended approach.

## 5. Recommendation

Adopt **Option C: internal Suggestion Harness + small bounded agents**.

The key idea is:

- Do not turn the whole suggestion system into one large agent
- Do not treat rules and AI as separate products
- Instead, build a harness that runs several explicit stages, where local retrieval remains first-class and AI becomes one controlled component

This preserves the strengths of the current system:

- local speed
- local data ownership
- user feedback learning
- UI approval flows

And it adds what the system is missing:

- structure
- scoring
- traceability
- evaluation

## 6. Proposed Architecture

The new pipeline should be:

`analyze_title -> retrieve_candidates -> generate_candidates -> critique_and_rank -> present -> feedback -> learn`

### 6.1 Stage 1: Analyze Title

Replace the current “keywords only” output with a structured analysis object.

Proposed shape:

```ts
interface TitleAnalysis {
  rawTitle: string;
  normalizedTitle: string;
  keywords: string[];
  intentHints: string[];
  entityHints: string[];
  timeHints: string[];
  englishTerms: string[];
  projectHints: string[];
  segmentTrace: Array<{
    text: string;
    type: 'content' | 'temporal' | 'run' | 'english' | 'noise';
    source: 'segmenter' | 'recovery' | 'join' | 'fallback';
  }>;
}
```

Design notes:

- Keep C3 as the base analyzer
- Continue filtering temporal tokens out of retrieval keywords
- Preserve temporal hints separately for generation and ranking
- Treat analysis as reusable structured context, not a transient array

### 6.2 Stage 2: Retrieve Candidates

Replace short-circuit local retrieval with parallel retrieval from multiple sources.

Candidate sources:

- pattern templates
- learn-log suggestions
- historical manual subtasks
- task subtask history snapshots
- same-project sibling tasks
- optional future project-level priors

Proposed shape:

```ts
interface SuggestionCandidate {
  title: string;
  source:
    | 'pattern'
    | 'learning'
    | 'history'
    | 'sibling'
    | 'ai_generated';
  evidence: string[];
  rawScore?: number;
}
```

Design notes:

- Every retriever returns candidates, not final results
- Multiple retrievers may produce the same title
- Duplicate titles should be merged before ranking

### 6.3 Stage 3: Generate Candidates

AI should supplement the candidate pool instead of replacing it.

Recommended AI roles:

- `candidate_generator`: propose concise subtask candidates based on structured context
- `candidate_critic`: reject vague, duplicate, or low-specificity items

This can still run inside the existing skill/job system, but the contract should change from:

- “return final actions”

to:

- “return generated candidates with lightweight evidence”

### 6.4 Stage 4: Critique And Rank

Introduce a single ranking layer over all merged candidates.

Ranking signals should include:

- learn-log positive score
- recent rejection penalties
- project match
- history frequency
- semantic overlap with title analysis
- duplicate penalty against existing subtasks
- generic-vagueness penalty
- optional AI critic boost or penalty

Output shape:

```ts
interface RankedSuggestion {
  title: string;
  score: number;
  sources: string[];
  evidence: string[];
  reasons: string[];
}
```

This is the core harness layer. It is where the system becomes debuggable.

### 6.5 Stage 5: Present

The sidebar UI can remain mostly unchanged, but the state should store richer suggestion metadata.

Benefits:

- better ordering
- explainable suggestions
- easier A/B evaluation later

The initial UI does not need to show all evidence immediately. It only needs to preserve it.

### 6.6 Stage 6: Feedback And Learning

Feedback should continue updating the current local learning tables, but should also record per-run evaluation data.

Recommended additions:

- record the suggestion run id
- record the ranked position shown to the user
- record whether the suggestion came from one source or multiple merged sources
- record the analysis version and ranking version used

## 7. Harness Data Model

The current schema already provides several usable tables. The harness should build on them instead of replacing them.

Existing reusable assets:

- `subtask_patterns`
- `subtask_learn_log`
- `keyword_clusters`
- `suggestion_feedback`
- `task_subtask_history`
- `ai_skills`
- `ai_jobs`

Recommended new tables:

### 7.1 `suggestion_runs`

Purpose:

- one row per suggestion request

Suggested fields:

- `id`
- `task_id`
- `task_title`
- `project_id`
- `analysis_json`
- `strategy`
- `ranker_version`
- `generator_version`
- `created_at`

### 7.2 `suggestion_candidates`

Purpose:

- one row per candidate produced during a run

Suggested fields:

- `id`
- `run_id`
- `title`
- `source`
- `merged_sources_json`
- `score`
- `evidence_json`
- `reasons_json`
- `shown_rank`
- `selected`
- `rejected`

These two tables are enough to support trace, replay, and evaluation.

## 8. Module Refactor Plan

The following module boundaries are recommended.

### 8.1 New or refactored frontend suggestion modules

- `titleAnalyzer.ts`
  - wraps current C3 extraction and returns `TitleAnalysis`
- `candidateRetrievers/`
  - `patternRetriever.ts`
  - `learningRetriever.ts`
  - `historyRetriever.ts`
  - `siblingRetriever.ts`
- `candidateMerger.ts`
  - dedupe and merge evidence across sources
- `candidateRanker.ts`
  - compute final ranking score and reasons
- `suggestionHarness.ts`
  - orchestrate the full pipeline

### 8.2 AI-specific modules

- keep `queue.ts` for transport and lifecycle
- add explicit candidate-generation result contracts
- preserve approval semantics already used by the app

### 8.3 Backend changes

- keep current pattern and learning commands
- add run/candidate trace persistence
- separate read-only matching from side-effectful usage tracking

## 9. Immediate Design Corrections

Several current behaviors should be corrected as part of the first phase.

### 9.1 Remove retrieval side effects from `pattern_match`

`pattern_match` currently increments `usage_count` during matching.

This is problematic because:

- matching should be read-only
- confidence scoring also calls matching
- a single request may inflate usage multiple times

Recommended change:

- make `pattern_match` pure
- increment usage only when a pattern-backed suggestion is accepted

### 9.2 Stop short-circuiting local retrieval

The current pipeline returns the first strong local source and skips the rest.

Recommended change:

- retrieve from all local sources
- merge and rank

### 9.3 Preserve structured AI context

The current AI context is flattened into prompt-ready strings.

Recommended change:

- keep a structured context object
- render strings only at the prompt boundary
- persist the structured payload in run traces

### 9.4 Expand feedback semantics

Today feedback mainly updates learning scores.

Recommended change:

- also record ranking context and candidate provenance

## 10. Phased Delivery Plan

### Phase 1. Harness Lite

Goal:

- create the internal harness without changing the visible UX much

Scope:

- add `TitleAnalysis`
- add multi-source candidate retrieval
- add merge + rank
- remove `pattern_match` side effects
- add minimal trace persistence

Expected outcome:

- better local quality
- more explainable suggestions
- lower architecture risk

### Phase 2. Agent-As-Node

Goal:

- use AI as a controlled candidate generator and critic

Scope:

- replace direct “actions-only” AI generation with candidate generation
- optionally add critic pass
- feed AI results into the same ranker as local results

Expected outcome:

- better long-tail coverage
- fewer vague AI-only suggestions

### Phase 3. Eval Harness

Goal:

- make quality changes measurable

Scope:

- build offline benchmark cases from:
  - keyword extractor self-tests
  - suggestion feedback
  - task subtask history
- define metrics
- compare ranker/generator versions

Expected outcome:

- safer iteration on extraction, retrieval, and AI prompts

## 11. Metrics

The system should be measured at both retrieval and product levels.

### 11.1 Retrieval metrics

- candidate recall against accepted subtasks
- top-3 coverage
- duplicate rate
- vague-item rate

### 11.2 Product metrics

- suggestion acceptance rate
- accepted suggestion rank position
- AI contribution rate
- rejection rate by source
- time-to-first-usable-suggestion

### 11.3 Regression metrics

- keyword extractor benchmark pass rate
- known retrieval scenario pass rate
- no-side-effect matching behavior

## 12. Risks And Mitigations

### Risk 1. The harness becomes too complex too early

Mitigation:

- phase delivery
- keep current UI surface mostly stable
- avoid introducing a full external framework in phase 1

### Risk 2. Ranking logic becomes opaque

Mitigation:

- emit reasons and evidence per ranked candidate
- keep score components inspectable

### Risk 3. AI adds latency without enough gain

Mitigation:

- keep local-first behavior
- make AI additive, not blocking
- allow strategy thresholds to disable AI easily

### Risk 4. More data collection increases schema complexity

Mitigation:

- add only run/candidate trace tables first
- do not redesign existing learning tables yet

## 13. Why This Is Better Than “Just Make It One Agent”

Turning the whole system into one agent would look simpler conceptually, but would weaken several strengths of this product:

- desktop responsiveness
- local explainability
- deterministic reuse of user history
- bounded approval-based UX

The better pattern for this project is:

- harness outside
- small agents inside

This mirrors the useful ideas from current agent ecosystems without forcing a framework migration:

- OpenAI Agents SDK contributes strong ideas around tools, handoffs, and tracing
- LangGraph contributes the notion of explicit graph nodes and human-in-the-loop control
- Google ADK contributes patterns for sessions, state, and long-running agent execution

These frameworks are useful references, but the first implementation step should remain internal to this repository.

## 14. External References

- OpenAI Agents SDK, multi-agent guide: https://openai.github.io/openai-agents-js/guides/multi-agent/
- OpenAI Agents SDK, tracing guide: https://openai.github.io/openai-agents-js/guides/tracing/
- LangGraph overview: https://docs.langchain.com/oss/javascript/langgraph/overview
- Google ADK get started: https://google.github.io/adk-docs/get-started/
- Google ADK sessions: https://google.github.io/adk-docs/sessions/
- Google ADK memory: https://google.github.io/adk-docs/sessions/memory/
- Google ADK function tools and long-running execution: https://google.github.io/adk-docs/tools-custom/function-tools/

## 15. Decision

Proceed with:

- an internal Suggestion Harness
- local-first multi-source retrieval
- structured title analysis
- unified ranking
- AI as bounded candidate-generation nodes
- evaluation infrastructure in a later phase

Do not proceed with:

- a full external framework migration in the first iteration
- prompt-only optimization as the primary strategy
- a single monolithic agent replacing all deterministic logic
