# Kaygent — Project Specification

| | |
| --- | --- |
| **Status** | Draft — for review |
| **Version** | 0.1 |
| **Last updated** | 2026-11-07 |

## 1. Vision

Kaygent is the one place where a person sees **all** of their work and acts on
it without switching tools. Work arrives from any source, lives as a card on a
kanban board, and is carried out by the user's own agents through MCP.

The board is not a reporting dashboard. It is the control surface: see the
work, decide what matters, and start or steer the agent that does it.

## 2. Constitution

The constitution is the soul of the project. It is deliberately short and has
precedence over every component decision. A feature that weakens an article
does not ship.

### Article I — All work items live in one place

**Every piece of work the user cares about has a home on the kanban board.**

- Work may be captured manually or arrive from external sources: chat,
  email, incident management, ticket systems, and anything else that can
  produce a list of items.
- The board shows what the work is and what state it is in:
  **in progress, done, waiting, blocked, or parked**.
- A work item keeps its identity, history, source, and current state from
  capture to completion. Nothing important lives only in a chat window, an
  inbox, or an agent's terminal scrollback.
- The board is the single source of truth. Every component reads and writes
  through it; no component keeps a private backlog.

### Article II — Act on the work from the same place

**The user acts on a work item without leaving the board.**

- Actions are performed with the user's **own agents**, orchestrated through
  **MCP** (Model Context Protocol). Kaygent does not lock the user into a
  single agent or model.
- From a work item, the user can:
  - reply to a chat,
  - send an email reply,
  - schedule a meeting,
  - write code or design,
  - create a pull request,
  - investigate live incidents,
  - or run any other MCP-backed action the user has configured.
- Acting must preserve context: the agent receives the work item, its source
  references, and the user's intent without retyping them.
- The outcome of an action is written back to the work item: state, links,
  artifacts, and an audit trail.

### 2.1 Design principles derived from the constitution

1. **See and act in one surface.** Navigation to another app is a last resort,
   not the primary workflow.
2. **Bring your own agent.** Agents are adapters, not dependencies. Claude,
   Codex, a local model, or a custom CLI can all drive the same work item.
3. **Source-agnostic.** A new source is a connector, not a redesign. Chat,
   email, incidents, and tickets normalize into the same work-item model.
4. **Provenance is mandatory.** Every imported item links back to where it came
   from and every action records who or what performed it.
5. **The human stays in control.** Moving work, launching agents, and sending
   outbound messages are explicit decisions. Automation is configurable and
   auditable.
6. **Local ownership.** The board belongs to the user. Data lives locally by
   default; network access happens through configured sources and MCP tools.

## 3. Vocabulary

| Term | Meaning |
| --- | --- |
| **Work item** | One unit of tracked work: a card on the board. |
| **Board** | The complete set of work items and their stages. |
| **Stage** | The lifecycle state of a work item: New, Active, Paused, Completed (configurable labels; stable semantics). |
| **Source** | An external system or command that produces candidate work items. |
| **Connector** | The adapter that reads a source and normalizes its output. |
| **Filter rule** | A per-source rule that decides whether an item is ignored, converted to a work item, or left alone. |
| **Agent** | An external coding/assistant process owned by the user. |
| **Agent session** | One running agent instance bound to a work item. |
| **Workspace** | The working directory, repository, branch/worktree, and environment an agent uses. |
| **Action** | An MCP-backed operation performed on behalf of a work item. |
| **Live incident** | An active incident being investigated; a work item may link to it. |

## 4. Main Components

### 4.1 Kanban Board

The board is the home screen and the source of truth.

**Responsibilities**

- Display every work item grouped by stage.
- Represent the lifecycle: New → Active → Paused → Completed, with Paused
  capturing waiting, blocked, and parked work (optionally with a reason).
- Support manual capture, editing, tagging, prioritization, search, and
  filtering.
- Link each item to its source provenance, agent session, and action history.
- Persist atomically and recover from corruption without losing valid items.
- Remain keyboard-first and usable in a terminal at 70 × 24 or larger.

**Work-item lifecycle**

| Stage | Meaning |
| --- | --- |
| **New** | Captured but not yet triaged or started. |
| **Active** | Being worked on by the user or an agent. |
| **Paused** | Intentionally not active: waiting on someone/something, blocked, or parked. A reason may be recorded. |
| **Completed** | Finished and archived from the active view. |

Stage labels, colors, and glyphs are presentation. Stage semantics are stable so
automation (agents, sync, reporting) can rely on them.

**Requirements**

- **BR-1** The board shall show all work items and their current stages.
- **BR-2** The user shall create, edit, tag, reorder, move, and delete work
  items without leaving the board.
- **BR-3** Moving an item between stages shall update its state immediately and
  persist it.
- **BR-4** A paused item shall optionally record why it is paused (waiting,
  blocked, parked).
- **BR-5** Every item shall retain its source reference and agent/action links.
- **BR-6** The board shall remain responsive while sources sync or agents run.
- **BR-7** The board shall be the only writer of work-item state; components
  report events to it rather than maintaining parallel state.

### 4.2 Multi-Agent Management

Kaygent launches and steers the user's agents, and keeps each agent tied to the
work item it is carrying out.

**Responsibilities**

- **Launch** an agent for a work item, with a command, model, and workspace.
- **Interact** with it: focus its terminal, send a prompt, read output, pause,
  resume, or close it.
- **Navigate** between running agents quickly: list sessions, jump to the
  terminal, and map every session back to its work item.
- **Manage workspaces**: per-item working directory, repository, branch or git
  worktree, environment variables, and cleanup policy.
- Keep session handles with the item so links survive a restart.
- Report agent state on the item: launching, idle, working, waiting, done,
  error, closed.

**MCP action surface**

Agents connect to Kaygent through MCP. The same surface lets the user trigger
actions directly.

- Kaygent shall expose MCP tools to read the board, read/update a work item,
  report agent state, and attach artifacts or links.
- Action tools shall be composable: chat reply, email reply, meeting
  scheduling, code/design, pull-request creation, incident investigation, and
  user-defined tools.
- Whether an action runs inside Kaygent or is delegated to an agent is an
  implementation detail; the work item records the action, its result, and its
  audit entry either way.
- Outbound or destructive actions shall require explicit approval by default.

**Requirements**

- **AR-1** The user shall launch an agent from a work item.
- **AR-2** The user shall close an agent and release its workspace.
- **AR-3** The user shall focus/navigate to any running agent from the board.
- **AR-4** Every agent session shall be bound to exactly one work item.
- **AR-5** Agent state shall be visible on the work item and update without
  manual refresh.
- **AR-6** The user shall configure the agent command, provider, and workspace
  per item or per stage.
- **AR-7** Agent sessions and their handles shall survive a Kaygent restart.
- **AR-8** Workspace creation and cleanup shall be explicit and reversible
  (for example, git worktrees are not deleted without confirmation).
- **AR-9** Kaygent shall be agent-agnostic: any MCP-capable agent shall work.
- **AR-10** All agent and action events shall be recorded on the work item.

### 4.3 Multi-Source Sync

Sources bring the outside world onto the board.

**Responsibilities**

- Connect to any source: chat, incident management, email, ticket systems, or a
  user-defined command/API.
- Fetch candidate items on demand, on start, or on a schedule.
- Normalize each candidate into Kaygent's work-item model with a stable
  external id and provenance.
- Apply per-source rules:
  - **Ignore** — never surface or convert the item.
  - **Convert** — create an actionable work item, optionally with tags,
    priority, or a starting stage.
  - **Leave** — keep the item in the source without adding it to the board
    (default for items that match no rule).
- Deduplicate within a sync batch and against every board stage.
- Never silently delete or resurrect work items based on source disappearance.

**Rule inputs (examples)**

- Source, channel/queue, sender/author, labels, keywords or patterns, age,
  assignee, and whether the user is mentioned.

**Requirements**

- **SR-1** The user shall configure sources declaratively (command or
  connector, format, schedule, credentials via environment references).
- **SR-2** The user shall configure ignore/convert rules per source.
- **SR-3** A sync shall be idempotent: repeating it shall not create duplicate
  work items.
- **SR-4** Every imported work item shall retain its source name, external id,
  and URL/reference.
- **SR-5** One failing source shall not prevent other sources from syncing.
- **SR-6** The board shall show sync status, last success, and failures.
- **SR-7** Conversion shall be auditable: the rule that created an item and
  the source payload that matched it shall be recoverable.
- **SR-8** Rules shall be testable without writing to the board (dry run).

## 5. Core Workflows

**Capture → Act → Complete**

1. A work item is created manually or imported by a source.
2. The user triages it on the board and moves it to Active.
3. Kaygent launches (or reuses) an agent for the item with the right workspace.
4. The agent uses MCP to read the item, perform actions, and report state.
5. Results (links, artifacts, replies, PRs) are attached to the item.
6. The user reviews and moves the item to Completed; the agent and workspace
   are closed according to policy.

**Source → Rule → Board**

1. A source is synced (manual, startup, or schedule).
2. Each candidate is matched against ignore/convert/leave rules.
3. Converted candidates become work items with provenance.
4. Duplicates and ignored items are discarded with a recorded reason.
5. The board reports what changed.

**Agent → Board → User**

1. An agent updates its work item's stage or reports a blocker via MCP.
2. The board reflects the change immediately.
3. The user navigates from the item to the agent's terminal to intervene.

## 6. Conceptual Data Model

This is not a final schema; it fixes the concepts the components share.

**WorkItem**

- `id`, `title`, `notes`, `stage`, `pauseReason`
- `tags`, `priority`, `dueAt`
- `source` (name, external id, url, metadata)
- `session` (provider, handle, status, workspace)
- `links` / `artifacts`
- `createdAt`, `updatedAt`

**Source**

- `name`, `connector`, `command`/`endpoint`, `schedule`, `format`
- `defaults` (tags, priority, stage)
- `rules[]` (match, action: ignore | convert | leave, overrides)

**AgentSession**

- `provider`, `handle`, `status`, `workspace`, `startedAt`, `lastSeenAt`

**Workspace**

- `path`, `repository`, `branch`/`worktree`, `env`, `cleanupPolicy`

**ActionRecord**

- `type`, `workItemId`, `actor` (user | agent), `request`, `result`, `at`

## 7. Non-Functional Requirements

- **NFR-1 Local-first.** The board and its history remain usable offline.
  Network access is explicit and confined to sources and MCP tools.
- **NFR-2 Extensible.** Sources, agents, and actions are plugins/adapters; adding
  one shall not require changing the board model.
- **NFR-3 Failure isolation.** A failing source, agent, or action shall not take
  down the board or corrupt data.
- **NFR-4 Responsiveness.** Board navigation and edits stay responsive while
  syncs and agents run in the background.
- **NFR-5 Portability.** The core runs on Windows and Linux; the architecture
  shall not preclude macOS.
- **NFR-6 Safety.** Outbound actions are explicit, auditable, and least
  privilege; secrets are referenced from the environment, never written to the
  board.
- **NFR-7 Observability.** The user can always answer: what is running, what
  synced, what failed, and what acted on this item.
- **NFR-8 Determinism.** Identical source payloads and rules produce identical
  work items and dedup decisions.

## 8. Boundaries and Non-Goals

- Kaygent is **not** an agent runtime or a model provider. It orchestrates agents
  the user already trusts.
- Kaygent is **not** a replacement for chat, email, calendar, incident, or
  ticket systems. It is the place those systems' work is collected and acted on.
- Kaygent does **not** hide actions: no outbound message is sent, no PR opened,
  and no workspace destroyed without an explicit or configured approval.
- Kaygent does **not** require a hosted account for the core board.

## 9. Current State vs Target

| Capability | Current | Target |
| --- | --- | --- |
| Kanban board with four stages | Implemented | Constitution Article I |
| Local persistence and recovery | Implemented | Retained |
| Terminal-based agent launch, focus, close | Implemented (herdr-core, herdr, tmux, WezTerm, Windows Terminal, process, custom) | Multi-Agent Management |
| Agent list and navigation | Partial (via task sessions) | AR-1 – AR-10 |
| Workspace management | Partial (global terminal `cwd`; per-source `cwd`) | Worktrees, env, cleanup |
| MCP action surface | Not implemented | Article II |
| Source sync (commands, schedules, dedup, provenance) | Implemented | Multi-Source Sync |
| Declarative ignore/convert rules | Partial (source command decides output) | SR-2, SR-7, SR-8 |
| Paused reason (waiting/blocked/parked) | Not implemented | BR-4 |
| Agent/action audit trail | Not implemented | AR-10, NFR-6 |

## 10. Open Questions

1. **Paused vs blocked/parked:** Should waiting, blocked, and parked be reasons
   within Paused, or separate stages/sub-states?
2. **MCP topology:** Is Kaygent an MCP server, an MCP client, or both? Which
   transport (stdio, HTTP) and how are tools discovered?
3. **Default rule outcome:** When a source item matches no rule, should it be
   left in the source (proposed), or shown in a review queue for triage?
4. **Workspace isolation:** Is a per-item working directory enough, or must each
   item get a git worktree/branch by default?
5. **Agent status authority:** Do agents report state through MCP, or does
   Kaygent infer it from terminals/processes? What if both disagree?
6. **First connectors:** Which chat, email, incident, and ticket systems are the
   initial targets?
7. **Approval policy:** Which actions always require confirmation, which may be
   pre-authorized by rule, and where is the audit surface?
8. **Multi-machine work:** Should agents and sources span remote machines in the
   first version (herdr-core already supports remote terminals)?
