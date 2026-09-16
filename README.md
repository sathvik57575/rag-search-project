 # Project Management Agent

This project demonstrates a goal-oriented project-management agent using local Ollama tool calling. It uses exact lookups and analysis over `data/pm-data.json`; it does not use embeddings, chunking, vector search, or PostgreSQL.

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

Optional environment variables are `OLLAMA_URL` and `PORT`. Configure `GEMINI_API_KEY` only when using the Gemini model.

## Architecture

`POST /agent` sends the user goal and all tool schemas to Ollama. The model can create a plan, choose the next function from observed evidence, revise the plan after failures or conflicting data, and stop when it has enough evidence or cannot continue. The response includes `state.plan`, `state.planHistory`, `executionTrace`, failures, and recommendations.

Available tools include `create_plan`, `replan`, `get_employee`, `get_project`, `get_projects`, `get_tasks`, `get_task`, `get_project_metrics`, `get_project_updates`, `find_project_risks`, `update_task_status`, `assign_task`, `create_recommendation`, `remember`, `forget`, and `search_memory`.

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
