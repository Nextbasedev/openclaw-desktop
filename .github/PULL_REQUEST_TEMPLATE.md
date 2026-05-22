## Summary
<!-- What does this PR do? Keep it concise. -->

## Changes
<!-- List the key changes. Use bullet points. -->

## Constraints Checked
<!-- Which docs/constraints/* files are relevant? Did you verify against them? -->
- [ ] `docs/constraints/middleware.md` — if touching middleware routes, limits, error handling
- [ ] `docs/constraints/chat-engine.md` — if touching message ordering, dedup, history, streaming
- [ ] `docs/constraints/ui-scroll.md` — if touching scroll behavior, layout effects
- [ ] `docs/constraints/sessions.md` — if touching session sync, imports, window isolation
- [ ] `docs/constraints/gateway.md` — if touching gateway protocol, events, timeouts

## Verification
<!-- How did you verify this works? -->
- [ ] `pnpm --filter <package> typecheck`
- [ ] `pnpm --filter <package> test`
- [ ] `pnpm --filter <package> build`

## Lessons
<!-- Did this fix a bug? Add a lesson to docs/lessons/README.md -->
