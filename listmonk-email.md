# Sending pool emails with listmonk + AWS SES

Short runbook for the next pool. First used for the Thanksgiving Squares final reminder (Nov 2026), after moving off sender.net.

## Why the old sender.net tags break

listmonk renders campaign bodies with Go templates. sender.net tags like `{{unsubscribe_link}}` and `{{unsubscribe_text}}` look like Go function calls, so listmonk fails with:

```
Error compiling template: error compiling message: template: content:141: function "unsubscribe_link" not defined
```

Any `{{ ... }}` in the body must be a real listmonk function. Before pasting an email, search the HTML for `{{` and make sure every hit is one of the tags below.

## Tags that work

| Tag | What it does | Where it goes |
|---|---|---|
| `{{ UnsubscribeURL }}` | Per-subscriber unsubscribe link | Inside an `href` in the footer |
| `{{ TrackView }}` | Open tracking (inserts a 1px image) | Once, right before `</body>` |
| `{{ TrackLink "https://..." }}` | Click tracking for one URL | Inside an `href`, replacing the raw URL |

Examples:

```html
<a href="{{ UnsubscribeURL }}" style="color:#7F8FB3;">Unsubscribe</a>

<a href="{{ TrackLink "https://www.marchmeleepools.com/pool/POOL_ID" }}" target="_blank">Grab My Squares</a>

{{ TrackView }}
</body>
```

Mistakes to avoid:

- `TrackLink` does not turn on tracking for the whole page. It wraps one URL. A bare `{{ TrackLink "..." }}` on its own line prints a tracking URL as visible text.
- `TrackView` outside `<body>` is invalid HTML and some mail clients drop it.
- Do not wrap `{{ UnsubscribeURL }}` in `TrackLink`.
- Tracking only works when **Settings → General → Root URL** is the public listmonk address, not `localhost`. If test-email links point to `localhost:9000`, fix that field and resend the test.

Quick wrap of every https link in a finished HTML file (Git Bash / perl):

```
perl -i -pe 's/href="(https:\/\/[^"]+)"/href="{{ TrackLink "$1" }}"/g; s/<\/body>/{{ TrackView }}\n<\/body>/' email.html
```

Then check: `grep -c 'href="https://' email.html` should print `0`.

## Blank template (so a full-page HTML email stands alone)

The default listmonk template wraps the campaign body in its own header and footer. Our emails are complete pages (`<!DOCTYPE html>` through `</html>`), so they need a template that adds nothing.

1. In listmonk, go to **Campaigns → Templates**.
2. Click **+ New**.
3. **Name:** `Blank`. **Type:** `Campaign`.
4. Body box, delete everything, paste exactly:

   ```
   {{ template "content" . }}
   ```

5. Click **Save**. `Blank` should appear in the template list.

Only needs to be created once per listmonk install.

## Sending a campaign

1. **Campaigns → + New**. Pick the list, subject, from address (must be a verified SES identity).
2. **Template:** `Blank`.
3. **Content → Format:** `Raw HTML`. Paste the whole HTML file.
4. **Save changes**, then **Send test** to your own address.
5. In the test email: click a tracked link (should bounce through the listmonk domain, then land on the pool page), and click **Unsubscribe** (should show a listmonk page, not an error).
6. Both pass → **Start campaign**.

## Email HTML conventions used so far

- Table-based layout, inline styles, 600px max width, Arial.
- Hidden preview-text div at top of `<body>`.
- Board grid is a static snapshot of the live pool page at send time. Re-pull it right before sending or it will show stale open squares.
- Payment line: Venmo `@kevinstruck`, link `https://account.venmo.com/u/Kevin-Struck`, note = name + square count.
