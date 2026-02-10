---
name: skill-code-review
description: Professional code review assistance for local changes and remote PRs. Combines automated style checking with deep structural and logical analysis.
---

# Code Review SOP

## Capability Overview
This skill guides the agent in conducting professional and thorough code reviews. It supports both local changes (staged or working tree) and remote Pull Requests (by ID or URL), focusing on correctness, maintainability, and adherence to project standards using both automated tools and manual analysis.

## Tools (Scripts)
* **Style Checker:** `python skills/skill-code-review/scripts/check_style.py [target_file]`
    * *Input:* Path to a file for automated style & linting check.
    * *Output:* Report of style violations and potential improvements.

## Workflow

### 1. Determine Review Target
*   **Remote PR**: If a PR number or URL is provided, checkout the PR using `gh pr checkout <PR_NUMBER>`.
*   **Local Changes**: Use `git status` and `git diff` to identify and review uncommitted changes.

### 2. Preparation
1.  **Reference Style Guide:** Read `skills/skill-code-review/references/style-guide.md`.
2.  **Run Automation:** Use the **Style Checker** tool on modified files.
3.  **Context (Remote):** Read PR descriptions and existing comments.

### 3. In-Depth Analysis
Analyze based on these pillars:
*   **Correctness**: achievment of purpose without bugs.
*   **Maintainability**: clean structure and modularity.
*   **Efficiency**: performance bottlenecks.
*   **Security**: vulnerabilities or hardcoded secrets.
*   **Testability**: adequate test coverage.

### 4. Provide Feedback
1.  **Summary**: High-level overview of findings.
2.  **Findings**:
    *   **Critical**: Bugs, security issues, or breaking changes.
    *   **Improvements**: Suggestions for quality or performance.
    *   **Nitpicks**: Formatting or minor style issues.
3.  **Conclusion**: Recommendation (Approved / Request Changes).

---
## Review Checklist
- [ ] Code follows naming conventions.
- [ ] No hardcoded secrets or credentials.
- [ ] Error handling is appropriate.
- [ ] Functions are concise (< 50 lines).
- [ ] Tests are included or updated.
