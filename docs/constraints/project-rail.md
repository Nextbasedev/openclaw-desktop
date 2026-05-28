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
