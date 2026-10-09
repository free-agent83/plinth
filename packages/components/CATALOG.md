# Component Index

This index is the first thing an agent (or engineer) should read when working in `@plinth/components`. Each row summarises what a component is for and, critically, what it is **not** for, so you reach for the right tool first time.

For full props, best practices, accessibility notes, and the quality checklist, open the component's sibling `COMPONENT.md` file. For how components sit together on a screen, read `COMPOSITION.md`: every rule there names the token or export it is expressed in.

Components are grouped by **what they are for**, because that is how you choose one. There is no tier system here: every component lives at `src/components/<name>/` regardless of how many parts it has, and composing several of them is not a different kind of thing from using one.

## Actions

| Component | Status | For | Not for |
|-----------|--------|-----|---------|
| Button | stable | The primary action in a section: submitting forms, confirming dialogs, triggering in-place operations. | Navigation to a URL or route. Use a link instead. |
| DropdownMenu | stable | A list of ACTIONS triggered by a button: row overflow menus, account menus, bulk actions. | Picking a form value (Select/Combobox), free-form content (Popover), or a single hint (Tooltip). |

## Forms

| Component | Status | For | Not for |
|-----------|--------|-----|---------|
| Input | stable | Single-line text/number/email entry. | Multi-line text (Textarea), choosing from known options (Select), or boolean state (Checkbox/Switch). |
| Checkbox | stable | A boolean choice in a form: accept terms, multi-select options. | An immediate on/off setting with side effects (Switch), or choosing one of many (radio). |
| Switch | stable | An immediate on/off setting that takes effect at once: dark mode, notifications. | A form value submitted on save (Checkbox), or choosing one of many. |
| Select | stable | Choosing ONE option from a small, known list. | Many options or typeahead (Combobox), multiple selection, or a boolean (Switch/Checkbox). |
| Combobox | stable | Single-select with typeahead over a known, long list (10+): frameworks, assignees, countries. | Short lists (Select), multi-select, free-form/async values, or action lists (DropdownMenu). |
| DatePicker | stable | Picking a single calendar date where the month grid helps: due dates, start dates. | Fast typed dates (birthdays), date ranges, or date+time (pair a time control). |

## Display

| Component | Status | For | Not for |
|-----------|--------|-----|---------|
| Badge | stable | A small, read-only status/category label: order state, severity, a qualifier. | Clickable/removable chips (use a control), or full-sentence messages (use text). |
| Avatar | stable | A person/entity picture with an initials fallback: authors, assignees, member lists. | Brand/product logos (use an img/icon), or a status dot (Badge). |
| Card | stable | A contained, elevated surface grouping a coherent unit: stat tiles, settings panels, summaries. | Separating content on the same plane (use spacing/Separator), or a modal task (Dialog). |
| Table | stable | Presenting rows of tabular data with semantic markup; `numeric` cells for aligned numbers. | Page layout (use grid/flex), or built-in sort/filter/pagination (DataTable). |
| DataTable | stable | A sortable/filterable/paginated table over a `columns`+`data` API: invoices, users, products. | Static rows (Table), or server-scale virtualized grids (use a dedicated data grid). |

## Navigation

| Component | Status | For | Not for |
|-----------|--------|-----|---------|
| Tabs | stable | Switching between peer views of the same subject without navigating: Overview/Activity/Settings. | Separate destinations (use links + URL), sequences (stepper), or 10+ sections. |
| Breadcrumb | stable | Showing location in a hierarchy with one-click routes up it: Home › Reports › Q3. | Flat apps, process steps (stepper), or primary navigation (nav bar/sidebar). |

## Overlays

| Component | Status | For | Not for |
|-----------|--------|-----|---------|
| Popover | stable | Transient, interactive content anchored to a trigger: filter panels, contextual forms. | Non-interactive text hints (Tooltip), action lists (DropdownMenu), or blocking tasks (Dialog). |
| Tooltip | stable | A short, non-interactive text hint on hover/focus: naming icon buttons, clarifying terse labels. | Interactive content (Popover), essential info (put it inline), or action lists (DropdownMenu). |

## Layout

| Component | Status | For | Not for |
|-----------|--------|-----|---------|
| Page | stable | The frame every screen sits in: inset from the viewport by `layout.page.inset`, a content ceiling, the gap between sections, and the page's h1. | A modal task (Dialog), the application chrome (AppShell), or nesting inside another Page. |
| Section | stable | A top-level group inside a Page with its h2; `surface` sits it on the card surface with the section inset. | A single tile or stat (Card), a floating panel (Popover), or spacing two controls (Stack). |
| Stack | stable | Rhythm between things, from the layout scale only: label to control, controls in a group, groups in a section, a row of actions. | Columns that collapse (Grid), separating page sections (Page does that), or a rule (Separator). |
| Grid | stable | Cards, tiles or panels in columns that collapse at a token minimum; responsive by construction. | Tabular data (Table/DataTable), a single column (Stack), or a fixed two-pane frame (AppShell). |
| Separator | stable | A hairline rule dividing related groups: menu sections, toolbar clusters, list blocks. | Lifting distinct units apart (Card), or mere spacing (use whitespace). |
| AppShell | stable | The dashboard frame: collapsible sidebar + sticky header + content region. | The screen inside the frame (Page), marketing/content sites, or a single panel (use a Card). |

## System

Not building blocks for a screen: this group holds what declares a gap in the system itself, not something to compose a screen from.

| Component | Status | For | Not for |
|-----------|--------|-----|---------|
| Missing | stable | Declaring a genuine gap in the design system: a component or token that does not exist and cannot be composed from what does. Keeps the layout honest, and marks the gap in the DOM. Where a product also runs `undrift gate`, it finds the gap by its JSX tag name in source. | Anything that exists or can be composed from existing components and tokens. Compose it instead; it is a declared gap, never shipped UI. |
