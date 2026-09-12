 # Project Management Agent

This project demonstrates a goal-oriented project-management agent using Gemini native tool calling. It uses exact lookups and analysis over `data/pm-data.json`; it does not use embeddings, chunking, vector search, or PostgreSQL.

## Run

1. Install dependencies: `npm install`
2. Set `GEMINI_API_KEY` and `DEFAULT_MODEL=gemini-3.5-flash-lite` in `.env`.
3. Start the API: `npm start`
4. Ask the agent:

```powershell
Invoke-RestMethod http://localhost:3000/agent -Method Post -ContentType 'application/json' -Body '{"message":"Who is responsible for the overdue tasks in Project Alpha?"}'
```

Optional environment variables are `OLLAMA_URL`, `OLLAMA_MODEL`, and `PORT`.

## Architecture

`POST /agent` sends the user goal and all tool schemas to Gemini. When Gemini returns a function call, `src/agent.js` executes the selected function from `src/toolImpl.js`, records the tool name, arguments, and result, then sends the result back to Gemini. The model chooses the next step dynamically and the loop ends when it returns a complete answer or reaches an eight-iteration safety limit.

Available tools include `get_employee`, `get_project`, `get_projects`, `get_tasks`, `get_task`, `calculate_project_metrics`, `find_project_risks`, `update_task_status`, `assign_task`, and `create_recommendation`.

Each request gets an isolated context containing tool results, failures, and recommendations. Repeated identical calls are served from the request cache. Status and assignment changes stop with `pendingConfirmation`; repeat the request with `"confirmed": true` to authorize the mutation.

## Test the data tools

Run `npm run test:tools`. This checks duplicate-name ambiguity, overdue filtering, missing projects, metrics, and missing-task failures without requiring Ollama.

Useful agent scenarios:

- `Who is responsible for the overdue tasks in Project Alpha?` should require multiple tool calls.
- `Show me John's projects` should ask which John because two employees match.
- `Show me tasks for Project Zeta` should report that the project does not exist.
- `Give me metrics for Project Alpha` should use the metrics tool.
- A request for a nonexistent task should receive the tool error and produce a graceful answer.

## Goal-agent checks

Run `npm run test:agent` to test a five-tool investigation goal, risk analysis, recommendation creation, failed-tool recovery, duplicate-call avoidance, ambiguous input, confirmation gating, and per-request state isolation without requiring a live Gemini request.
