export const SKILL_TEMPLATES: Record<string, string> = {
  "code-review": `When the user asks for a code review, analyze the provided code thoroughly.

## What to check
- Logic errors and edge cases
- Naming conventions and readability
- DRY violations and unnecessary complexity
- Missing error handling at system boundaries
- Security issues (injection, XSS, auth bypass)
- Performance concerns (N+1 queries, unbounded loops)

## Output format
For each issue found, provide:
1. **Location**: file and line reference
2. **Severity**: critical / warning / suggestion
3. **Issue**: one-sentence description
4. **Fix**: concrete code change

Summarize with a verdict: approve, request changes, or needs discussion.`,

  "git-commit": `When the user asks you to write a commit message, analyze the staged diff.

## Rules
- First line: imperative mood, under 72 chars, no period
- Blank line, then body explaining WHY not WHAT
- Reference issue numbers when available
- Use conventional commit prefixes: feat, fix, refactor, docs, test, chore
- Group related changes; suggest splitting unrelated changes

## Output
Provide the full commit message ready to copy. If the diff is large, suggest multiple commits with a breakdown.`,

  "test-gen": `When the user asks to generate tests, create comprehensive unit tests.

## Approach
- Identify the function signature, dependencies, and return type
- Write tests for: happy path, edge cases, error cases, boundary values
- Mock external dependencies only at system boundaries
- Use descriptive test names that explain the scenario
- Follow the existing test framework in the project (Jest, Vitest, pytest, etc.)

## Output
Provide complete, runnable test code. Include imports and any necessary setup/teardown.`,

  "refactor": `When the user asks for refactoring suggestions, analyze the code structure.

## What to look for
- Long functions that should be split (>30 lines)
- Deeply nested conditionals that can be flattened
- Repeated patterns that warrant extraction
- God classes/modules doing too many things
- Unclear naming that hides intent
- Dead code and unused imports

## Output
For each suggestion:
1. Current code snippet
2. Proposed refactored version
3. Brief rationale

Preserve behavior exactly. Never change logic during refactoring.`,

  "doc-gen": `When the user asks to generate documentation, create clear and concise docs.

## Rules
- Match the project's existing doc style if present
- Document the WHY and contract, not the HOW
- Include: purpose, parameters, return values, exceptions, usage example
- Keep descriptions under 3 sentences
- Use the language's standard doc format (JSDoc, docstring, rustdoc, etc.)

## Output
Provide the documentation ready to insert into the code.`,

  "bug-finder": `When the user asks to find bugs, systematically analyze the code.

## Check for
- Null/undefined access without guards
- Off-by-one errors in loops and slices
- Race conditions in async code
- Resource leaks (unclosed handles, missing cleanup)
- Integer overflow or precision loss
- Unhandled promise rejections
- Incorrect comparison operators (== vs ===)
- Mutable shared state

## Output
For each potential bug:
1. **Location**: where in the code
2. **Risk**: high / medium / low
3. **Description**: what could go wrong
4. **Reproduction**: scenario that triggers it
5. **Fix**: concrete code change`,

  "api-designer": `When the user asks to design an API, follow REST best practices.

## Design principles
- Use nouns for resources, HTTP verbs for actions
- Consistent naming: plural nouns, kebab-case
- Proper status codes (201 for create, 204 for delete, 404 for not found)
- Pagination for list endpoints (cursor-based preferred)
- Version the API (path prefix or header)
- Include request/response schemas

## Output
For each endpoint provide:
- Method + path
- Request body schema (if applicable)
- Response schema with example
- Error responses
- Authentication requirements`,

  "sql-helper": `When the user asks for SQL help, write optimized queries.

## Rules
- Use parameterized queries, never string concatenation
- Add appropriate indexes for WHERE and JOIN columns
- Prefer JOINs over subqueries for readability
- Use CTEs for complex multi-step queries
- Include LIMIT for potentially large result sets
- Consider NULL handling explicitly

## Output
Provide the complete SQL query with:
- Inline comments for complex logic
- Index suggestions if relevant
- Performance notes for large tables`,

  "playwright-browser": `When the user asks for browser automation, generate Playwright scripts.

## Rules
- Use locators (getByRole, getByText) over CSS selectors
- Add proper waits (waitForSelector, waitForNavigation)
- Handle dynamic content and loading states
- Include assertions to verify expected behavior
- Use Page Object pattern for complex flows
- Handle popups, dialogs, and iframes

## Output
Provide complete, runnable Playwright test code with:
- Setup and teardown
- Descriptive test names
- Error screenshots on failure`,

  "code-explainer": `When the user asks to explain code, break it down clearly.

## Approach
- Start with a one-sentence summary of what the code does
- Walk through the logic step by step
- Explain non-obvious patterns, idioms, or algorithms
- Highlight key data transformations
- Note any side effects or external dependencies
- Use analogies for complex concepts

## Adjust to audience
- If the user seems experienced: focus on the WHY and tradeoffs
- If the user seems learning: explain fundamentals and terminology
- Always be concise — explain what matters, skip what's obvious`,

  "security-audit": `When the user asks for a security audit, scan for vulnerabilities.

## Check for (OWASP Top 10)
- Injection (SQL, command, LDAP, XSS)
- Broken authentication and session management
- Sensitive data exposure (hardcoded secrets, logs)
- Missing access control checks
- Security misconfiguration
- Insecure deserialization
- Using components with known vulnerabilities
- Insufficient logging and monitoring

## Output
For each finding:
1. **Severity**: critical / high / medium / low
2. **Category**: OWASP category
3. **Location**: file and line
4. **Description**: what the vulnerability is
5. **Impact**: what an attacker could do
6. **Remediation**: specific fix with code`,

  "performance-optimizer": `When the user asks to optimize performance, analyze bottlenecks.

## Check for
- O(n^2) or worse algorithms that can be O(n log n) or O(n)
- Unnecessary re-renders in React (missing memo, unstable refs)
- N+1 database queries
- Missing caching opportunities
- Synchronous I/O blocking the event loop
- Large bundle sizes and lazy loading opportunities
- Memory leaks (event listeners, closures, circular refs)

## Output
For each optimization:
1. **Current**: what's slow and why
2. **Proposed**: the optimization
3. **Impact**: estimated improvement
4. **Tradeoff**: any downsides (complexity, memory)`,

  "regex-builder": `When the user asks for regex help, build and explain patterns.

## Approach
- Start by understanding what the user wants to match
- Build the regex incrementally, explaining each part
- Provide test cases showing matches and non-matches
- Warn about common pitfalls (greedy vs lazy, backtracking)
- Use named groups for readability when applicable

## Output
1. The complete regex pattern
2. Breakdown of each component
3. Example matches and non-matches
4. Any edge cases to be aware of
5. Language-specific syntax notes if needed`,

  "csv-excel-processor": `When the user asks to process spreadsheet data, help with parsing and transformation.

## Capabilities
- Parse CSV with proper delimiter and quote handling
- Read/write Excel files (.xlsx)
- Data cleaning: trim, type conversion, null handling
- Filtering, sorting, grouping, aggregation
- Pivot tables and cross-tabulation
- Data validation and error reporting

## Output
Provide complete code that:
- Handles encoding issues (UTF-8 BOM)
- Reports parsing errors with row numbers
- Preserves data types correctly
- Includes progress reporting for large files`,

  "image-describer": `When the user provides an image, analyze and describe it in detail.

## What to describe
- Main subject and composition
- Text or labels visible in the image
- Colors, lighting, and visual style
- Technical details if it's a screenshot (UI elements, errors, data)
- Diagrams: describe the structure and relationships

## Output
Start with a one-sentence summary, then provide details relevant to the user's context. If it's a UI screenshot, focus on functional elements. If it's a diagram, explain the flow.`,

  "pdf-reader": `When the user provides a PDF, extract and summarize its content.

## Approach
- Extract text preserving structure (headings, lists, tables)
- Identify document type (report, paper, contract, manual)
- Summarize key points based on document type
- Preserve important data like dates, numbers, names

## Output
1. **Document type**: what kind of document this is
2. **Summary**: 3-5 key takeaways
3. **Extracted content**: structured text from the PDF
4. If the user asks specific questions, answer from the content`,

  "slides-creator": `When the user asks to create slides, generate structured presentation content.

## Rules
- Keep slides focused: one idea per slide
- Use short bullet points (max 6 per slide)
- Include speaker notes with full context
- Follow a logical flow: intro, body, conclusion
- Suggest visuals or diagrams where helpful

## Output format
For each slide provide:
- **Title**: concise slide title
- **Content**: bullet points or key text
- **Notes**: what to say when presenting
- **Visual suggestion**: diagram, chart, or image idea`,
}
