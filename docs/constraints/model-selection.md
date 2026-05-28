# Model Selection UI Constraints

These constraints protect the model picker surfaces from regressing into plain text lists or adding behavior that blocks model selection.

## Scope

Applies to:
- `packages/ui/components/sidebar/ModelSelector.tsx` — global/default model dialog.
- `packages/ui/components/ChatBox/ActionBar.tsx` — composer model popover and trigger.
- Shared model identity helpers such as `packages/ui/components/model/ModelLogo.tsx`.

## Visual identity

- Model selection rows should include a visual model/provider identity, not only text.
- Prefer `@lobehub/icons` for AI/model/provider logos.
- Use `ModelIcon` for model-id-based matching when possible.
- Use `ProviderIcon` for provider fallback when the model id is unknown or custom.
- Unknown/custom models must degrade gracefully to an initials tile; never render a broken or missing icon.
- Keep logos inside a calm rounded tile so color icons work on dark glass surfaces.

## Behavior safety

- Do not add model health probes or availability blocking to the picker. Model list/select should remain fast and selection-focused.
- Do not change model selection semantics when polishing UI:
  - global dialog still calls `middleware_models_set_default` with `${provider}/${id}`.
  - composer popover still delegates to the existing `onModelSelect(model)` flow.
- Do not change middleware/API contracts for visual-only model picker work.
- Preserve existing model cache invalidation behavior on middleware connection changes.

## Layout

- Composer model trigger must remain compact and truncate long model names.
- Popover rows should show: logo, model name, provider/reasoning metadata, and active check.
- Global dialog should make the current/active model visually clear before the searchable list.
- Loading, error, empty, disabled/saving, hover, and active states must stay readable in dark mode.

## Verification

For model picker visual changes, run at minimum:

```bash
pnpm --filter ui exec eslint components/model/ModelLogo.tsx components/sidebar/ModelSelector.tsx
```

Also run `pnpm --filter ui typecheck` when possible. If typecheck is blocked by an unrelated known issue, state the exact blocker.

Manual visual checks should cover:
- footer/global model dialog
- composer model popover
- active model state
- unknown/custom provider fallback
- long model names/truncation
- dark mode hover/focus/active states
