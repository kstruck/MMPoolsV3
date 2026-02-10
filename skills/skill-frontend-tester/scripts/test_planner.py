#!/usr/bin/env python3
import sys
import re
import json
from pathlib import Path

def analyze_component(file_path):
    if not Path(file_path).exists():
        return {"error": "File not found"}

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Complexity Score
    line_count = len(content.splitlines())
    hook_count = len(re.findall(r"use[a-zA-Z]+", content))
    complexity_score = line_count / 10 + (hook_count * 2)

    # 2. Import Analysis
    # regex should look for imports to mock
    imports = re.findall(r"import\s+(?:\{[^}]*\}|\w+)\s+from\s+['\"]([^'\"]+)['\"]", content)
    mocks_needed = []
    for path in imports:
        if "service" in path or "next/" in path or "query" in path:
            mocks_needed.append(path)

    # 3. Props Analysis
    props_match = re.search(r"interface\s+([a-zA-Z]+Props)\s*\{([^}]*)\}", content, re.DOTALL)
    props = []
    if props_match:
        raw_props = props_match.group(2)
        props = [line.strip() for line in raw_props.splitlines() if ":" in line]

    # 4. Suggested Scenarios
    scenarios = ["Should render without crashing"]
    if "useState" in content:
        scenarios.append("Should handle state updates")
    if "onClick" in content:
        scenarios.append("Should handle user clicks")
    if "map(" in content:
        scenarios.append("Should render list of items")
    if mocks_needed:
        scenarios.append("Should handle API loading/error states")

    return {
        "file": file_path,
        "complexity": round(complexity_score, 1),
        "mocks_needed": list(set(mocks_needed)),
        "props": props,
        "suggested_scenarios": scenarios
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Provide a file path"}))
        sys.exit(1)
    
    result = analyze_component(sys.argv[1])
    print(json.dumps(result, indent=2))
