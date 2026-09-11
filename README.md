 # Project Management Agent

This project demonstrates an AI agent that uses Ollama native tool calling to answer project-management questions. It uses exact lookups and filters over `data/pm-data.json`; it does not use embeddings, chunking, vector search, or PostgreSQL.

## Run

1. Install dependencies: `npm install`
2. Start Ollama and pull a tool-capable model, for example: `ollama pull llama3.1`
3. Start the API: `npm start`
4. Ask the agent:

```powershell
Invoke-RestMethod http://localhost:3000/agent -Method Post -ContentType 'application/json' -Body '{"message":"Who is responsible for the overdue tasks in Project Alpha?"}'
```

Optional environment variables are `OLLAMA_URL`, `OLLAMA_MODEL`, and `PORT`.

## Architecture

`POST /agent` sends the user message and all tool schemas to Ollama. When Ollama returns `tool_calls`, `src/agent.js` executes the named function from `src/toolImpl.js`, records the tool name, arguments, and result, then sends the result back as a `tool` message. The loop ends when the model returns normal text or reaches an eight-iteration safety limit.

Available tools are `get_employee`, `get_project`, `get_projects`, `get_tasks`, `get_task`, and `calculate_project_metrics`.

## Test the data tools

Run `npm run test:tools`. This checks duplicate-name ambiguity, overdue filtering, missing projects, metrics, and missing-task failures without requiring Ollama.

Useful agent scenarios:

- `Who is responsible for the overdue tasks in Project Alpha?` should require multiple tool calls.
- `Show me John's projects` should ask which John because two employees match.
- `Show me tasks for Project Zeta` should report that the project does not exist.
- `Give me metrics for Project Alpha` should use the metrics tool.
- A request for a nonexistent task should receive the tool error and produce a graceful answer.
