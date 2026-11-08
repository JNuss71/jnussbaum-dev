# Trips

## Workflow

```sh
pnpm add -D sharp                    # once

# 1. Put originals in photos-src/<slug>/ (git-ignored), then draft the trip:
pnpm curate:photos iceland           # local checks only, nothing leaves your machine
pnpm curate:photos iceland --ai      # also captions, alt text, day titles (Gemini)

# 2. Edit src/data/trips/iceland.json: location, blurb, diary text, titles.
#    Remove a name from "exclude" to bring a suggested drop back.

# 3. Build the web images, preview, publish:
pnpm build:photos
pnpm dev                             # drafts are visible here
# delete the "draft" line, then commit src/data/trips/, src/data/photos.generated.json
# and public/photos/
```

`--ai` needs `GEMINI_API_KEY` in your shell (the model defaults to
`gemini-3.5-flash-lite`; override with `--model` or `GEMINI_MODEL`). Only resized
1024px copies with all metadata removed are sent, and answers are cached in
`photos-src/<slug>/.curation-cache.json` so re-runs are free. Without `--ai`
nothing touches the network. The script never overwrites an existing trip file
unless you pass `--rewrite` (the old one is backed up first).

## File format

One JSON file per trip. The **file name is the slug** and must match the folder
name in `photos-src/` (e.g. `iceland.json` <-> `photos-src/iceland/`).

You can write these by hand, or let `pnpm curate:photos <slug>` draft one for you
and then edit it.

```json
{
  "title": "Iceland",
  "location": "Ring Road, Iceland",
  "date": "Aug 2025",
  "start": "2025-08-03",
  "draft": false,
  "blurb": "Ten days around the Ring Road.",
  "cover": "DSC01234",
  "captions": { "DSC01234": "Seljalandsfoss at 6am" },
  "alt": { "DSC01234": "A waterfall falling over a cliff into low morning mist" },
  "exclude": ["DSC01299"],
  "entries": [
    {
      "label": "Day 1 · Aug 3",
      "title": "Landing in Keflavík",
      "text": ["First paragraph.", "Second paragraph."],
      "photos": ["DSC01234", "DSC01240"]
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `title`, `location`, `date` | Required. `date` is display text, shown as-is. |
| `start` | Optional ISO date. Trips are sorted newest first by this. |
| `draft` | `true` hides the trip in production builds. It still shows in `pnpm dev`. |
| `cover` | Base file name. Defaults to the first photo. |
| `captions` / `alt` | Keyed by base file name (no extension). `alt` falls back to the caption. |
| `exclude` | Base file names that are never processed or published. |
| `entries` | The photo diary. Photos not listed in any entry go in a final "More" section. |

Photos only appear once `pnpm build:photos` has processed `photos-src/<slug>/`.
