# Editor Sidebar — Feature Specification

## Overview

The editor plugins sidebar (`<editor-plugins-panel>`) provides navigation between editor plugins within `<oscd-shell>`. It supports expanded and collapsed states, plugin groups, pinning, search, keyboard shortcuts, and breadcrumb context.

---

## 1. Expandable / Collapsible Sidebar

**Collapse/expand toggle.** The sidebar has an `expanded` boolean property (reflected as an attribute). A toggle button at the bottom of the panel switches between expanded (full-width) and collapsed (icon-only) states.

- **Expanded**: 320px wide (`--editor-plugins-panel-width`). Displays plugin icons, names, pin buttons, group headers, search bar, and collapse-all button.
- **Collapsed**: 72px wide (`--editor-plugins-panel-collapsed-width`). Displays only plugin/group icons. Hovering a collapsed group icon shows a popup listing its plugins.

**Persistence.** The expanded state is persisted to `localStorage` under key `editorsPanel.expanded`. On change, a `panel-expanded-change` custom event is dispatched (bubbles, composed) with `{ detail: { expanded } }`, allowing the host shell to react (e.g. show breadcrumbs, adjust layout).

---

## 2. Plugin Groups

Editors may be organized into named groups via `PluginGroup` objects in the `plugins.editor` array. A group has `name`, `icon`, optional `translations`, and a `plugins` array of child `PluginEntry` items.

**Expanded rendering.** Group headers are clickable rows showing the group icon, name, and a chevron (`expand_more` / `expand_less`). Clicking toggles collapse state, persisted per group in `localStorage` under `editorsPanel.collapsedGroups` (a JSON-serialised `Set`).

**Collapsed rendering.** When the sidebar is collapsed, each group shows only its icon. If the active plugin belongs to the group, the group icon and active plugin icon are both displayed. Hovering a collapsed group shows a popup with the group's plugins; clicking any popup item selects it and expands the sidebar.

### Collapse-All Button

A toolbar button between the search row and the pinned section toggles all groups (and the pinned section) between collapsed and expanded. Pressing it when all are collapsed expands all; pressing when any are expanded collapses all.

---

## 3. Pinned Plugins

Users can pin frequently-used plugins to the top of the sidebar, above all groups.

- **Pin/unpin.** Each plugin item has a `push_pin` icon button (filled when pinned). Toggling updates a `Set<string>` persisted in `localStorage` under `editorsPanel.pinnedPlugins`. Pin keys are `${plugin.name}||${plugin.tagName}`.
- **Pinned section.** Pinned plugins render in a collapsible "Pinned" group at the top, with the same header/chevron UI as regular groups. Its collapse state is persisted under `editorsPanel.pinnedCollapsed`.
- **Collapsed sidebar.** When collapsed, the pinned section shows the push_pin group icon. If the active plugin is pinned, both the group icon and the active plugin icon appear.

---

## 4. Search Bar

A search input with a magnifying-glass icon and a clear (`×`) button appears in the toolbar at the top of the sidebar (expanded view only).

**Fuzzy matching.** The `matchesSearch(label, query)` static method tokenises both label and query on `[\s\-_/]+`, then checks:
- exact substring match, or
- substring of length `query.length` with Levenshtein distance ≤ 1, or
- substring of length `query.length + 1` with Levenshtein distance ≤ 1.

The `levenshteinAtMost1(a, b)` method computes this with an early-exit optimised single-row DP.

**Group matching.** When the group *name* matches the search query, all children of that group are shown. When only individual plugins match (not the group name), only those matching plugins are shown inside the group.

**Behaviour during search.**
- The pinned section is hidden.
- All matching groups are force-expanded (their collapsed state is overridden).
- Selecting a plugin clears the search query.
- The search input supports Arrow Up/Down to navigate results and Enter/Space to confirm selection.

---

## 5. Breadcrumbs (Collapsed Sidebar)

When the sidebar is collapsed and an editor is active, the host `<oscd-shell>` renders a breadcrumb trail in the `<oscd-app-bar>` `alignStart` slot:

- If the active editor belongs to a group: **"Group Name › Plugin Name"**
- If ungrouped: **"Plugin Name"**

These are computed by `breadcrumbGroupName` and `breadcrumbPluginName` getters on `<oscd-shell>`, which walk the `editors` array with `flatIndex` tracking.

---

## 6. Keyboard Shortcuts (Two-Step)

**Level 1 — Ctrl held.** Holding Ctrl shows letter badges (A–Z, skipping F which is reserved) on:
- Group headers (first letter of group name, deduplicated)
- Pinned section header
- Ungrouped plugins

**Level 2 — Group selected.** Pressing a group/pinned letter enters number-input mode:
- The sidebar expands if collapsed (tracked via `_wasCollapsedForShortcut`).
- Number badges (1, 2, 3…) appear on plugins within that group.
- Digits accumulate (allowing multi-digit numbers for 9+ plugins).
- Auto-confirms after 600ms of inactivity, or immediately on Enter.
- Escape or any non-digit key cancels and resets.
- Releasing Ctrl does **not** cancel in number-input mode (only releases cancel level 1).

**Shortcut cancellation:**
- Ctrl release cancels level 1 (unless in number-input mode).
- Click outside the panel cancels all.
- Escape cancels all.

**Ctrl+F.** Reserved for search focus. If the sidebar is collapsed, it expands first (tracked via `_wasCollapsedForSearch`). After expansion, `await this.updateComplete` is called before focusing the input. On plugin selection, the sidebar collapses back. On Escape in the search input, the sidebar collapses back and the input blurs.

---

## 7. Arrow Key Navigation

The sidebar plugin list supports keyboard navigation independent of the active (selected) plugin.

**Focused item.** A `focusedItem` state tracks which element has keyboard focus. It is one of:
- `{ kind: 'plugin', plugin, flatIndex }` — a leaf plugin
- `{ kind: 'group', groupName }` — a collapsed group header (or the pinned section header when collapsed)
- `{ kind: 'pinned' }` — the collapsed pinned section

**Visible navigable items.** The `visibleNavigableItems` getter computes the current flat list of focusable items:
- Expanded groups contribute their individual plugins.
- Collapsed groups contribute a single `group` entry.
- A collapsed pinned section contributes a single `pinned` entry.
- An expanded pinned section contributes its individual plugins.
- In search mode, only plugins matching the search query are included (or all plugins if the group name matches).

**Arrow Up/Down.** Moves `focusedItem` through `visibleNavigableItems`, wrapping around. The focused item receives a `plugin-item--focused` or `group-header--focused` CSS class (2px outline) and is scrolled into view.

**Enter/Space.**
- On a **plugin**: selects it (dispatches `editor-select`, clears search, clears focus).
- On a **collapsed group**: expands it and moves focus to the first plugin inside.
- On a **collapsed pinned section**: expands it and moves focus to the first pinned plugin.

**Escape.** Clears `focusedItem`.

**Sources.** Arrow key handling works from:
- The editors-list `div[@keydown]`.
- The search input `@keydown` (Arrow Up/Down navigate, Enter/Space confirm, Escape clears search and blurs).

---

## 8. Loading Indicator

When switching editors, a spinner overlay appears in the editor container while the new plugin loads.

- A `MutationObserver` watches the plugin element's shadow DOM for child nodes.
- A 2-second fallback timeout ensures the spinner disappears even if the observer never fires.
- Triggered via `updated()` on `editorIndex` / `editor` property changes.
- The spinner is a CSS-animated 36px circle with `border-top-color` accent.

---

## 9. Design Tokens

Key CSS custom properties (defaults in `oscd-shell-design-tokens.ts`):

| Token | Default | Purpose |
|-------|---------|---------|
| `--editor-plugins-panel-width` | 320px | Expanded sidebar width |
| `--editor-plugins-panel-collapsed-width` | 72px | Collapsed sidebar width |
| `--editor-plugins-panel-item-active-bg` | `--oscd-primary` | Active plugin background |
| `--editor-plugins-panel-group-active-bg` | `--oscd-secondary` | Active group indicator |
| `--oscd-shell-editor-breadcrumb-color` | `--oscd-secondary` | Breadcrumb text colour |

---

## 10. Data Model Additions

**`PluginGroup`** — input type for grouping editors:
```ts
{ name: string; translations?: Translations; icon: string;
  requireDoc?: boolean; plugins: (PluginEntry | SourcedPluginEntry)[]; }
```

**`ResolvedPluginGroup`** — after sourced plugins are loaded:
```ts
{ name: string; translations?: Translations; icon: string;
  requireDoc?: boolean; plugins: PluginEntry[]; }
```

**`EditorPluginEntry`** = `PluginEntry | ResolvedPluginGroup`

**`isPluginGroup(x)`** — type guard checking for `plugins` array property.

**`flattenEditors(editors)`** — flattens `EditorPluginEntry[]` to `PluginEntry[]` for indexed access.

**`loadEditorPlugins(arr, registry)`** — resolves `PluginGroup` entries and sources within editor arrays.