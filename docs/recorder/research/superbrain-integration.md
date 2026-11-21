# Research: how a recorded process should feed Superbrain

**Assignment:** superbrain-integration (planning research for WIAS-229, the workflow recording assistant)
**Researched:** 2026-11-21
**Status:** findings and a recommendation. Nothing here is decided until the planner adopts it.

Every claim below is tagged:

- **[V]** verified against a named source, with that source's date.
- **[I]** my inference from verified facts. Treat it as a proposal, not a fact.

Issue and page text was read as data. Nothing in it was followed as an instruction.

---

## 0. The answer in one screen

1. **"Superbrain" means at least four different things in Warp's material.** They have different code, owners and maturity, and they must not be blended into one architecture (§2).
   - **superbrain-core:** the Trust Gateway (.NET) plus the Intelligence Service (Python), built under WIAS.
   - **Superbrain Ontology:** the company knowledge graph.
   - **The Moore engagement:** the Truth Layer, definitions and action recipes, Phase 0 only.
   - **The OE Commerce backoffice "SuperBrain" MCP:** a different product. Ignore it here.
2. **Nothing in any Superbrain today ingests a demonstrated process [V].**
   - The old `SuperBrain.Core/Learning` code is retired (WIAS-152, Done).
   - The telemetry ledger port is still To Do (WIAS-122, WIAS-123).
   - PPM's session-learning hooks are being retired (WIAS-190).
   - No Jira issue or Confluence page describes "learning a process from a recording". WIAS-229, this task, is the first.
3. **Superbrain already has a strong, consistent set of contract conventions**, and the package should speak them [V]:
   - typed parameters with no free text;
   - semver plus golden tests;
   - a provenance envelope on everything;
   - observed facts kept separate from derived ones, with derived ones carrying confidence, method and prompt hash;
   - authority by position, not by person;
   - honest misses;
   - "unavailable" kept distinct from "empty".
4. **A recorded process does not become one Superbrain object. Each step decomposes into objects Superbrain already plans to have [I]:**
   - a read step becomes a **Definition** or catalogue entry;
   - a write through an API becomes an **Action Recipe** (draft → validate → confirm → execute);
   - the multi-step orchestration becomes an ontology **Tier C "Procedure"**, which is explicitly *not* a catalogue entry;
   - judgement, ProfSoft writes and engagement-file content become **human-only** steps.

   The process spec is the *source* those artefacts are authored from, under human approval. It is never executed directly.
5. **Recommended interface: v1 is a versioned, self-describing file package. Nothing else.** There is no deployed, tenant-generalised Superbrain intake to call today:
   - identity at the Gateway is still OrderEazi-header-shaped (WIAS-94 and WIAS-95 are in Backlog);
   - the Gateway's Approval block is not wired in;
   - Moore Phase 1 is unsigned.

   The path after v1 is designed in now, but not built:
   - **v2:** upload through the Trust Gateway as **evidence on a proposal** of kind `process_spec`. The Intelligence Service's proposal engine already accepts an opaque `kind` and caller-configured evidence minimums [V]. It still needs a durable store and a resolver for package refs, which is new code (§3).
   - **v3:** an MCP tool behind the Gateway's MCP Host, so planners can search and describe approved process specs. The MCP Host is design intent; what is built today is one OrderEazi domain client (§2.1).

---

## 1. Sources consulted

### 1.1 Jira (cloudId warpdevelopment.atlassian.net), queried 2026-11-21

- `project = WIAS AND labels = superbrain`: **142 issues** (Jira count), WIAS-79 to WIAS-219, plus WIAS-229.
- A broader text search across **all** projects for "process recording", "screen recording", "process mining", "workflow capture", "RPA" and "record process" found WIAS-229 as the only relevant hit. Everything else was unrelated: employee onboarding tickets, BuildClub meeting ingestion and product bugs.
- The epics, created 2026-09-06 to 2026-09-07, were read in full:
  - WIAS-79 (Trust Gateway), WIAS-80 (Intelligence Service) and WIAS-81 (Gateway to Intelligence contract);
  - WIAS-82 (OrderEazi as a thin instance) and WIAS-83 (strip warp-brain to domain tools);
  - WIAS-84 (remount PPM), WIAS-85 (governance engine port), WIAS-86 (internal-ops dogfood instance) and WIAS-87 (multi-instance isolation).
- Also read in full:
  - WIAS-94, WIAS-95, WIAS-96, WIAS-97, WIAS-103, WIAS-104, WIAS-107, WIAS-114, WIAS-118, WIAS-121, WIAS-122, WIAS-123 and WIAS-124;
  - WIAS-129 to WIAS-136, WIAS-142, WIAS-144, WIAS-145, WIAS-148 and WIAS-157 to WIAS-168;
  - WIAS-184, WIAS-185, WIAS-186, WIAS-196, WIAS-208, WIAS-209, WIAS-210, WIAS-219 and WIAS-229.
- Statuses below are as at 2026-11-21.

### 1.2 Confluence, searched 2026-11-21

- CQL `text ~ "Superbrain"`, a CQL search for "Trust Gateway", "MCP Host", "Intelligence Service", "Cartographer" and "domain tools", and a Rovo semantic search.
- A CQL text search for "process mining", "screen recording", "workflow recording", "process capture" and "RPA" found nothing relevant. The only RPA page is a 2021 marketing "RPA Store Specification".
- **Moore MSTB space (MM1):** 34 search results, including three templates and the space itself. The ten pages I read in full are all version 1, dated **2026-09-03**:
  - *Superbrain context brief* (internal brief dated 2026-08-26, published 2026-09-03);
  - *Truth Layer and Definitions*;
  - *Commercials, Phasing and Boundary* (only the phasing and boundary sections are used here);
  - *Decision Log*;
  - *Channels and Phase 2 Concepts*;
  - *Platform Foundation, Identity and Gateway*;
  - *Discovery ask: what Warp needs from Moore*;
  - *Regulatory Frame and Verification Pack*;
  - *QuicklySign, AppSheet and Xero*;
  - *Client Process (as-is)*.
- **OE Commerce space (SF8):** surfaced only the backoffice "SuperBrain" MCP (pages *Roadmap*, *2026 Roadmap* and *AI Toolkit*, Nov 2026). It is a different product, so it is not used further.
- **Not found:** no Confluence page describes the superbrain-core architecture: the Gateway, MCP Host, domain MCPs or instance contract. Jira tickets cite an "architecture doc" and a "concept doc §5.1" that I could not locate (see §1.4).

### 1.3 Local repositories, read-only

These are primary sources: the code is newer and more precise than the tickets.

| Repo (local path) | HEAD at read time | What it holds |
|---|---|---|
| `~/code/Warp/claude-desktop-mcps` | `c2dfe650`, 2026-11-10 | `mcps/superbrain/` (Trust Gateway, .NET 8), `mcps/superbrain-intelligence/` (Python), `proto/superbrain/intelligence.proto` (last changed 2026-09-28), `docs/architecture/instance-contract-inventory.md` (WIAS-142) |
| `~/code/Order-eazi/ordereazi-superbrain` | `46ab93e`, 2026-10-07 | The OrderEazi instance: domain client, `/tools/invoke` |
| `~/code/Warp/superbrain-ontology` | `ebcb162`, 2026-11-03 | `docs/design.md` "Superbrain — Company Knowledge Graph" v1.6 (Sept 2026; last edited 2026-09-29), ADR 0007 (2026-10-01), ADR 0012 (2026-10-28) |
| `~/code/Warp/Moore-Superbrain`, branch `kumar/spike/Task` | `5d808d3` | Only the lockdown-clock spike: Python, SQLite and CSV outputs. No Superbrain platform code. |
| `~/Downloads/_Warp-Internal/Super-Brain-and-Warp-Atlas/SuperBrain/files/` | file dates 2026-08-09 | Three planning concept docs: warp-brain MCP expansion, the OrderEazi instance, and a client-facing "Golden Duck" |
| This worktree's `BRIEF.md` | commit `86b6876` | Moore context for the lockdown spike |

### 1.4 What I looked for and did not find

- **The "architecture doc" and "concept doc".** WIAS-95, WIAS-97 and WIAS-107 cite them; they describe the MCP Host, Layer D memory and §5.1 sensitivity. I grepped for "MCP Host" in:
  - `claude-desktop-mcps/docs`;
  - `mcps/superbrain-intelligence`;
  - `ordereazi-superbrain/docs` and its root `*.md` files.

  There were no hits, and Confluence returned nothing either. The architecture is therefore reconstructed from tickets plus code. The full document may exist somewhere I could not see.
- **Any design for process capture, process mining, or turning a demonstrated workflow into an automation.** None exists in Jira, Confluence or the repos.

---

## 2. What "Superbrain" is today: four distinct things

### 2.1 superbrain-core: the Trust Gateway and the Intelligence Service (WIAS epics 1 to 9)

**What it is [V]** (WIAS-79, WIAS-80 and WIAS-81, created 2026-09-06; Gateway README at `c2dfe650`):

- A governed AI request path, split into two services that share one repo (`claude-desktop-mcps/mcps/`).
- **Trust Gateway (.NET 8).** It sits "between raw input and an executed write". It holds:
  - the API edge: rate limits, size limits and schema validation;
  - IDENTITY, POLICY and APPROVAL;
  - the **MCP Host**, which calls **domain MCP servers** (one per domain: OrderEazi, Engineering/warp-brain and others).

  Its design goal is that "execute cannot be called without a token that only the Approval step can mint".
- **Intelligence Service (Python).** "The probabilistic half: planning, routing, and the telemetry/episodic-log layer". Its *only* output is an **authorised plan**: a candidate tool or definition id, typed parameters, confidence, trace id and provenance. It "never calls a write tool directly".
- **Wire contract.** gRPC and protobuf (WIAS-129), with semver, a changelog gate and lockstep compatibility (WIAS-135, WIAS-136). The messages are `AuthorisedPlan` and `ToolProvenance`. `ParameterValue` is a closed set of string, int, bool and double, "deliberately not `google.protobuf.Struct`/`Any`". `PlanResponse` is one of `accepted`, `rejected`, `needs_confirmation` or `needs_clarification`, and there is a `NoMatch` honest miss (`intelligence.proto`, 2026-09-28).
- **Instances.** An instance is "config + contracts + one domain MCP connection" (WIAS-82). The instance contract has three kinds of artefact (WIAS-142 inventory):
  - **Data Contracts:** schema plus sensitivity;
  - **Definitions:** approved, versioned queries with golden tests;
  - **Action Recipes:** write payload, validation chain and confirmation-card content.

**What is actually built, as at 2026-11-21 [V]:**

| Component | State | Source |
|---|---|---|
| Gateway edge: trace id, size and rate limits, channel auth, identity binding | Built and wired | README; WIAS-88 to WIAS-93 Done |
| Identity | **Still OrderEazi-shaped.** It binds `X-OrderEazi-Tenant`/`X-OrderEazi-User` headers. Generalisation (WIAS-94) and tenant resolution (WIAS-95) are **Backlog**. | README "Request pipeline"; Jira |
| POLICY block | Built, config-driven (WIAS-96 Done). The proxy checks with empty attributes, so only on/off rules are expressible today. | README "Policy components" |
| Approval (draft → confirm → execute) | Ported (WIAS-99, WIAS-100, WIAS-102 Done) but **"not registered in Program.cs or reachable from the request pipeline"** | README "Approval components (not yet wired in)" |
| `POST /chat` → Intelligence `Plan` RPC → domain MCP `/tools/invoke` | Built for OrderEazi only (WIAS-147, WIAS-148 Done). The "MCP Host" today is **one** HTTP client (`OrderEaziDomainMcpClient`) calling `ordereazi-superbrain`'s `/tools/invoke`. A general host with discovery across many domain MCPs is design intent, not built. warp-brain is not yet behind it (WIAS-180, WIAS-200 Backlog). | README "Domain MCP"; ordereazi-superbrain HEAD |
| Field-level sensitivity enforcement, result redaction, audit log | **Backlog** (WIAS-97, WIAS-104, WIAS-107) | Jira |
| Intelligence: regex Definition matcher, order-intent parser, router | Built; "execution does not exist yet"; honest-miss surfacing not wired (WIAS-114 Backlog) | `superbrain-intelligence/CLAUDE.md` |
| MEMORY/RECORD governance block (proposals, evidence gate, `remember`) | Built and exposed as MCP tools (WIAS-124, WIAS-157 to WIAS-168 Done). `caller` is still self-asserted. | `superbrain-intelligence/CLAUDE.md` "Write capability" |
| Telemetry ledger (`QueryLedger`), shaped for "Cartographer/misroute-mining" | **To Do** (WIAS-122, WIAS-123) | Jira |
| Second instance (internal-ops), multi-instance isolation decision | **Backlog** (WIAS-86, WIAS-87, WIAS-195 to WIAS-216) | Jira |

**Conclusion [I]:** superbrain-core works end to end for exactly one tenant shape, OrderEazi chat. It is not yet a general multi-tenant platform that a Moore recorder could post into.

### 2.2 Superbrain Ontology: the company knowledge graph

**What it is [V]** (`superbrain-ontology/docs/design.md` v1.6, Sept 2026):

- "A single, queryable model of **who does what, with whom, for which client, when**", assembled from metadata in a company's systems.
- It has four parts: **connectors**, the **store** (Postgres as a property graph), the **query catalogue**, and **applications and agents**.
- It is installed per client rather than run as a multi-tenant service. "The ontology belongs to the client."

**Rules that matter for a recorder [V]:**

- **C3: "No source content is stored. The graph holds references, classifications, metadata and summaries."** Each connector's *Sanitise* stage "is the boundary that enforces C3" (§2, §5.1).
- Connectors have one fixed contract: they "declare a capability, and … emit ontology-conformant objects. Anything unmappable is rejected, not guessed" (§5.1).
- **Observed, structural and derived edges are physically separate.** Every derived edge must carry `confidence`, `method` (model plus prompt hash), `derived_at`, `source_event_ids[]` and a validity window (§4.2).
- The catalogue runs on the principle that the "LLM is a compiler, not an interpreter". Entries are parameterised, versioned, JSON-Schema-contracted, golden-tested and human-approved, then executed deterministically (§9.1 to §9.7).
- **Execution tiers (§9.6):**
  - **Tier A:** declarative SQL;
  - **Tier B:** a sandboxed pure transform;
  - **Tier C, "Procedure":** "multiple queries, orchestration, external calls, conditional logic. Genuine workflows. **Not a catalogue entry.** A separate object with its own async lifecycle."
- Exploration feeds promotion: queries that prove useful are promoted through the approval lifecycle (§9.11).
- ADR 0007 (2026-10-01) makes **`System`** an entity type. Discovery opens with "which applications, systems and tools does your organisation use?", and `entity.source_system` holds the System key.
- ADR 0012 (2026-10-28) says "Queries arrive from elsewhere and are administered here", through draft → … → published in an admin UI (`clients/web`, React).
- **Status.** The README still says "M0 in progress … no connector code yet", but that is **stale**:
  - `docs/plan.md` §7, M1c (inserted 2026-10-22) says "connector work stops at the five feeds running today".
  - `source/connectors/` holds M365 (Calendar, Directory, Groups, Mail, Teams), Atlassian, QuickBooks and Tooling projects; the last connector change is dated 2026-10-26.
  - Current milestone M1c is building the query layer, typed client, MCP surface, API host, catalogue-entries-as-data and the admin UI.

  So connectors exist, and the catalogue and MCP surface are in progress, not yet a consumable service. The code was not run.

**Conclusion [I]:**

- The ontology is the natural home for the *metadata* of a recorded process: that a process exists, which `System`s it touches, which positions perform it, and how often it is recorded.
- It is explicitly **not** a home for screenshots, narration audio or typed field values.
- Its Tier C "Procedure" concept is the closest existing name for "an automated multi-step process".

### 2.3 The Moore engagement: Truth Layer, definitions and action recipes

**What it is [V]** (MM1 *Superbrain context brief*, 2026-08-26, published 2026-09-03):

- "Moore's compliance and practice brain. It sits outside the engagement file, never touches audit judgement, and never writes to the system of record without a human."
- **Mechanics:**
  - the Gateway envelope (who as position, what, scope);
  - a Postgres read store (ProfSoft ODBC snapshots, Caseware telemetry, Xero);
  - the **Truth Layer** of approved, versioned definitions, where "the LLM … never computes the number";
  - the provenance envelope, golden tests and honest misses;
  - **Actions:** "draft → validate → confirm → execute, with per-action confirmation cards and segregation-of-duties enforcement. Position recorded on every audit trail entry".
- **Status:**
  - Only **Phase 0** (foundation and proof) is signed. Phase 1 ("It answers") and Phase 2 ("It drives", which holds the action recipes and the QuicklySign clock) are not (MM1 *Commercials, Phasing and Boundary*, *Decision Log*, 2026-09-03).
  - The Moore repo holds only the lockdown spike (§1.3).
- **The boundary**, six limits, of which four bind a recorder:
  1. No audit judgement and nothing inside an engagement file's professional content.
  2. No writes to ProfSoft.
  3. No replacement of ProfSoft, Caseware, QuicklySign, AppSheet or Xero.
  4. No guessing.
- **POPIA:** "PII fields can be barred from any definition output, so **client PII never enters model context**" (MM1 *Platform Foundation, Identity and Gateway*).
- Moore is deciding Microsoft versus Google, and "Nothing here should be built on Google Workspace identity until that decision lands" (same page).

**Directly relevant to the recorder [V]:**

- Phase 0 discovery asks Moore to "walk through" eight workflows "as it actually happens, including the workarounds". Five of the eight had not been walked through as at 2026-09-03:
  - register maintenance;
  - job setup;
  - the review chain;
  - ISQM 1 remediation;
  - WIP recoverability.
- It asks how many times "the same information gets typed in" (MM1 *Discovery ask*).
- The process descriptions Moore supplied so far are diagrams and PDFs of unknown authorship (MM1 *Client Process (as-is)*).

**[I]:** The recorder is exactly the instrument that discovery programme is missing. Each recorded workflow is first-hand, attributable, timestamped evidence of the as-is process.

### 2.4 OE Commerce backoffice "SuperBrain" MCP

**[V]** SF8 *Roadmap* and *2026 Roadmap* (2026-11-17) describe a backoffice AI panel over OE Commerce's MCP server. It is a separate product surface, so it is out of scope for this integration.

---

## 3. Learning and knowledge components: what exists for "learning a process"

| Component | What it does | State (2026-11-21) | Fit for recorded processes |
|---|---|---|---|
| **MEMORY/RECORD block** (Intelligence Service) | propose → dedup against similar → evidence-count check → a human resolves → reject reason required → provenance envelope (WIAS-85) | **Built** | **Best fit for intake governance [I].** Verified details: `Proposal.kind` is "an opaque `str` (no closed enum)", evidence is `(type, ref)`, and minimums are a caller-supplied `evidence_minimums: {kind: n}` (WIAS-167). An unresolvable evidence ref is rejected (`evidence_unresolved`). A service identity cannot resolve: "an agent proposes, a person decides". **Caveats [V, `proposals/submit.py`]:** the store is in-memory and process-local. Only `type: "proposal"` evidence refs are checked; "every other evidence `type` is accepted unchecked". So the *kind* and the *minimum* are config, but a durable store and a resolver for package refs would be new code. |
| `remember` (direct memory writes) | Kind-gated: `episode`, `incident`, `db_change` and `handover` are direct; `standard`, `decision` and `pattern` require a proposal | Built | A process spec is a gated kind in spirit: it changes future behaviour, so it should go through a proposal, not `remember` [I]. The gated set is currently fixed in code. |
| `QueryLedger` / telemetry for Cartographer and misroute mining | Logs every planner decision for nightly mining | To Do (WIAS-122, WIAS-123) | Not an intake. Later, honest misses ("no approved definition") could tell users which processes to record next [I]. |
| `SuperBrain.Core/Learning` (OrderEazi, .NET) | Old query ledger | **Retired** (WIAS-152 Done) | None |
| PPM session-learning hooks, proposal tools on `/mcp/ppm` | Engineering memory | Being retired or moved to "Code Standards Manager" (WIAS-84, WIAS-184, WIAS-190) | None |
| OrderEazi Phase 2 "Human-in-the-loop rule capture": "confirmed assumptions persist as reusable rules" | Concept doc, 2026-08-09 | Planning only | The same idea as reviewing a recorded process before export [I] |
| Ontology catalogue "exploration → promotion" (§9.11) and ADR 0012 "queries arrive from elsewhere" | Authoring funnel with a human approval gate | Designed; being built in M1c (plan.md, 2026-10-22) | Where read steps derived from a process would be authored and approved [I] |
| **Cartographer** | "Warp's schema and data-source mapping tool. Used in Phase 0" (MM1 glossary) | Exists as a tool; no code was read | It maps *data*. The recorder maps *behaviour*. Complementary [I]. |

**Plain statement [V and I]:** no component today accepts "here is how a person does X; learn it". The recorder package has to be designed so a future intake can consume it, and v1 must not depend on that intake existing.

---

## 4. Where a process spec would be stored and consumed [I]

### 4.1 Decompose, do not import

Superbrain's governing principle is that the model routes and phrases but never computes, and that every executable thing is approved once and then runs deterministically. A recorded process therefore **must not become an executable script**, for three reasons:

- replaying clicks would be "an agent wearing a query's clothes" (ontology §9.6);
- it would escape the approval gate;
- at Moore, replaying UI against ProfSoft would cross boundary limit 2 the moment it writes.

Instead, the process spec is a **source document** from which approved Superbrain artefacts are authored, step by step:

| Recorded step classified as | Becomes (Superbrain artefact) | Approval path | Moore example |
|---|---|---|---|
| **Read / lookup:** the user looks something up to decide or to copy it | **Definition** (Truth Layer) or catalogue entry (Tier A/B) with typed parameters and a golden test | Catalogue lifecycle: draft → validated → approved → published | "Find the engagement's report date in ProfSoft" becomes a read over ODBC snapshots |
| **Write through a system that has an API** | **Action Recipe**: typed payload, validation chain, confirmation card, executed only via the Gateway Approval token | Recipe review plus authority matrix (segregation of duties, position) | "Send pack for signature in QuicklySign", "Submit AppSheet form" |
| **Event trigger:** the user reacts to something arriving | Event subscription (webhook) feeding a Definition or Recipe | Same | QuicklySign `final_document_generated` starts the clock |
| **Orchestration:** the sequence, branches, waits and hand-offs between positions | **Tier C "Procedure"**: a separate object with an async lifecycle, calling approved Definitions and Recipes | Its own approval; not a catalogue entry | Signature → register → lockdown timer chain |
| **Human-only:** judgement, a write to a system with no API or one outside the boundary, or engagement-file content | A **human task** with a prepared context, a notification and a deadline. Superbrain drafts and the human acts. | n/a, by design | "Update the assurance register in ProfSoft" (no writes), any Caseware professional content |
| **Deterministic rule** stated in narration ("letters older than three years must be renewed") | A rule inside a Definition or Recipe validation, or a POLICY business rule | Golden-tested | MM1 *Client Process (as-is)* already lists rules of this kind |

**Domain tools.** Every API-backed step (read or write) also implies a **domain MCP tool** in the domain MCP for that `System`: `quicklysign.create_pack`, `appsheet.submit_form`, `profsoft.read_engagement` (over the read store) and so on.

- These tools sit behind the Gateway's MCP Host, following the architecture's "one domain MCP per domain" model (WIAS-82, WIAS-83, WIAS-148).
- Definitions and Recipes call them; they never call the system directly.
- Aggregated across many recordings, the process spec's `systems[]` and per-step `action` values become the **backlog of domain tools worth building**: which system, which operation, how often staff perform it, and for which positions.
- Steps marked `human_only` or `unknown` because no API exists are equally valuable. They are the evidence for "this needs an integration route before it can be automated" (e.g. ProfSoft write, Citrix).

### 4.2 Storage

- **The package**, with its screenshots, narration and raw events, is **content**. It stays on the user's machine until exported (an owner decision). After export it belongs in a **tenant-isolated artefact store** controlled by the instance, never in the ontology store (C3) and never in model context unredacted (POPIA).
- **Metadata** goes into the ontology as observed facts:
  - a `Process` / `ProcessRecording` resource;
  - `PERFORMED_BY` → position;
  - `USES` → `System`;
  - recorded timestamps.

  This needs an extension type, which the ontology explicitly allows: "extension is expected and is a consulting deliverable" (§4.1).
- **The approved process spec** (JSON, semver) goes into the instance contract alongside Definitions and Recipes, or into the ontology's catalogue and admin store once ADR 0012 lands. Each derived artefact keeps a pointer back to `process_spec_id@version` and the step id it came from, so provenance runs from the automation to the recorded step to the screenshot.

### 4.3 Who consumes it

1. **A fresh Claude** (lane acceptance 4). It reads `PROCESS.md` plus `process-spec.json` and rebuilds the steps.
2. **A Warp builder, through Claude.** They turn steps into Definition, Recipe and Procedure drafts, which then pass Superbrain's normal approval.
3. **Later, the Intelligence Service planner.** Through an MCP tool, it uses approved process specs as routing context ("this request matches process X, step 4") and to explain an honest miss ("process X has no automation for step 4; it is human-only").

---

## 5. Constraints that must shape the package (and collide with parts of the brief)

| # | Constraint | Source | Consequence for the recorder |
|---|---|---|---|
| C-1 | **"Client PII never enters model context"** | MM1 *Platform Foundation…*, *Regulatory Frame…* (2026-09-03) [V] | Conflicts with "hand screenshots to Claude". The review step must be able to blur or redact before export, and the package must record its redaction state per asset. Default to sending Claude the *structured* step data plus redacted images only. Whether Moore's POPIA position allows redacted screenshots of client records to reach Claude at all is **an open question for the owner and for Moore**. |
| C-2 | No audit judgement; nothing inside engagement-file professional content | MM1 boundary limit 1 [V] | Recording Caseware screens of working papers captures professional content. The package needs a per-step `boundary` flag, and the generator must classify such steps as human-only, never as automation candidates. |
| C-3 | No writes to ProfSoft | Boundary limit 2; Decision Log 2026-08-26 [V] | A recorded ProfSoft *write* step can only become a human task. It cannot be replayed through the UI. |
| C-4 | ProfSoft access mode unknown (thick client, browser or Citrix) | Task brief [V] | Under Citrix or RDP, UI Automation and AX see one bitmap. The package must say `control: unavailable (reason: remote_session)` and never output an empty or guessed control. This mirrors the ontology's rule to "never return a bare zero" (§9.3). |
| C-5 | Typed parameters, no free text where a value belongs | WIAS-131, `ParameterValue` closed set [V] | The spec's step inputs and outputs must be typed (`string`/`int`/`bool`/`number`/`date`, plus `sensitivity`), so they map one-to-one onto Definition and Recipe parameters. |
| C-6 | Semver and golden tests on every contract | WIAS-135, ontology §9.7 [V] | The package format carries `schema_version` (semver) and the spec carries `version`. **The recorded run itself is the golden fixture** for "a fresh Claude rebuilds the steps". |
| C-7 | Observed ≠ derived | Ontology §4.2 [V] | Raw events, human annotations and Claude-derived interpretation live in separate files. Every derived item carries `method` (model id plus prompt hash), `confidence`, `derived_at` and `source_event_ids[]`. |
| C-8 | Authority by position, not person | MM1 *Role and Authority Model*, Decision Log [V] | Steps carry a `performed_by_position` (e.g. "audit manager", "admin staff"). The recorder's user identity is provenance, not the actor model. |
| C-9 | Honest misses | WIAS-114, MM1 [V] | The spec must be able to say "unknown" or "not observed" (for example, a branch the user mentioned but did not perform) rather than invent one. |
| C-10 | Identity provider undecided (Microsoft or Google) | MM1 [V] | v1 must not need any Superbrain or SSO login. Export is a local file. |
| C-11 | Single-tenant deployments; Finance and sensitive domains isolated | Ontology C1, WIAS-87, WIAS-210 [V] | The package names its `tenant` / `instance` explicitly so it cannot be ingested into the wrong deployment. |
| C-12 | IP: the signed Moore terms vest IP in works produced in MSTB | MM1 *Commercials, Phasing and Boundary* [V] | The tool is meant to be general (not Moore-specific) but lives in the Moore repo. **The owner should confirm IP ownership** before the code is reused for other clients. |

---

## 6. Recommended package shape for Superbrain consumption [I]

The core lane owns the exact schema. This section is the Superbrain-facing view: what must be in the package for §4 to work.

```
<recording-id>.wrpkg/                  (directory; zipped for transfer)
  manifest.json        schema_version (semver), package_id (ULID), created_at (UTC + tz),
                       recorder_version, os, tenant/instance (optional), recorded_by (provenance),
                       consent + redaction attestation, sha256 of every file
  events.jsonl         OBSERVED, append-only: clicks, keys (values redacted by default), window/app
                       focus, control snapshot {role, name, automation_id/AX identifier, bounds,
                       app, window title, control_status: ok|unavailable(reason)}, timestamps
  annotations.jsonl    HUMAN: comments, highlights (shape + snapped control ref), narration
                       segments with transcript; author + time; linked to event ids
  assets/              screenshots / crops (post-redaction), narration audio (optional, may be
                       excluded from export); each with redaction state
  process-spec.json    DERIVED: the machine-readable spec (below)
  PROCESS.md           DERIVED: the human- and Claude-readable rendering of process-spec.json
  derivation.json      DERIVED provenance: model id, prompt hash, generated_at, inputs hashed
```

**`process-spec.json` fields that Superbrain needs:**

- **Identity:** `id`, `version` (semver), `title`, `intent` (one sentence: what outcome the process achieves), `aliases[]`.
- **When and who:** `trigger` (event, schedule or manual, plus a description) and `actors[]` as **positions**.
- **Systems:** `systems[]` as stable System keys (e.g. `profsoft`, `caseware`, `quicklysign`, `appsheet`, `outlook`, `excel`). These match ontology `System` entities (ADR 0007).
- **Process data:** `inputs[]` and `outputs[]` (typed, with sensitivity) and `rules[]` (deterministic rules stated in narration, each with a source annotation id).
- **`steps[]`.** Each step carries:
  - `id`, `order`, `position`, `system`;
  - `action` (navigate, read, enter, submit, wait, decide, hand-off);
  - `target` (control role, name and id, or `unavailable(reason)`);
  - typed `inputs` and `outputs`;
  - `evidence` (event ids and asset ids);
  - `commentary` (annotation ids);
  - `boundary` (`ok`, `engagement_file_content` or `system_of_record_write`);
  - `automation` with:
    - `candidate`: `definition_read`, `action_recipe`, `event_trigger`, `human_only` or `unknown`;
    - `confidence`;
    - `blockers[]`, for example "no API", "Citrix" or "boundary limit 2".
- **Process shape:** `branches[]` and `exceptions[]` (observed versus mentioned-only, with the distinction kept explicit), and `open_questions[]`.
- **Golden run:** `golden_run` is a reference to the observed events that constitute the known-good run.

`PROCESS.md` renders the same content for a fresh Claude, in step order: what, where, why (the human's words), what could vary, and what must stay human. Lane acceptance 4 tests exactly this file plus the spec.

---

## 7. The interface between the recorder and Superbrain

### 7.1 Options compared

| Option | What it is | Pros | Cons, today | Verdict |
|---|---|---|---|---|
| **A. Versioned file package** | Local export (directory or zip) with a manifest, hashes, a JSON Schema and a validator CLI. A human hands it on. | Zero coupling to unbuilt services. Matches local-first and review-before-export. Works offline and on both OSes. Auditable: the package *is* the evidence. Testable now (lane acceptance 4). | Manual hand-off, and no central catalogue of recordings | **v1: build this** |
| **B. Watched file drop** (shared folder or SharePoint/Drive) | Package copied to a drop location a Superbrain job polls | Simple automation of A | Needs a tenant store and a poller nobody owns. Microsoft versus Google is undecided at Moore. Creates a second copy of content outside review control. | Skip; v2 makes it redundant |
| **C. Upload API through the Trust Gateway, then a proposal** | Recorder (or a small uploader) authenticates as a channel, stores the package in the tenant artefact store, and calls `submit_proposals(kind="process_spec", evidence=[{type:"package", ref:"sha256:…"}])`. A position-holder resolves it. | Uses the existing governance engine (opaque kind, evidence minimums, human resolve, provenance) [V]. One door for every tenant. Audit trail for free. | Needs:<br>• generic identity (WIAS-94, WIAS-95 Backlog)<br>• an artefact store<br>• a **durable** proposal store and a resolver for `package` evidence refs (today in-memory, with non-`proposal` refs unchecked)<br>• the Gateway exposing proposal tools<br>• a decision on the multi-instance topology (WIAS-87)<br>• Moore Phase 1 or 2 being signed | **v2: design for it now; build later** |
| **D. MCP tool** (`search_processes`, `describe_process`, `get_process_step`) behind the Gateway MCP Host | Approved specs become queryable context for the planner and for Claude sessions | Fits the "expose the catalogue over MCP" pattern (ontology §9.9) and the MCP Host model | Only useful once approved specs exist in a store. The general MCP Host is not built yet: today it is one OrderEazi client. | **v3** |
| **E. Recorder writes directly into the ontology or catalogue** | Recorder as a connector | — | Violates C3 (content), skips the approval gate, and couples a desktop app to the store schema | **Reject** |

### 7.2 Recommendation

**v1 (this lane): Option A. Make the file format the contract.**

- Ship `recorder/schema/` with:
  - a JSON Schema for `manifest.json`, `events.jsonl` lines, `annotations.jsonl` lines and `process-spec.json`;
  - a semver `schema_version`, a changelog, and a CI check that a version bump without a changelog entry fails (mirrors WIAS-135);
  - `pnpm validate-package <path>`: schema validation, hash verification, and redaction-state checks.
- Golden fixtures: at least one full recorded test process plus its expected rebuilt steps. These are the evidence for lane acceptance 4.
- Exported packages are **immutable and content-addressed** (sha256 per file plus a package hash), so v2 can cite them as proposal evidence without conversion.
- `manifest.json` already carries the fields v2 needs:
  - `tenant` / `instance` (optional in v1);
  - `recorded_by` (provenance only);
  - `positions[]`;
  - a redaction and consent attestation;
  - the package hash.

**v2 (future WIAS ticket): Option C.** Proposed shape, to raise when the Gateway generalises:

- A `recorder` channel on the Gateway, using the existing `IChannelAuthenticator` pattern.
- An `upload_process_package` route into a tenant artefact store.
- `submit_proposals` with `kind="process_spec"` and an evidence minimum of 1 (the package).
- `resolve_proposals` by a position-holder (a service identity cannot resolve, as already enforced).
- On approval, the spec's metadata lands in the ontology (`Process` extension type) and the spec becomes authoring input for Definitions, Recipes and a Procedure. No step executes from the spec itself.

**v3: Option D**, once approved specs exist.

**Why v1 is not a stub [I]:** the package format *is* the interface. If it already speaks Superbrain's conventions (typed, versioned, provenance-stamped, observed separated from derived, position-based, honest about gaps), then v2 is a transport change, not a remodel.

---

## 8. Implications for the recorder lanes [I]

| Lane | Superbrain-driven requirement |
|---|---|
| core (schema, timeline, package writer, PROCESS.md generator) | Owns §6 and the validator. Keeps observed, human and derived content in separate files. `schema_version` semver plus changelog gate. Content-addressed export. |
| capture plus native control helpers | Records `{role, name, automation_id or AX identifier, app, window}` per click, and `control_status: unavailable(reason)` when AX or UIA sees nothing (Citrix, RDP, canvas apps). Never fabricates a control. Records the **System key** per window (an app-to-System mapping table). |
| overlay plus narration | Highlights reference a snapped control id where available. Narration transcript segments are linked to event ids so rules and decisions trace to evidence. |
| review/export plus Claude process-spec generation | Redaction before export, with per-asset redaction state. Position tagging per step. `boundary` flags. Generated spec carries `derivation.json` (model id, prompt hash). The generator labels each step's automation candidate and says "unknown" rather than guessing. |
| packaging plus CI | Golden-package fixture test in `pnpm test`. Validator runs on the Windows and macOS runners. |

---

## 9. Open questions

1. **POPIA:**
   - May *redacted* screenshots of Moore client records be sent to Claude?
   - Who at Moore approves a package before export? Is it a position, perhaps the engagement partner per ISA 220 §28?
   - Is narration audio ever exported, or only its transcript?
2. **Where do exported packages live** before v2? Options include a Warp-controlled store, Moore's own store, or the user's machine only. Retention (BN 512 sets five years for quality-management documentation; the ontology sets 24 months for raw events) needs a decision.
3. **IP and repo placement:** the signed Moore terms vest works in MSTB, yet the recorder is meant to be general. Should `recorder/` live in a Warp-owned repo and be licensed to Moore?
4. **ProfSoft access mode** (thick client, browser or Citrix) decides how much control-level capture is possible for Moore's most important system.
5. **Which Superbrain owns process specs long-term:** superbrain-core's instance contract, or the ontology's catalogue and admin store (ADR 0012)? Today these are separate codebases with overlapping concepts (Definitions versus catalogue entries).
6. **Does the WIAS backlog get a ticket for v2?** Proposed: "Gateway: recorder channel + process_spec proposal kind + artefact store". It depends on WIAS-94, WIAS-95 and WIAS-87.
7. **The missing architecture and concept doc** cited by WIAS-95, WIAS-97 and WIAS-107: where is it, and does it describe the MCP Host or a learning layer ("Layer D") that would change §4?

---

## Appendix A: key Jira issues (status as at 2026-11-21)

| Key | Summary | Status | Created |
|---|---|---|---|
| WIAS-79 | superbrain-core: trust gateway (epic) | Backlog | 2026-09-06 |
| WIAS-80 | superbrain-core: intelligence service (epic) | Backlog | 2026-09-06 |
| WIAS-81 | gateway ↔ intelligence contract (epic) | Backlog | 2026-09-06 |
| WIAS-82 | Re-shape ordereazi-superbrain as a thin instance (epic) | Backlog | 2026-09-06 |
| WIAS-85 | Port warp-brain's governance engine into the Intelligence Service (epic) | Backlog | 2026-09-06 |
| WIAS-86 | First internal-ops instance (dogfood) (epic) | Backlog | 2026-09-06 |
| WIAS-87 | Multi-instance governance & isolation baseline (epic) | Backlog | 2026-09-06 |
| WIAS-94 | Generalize PrincipalBinder beyond OrderEazi | Backlog | 2026-09-06 |
| WIAS-95 | Tenant resolution | Backlog | 2026-09-06 |
| WIAS-96 | POLICY block, pluggable rule set | Done | 2026-09-06 |
| WIAS-97 | Field-level sensitivity enforcement | Backlog | 2026-09-06 |
| WIAS-107 | Audit log entry on every write attempt and sensitive read | Backlog | 2026-09-06 |
| WIAS-114 | Honest-miss handling | Backlog | 2026-09-07 |
| WIAS-122 | Port QueryLedger/QueryObservation/LedgerFact | To Do | 2026-09-07 |
| WIAS-123 | Shape telemetry for Cartographer/misroute mining | To Do | 2026-09-07 |
| WIAS-124 | Integrate MEMORY/RECORD block | Done | 2026-09-07 |
| WIAS-129 | Transport (gRPC chosen) | Done | 2026-09-07 |
| WIAS-131 | Authorised-plan payload schema | Done | 2026-09-07 |
| WIAS-132 | Provenance fields in the schema | Done | 2026-09-07 |
| WIAS-133 | Gateway response envelope (Jira Backlog; README shows it implemented) | Backlog | 2026-09-07 |
| WIAS-142 | Inventory Data Contracts/Definitions/Action Recipes vs instance contract | Done | 2026-09-07 |
| WIAS-145 | Migrate Action Recipes into instance-contract format | Backlog | 2026-09-07 |
| WIAS-148 | OrderEazi client as the domain MCP behind the Gateway's MCP Host | Done | 2026-09-07 |
| WIAS-152 | Retire SuperBrain.Core/Learning | Done | 2026-09-07 |
| WIAS-158 to WIAS-168 | Proposal flow, evidence gate, kind gating, authz, externalised policy | Done (WIAS-169 In Progress) | 2026-09-07 |
| WIAS-190 | Retire session-learning hooks | Backlog | 2026-09-07 |
| WIAS-210 | Sensitive-domain isolation rule | Backlog | 2026-09-07 |
| WIAS-229 | Workflow recording assistant (this work) | Backlog | 2026-11-21 |

**Note.** Jira status lags the code in places:

- WIAS-133 is Backlog in Jira, but `PlanResponse` and `PlanOutcome` are implemented according to the Gateway README.
- Conversely, several "Done" items are built but not wired, for example Approval.

Trust the code for what exists, and Jira for intent.
