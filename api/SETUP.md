# Post-Show API — Setup Guide

## Install & Run

```bash
cd api
npm install
npm run dev   # or: npm start
```

The API runs at **http://localhost:4400**.

---

## Environment Variables (`.env`)

Copy `.env.example` to `.env` and fill in each value:

---

### 1. Video Directories

```
VIDEO_SOURCE_DIR=/Users/trevor/Desktop/Recordings
VIDEO_OUTPUT_DIR=/Users/trevor/Desktop/Mayday-Clips
```

- `VIDEO_SOURCE_DIR` — the folder where your raw show recordings live. When you select a file in the Post-Show tool, the API searches here by filename.
- `VIDEO_OUTPUT_DIR` — where cut clips are saved before Drive upload. Created automatically if it doesn't exist.

**Requires ffmpeg installed on your Mac:**
```bash
brew install ffmpeg
```

---

### 2. Google Drive (Service Account)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use an existing one)
3. Enable the **Google Drive API**
4. Go to **IAM & Admin → Service Accounts** → Create a service account
5. Download the JSON key file, save it somewhere safe (e.g. `~/.secrets/google-service-account.json`)
6. Share your Editors Drive folder with the service account email (looks like `name@project.iam.gserviceaccount.com`) — give it **Editor** access
7. Copy the root folder ID from the Drive URL (the long string after `/folders/`)

```
GOOGLE_SERVICE_ACCOUNT_PATH=/Users/trevor/.secrets/google-service-account.json
GOOGLE_DRIVE_ROOT_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
```

---

### 3. Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it "Mayday Post-Show"
3. Go to **Bot** → click **Add Bot** → copy the **Token**
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**
5. Go to **OAuth2 → URL Generator** → check `bot` scope → check `Send Messages` and `Read Message History` permissions
6. Copy the generated URL, paste it in your browser, and add the bot to your Discord server
7. To get a **Channel ID**: right-click the channel in Discord → "Copy Channel ID" (enable Developer Mode in Discord settings first)
8. To get a **User ID**: right-click a user → "Copy User ID"

```
DISCORD_BOT_TOKEN=your-bot-token-here
```

Then in the Post-Show tool **Settings → Recipients**, fill in each person's Discord Channel ID and User ID.

---

### 4. Supabase

Use the **service role key** (not the anon key) — this allows the backend to insert into the database without RLS restrictions.

1. Go to your Supabase project → **Settings → API**
2. Copy **Project URL** and **service_role** key (under "Project API keys")

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...
```

To get your user IDs (for `KANBAN_CREATED_BY_USER_ID` and `ALANA_USER_ID`):
- Go to Supabase → **Authentication → Users**
- Copy the UUID for each user

```
KANBAN_CREATED_BY_USER_ID=your-uuid-here
ALANA_USER_ID=alanas-uuid-here
```

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/videos/cut` | Cut clips from source video using ffmpeg |
| POST | `/api/drive/upload` | Upload cut clips to Google Drive |
| POST | `/api/discord/notify` | Send Discord message to channel + DM user |
| POST | `/api/kanban/sync` | Insert clips into Shorts Queue (Supabase) |

---

## Starting the server

After setup, just run from the `api/` directory:

```bash
npm run dev
```

Keep this running in a terminal tab whenever you're doing post-show work.
