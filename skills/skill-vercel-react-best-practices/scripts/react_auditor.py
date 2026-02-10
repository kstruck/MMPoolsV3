#!/usr/bin/env python3
import sys
import re
import json
from pathlib import Path

def audit_react_performance(file_path):
    if not Path(file_path).exists():
        return {"error": "File not found"}

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    findings = []

    # 1. async-parallel: Detect sequential awaits that could be parallelized
    # This is a simple heuristic: two awaits on different variables within the same block
    awaits = re.findall(r"const\s+(\w+)\s*=\s*await\s+", content)
    if len(awaits) > 1:
        findings.append({
            "rule": "async-parallel",
            "severity": "CRITICAL",
            "message": "Potential sequential awaits detected. Consider using Promise.all() for independent operations."
        })

    # 2. bundle-barrel-imports: Detect imports from potential barrel files
    # Heuristic: imports from a path that ends in a directory (no extension or index)
    barrel_imports = re.findall(r"from\s+['\"](\.@?\/[^'\"]+)['\"]", content)
    for imp in barrel_imports:
        if not imp.endswith((".ts", ".tsx", ".js", ".jsx")) and "/" in imp:
             # Basic check to skip known non-barrel like packages if they follow specific naming
             findings.append({
                "rule": "bundle-barrel-imports",
                "severity": "CRITICAL",
                "message": f"Potential barrel import detected: '{imp}'. Import directly from the source file to reduce bundle size."
            })

    # 3. rerender-memo: Detect complex components without memoization
    # Heuristic: Component with many props or complex JSX
    if "export const" in content and "=> {" in content:
        if len(re.findall(r"const|let|var", content)) > 10 and "memo(" not in content:
            findings.append({
                "rule": "rerender-memo",
                "severity": "MEDIUM",
                "message": "Component appears complex but does not use React.memo(). Evaluate if memoization would prevent unnecessary re-renders."
            })

    # 4. rendering-conditional-render: Detect && usage for conditional rendering
    if " && <" in content:
        findings.append({
            "rule": "rendering-conditional-render",
            "severity": "MEDIUM",
            "message": "Detected '&&' for conditional rendering. Consider using a ternary operator to avoid potential '0' rendering issues."
        })

    return {
        "file": file_path,
        "findings": findings,
        "score": 100 - (len(findings) * 10)
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Provide a file path"}))
        sys.exit(1)
    
    result = audit_react_performance(sys.argv[1])
    print(json.dumps(result, indent=2))
