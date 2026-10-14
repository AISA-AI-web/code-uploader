# AISA Activity Hub

Teachers paste HTML from any AI tool or resource (ChatGPT, Gemini, Claude, Canva, …) and get a classroom-ready activity:

- **A unique link for every activity** — students open it on any device, no sign-in needed
- **QR code** — show it full screen on the board, or download it as a PNG
- **Share to Google Classroom** — posts the link as an assignment
- **Download** — every page can save the activity as an `.html` file
- **A shared library** — every activity is saved so other teachers can find, use and remix it, browsable by **grade level**, subject and activity type
- **Automatic tagging** — the tool reads the code and suggests the title, grade level(s), subject, concept and activity type (optionally improved by AI)
- **Teachers only** — creating and browsing require signing in with a school Google account on the teacher list; students can only open the links they're given

The website is static HTML/JS hosted on **GitHub Pages**. The backend is **Google Apps Script**: activity details live in a Google Sheet, the HTML files in a private Google Drive folder.

```
Teacher ──► Create page (GitHub Pages) ──► Apps Script web app ──► Google Sheet (details, teacher list)
                │                                   │                  Google Drive (activity files)
                ▼                                   ▼
        Library (teachers only)          view.html?id=… ◄── students (link / QR / Classroom)
```

---

## Setup

You'll need: a Google Workspace account (the one that will own the data), admin access to this GitHub repository, and about 20 minutes.

### 1. Publish the website (GitHub Pages)

1. In this repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick the branch that holds this code (e.g. `main`) and the **/ (root)** folder, then **Save**.
3. After a minute the site is live at `https://aisa-ai-web.github.io/code-uploader/`.

Until the backend is connected, the site runs in **demo mode**: everything works, but activities are saved only in your own browser.

> GitHub Pages on a free plan needs a public repository. That's fine — the code contains no secrets and no teacher or student data. All data stays in your private Google Sheet and Drive folder.

### 2. Create the backend (Google Apps Script)

1. Go to [script.google.com](https://script.google.com) and click **New project**. Name it *Activity Hub backend*.
2. Open **Project Settings** (⚙️) and tick **Show "appsscript.json" manifest file in editor**.
3. Back in the **Editor**, open `appsscript.json` and replace its contents with [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Open `Code.gs` and replace its contents with [`apps-script/Code.gs`](apps-script/Code.gs). Save.
5. In the toolbar's function menu choose **`setup`**, click **Run**, and approve the permissions.
   This creates a spreadsheet called *Activity Hub – Activities*, a Drive folder called *Activity Hub – Activity Files*, and adds you as the first admin. The **Execution log** shows links to both.
6. Click **Deploy → New deployment**. Choose the type **Web app**, then set:
   - **Execute as:** Me
   - **Who has access:** Anyone
7. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

Why "Anyone"? Students open activities without signing in, and browsers can't send Google sign-in cookies to Apps Script from another site. Access to creating and browsing is enforced by the backend's own teacher sign-in check (step 4). If **Anyone** isn't offered, your Google Workspace admin has turned off sharing outside the school; ask them to allow it for this account.

#### Or do step 2 from the terminal (clasp)

[clasp](https://github.com/google/clasp) is Google's command-line tool for Apps Script. First turn on **Google Apps Script API** at [script.google.com/home/usersettings](https://script.google.com/home/usersettings).

Install clasp and sign in with the school account that will own the data (the sign-in opens in your browser):

```bash
npm install -g @google/clasp
clasp login
```

Create the project and upload the backend. `git checkout` puts back our `appsscript.json`, which `clasp create-script` replaces with a blank one:

```bash
git clone https://github.com/AISA-AI-web/code-uploader.git
cd code-uploader/apps-script
clasp create-script --type standalone --title "Activity Hub backend" --rootDir .
git checkout -- appsscript.json
clasp push -f
clasp open-script
```

In the editor that opens, choose **setup** in the toolbar, click **Run** and approve the permissions. Then deploy the web app:

```bash
clasp create-deployment -d "v1"
clasp list-deployments
```

Copy the long ID on the `@1 - v1` line. Your Web app URL is `https://script.google.com/macros/s/<that ID>/exec`.

To ship a change to `Code.gs` later and keep the same URL, run this from `code-uploader/apps-script`:

```bash
clasp push -f
clasp update-deployment <that ID> -d "v2"
```

Paste these blocks as they are: zsh (the default Mac terminal) doesn't treat `#` as a comment, so don't add notes on the same line. If `npm install` fails with `EACCES … _cacache`, fix your npm cache's permissions with `sudo chown -R $(id -u):$(id -g) ~/.npm` and try again.

### 3. Connect the website to the backend

Edit [`assets/js/config.js`](assets/js/config.js) on GitHub and paste the Web app URL:

```js
apiUrl: 'https://script.google.com/macros/s/AKfy…/exec',
```

Commit the change. GitHub Pages updates within a minute.

### 4. Turn on teacher sign-in (Google single sign-on)

Teachers sign in with **Sign in with Google**, using the same school account they use for Classroom. Set this up once:

1. Go to [console.cloud.google.com](https://console.cloud.google.com), sign in with your school account, and create a project (e.g. *Activity Hub*).
2. Open **APIs & Services → OAuth consent screen** (also called *Google Auth Platform*). Click **Get started**, enter the app name *AISA Activity Hub* and a support email, and choose the audience **Internal**. Internal means only accounts in your school's Google Workspace can sign in at all.
3. Open **Clients → Create client**. Choose **Web application** and, under **Authorized JavaScript origins**, add your site's origin with no path and no trailing slash:
   `https://aisa-ai-web.github.io`
   You don't need a redirect URI. Click **Create** and copy the **Client ID**.
4. In Apps Script, open **Project Settings → Script properties → Add script property**:
   - Property: `GOOGLE_CLIENT_ID`, Value: the Client ID you copied.

How sign-in works:

- **Only @aisa.sch.ae accounts.** Google's account picker shows only school accounts, and the backend refuses any other account (including a personal Gmail) even if its address is on the Teachers tab. It also checks Google's Workspace marker on the account, so a personal account that merely uses a school-looking address can't get in. To use a different domain, set the `SCHOOL_DOMAIN` script property.
- **Only rostered teachers.** A school account that isn't on the **Teachers** tab (for example a student's) is told it isn't on the teacher list.
- **Automatic for returning teachers.** Teachers who are already signed into their school Google account in the browser get in with one click the first time and automatically after that. If your Workspace signs in through another provider (Microsoft, ClassLink, …), Google sends teachers through it as usual.
- **Students never sign in.** Activity links and QR codes work without an account.

### 5. Add your teachers

Open the spreadsheet created in step 2 and go to the **Teachers** tab:

| email | name | role | notes |
|---|---|---|---|
| `jane.smith@aisa.sch.ae` | Ms. Smith | teacher | |
| `it.lead@aisa.sch.ae` | | admin | can edit or delete any activity |

- One row per teacher; you can paste a whole column of emails from your staff list. **name** is optional (it's how they're shown in the library) and **role** is `teacher` (default) or `admin`.
- Everyone not on this tab is kept out of creating and browsing, including students with @aisa.sch.ae accounts.
- A row like `*@aisa.sch.ae` would let *every* school account in, students included, so don't add one unless students use a different domain.
- Changes take effect within 5 minutes. To apply them immediately, run **`clearCaches`** in the Apps Script editor.
- Removing someone from the list ends their access within 5 minutes (immediately after `clearCaches`), even if they’re signed in.

That's it — open the site, sign in and paste an activity.

---

## Optional settings (Apps Script → Project Settings → Script properties)

| Property | What it does |
|---|---|
| `GOOGLE_CLIENT_ID` | Turns on teacher sign-in (step 4). |
| `SCHOOL_DOMAIN` | The Google Workspace domain teachers must sign in with. Default `aisa.sch.ae`; `any` accepts any Google account on the Teachers tab. |
| `SESSION_DAYS` | How long teachers stay signed in. Default `7`. |
| `OPEN_MODE` | `true` lets **anyone** create and browse with no sign-in. Only use it for a quick trial before step 4. |
| `ANTHROPIC_API_KEY` | Turns on AI suggestions using Claude (see below). |
| `CLAUDE_MODEL` | Claude model to use. Default `claude-opus-5-5`. |
| `GEMINI_API_KEY` | Turns on AI suggestions using Google Gemini instead. |
| `GEMINI_MODEL` | Default `gemini-2.5-flash`. Check Google AI Studio for current model names. |
| `AI_PROVIDER` | `anthropic` or `gemini`, if you set both keys. |
| `AI_DAILY_LIMIT` | Maximum AI suggestions per day across the school. Default `400`. |

`SPREADSHEET_ID`, `FOLDER_ID` and `SESSION_SECRET` are created by `setup()` — don't change them. (Changing `SESSION_SECRET` signs everyone out.)

### How grade, subject and concept are detected

As soon as a teacher pastes code, the browser reads it — the title, headings, visible text and the questions inside the scripts — and suggests:

- **Grade level(s)** from explicit mentions ("Grade 4", "3rd grade", "Grades 6–8", "Year 7", "KG2", "Algebra I"), including the chat message the AI tool wrote around the code ("Here's a game for your 3rd grade class"), or else from the concept (fractions → Grades 3–5) and reading level.
- **Subject** and **concept** from a vocabulary of K–12 topics (including Arabic, Islamic Studies and UAE social studies).
- **Activity type** (Quiz, Game, Flashcards, Simulation, Lesson, Worksheet, Tool).

This is free and needs no setup. Teachers see why each suggestion was made and can change anything; their edits are never overwritten.

With an AI key set, a **Check with AI** button appears and AI runs automatically after each paste. Only extracted text is sent (title, headings, visible text, up to about 12,000 characters) — never names or other data about the teacher. Claude requests use structured output, so the answers always fit your grade, subject and type lists, and they opt into Anthropic's server-side fallback if a request is declined. Get a Claude key at [console.anthropic.com](https://console.anthropic.com) or a Gemini key at [aistudio.google.com](https://aistudio.google.com).

---

## Running the hub

**Moderating.** Admins (role `admin`) see **Edit** and **Delete** on every activity. You can also hide an activity directly in the **Activities** tab by changing its `status` from `active` to `hidden`; its link stops working immediately, and it leaves the library within 5 minutes (or run `clearCaches`).

**Where things are.** Each activity is a row in the **Activities** tab and an `.html` file in the *Activity Hub – Activity Files* Drive folder (named `ID – Title.html`). Deleted and replaced files go to the Drive trash, so they can be recovered for 30 days. The Drive folder and spreadsheet stay private to the account that ran `setup()`.

**Updating the backend.** After changing `Code.gs`, go to **Deploy → Manage deployments**, click ✏️, choose **Version: New version**, and **Deploy**. The URL stays the same. Saving the file alone does not update the live web app.

**Quotas.** Apps Script runs every request as the account that deployed it. A Google Workspace account allows up to 30 requests running at the same moment. Activities are cached so each request is fast, and the website automatically retries a failed load once.

## Safety and privacy

- Activity code runs inside a sandboxed frame with no access to the hub, the teacher's sign-in or other activities. Activities that save progress in browser storage still work: each activity's saved data is kept separately on the student's device.
- Every activity is visible to all signed-in teachers, and anyone with an activity's link can open it. Don't put student names or other personal information into activities.
- Sign-in uses Google's ID tokens, verified by the backend, then a signed session token. The teacher list is checked on every request.
- Nothing secret is stored in this repository. API keys live only in Apps Script's script properties.

## Customising

- **Names and address:** [`assets/js/config.js`](assets/js/config.js) (`schoolName`, `appName`, and `publicBaseUrl` if you use a custom domain).
- **Colours and fonts:** the tokens at the top of [`assets/css/app.css`](assets/css/app.css) (AISA purple `#21076C`, gold `#D8B664`, DM Sans).
- **Grades, subjects and activity types:** [`assets/js/taxonomy.js`](assets/js/taxonomy.js) **and** the matching lists near the top of [`apps-script/Code.gs`](apps-script/Code.gs). `npm test` fails if they drift apart.

## Development

Requires Node.js 20+. No packages to install.

```bash
npm run dev     # http://localhost:8787 — the real Code.gs running on mocked Google services,
                # with sample activities, fake sign-in (teacher@aisa.test, admin@aisa.test)
                # and simulated AI suggestions
npm test        # unit tests: backend, auto-tagging, paste clean-up, sandbox
```

`npm run dev -- --demo` serves the site with no backend (demo mode); `--empty` starts with an empty library.
A browser smoke test lives in [`tests/e2e/smoke.mjs`](tests/e2e/smoke.mjs) (instructions at the top of the file).

```
index.html            Create / edit / remix an activity (teachers)
library.html          Shared library with grade, subject and type filters (teachers)
view.html             The activity page students open (link, QR, Classroom)
assets/js/            Page scripts, API client, auto-tagging (classifier.js), paste clean-up and sandbox (code-tools.js)
assets/vendor/        qrcode-generator (MIT) for QR codes
apps-script/          Google Apps Script backend (Code.gs, appsscript.json)
dev/                  Local dev server, Google service mocks, sample activities
tests/                Unit tests (node --test) and the browser smoke test
```

## Troubleshooting

| What you see | What to check |
|---|---|
| "Couldn't reach the activity server" | `apiUrl` in `config.js` is the full URL ending in `/exec`; the deployment's access is **Anyone**; you deployed a **new version** after editing `Code.gs`. Opening the `/exec` URL in a browser should show `"ok": true`. |
| "Teacher sign-in isn't set up yet" | Add `GOOGLE_CLIENT_ID` to the script properties. |
| The Google button shows an error about the origin | The client's **Authorized JavaScript origin** must exactly match the site's origin, e.g. `https://aisa-ai-web.github.io` — no path, no trailing slash. |
| "… isn't on the teacher list" | Add the email (or a `*@domain` row) to the **Teachers** tab, then run `clearCaches` or wait 5 minutes. |
| An activity is blank or partly broken | The preview shows any errors the code reports. The paste checker warns about code that's cut off, references to files that weren't included (`style.css`, `images/…`), and React code that isn't a web page. Ask the AI tool for "one self-contained HTML file". |
