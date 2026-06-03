# Mayday Broadcast — Stream Deck plugin

Hardware controller for the Mayday Broadcast tool. Ported from Triton's
`com.triton.broadcast.sdPlugin`. Each Stream Deck key maps to one
broadcast asset; press toggles show/hide via the broadcast trigger API.

## Layout

```
streamdeck-plugin/
  com.mayday.broadcast.sdPlugin/
    manifest.json             # plugin metadata + action UUIDs
    bin/plugin.js             # main process (Stream Deck WebSocket client)
    ui/property-inspector.*   # per-button config UI (HTML + JS)
    images/                   # 28x28 / 72x72 / 144x144 PNGs (not committed)
    package.json
```

Images live outside the repo for now (the plugin loads them by relative
path so add them to `images/` before packaging — see "Building").

## Installing locally (development)

1. Copy or symlink `com.mayday.broadcast.sdPlugin/` into
   `~/Library/Application Support/elgato/StreamDeck/Plugins/` (macOS) or
   `%APPDATA%\Elgato\StreamDeck\Plugins\` (Windows).
2. Restart Stream Deck.
3. The "Mayday Broadcast" category will appear in the actions panel.

## Configuring a key

1. Drag a "Toggle Asset" (or other action) onto a key.
2. **Connection**: paste your Mayday base URL (e.g. `https://studio-hub.vercel.app`) and hit "Save connection". This is shared across every key on every profile.
3. **Session ID**: paste the session UUID from the producer console
   header. Press "Load assets" to fetch the project's asset list.
4. **Asset**: pick one and hit "Save button".

The plugin doesn't need any API keys — the session ID itself acts as the
capability token for `/api/broadcast/trigger`.

## Actions

| Action | Behavior |
|---|---|
| Toggle Asset | Toggles the chosen asset's visibility on the active scene. |
| Play Video | Same as Toggle Asset, but rendered with the play/stop icons for clarity. |
| Slideshow Next | Advances the selected slideshow asset (or the currently-visible slideshow if no asset is selected). |
| Slideshow Prev | Same, in reverse. |

## Building a distributable

The Stream Deck CLI's `pack` command turns the `.sdPlugin` directory into
a single `.streamDeckPlugin` file. Install instructions for end-users:
double-click that file. We'll ship a packaged build on each Broadcast
release; the source under `streamdeck-plugin/` is the canonical reference.
