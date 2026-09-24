# CMRCET Hackathon Portal

A live list of real hackathons for CMRCET students and management, replacing the whiteboard.
Events are imported automatically from **Unstop, Devfolio, Hack2Skill and Devpost** twice a day.
Staff can add more events, and students can suggest them.
Hyderabad events are listed first, then the rest of Telangana, other states, and virtual events.

## Project structure

```
cmrcet-hackathons/
├── index.html                     # The whole web app: HTML, CSS and JavaScript in one file
├── config/
│   ├── app.config.json            # Firebase web config (public, safe to commit)
│   └── app.config.example.json
├── firebase/
│   ├── firestore.rules            # Security rules: who can read/write what
│   └── firestore.indexes.json
├── firebase.json                  # Tells the Firebase CLI where the rules are
├── data/
│   ├── settings.json              # Initial portal settings (college, domain, priority cities, import options…)
│   └── roles.json                 # Starting admins / coordinators
├── scripts/                       # Node.js tools (never deployed)
│   ├── seed.mjs                   # One-time: writes settings + roles to Firestore
│   ├── import-events.mjs          # Pulls real hackathons into Firestore
│   ├── sources/                   # One file per platform
│   │   ├── unstop.mjs
│   │   ├── devfolio.mjs
│   │   ├── hack2skill.mjs
│   │   └── devpost.mjs
│   └── lib/                       # Shared helpers (Firebase, fetch, dates)
├── .github/workflows/
│   └── import-events.yml          # Runs the importer at 06:00 and 18:00 IST
├── .gitignore
└── .vercelignore                  # Only index.html + config/ are deployed
```

Nothing college-specific is hard-coded in the app. The college name, email domain, priority cities,
departments, team size, time zone and import options live in Firestore (`settings/public`), and
admins edit them on **Admin → Settings**.

## How events get in

| Source | How | Visible to students |
|---|---|---|
| Unstop / Devfolio / Hack2Skill / Devpost | `import-events.mjs`, twice a day via GitHub Actions | Immediately, or after approval if *Publish imported events immediately* is off |
| Staff | **Add event** button | Immediately |
| Students | **Suggest** page | After a coordinator reviews it |

Importer rules:
- Only open or upcoming events. In-person events must be in `importCountry` (India). Online events are always kept.
- The same event listed on two platforms is imported once.
- **Staff edits are never overwritten.** Once staff edit an imported event, the importer leaves it alone.
- To remove an imported event, click **Hide**. Deleting it would bring it back on the next import.
- **Hack2Skill** does not publish venues. Its in-person and hybrid events always wait in **Admin → Approvals**
  with a note. Click **Edit & publish**, set the city and state, and save.

### Health check
Every run checks each enabled platform. A source is **unhealthy** if it errors, returns no events, or returns
mostly unusable data (usually a sign that the platform changed its API).

- Healthy sources are still imported. The run then **fails**, so GitHub emails you, and the
  run page shows a table of which source broke and why.
- **Admin → Approvals** shows the last import time and each source's status. It warns if no import has
  run for `importStaleHours` (GitHub pauses scheduled workflows after 60 days without repository activity).
- To fix a broken source, edit its file in `scripts/sources/` and run `npm run import:preview` to check it.

## Features

| Area | What it does |
|---|---|
| Sign-in | Google sign-in, only `@cmrcet.ac.in` accounts (checked in the app **and** in the security rules) |
| Events | Region tabs, search, status/mode/year filters, live deadlines and countdowns, source platform |
| Teams | Students register teams with roll numbers. Coordinators verify them and record results. |
| Board | Full-screen TV view that looks like the old whiteboard, updates live and scrolls automatically |
| Admin | Approvals, team verification, event management (publish, hide, pin, edit), roles, settings, Excel export |

Roles: **Admin** (everything), **Coordinator** (events, teams and approvals), **Student** (everyone else).

---

## Setup (one time)

### 1. Firebase Console
1. **Authentication → Sign-in method → Google → Enable.**
2. **Firestore Database → Create database**, location `asia-south1`, production mode.
3. **Project settings → Your apps → Web app (`</>`)**, then copy the config into `config/app.config.json`.
4. **Project settings → Service accounts → Generate new private key.** Save the file as
   `scripts/service-account.json`. It is git-ignored. **Never commit or share it.**

### 2. Deploy the security rules
```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore --project YOUR_PROJECT_ID
```
Instead, you can paste `firebase/firestore.rules` into **Firestore → Rules** and click Publish.

### 3. Load settings and import real events
```bash
cd scripts
npm install
npm run seed          # settings + first admin
npm run import        # pulls live hackathons (takes about 1–2 minutes)
```
`npm run import:preview` shows what would be imported without writing anything.

### 4. Run locally
```bash
npx serve .
```

### 5. Deploy
1. Push to GitHub.
2. **Vercel → Add New → Project**, pick the repo, keep the defaults (no build command), and deploy.
3. Add the Vercel domain under **Firebase → Authentication → Settings → Authorized domains**.
4. For automatic imports, go to **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**.
   Name it `FIREBASE_SERVICE_ACCOUNT` and paste the **entire contents** of `service-account.json` as the value.
   You can run it any time from **Actions → Import hackathons → Run workflow**.

---

## Firestore collections

| Collection | Contents |
|---|---|
| `settings/public` | Portal configuration |
| `roles/{email}` | `{ role: "admin" \| "coordinator" }` |
| `users/{uid}` | Student profile: name, roll number, department, year |
| `events` | Hackathons. `visibility`: `published` / `pending` / `hidden`. `source`: `manual`, `suggestion`, `unstop`, `devfolio`, `devpost` |
| `teams` | Team registrations (`pending` → `verified` / `rejected`, plus result) |
| `suggestions` | Events suggested by students |
| `status/import` | Result of the last import run (staff only) |

## Adding another platform
Create `scripts/sources/<name>.mjs` exporting `{ key, label, fetch }`, where `fetch` returns events in the
same shape as the existing sources. Then add it to `SOURCES` in `import-events.mjs` and add a label in
`SOURCES` in `index.html`.
