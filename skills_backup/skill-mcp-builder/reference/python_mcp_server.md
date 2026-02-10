# Python FastMCP Patterns

## 1. Basic Server Setup
*Always define your tools BEFORE calling `mcp.run()`.*
```python
from mcp.server.fastmcp import FastMCP

# Initialize
mcp = FastMCP("service_name_mcp")
```

## 2. Tool Registration (Standard)
```python
from pydantic import BaseModel, Field

# 1. Define Input Schema
class CalculateInput(BaseModel):
    x: int = Field(description="First number")
    y: int = Field(description="Second number")

# 2. Register Tool
@mcp.tool()
def add(params: CalculateInput) -> int:
    """Adds two numbers together."""
    return params.x + params.y
```

## 3. Tool Registration (Async/Context)
Use this for API calls or long-running tasks.
```python
from mcp.server.fastmcp import Context

@mcp.tool()
async def fetch_data(url: str, ctx: Context) -> str:
    """Fetches data with progress reporting."""
    await ctx.report_progress(0.1)
    await ctx.log_info(f"Fetching {url}")
    # ... perform async request ...
    return "Result"
```

## 4. Resources (Read-Only Data)
```python
@mcp.resource("config://{env}/settings")
def get_config(env: str) -> str:
    """Read a config resource."""
    return f"Settings for {env}"
```

## 5. Error Handling Pattern
Always return explicit errors, do not crash.
```python
try:
    result = api.call()
except APIError as e:
    # Format for the LLM to understand
    return f"Error: The API rejected the request (Status {e.status}). Hint: Check your API key."
```

## 6. Main Entry Point
*Place this at the very end of your file.*
```python
if __name__ == "__main__":
    mcp.run()
```