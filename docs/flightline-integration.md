# Flightline Dashboard and login

The `/flightline` route now uses the Mayday session for shared Flightline projects,
project creation and footage uploads. `/radar` remains an alias for existing links.
The Mac app download appears only when a published release URL is configured.
The editor opens the Terminal with the same Mayday identity through a PKCE handoff.
Flightline grants are independent of Mayday's suite-admin gate.

Frontend configuration:

- `REACT_APP_FLIGHTLINE_SERVICE_URL`: provisioned HTTPS service origin, no path.
- `REACT_APP_FLIGHTLINE_DOWNLOAD_URL`: signed/notarized Mac package HTTPS URL.

The production service URL is now `https://trevors-mac-studio.taildee51f.ts.net`.
The host uses **public Funnel**, so the editor needs no Tailscale software or
network account. The Dashboard was deployed and promoted on September 22.
The notarized universal Mac release is now published at
`https://www.maydaystudio.app/downloads/flightline/0.1.0/Flightline-macos-universal.zip`
with an adjacent `.sha256` checksum. Production `REACT_APP_FLIGHTLINE_DOWNLOAD_URL`
is set to this URL; the Download for Mac button is enabled. Requires macOS 15+.
Deployment `studio-aquj2dopj-trevor-mays-projects.vercel.app` was promoted on
September 22 after release checks and seven Flightline tests passed.
The live ZIP's checksum matches the notarized local artifact. The user confirmed
the native app works on the test Mac after connecting to the correct network.
The gateway is bandwidth-limited and still requires the off-site editor trial.

The complete authentication contract, pilot grants, service configuration and
remaining deployment checks live in the companion Flightline checkout at
`docs/MAYDAY_STUDIO.md`.

No Mayday database migration or new Mayday password store is needed. Flightline
validates the existing Mayday Auth session and checks an explicit pilot grant on
its own backend. New routing does not grant contractor accounts Mayday admin access.

## Native app updates

Starting with 0.1.1, the connected app uses signed Sparkle updates. The dashboard's
production download URL is the permanent
`https://www.maydaystudio.app/downloads/flightline/latest/Flightline-macos-universal.zip`.
The companion `tools/stage_service_release.py --site PATH` stages the verified
versioned ZIP, signed appcast, `latest.json`, and Vercel redirect in one change.
Deploying that change advances both the app updater and dashboard download; no
per-release environment variable change is needed. Versioned ZIPs stay immutable.
Dynamic release endpoints disable caching. The 0.1.0 app needs one manual upgrade
to gain the updater; subsequent versions can update inside the app.
See Flightline's `docs/APP_UPDATES.md` for signing and release instructions.
