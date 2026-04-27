# Annotate AI

Annotate any element on your WordPress frontend — text, font size, color, copy — and let your AI agent apply the fix via the REST API.

Built for agencies doing design QA on staging before client delivery: structured payloads (selectors, computed styles, `theme.json` preset slugs, breakpoints), a status flow your agent walks through, and a review modal so you can verify the change without leaving the page.

## Description

Annotate AI puts a design-QA toolbar in the WordPress admin bar on the public frontend. Click any element, then either tweak its values directly — text content, font size, color, background, breakpoint — or leave a free-text note for the things structured fields can't capture. Each annotation captures the CSS selector, the element's full computed-styles snapshot, the viewport, and a structured `requested_changes` block, giving an AI coding agent everything it needs to locate the source and apply the fix.

Annotations move through a status flow: **open** → **in_progress** → **done** → **verified**. Pins on the page colour-code the current state — blue when waiting on the agent, yellow while it's working, green when the change is ready for review. Clicking a green pin shows the agent's diff alongside your original ask, so you can verify or send it back for revision without leaving the page.

Pull-based by default: agents poll the REST API on their own schedule. Optional webhook and Telegram notifications are available for push-based integrations.

### Features

- **Point-and-click annotations** — hover to highlight elements, click to annotate
- **Direct manipulation + theme.json presets** — tweak `text`, `font-size`, `color`, `background-color` with controls pre-filled from the element's current values. Pickers source their options from the active theme's `theme.json` so picking "Large" or "Primary" hands the agent a real preset slug, not just a CSS value.
- **Persistent pins with status flow** — pins survive page reloads. Each one carries a status: blue (open), yellow (in progress, agent is working), green (done, review the change), then verified (pin disappears). The QA loop survives across sessions.
- **Review and verify** — clicking a green pin opens a review modal showing your original ask alongside the agent's structured change-log. **Looks good** verifies and clears the pin; **Not quite** sends it back for revision.
- **Live save in None mode** — annotations persist immediately on Add (no separate "Send" step). Edits PATCH the server in place.
- **Batched send in webhook/Telegram modes** — annotate multiple elements, send them all to the agent in one request (one notification per batch, not per annotation).
- **WordPress-native UI** — the toggle lives in the admin bar, the modal and toast use `@wordpress/components`, and styles follow your wp-admin color scheme.
- **Structured payload for agents** — selector, full computed-styles snapshot, the user's deltas (with preset slug when applicable), requested text, viewport size.
- **REST API** — agents fetch open annotations, claim them as in-progress, mark them done with a change-log.
- **Webhook + Telegram** — auto-notify your AI agent on submit (with optional Bearer token auth) or send a Telegram summary.
- **Admin only** — toolbar is only visible to users with `manage_options`.
- **Accessible** — `<Modal>` provides focus trap and ARIA wiring, `<Snackbar>` provides live regions, `@wordpress/components` honour `prefers-reduced-motion`.
- **Translation-ready** — ships with French, German, Spanish, Brazilian Portuguese, Italian, and Japanese translations out of the box.

## Installation

1. Upload the `annotate-ai` folder to `/wp-content/plugins/`
2. Activate the plugin through the **Plugins** menu in WordPress
3. Go to **Tools → Annotate AI** to configure the agent connection (optional)
4. Browse the frontend — an "Annotate" item appears in the WordPress admin bar (or as a floating button if your profile has the toolbar hidden)

> **Letting an AI agent install + configure the plugin?** Point it at [SETUP_FOR_AGENTS.md](SETUP_FOR_AGENTS.md). It's a paste-ready agent prompt with shell commands, the human-in-the-loop step for the Application Password, and the API contract.

### Building from source

```bash
npm install
npm run build
```

After modifying user-facing strings, regenerate translations:

```bash
npm run i18n        # makepot + makemo + makejson
```

The generated `languages/*.json` files only land in the right place after `npm run build` — wp-cli derives JS translation filenames from the path of the built JS, so the build needs to run first.

### Linting

```bash
npm run lint        # Run all linters
npm run lint:js     # ESLint (TypeScript)
npm run lint:css    # Stylelint (CSS + SCSS)
npm run check-types # TypeScript type checking
npm run format      # Auto-format source files
```

## Usage

### For humans (annotating)

1. Visit any page on your site while logged in as an admin
2. Click **Annotate** in the WordPress admin bar to activate annotation mode (the bar item highlights when active). If the admin bar is hidden in your profile, a floating "Annotate" button appears bottom-right instead
3. Hover over elements — they highlight with an outline in your wp-admin theme color
4. Click an element. The modal pre-fills with the element's current values:
   - Edit the **text** content (when the element has only text children)
   - Bump the **font size**
   - Pick a new **text color** or **background**
   - Add **notes** for anything that doesn't fit the structured fields
5. Click **Add** (or **Update** when editing an existing pin)
6. Repeat for as many elements as needed
7. **In None mode** (agent pulls via REST), each annotation is saved live as you go — no separate Send step. **In webhook/Telegram mode**, click **Send** when you're done to dispatch the batch and notify the agent
8. Press **Esc** at any time to exit annotation mode

### For AI agents (actioning)

Annotations move through a status flow: `open` → `in_progress` → `done` → `verified` (or back to `open` if the human says "not quite").

1. **Fetch open annotations:** `GET /wp-json/annotate-ai/v1/annotations?status=open`
2. **Claim it** so the human sees you're working on it (pin turns yellow):
   `PATCH /wp-json/annotate-ai/v1/annotations/{id}` with `{"status": "in_progress"}`
3. **Read the payload:**
   - `selector` / `element_tag` / `element_text` — what was annotated
   - `computed_styles` — full computed-CSS snapshot (context)
   - `requested_changes` — structured deltas, each `{"value": "24px", "preset": "x-large"}`. The `preset` slug is a `theme.json` slug — write to it where possible (block `fontSize` attribute, `theme.json` styles) instead of raw CSS.
   - `requested_text` — new text content for text-only elements
   - `breakpoint` — `"all"` | `"mobile"` | `"tablet"` | `"desktop"`. If anything other than `"all"`, test the fix at that breakpoint (don't just regress at the user's current viewport).
   - `note` — natural-language guidance for anything the structured fields don't cover
4. **Apply the fix** via the WordPress REST API (theme.json, block attributes, customiser CSS, etc.)
5. **Mark done** with a change-log so the human can verify (pin turns green):
   `PATCH /wp-json/annotate-ai/v1/annotations/{id}` with:
   ```json
   {
     "status": "done",
     "resolution_note": "Bumped hero size and tightened header spacing.",
     "changes": [
       { "file": "theme.json", "path": "styles.elements.h2.typography.fontSize", "old": "18px", "new": "24px" }
     ]
   }
   ```
   The human will then click the green pin, review your changes in the modal, and either verify (pin disappears) or send it back to `open` with a follow-up.

### Authentication

All endpoints require the `manage_options` capability. Pick whichever auth fits your agent:

- **Logged-in cookie** — when the agent runs in a browser session (e.g. a script invoked from the wp-admin), `apiFetch` and `fetch` calls inherit the cookie and `X-WP-Nonce` header automatically.
- **Application Password** — for remote agents, generate one under **Users → Profile → Application Passwords** and authenticate with HTTP Basic auth: `Authorization: Basic <base64(user:app_password)>`.
- **JWT or OAuth plugin** — if you already use one, the same Bearer token works.

## REST API

All endpoints require authentication with `manage_options` capability.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/annotate-ai/v1/annotations` | List annotations. Filter: `?status=open` or `?page_url=...` |
| `POST` | `/annotate-ai/v1/annotations` | Create a single annotation (live save in None mode) |
| `POST` | `/annotate-ai/v1/annotations/batch` | Submit a batch of annotations (+ notify agent). Returns the saved annotations with their assigned IDs. |
| `PATCH` | `/annotate-ai/v1/annotations/{id}` | Update any of: `note`, `requested_text`, `requested_changes`, `status` (`open`/`in_progress`/`done`/`verified`), `resolution_note`, `changes` (agent's structured change-log). |
| `POST` | `/annotate-ai/v1/annotations/{id}/resolve` | Legacy alias for `PATCH /annotations/{id}` with `{"status":"done", "resolution_note":"…"}` (sets `status` to `done` and stores the note as `resolution_note`). Prefer the PATCH form. |
| `DELETE` | `/annotate-ai/v1/annotations/resolved` | Delete annotations the human has already verified (status `verified` — also clears any leftover `resolved` from before the new flow). |
| `POST` | `/annotate-ai/v1/settings` | Update plugin settings |

### Annotation object

```json
{
  "id": "uuid",
  "status": "done",
  "timestamp": "2026-04-24T10:00:00+00:00",
  "in_progress_at": "2026-04-24T10:01:00+00:00",
  "done_at": "2026-04-24T10:02:00+00:00",
  "user": "admin",
  "page_url": "https://example.com/",
  "note": "And consider whether the line break is needed",
  "selector": "main > article > h1",
  "element_tag": "h1",
  "element_text": "Latest news",
  "requested_text": "Latest News & Updates",
  "computed_styles": {
    "font-size": "18px",
    "font-weight": "700",
    "color": "rgb(85, 85, 85)"
  },
  "requested_changes": {
    "font-size": { "value": "24px", "preset": "x-large" },
    "color": { "value": "#1a1a1a" }
  },
  "viewport": { "width": 1440, "height": 900 },
  "breakpoint": "all",
  "resolution_note": "Bumped hero size and updated copy.",
  "changes": [
    { "file": "theme.json", "path": "styles.elements.h1.typography.fontSize", "old": "18px", "new": "24px" },
    { "file": "wp_posts/42", "field": "post_content", "old": "Latest news", "new": "Latest News & Updates" }
  ]
}
```

`computed_styles` is the full snapshot at annotation time (context). `requested_changes` carries the user's structured deltas — each entry is `{ value, preset? }` so the agent can prefer a `theme.json` preset slug when one was selected. `requested_text` is set only for text-only elements. `resolution_note` and `changes` are populated by the agent when it transitions the status to `done`.

## Agent Connection

Configure under **Tools → Annotate AI**.

| Method | Description |
|--------|-------------|
| **None** | Annotations are saved to the site as soon as you click Add (no separate Send step). The agent pulls them via REST API on its own schedule. The settings page shows the pull URL and a copy-able instruction snippet for the agent. |
| **Webhook URL** | Annotations are batched as you go and POSTed as a single JSON payload to your URL when you click Send. Supports Bearer token auth. |
| **Telegram** | Same batched flow; a summary message is sent to a Telegram chat via bot. |

> **Treat the webhook URL as a privileged setting.** Anyone with `manage_options` can point it at an internal service (SSRF surface). The plugin does not block private IPs.

### For local development (Claude Code / Codex)

When method is **None**, the settings page shows your site's pull URL and a **Copy agent snippet** button. Click it and paste the snippet into your project's `CLAUDE.md` or your agent's system prompt — it includes the live URL plus the resolve flow:

```
This WordPress site has the Annotate AI plugin installed.

Pull open annotations: GET <site>/wp-json/annotate-ai/v1/annotations?status=open
Each annotation has a CSS selector, computed styles, requested_changes (concrete style deltas to apply), optional requested_text, and a human note.

After fixing, mark resolved:
POST <site>/wp-json/annotate-ai/v1/annotations/{id}/resolve
Body: {"note": "what changed"}
```

## Translations

The plugin ships with bundled translations for:

| Locale | Language |
|--------|----------|
| `fr_FR` | French |
| `de_DE` | German |
| `es_ES` | Spanish (Spain) |
| `pt_BR` | Brazilian Portuguese |
| `it_IT` | Italian |
| `ja` | Japanese |

PHP-side translations (settings page, REST error messages, plugin metadata) work as soon as the plugin is activated and the site language is one of the above. JavaScript-side translations (toolbar, settings UI controls) require the build to be run first so that the JSON files are generated against the right script paths — see _Building from source_.

To add a new locale, copy `languages/annotate-ai.pot` to `languages/annotate-ai-<locale>.po`, translate the `msgstr` entries, then run `npm run i18n`.

## Optimised for block themes

The annotation modal pulls its color palette and font-size scale from the active theme's `theme.json` (via `wp_get_global_settings()`), so when the user picks "Large" or "Primary", the agent receives a real preset slug it can write directly to `theme.json` styles or block attributes — no guessing.

This works best with **block themes** (or any theme with a non-trivial `theme.json`), where the palette and scale reflect the design system. With **classic themes that don't ship a `theme.json`** the modal falls back to WordPress core defaults — the pickers still work and you can pick custom values, but the preset slugs may not map to anything the theme actually consumes. In that case the agent should treat the values as custom CSS rather than preset references.

## Requirements

- WordPress 6.4 or later
- PHP 7.4 or later
- Administrator access (the toolbar is only visible to admins)
- A theme that defines its design system in `theme.json` (block theme or classic theme with a populated `theme.json`) for best preset support — see _Optimised for block themes_ above.

## License

GPL-2.0-or-later. See [LICENSE](https://www.gnu.org/licenses/gpl-2.0.html).
