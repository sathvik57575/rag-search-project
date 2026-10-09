 # Project Management Agent

This project demonstrates a project-management agent and a separate multi-agent coordinator. Project and task tools use `data/pm-data.json`. The single-agent route can also search shared uploaded documents and the existing `/knowledge` files using Gemini embeddings stored in Neon PostgreSQL with pgvector. The coordinator keeps its existing JSON tools and local `/knowledge` search.

## Run

1. Install dependencies: `npm install`
2. Start Ollama and pull the local models you want to use: `ollama pull qwen3:4b` and/or `ollama pull llama3.2`.
3. Start the API: `npm start`
4. Ask the agent:

```powershell
Invoke-RestMethod http://localhost:3000/agent -Method Post -ContentType 'application/json' -Body '{"message":"Who is responsible for the overdue tasks in Project Alpha?"}'
```

Supply `userId` to isolate long-term memory and `conversationId` to keep short-term context between turns:

```json
{
	"userId": "alice",
	"conversationId": "planning",
	"message": "Remember that Project Alpha is my priority."
}
```

The agent stores explicit memories in `data/memory.json`, keyed by user. A later request such as `What should I focus on today?` retrieves only relevant memories for that user. Reusing a memory key updates it, and `Project Alpha is no longer my priority` allows the agent to remove or replace the old preference through the memory tools. Recent turns are held in bounded in-memory conversation state; they are not promoted to long-term memory automatically. Set `MEMORY_PATH` to use another JSON file.

The default model is `qwen3:4b`. Choose a model per request with the optional `model` field:

```json
{
	"model": "llama3.2",
	"message": "Analyze all active projects and generate a prioritized risk report."
}
```

Supported examples are `qwen3:4b` and `llama3.2` through Ollama, or `gemini-3.5-flash-lite` through Gemini when `GEMINI_API_KEY` is configured. The request value takes precedence; omitting `model` uses `qwen3:4b`.

Optional environment variables are `OLLAMA_URL`, `PORT`, and `GEMINI_EMBEDDING_MODEL`. Configure `GEMINI_API_KEY` when using Gemini for chat or when indexing/searching documents.

## Document uploads

Create a Neon PostgreSQL database with the `vector` extension available. Add its connection string to the local environment as `DATABASE_URL` (include SSL settings from Neon). The app creates its document tables and enables `vector` the first time upload or semantic document search is used. If the Neon role cannot create extensions, enable `vector` once in the Neon SQL Editor.

The `GET /upload` page accepts up to five PDF or TXT files per request, each up to 10 MB. `POST /upload` extracts text, chunks it, generates embeddings with `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`), and stores each original file, its chunks, and vectors in Neon. `GEMINI_API_KEY` is needed for embeddings even when the chat model uses Ollama. Scanned-image PDFs are not OCR'd.

Uploads and answers are shared with all visitors; there is no authentication or uploader ID. Existing files under `/knowledge` are indexed into the same vector corpus the first time `/agent` document search or upload runs, while the files remain in the repository. `/agent` uses semantic document search when relevant and keeps its existing JSON tools for project and task questions. `/coordinator` is unchanged and does not search uploaded files.

The coordinator route is a separate multi-agent workflow with JSON-backed role guardrails. Send a known `employeeId` with the query:

```json
{
	"employeeId": "EMP3",
	"query": "Analyze Project Alpha risks",
	"model": "llama3.2"
}
```

Access roles are stored as `accessRole` on employees in `data/pm-data.json`; job-title values remain in `role`. The permission catalog and role mappings are in `data/roles.json`. Regular employees are limited to their own profile, owned projects, and assigned tasks. Project managers can inspect the broader project-management dataset. Only administrators can mutate task status, task assignment, or project-update risk through `/coordinator`, and each mutation requires `confirmed: true`.

For this JSON-only demo, `employeeId` is supplied in the request body and is therefore spoofable. It is an authorization example, not production authentication. A deployed system must derive identity from a trusted authenticated session or token. The `/agent` route keeps its existing contract and behavior.

## Architecture

`POST /agent` sends the user goal and its available tool schemas to the configured chat model. The single agent can create a plan, choose the next function from observed evidence, revise the plan after failures or conflicting data, and stop when it has enough evidence or cannot continue. It can use `search_documents` for relevant uploaded and `/knowledge` passages, and the existing tools for current project data. The response includes `state.plan`, `state.planHistory`, `executionTrace`, failures, and recommendations.

Available tools include `create_plan`, `replan`, `get_employee`, `get_project`, `get_projects`, `get_tasks`, `get_task`, `get_project_metrics`, `get_project_updates`, `find_project_risks`, `update_task_status`, `assign_task`, `create_recommendation`, `remember`, `forget`, `search_memory`, and `search_documents`.

Each request gets an isolated context containing tool results, failures, and recommendations. Repeated identical calls are served from the request cache. Status and assignment changes stop with `pendingConfirmation`; repeat the request with `"confirmed": true` to authorize the mutation.

## Test the data tools

Run `npm test` to cover the data tools, agent flow, planning/risk behavior, and memory isolation without requiring Ollama.

The default seed expands to 24 employees, 9 projects, 105 tasks, and 24 updates. It includes overdue and blocked work, a project with no tasks, malformed task data, stale updates, and conflicting update risk levels. Custom `PM_DATA_PATH` fixtures are not expanded, so API/tool failure scenarios remain easy to test.

Failure and replanning cases:

1. A missing task returns an explicit tool failure; the model can switch to a scoped pending-task query.
2. Invalid task or employee IDs are rejected before mutation; the model must resolve real records first.
3. A project with no tasks is reported as `no_task_coverage`, not as healthy or complete.
4. Stale and conflicting project updates are returned as separate evidence, so the model can replan around data validation instead of silently selecting one.
5. A local-model/API failure stops the run with `model_error` and an incomplete-evidence message; it never fabricates a risk report.

Useful agent scenarios:

- `Who is responsible for the overdue tasks in Project Alpha?` should require multiple tool calls.
- `Show me John's projects` should ask which John because two employees match.
- `Show me tasks for Project Zeta` should report that the project does not exist.
- `Give me metrics for Project Alpha` should use the metrics tool.
- A request for a nonexistent task should receive the tool error and produce a graceful answer.

## Goal-agent checks

Run `npm run test:agent` to test a five-tool investigation goal, risk analysis, recommendation creation, failed-tool recovery, duplicate-call avoidance, ambiguous input, confirmation gating, and per-request state isolation without requiring a live Gemini request.
