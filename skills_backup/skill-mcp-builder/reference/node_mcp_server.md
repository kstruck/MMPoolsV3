# Node/TypeScript MCP Patterns

## 1. Project Configuration

### `package.json` Template
```json
{
  "name": "service-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.1",
    "zod": "^3.23.8",
    "express": "^4.21.1"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.21"
  }
}