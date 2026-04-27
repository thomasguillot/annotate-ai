# Setup for AI agents

You are an AI coding agent installing **Annotate AI** on a WordPress site so the human can leave point-and-click design feedback for you on the frontend, and you can apply the fixes via the REST API. Follow these steps in order.

Throughout this document, replace `<site>` with the WordPress site URL (e.g. `https://example.com`), `<username>` with the human's WordPress username, and `<app-password>` with the value the human gives you in step 3.

## 1. Install the plugin

```bash
cd wp-content/plugins
git clone https://github.com/thomasguillot/annotate-ai.git
cd annotate-ai
npm install
npm run build
npm run i18n
```

The build produces `build/admin.js`, `build/frontend.js`, and the compiled CSS. The i18n step generates the `.mo` and `.json` translation files so the bundled locales (French, German, Spanish, Brazilian Portuguese, Italian, Japanese) work.

## 2. Activate the plugin

If you have WP-CLI:

```bash
wp plugin activate annotate-ai
```

Otherwise tell the human:

> *"Please activate Annotate AI: go to `<site>/wp-admin/plugins.php` and click **Activate** under Annotate AI."*

## 3. Get an Application Password (HUMAN STEP — required)

You cannot create this for yourself — WordPress requires a logged-in human in a real browser session. Print this verbatim to the human and wait for the response:

> *Please create an Application Password so I can read and resolve your annotations:*
>
> 1. *Open `<site>/wp-admin/profile.php`*
> 2. *Scroll to **Application Passwords***
> 3. *Name: `Annotate AI Agent`*
> 4. *Click **Add New Application Password***
> 5. *Copy the generated password (it has spaces — keep them)*
> 6. *Paste it back here, along with your WordPress username.*

Store the credentials in your local secrets store. Never echo, log, or commit them.

## 4. Verify the connection

```bash
curl -u "<username>:<app-password>" \
     "<site>/wp-json/annotate-ai/v1/annotations"
```

Expected: HTTP 200 with `{"count": 0, "annotations": []}` (or an existing list).

| Response | What it means | What to do |
|---|---|---|
| 200 with JSON | Working. | Proceed to step 5. |
| 401 | Bad credentials. | Re-ask the human for username + Application Password. |
| 404 | Plugin not active or REST API blocked. | Confirm step 2; check `<site>/wp-json/` returns the API root. |
| 403 | The user doesn't have `manage_options`. | Annotate AI is admin-only. Ask the human to check their role. |

## 5. Add the contract to your context

Add the following to your persistent context (e.g. `CLAUDE.md`, `AGENTS.md`, system prompt). Substitute `<site>`:

```
This WordPress site has Annotate AI installed.

POLL: GET <site>/wp-json/annotate-ai/v1/annotations?status=open
Auth: HTTP Basic, base64(username:application-password).

For each annotation:
1. CLAIM IT  → PATCH <site>/wp-json/annotate-ai/v1/annotations/{id}
              Body: {"status": "in_progress"}
2. APPLY THE CHANGE. Fields:
   - selector / element_tag / element_text — what was annotated
   - computed_styles — full CSS snapshot at annotation time (context)
   - requested_changes — explicit deltas, each {"value": "...", "preset?": "..."}.
       If `preset` is present, it's a theme.json slug — write that slug to
       block attributes / theme.json instead of raw CSS.
   - requested_text — new text content for text-only elements
   - breakpoint — "all" | "mobile" | "tablet" | "desktop"; if not "all",
       test the fix at that viewport.
   - note — natural-language guidance for what the structured fields can't capture
3. MARK DONE → PATCH the same endpoint with:
   {
     "status": "done",
     "resolution_note": "Plain English summary of what changed.",
     "changes": [
       {"file": "theme.json", "path": "...", "old": "...", "new": "..."}
     ]
   }

The human will then review your change in a modal on the frontend and either
verify it (status → verified, pin disappears) or send it back to status=open
with a follow-up note for you to retry.
```

The plugin's settings page (`<site>/wp-admin/tools.php?page=annotate-ai`) also has a **Copy agent snippet** button that produces a similar block with the exact site URL pre-filled — you can use either path.

## 6. Start working

The toolbar's default notification method is **None** (agent pulls). Annotations save live as the human creates them, so polling on a reasonable cadence is enough — there's no event/webhook required to start.

If the human wants you to be notified on submit (instead of polling), they can switch the method to **Webhook URL** in the settings page and give you the webhook URL. The webhook payload shape is identical to a `GET` response, just pushed.

## API summary

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`   | `/wp-json/annotate-ai/v1/annotations?status=open` | Your work queue. |
| `GET`   | `/wp-json/annotate-ai/v1/annotations?page_url=<url>` | Annotations for a specific page. |
| `PATCH` | `/wp-json/annotate-ai/v1/annotations/{id}` | Update status, resolution_note, changes, or any of note/requested_text/requested_changes. |

Status flow: `open` → `in_progress` → `done` → `verified`. The human controls `verified` (and can send a `done` back to `open`); you control the first three.

## Troubleshooting after install

- **`requested_changes` is empty but `note` is set** — the human couldn't express the change with the structured fields. Read `note` carefully.
- **`document.querySelector(annotation.selector)` returns null when you load the page** — the page was restructured since the annotation was created. Use `element_text` and surrounding context to locate the right element. The toolbar will automatically hide stale pins, but you'll still see the annotation in the API list.
- **`changes` is `verified` already** — that's a no-op. Skip it.

## Updating the plugin later

```bash
cd wp-content/plugins/annotate-ai
git pull
npm install
npm run build
npm run i18n
```

(The Application Password persists across updates.)
