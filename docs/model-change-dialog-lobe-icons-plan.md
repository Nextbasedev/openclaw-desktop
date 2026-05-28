# Model Change Dialog — Lobe Icons Premium UI Plan

## Problem
The current model selection surfaces are text-heavy and feel utilitarian instead of premium.

Current code paths:
- `packages/ui/components/sidebar/ModelSelector.tsx` renders the global/default model dialog opened from `Footer.tsx`.
- `packages/ui/components/ChatBox/ActionBar.tsx` renders the compact per-chat/draft model popover in the composer.
- `packages/ui/hooks/useModels.ts` normalizes models into `{ id, name, provider, reasoning, health }` and tracks the active model.

Current UI limitations:
- Model rows show only model name + provider/reasoning text.
- No provider/model branding, so OpenAI/Claude/Gemini/DeepSeek/etc. all look the same.
- The active model state is subtle; the dialog does not create a strong “selected premium model” feeling.
- `@lobehub/icons` is not installed yet in `packages/ui/package.json`.

## LobeHub Icons Guidance Checked
Read `https://lobehub.com/icons/skill.md` and provider reference.

Relevant usage:
- Install package: `@lobehub/icons`.
- Use React helpers:
  - `ModelIcon` for model-id-based icons: `<ModelIcon model="gpt-4o" size={24} />`
  - `ProviderIcon` for provider-based fallback: `<ProviderIcon provider="openai" size={24} type="color" />`
  - `ProviderCombine` is available but probably too wide for compact rows.
- Provider keys include common providers we use: `openai`, `anthropic`, `google`, `gemini`, `deepseek`, `groq`, `mistral`, `openrouter`, `cerebras`, `xai`, `meta`, `qwen`, `cohere`, `perplexity`, etc.

## Current Flow
### Global/default model dialog
1. `Footer.tsx` opens `ModelSelector`.
2. `ModelSelector` calls `useModels()`.
3. On open, it reloads models and focuses search.
4. Row click calls `middleware_models_set_default` with `${provider}/${id}`.
5. It reloads and closes.

### Composer model popover
1. `ChatBox/ActionBar.tsx` receives `models`, `currentModelId`, loading/error state, and `onModelSelect`.
2. It shows a small trigger with text-only active model label.
3. Popover rows are text-only and call `onModelSelect(model)`.

## Proposed Fix
Make a shared visual model identity layer, then use it in both surfaces.

### 1. Add `@lobehub/icons`
- Add dependency to `packages/ui/package.json` using pnpm.
- Update `pnpm-lock.yaml`.

### 2. Create shared helper component
Add `packages/ui/components/model/ModelLogo.tsx` (or `components/model/ModelIdentity.tsx`).

Responsibilities:
- Accept `model: ModelEntry | { id; provider; name }` and optional `currentModelId`.
- Render a premium rounded icon tile.
- Prefer `ModelIcon` with the actual model id/name.
- Fallback to `ProviderIcon` with normalized provider.
- Final fallback: initials in a subtle gradient tile if LobeHub cannot map the model/provider.
- Keep this client-safe and SSR-safe; avoid dynamic imports unless bundle size becomes a measured issue.

Provider normalization examples:
- `anthropic` / model containing `claude` → `anthropic` or `claude` icon fallback.
- `google` / model containing `gemini` → `google` or `gemini` fallback.
- `openai-responses`, `openai-codex` → `openai`.
- `kimi-coding` / model containing `kimi` → fallback initials if no exact Lobe provider exists.
- `qwen`, `deepseek`, `groq`, `mistral`, `cerebras`, `xai`, `openrouter` map directly where possible.

### 3. Upgrade `ModelSelector.tsx` dialog
Layout direction:
- Header: keep `Switch Model`, but make current model visual: icon tile + model name + provider below.
- Search: keep existing glass input, maybe slightly taller (`h-9`) for premium density.
- Rows:
  - left: logo tile
  - middle: model name, provider badge/reasoning badge
  - right: active check or subtle “Active” pill
- Active row:
  - stronger glass/foreground background
  - thin border/ring
  - check icon remains.
- Empty/error/loading states stay simple and unchanged functionally.

### 4. Upgrade `ActionBar.tsx` model popover
Keep it compact but branded:
- Trigger: small model/provider logo before `modelLabel`.
- Popover rows: logo + model name + provider/reasoning metadata + active check.
- No big dialog redesign here; just align identity visuals with the main dialog.

### 5. Keep behavior unchanged
No middleware/API changes.
No model health checks.
No change to model selection semantics.
No schema/storage changes.

## Files to Change
- `packages/ui/package.json` — add `@lobehub/icons` dependency.
- `pnpm-lock.yaml` — lockfile update.
- `packages/ui/components/model/ModelLogo.tsx` — new shared icon/identity component.
- `packages/ui/components/sidebar/ModelSelector.tsx` — premium dialog rows/current model header.
- `packages/ui/components/ChatBox/ActionBar.tsx` — branded trigger/popover rows.
- Optional: `packages/ui/components/model/modelIconMapping.ts` if provider normalization gets too large for the component.

## Risks
- Bundle size: `@lobehub/icons` has many icons, but documented React components/helpers are tree-shakable. Verify build size only if it noticeably slows build.
- Unknown providers/models: must degrade gracefully to initials, not broken icons.
- Dark mode contrast: color icons need a calm tile/background so they work on dark glass surfaces.
- Duplicate model names: existing de-dupe by lowercase name remains; do not alter unless specifically requested.
- Composer popover width: logo + labels must not overflow; use truncation and keep width reasonable.

## Testing
Minimum checks:
- `pnpm --filter ui typecheck`
- targeted eslint for changed files, e.g. `pnpm --filter ui exec eslint components/sidebar/ModelSelector.tsx components/ChatBox/ActionBar.tsx components/model/ModelLogo.tsx`
- `pnpm --filter ui build` if dependency/import behavior needs full validation.

Manual/visual checks:
- Open footer model dialog; verify current model header, search, rows, active state.
- Open composer model popover; verify trigger and rows with logos.
- Test providers/models: OpenAI, Claude/Anthropic, Gemini/Google, DeepSeek, Groq, unknown/custom.
- Verify dark mode, hover, disabled/saving, loading, error, no-results.

## Implementation Order
1. Install dependency.
2. Add `ModelLogo` helper with graceful fallback.
3. Update `ModelSelector` rows/header.
4. Update `ActionBar` trigger/popover.
5. Run checks and visual audit.
6. If UI looks good, commit on a dedicated branch and open/update PR.
