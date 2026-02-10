---
name: skill-mcp-builder
description: The comprehensive guide for building Model Context Protocol (MCP) servers. Use this to create tools that allow Agents to interface with external APIs (GitHub, Slack, Databases, etc.).
---

# MCP Server Builder

## Capability Overview
This skill guides the Agent through the lifecycle of building an MCP server: **Planning -> Implementation -> Evaluation**. It supports both Python (FastMCP) and Node.js (TS SDK).

## Knowledge Base (References)
The Agent should read these files *on demand* based on the user's chosen stack.
* **[Best Practices](./reference/mcp_best_practices.md)**: Naming conventions, security, and headers.
* **[Python Guide](./reference/python_mcp_server.md)**: **Read this** if the user chooses Python. Contains FastMCP patterns.
* **[Node/TS Guide](./reference/node_mcp_server.md)**: **Read this** if the user chooses Node.js. Contains Zod schema patterns.
* **[Evaluation Guide](./reference/evaluation.md)**: How to create QA pairs to test the server.

## Tools (Scripts)
* **Evaluator:** `python skills/skill-mcp-builder/scripts/evaluation.py`
    * *Usage:* Runs a set of questions against your running MCP server to verify it works.

## Workflow

### Phase 1: Stack Selection & Scaffolding
1.  **Ask the User:** "Python (FastMCP) or Node.js?"
2.  **Read the Guide:** Load the corresponding reference file (`python_mcp_server.md` or `node_mcp_server.md`).
3.  **Scaffold:** Create the project structure (e.g., `pyproject.toml` or `package.json`) based on the guide.

### Phase 2: Implementation
1.  **Define Tools:** Ask user which API endpoints to wrap.
2.  **Write Code:** Implement the tools using the patterns in the reference docs.
    * *Critical:* Ensure every tool has a clear `description` and `inputSchema` (Pydantic/Zod).
3.  **Validate:** Check against `reference/mcp_best_practices.md` (e.g., are you using snake_case for tool names?).

### Phase 3: Evaluation
1.  **Generate Test Data:** Create an XML file with test questions (see `reference/evaluation.md`).
2.  **Run the Harness:**
    ```bash
    # For local testing
    python skills/skill-mcp-builder/scripts/evaluation.py test_set.xml --transport stdio --command python --args my_server.py
    ```