# AISA Activity Hub

> **The Activity Hub has moved** to https://aisa-activity-hub.pages.dev, with a faster server on the school's Supabase project.
> Its code now lives in [AISA-AI-web/AI-Lessons](https://github.com/AISA-AI-web/AI-Lessons) (`activity-hub/`). The pages here only send
> old addresses – activity links, QR codes, the library – to the same page on the new site, so they keep working. The
> Apps Script backend and the Sheet below are kept, read-only, until the move is settled.

Teachers paste HTML from any AI tool or resource (ChatGPT, Gemini, Claude, Canva, …) and get a classroom-ready activity:

- **A unique link for every activity** — students open it on any device, no sign-in needed
- **QR code** — show it full screen on the board, or download it as a PNG
- **Share to Google Classroom** — posts the link as an assignment
- **Download** — every page can save the activity as an `.html` file
- **A shared library** — every activity is saved so other teachers can find, use and remix it, browsable by **grade level**, subject and activity type
- **Automatic tagging** — the tool reads the code and suggests the title, grade level(s), subject, concept and activity type (optionally improved by AI)
- **Teachers only** — creating and browsing require signing in with a school Google account (for now any @aisa.sch.ae account; turn on the teacher list to limit it to staff); students can only open the links they're given

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

The backend is one Apps Script project, deployed twice:

- **Public** (*Who has access: Anyone*) serves activities to anyone with a link, with no sign-in, and answers the website.
- **Teachers** (*Who has access: Anyone within AISA*) is the sign-in. Google signs teachers in with their school account, the script reads their email, checks it (and the Teachers tab, once the teacher list is on), and sends them back to the website signed in. This is Apps Script's built-in single sign-on, so there's nothing to set up in Google Cloud Console.

Use an @aisa.sch.ae account to own the project; "Anyone within AISA" only exists for school accounts.

These steps use [clasp](https://github.com/google/clasp), Google's command-line tool for Apps Script. First turn on **Google Apps Script API** at [script.google.com/home/usersettings](https://script.google.com/home/usersettings). Paste each block as it is: zsh, the default Mac terminal, doesn't treat `#` as a comment.

**Install clasp and sign in** with your school account. The sign-in opens in your browser:

```bash
npm install -g @google/clasp
clasp login
```

**Create the project and upload the code.** `git checkout` puts back our `appsscript.json`, which `clasp create-script` replaces with a blank one:

```bash
git clone https://github.com/AISA-AI-web/code-uploader.git
cd code-uploader/apps-script
clasp create-script --type standalone --title "Activity Hub backend" --rootDir .
git checkout -- appsscript.json
clasp push -f
clasp open-script
```

**Run setup.** In the editor that opens, choose **setup** in the toolbar, click **Run** and approve the permissions. This creates a spreadsheet called *Activity Hub – Activities*, a Drive folder called *Activity Hub – Activity Files*, and adds you as the first admin. The **Execution log** shows links to both.

**Deploy both web apps** from the `code-uploader` folder:

```bash
cd ..
node apps-script/deploy.mjs
```

It prints the Public and Teachers web app URLs. Put them in the website's config (step 3).

**To ship a change to `Code.gs` later**, run the same thing. Both URLs stay the same:

```bash
cd code-uploader
git pull
node apps-script/deploy.mjs
```

If `npm install` fails with `EACCES … _cacache`, fix your npm cache's permissions with `sudo chown -R $(id -u):$(id -g) ~/.npm` and try again.

<details>
<summary>Without the terminal (Apps Script editor only)</summary>

1. At [script.google.com](https://script.google.com) create a project, tick **Project Settings → Show "appsscript.json" manifest file**, and replace `appsscript.json` and `Code.gs` with the files in [`apps-script/`](apps-script/).
2. Run **setup** as above.
3. **Deploy → New deployment → Web app**, with *Execute as: Me* and *Who has access: Anyone*. This is the **Public** URL.
4. **Deploy → New deployment → Web app** again, with *Execute as: Me* and *Who has access: Anyone within AISA*. This is the **Teachers** URL.

After changing `Code.gs`, update each deployment in **Deploy → Manage deployments → ✏️ → Version: New version**, keeping its access setting.
</details>

### 3. Connect the website to the backend

Edit [`assets/js/config.js`](assets/js/config.js) on GitHub and paste both URLs:

```js
apiUrl: 'https://script.google.com/macros/s/AKfy…public…/exec',
signInUrl: 'https://script.google.com/macros/s/AKfy…teachers…/exec',
```

Commit the change. GitHub Pages updates within a minute.

### 4. Add your teachers (optional for now)

**For now the teacher list is off: anyone with an @aisa.sch.ae account can sign in**, students included. Accounts on the Teachers tab still get their name and role (so admins stay admins); everyone else signs in as a teacher, with a name taken from their email.

When you're ready to limit the hub to staff, fill in the **Teachers** tab of the spreadsheet created in step 2, then turn the list on: in Apps Script, **Project Settings → Script properties → Add script property**, `TEACHER_LIST` = `on`. It takes effect straight away, with no redeploy, and anyone not on the tab loses access on their next request, even if they're signed in.

| email | name | role | notes |
|---|---|---|---|
| `jane.smith@aisa.sch.ae` | Ms. Smith | teacher | |
| `it.lead@aisa.sch.ae` | | admin | can edit or delete any activity |

- One row per teacher; you can paste a whole column of emails from your staff list. **name** is optional (it's how they're shown in the library) and **role** is `teacher` (default) or `admin`.
- With `TEACHER_LIST` on, everyone not on this tab is kept out of creating and browsing, including students with @aisa.sch.ae accounts.
- A row like `*@aisa.sch.ae` would let *every* school account in, students included, so don't add one unless students use a different domain.
- Changes take effect within 5 minutes. To apply them immediately, run **`clearCaches`** in the Apps Script editor.
- Removing someone from the list ends their access within 5 minutes (immediately after `clearCaches`), even if they’re signed in.

How sign-in works:

- **Automatic.** Opening Create or Library goes straight to Google's school sign-in. A teacher already signed in to their @aisa.sch.ae account in the browser comes straight back signed in. If your Workspace signs in through another provider (Microsoft, ClassLink, …), Google sends teachers through it as usual. If Google's page shows a **Continue** button, that's one click.
- **Only @aisa.sch.ae accounts.** Google only lets school accounts reach the sign-in page, and the backend refuses any other account even if it's on the Teachers tab. To use a different domain, set the `SCHOOL_DOMAIN` script property.
- **Only rostered teachers, once the list is on.** With `TEACHER_LIST` on, a school account that isn't on the Teachers tab, such as a student's, is told it isn't on the teacher list. Until then, every school account gets in.
- **Students never sign in.** Activity links and QR codes work for anyone, on any device, signed in or not.
- **Signing out** keeps the teacher signed out on that browser until they click **Sign in** again.

That's it — open the site, sign in and paste an activity.

---

## Optional settings (Apps Script → Project Settings → Script properties)

| Property | What it does |
|---|---|
| `SCHOOL_DOMAIN` | The Google Workspace domain teachers must sign in with. Default `aisa.sch.ae`; `any` turns the domain check off (with `TEACHER_LIST` on, any Google account on the Teachers tab). |
| `TEACHER_LIST` | `on` lets only accounts on the Teachers tab sign in. `off` (the default for now) lets any `SCHOOL_DOMAIN` account sign in. |
| `SITE_URL` | The website's address. Sign-in only ever sends teachers back here. Default `https://aisa-ai-web.github.io/code-uploader/`; change it if you move the site. |
| `SESSION_DAYS` | How long teachers stay signed in. Default `7`. |
| `OPEN_MODE` | `true` lets **anyone** create and browse with no sign-in. Only use it for a quick trial. |
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
- Sign-in uses Google's own school sign-in (the Teachers deployment only opens for @aisa.sch.ae accounts), then a session token signed by the backend. The session comes back in the part of the address after `#`, which is never sent to any server, and it is only ever sent to the hub's own address. The school domain, and the teacher list once it's on, are checked on every request.
- Nothing secret is stored in this repository. API keys live only in Apps Script's script properties.

## Customising

- **Names and address:** [`assets/js/config.js`](assets/js/config.js) (`schoolName`, `appName`, and `publicBaseUrl` if you use a custom domain).
- **Colours and fonts:** the tokens at the top of [`assets/css/app.css`](assets/css/app.css) (AISA purple `#21076C`, gold `#D8B664`, DM Sans).
- **Grades, subjects and activity types:** [`assets/js/taxonomy.js`](assets/js/taxonomy.js) **and** the matching lists near the top of [`apps-script/Code.gs`](apps-script/Code.gs). `npm test` fails if they drift apart.

## Development

Requires Node.js 20+. No packages to install.

```bash
npm run dev     # http://localhost:8787 — the real Code.gs running on mocked Google services,
                # with sample activities, a stand-in for Google's school sign-in
                # (teacher@aisa.test, admin@aisa.test)
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
| "Teacher sign-in isn't connected yet" | Put the Teachers URL from `node apps-script/deploy.mjs` in `signInUrl` in `config.js`. |
| "We couldn't tell which Google account you're using" | The Teachers deployment must be *Who has access: Anyone within AISA* (`deploy.mjs` does this) and the project must belong to an @aisa.sch.ae account. |
| Google Drive page: "Sorry, unable to open the file at this time" | The browser is signed in to several Google accounts and the default one isn't a school account. The site already uses the school form of the sign-in address (`script.google.com/a/macros/aisa.sch.ae/…`); if it still happens, sign in from a browser profile or window where the @aisa.sch.ae account is the only (or first) Google account. |
| Google says "You need access" or asks you to switch accounts | You're signed in to Google with a personal account. Switch to (or add) your @aisa.sch.ae account. |
| "… isn't on the teacher list" | `TEACHER_LIST` is on. Add the email (or a `*@domain` row) to the **Teachers** tab, then run `clearCaches` or wait 5 minutes, or set `TEACHER_LIST` to `off` to let every school account in. |
| An activity is blank or partly broken | The preview shows any errors the code reports. The paste checker warns about code that's cut off, references to files that weren't included (`style.css`, `images/…`), and React code that isn't a web page. Ask the AI tool for "one self-contained HTML file". |
