# Project Rail Constraints

These constraints protect the collapsed left project rail from regressing into noisy hover states or accidental preview opens.

## Visual behavior

- Keep project icons calm by default: no hard hover rings, no heavy borders, and no distracting glow around inactive projects.
- The active project should be identifiable with a subtle rail marker/indicator, not by making every icon look selected.
- The collapsed rail should retain a narrow, stable footprint; visual polish must not widen the chat/sidebar layout unexpectedly.
- The create-project button should read as secondary to existing projects and should not compete with active project state.

## Hover preview behavior

- Hover preview is a convenience affordance, not primary navigation.
- Add/keep a small hover-open delay before starting collapsed preview so normal cursor travel across the rail does not open the project sidebar accidentally.
- Always clear pending hover-preview timers on mouse leave, click/open, and component unmount.
- Clicking a project must cancel any pending preview and switch directly to that project.

## Animation behavior

- Prefer one active indicator with shared/layout animation over per-icon animated borders.
- Keep transition scopes narrow (`background`, `box-shadow`, `transform`) so hover polish does not animate unrelated layout properties.
- Do not reintroduce hover behavior that fights the main sidebar open/close animation path.

## Project creation/edit icon UX

- Create-project flow is emoji-first. Do not reintroduce image upload into the create-project dialog.
- Existing `iconImage` support must remain for backward compatibility and for any older projects that already use uploaded images.
- New project icons use optional `iconEmoji` metadata (`emoji`, optional `label`, optional `color`).
- Rail render priority must stay: `iconEmoji` → existing `iconImage` → generated initial/dot fallback.
- Edit/rename project must allow changing project name, emoji, and emoji background color.
- Emoji picker should default to an `All` view and use vertical scrolling, not Prev/Next pagination.
- Selected emoji rings need inner grid padding so borders are not clipped on the first/last columns.
- Project icon background color should include a neutral black/default option for users who do not want a bright gradient.
- Keep image-upload removal scoped to project creation only; do not remove image rendering or storage elsewhere in the app.
