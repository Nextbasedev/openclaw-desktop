# AGENTS.md — Frontend Rules

These rules apply to frontend work in `packages/ui`.

Before coding any UI/frontend change:

1. Inspect the existing design, theme, layout, and nearby components first.
2. Use these skills/workflows before coding UI changes:
   - `frontend` — React/Next/Tailwind frontend patterns
   - `superdesign` — modern UI design guidance
   - `ui-audit` — checks hierarchy, spacing, accessibility, and cognitive load
   - `shadcn-ui` — theme-consistent components, dark mode, forms, and layouts
3. Build with existing components, tokens, CSS variables, Tailwind patterns, and project conventions. Do not introduce random one-off styles unless there is a clear reason.
4. Run typecheck before saying the work is done.
5. For UI changes, verify visually with a screenshot/browser check when possible.
6. Do a quick UI audit before saying “done”: spacing, alignment, responsiveness, hover/focus states, copy, empty/error/loading states, and consistency with the rest of the app.
