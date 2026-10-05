# Payroll Online · Crystal FM

Replaces the monthly and fortnightly payroll Excel files with a website everyone can use at the same time.

* **Website** – plain HTML/JS in this repo, hosted free on **GitHub Pages**. No build step.
* **Database + logins + live sync** – **Supabase** (Postgres). The Excel data lives *there*, never in GitHub.
* Change a number and **everyone sees it immediately**; every change is logged (who, when, old → new).

## What you can do

| Page | What it is for |
|---|---|
| **Dashboard** | Gross, budget and difference for a pay run, split by pay date (24th, 25th, 26th, 28th, 29th, LWD, 5th). Biggest over/under spends. |
| **Payroll** | The old "Detailed" sheet. Filter by pay date, project, status, week chips. Click any highlighted cell to edit. Click a name for the full line (weekly figures, day-by-day hours, notes, history). Export CSV. |
| **Hours explorer** | Pick **any** dates (a day, a week, a pay window, anything) and group by employee / project / site / week / day / pay date. |
| **Pay calendar** | The reconciliation window for each pay date. These change every month – set them here once. |
| **Import files** | Drop the monthly (.xlsm) or fortnightly (.xlsx) file whenever you like. It shows a preview and checks the maths against your Excel before saving. Re-import a corrected file with *Replace*, or add only missing rows. |
| **Projects** | Pay date and manager per project, plus aliases for projects spelled differently in different files. |
| **History** | Who changed what. (Editors and admins.) |
| **Users** | Roles. (Admins.) |

**Roles:** *Viewer* reads everything · *Editor* also edits, imports, sees history · *Admin* also manages users and deletes a pay run.

---

## Setup (about 20 minutes, once)

### 1. Create the database (Supabase)
1. Sign up at <https://supabase.com> → **New project**. Pick the **London** region, set a strong database password and keep it somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**. (Safe to run again later.)
3. **Authentication → Providers → Email**: switch **off** *Allow new users to sign up* – only people you invite can get in.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### 2. Point the website at it
Edit [`js/config.js`](js/config.js) and paste those two values. (The anon key is meant to be public – the data is protected by login and the row-level-security rules in `schema.sql`.)

### 3. Publish on GitHub Pages
1. Create a GitHub repository and push this folder to it.
   *(The repo holds only code. A private repo needs a paid GitHub plan to use Pages; a public repo is fine because it contains no payroll data.)*
2. Repo **Settings → Pages → Build and deployment**: *Deploy from a branch* → `main` → `/ (root)` → Save.
3. After a minute the site is live at `https://<your-account>.github.io/<repo>/`.
4. Back in Supabase: **Authentication → URL Configuration** → set **Site URL** to that address (and add it under *Redirect URLs*). This makes invite and password-reset emails land on your site.

### 4. Add people
**Authentication → Users → Invite user.** Invite **yourself first** – the first person to sign in automatically becomes **Admin**. Everyone after that starts as Viewer; change roles on the **Users** page.

### 5. Load your data
Sign in → **Import files** → drop `September_Monthly_2026.xlsm` and the fortnightly file. Check the preview, name the run, press **Import**.

---

## How the pay is calculated

Everything calculated lives in one database view (`v_payroll_lines` in `schema.sql`) so there is a single source of truth. It reproduces your Excel:

* **Actual hours** = sum of the weekly worked hours · **Leave hours** = sum of weekly leave hours
* **Over / Less hours** = sum of positive / negative weekly variances (worked + leave − budget), for weeks inside the pay window
* **Hourly pay** = (actual + leave) × rate, for **Hourly** and **Cover** contracts (other types: 0)
* **Gross pay** = fixed pay + hourly pay + leave pay + addition − deduction
* **Budgeted pay** = fixed pay if set, otherwise budget hours × rate (monthly: weekly budget × weeks reconciled; fortnightly: the two weekly budgets)
* **Difference** = gross − budgeted · status Over / Under when more than 50p out

A variance that someone typed over by hand in Excel is kept and shown with a ⚑ (click it in the line panel to switch back to the calculated value).

**Proven on your September files:** 1,160 monthly lines → gross **£357,560.32** and 344 fortnightly lines → **£84,424.40**, identical to the Excel totals, line by line. The only differences are 5 lines where the Excel has a budget typed over a formula; the import preview lists them.

## Keeping it safe
* Payroll data includes **NI numbers** – it is personal data. It only ever sits in Supabase; `.gitignore` stops spreadsheets being committed. Never put the Excel files in the repo.
* Supabase's **free plan pauses a project after a period of inactivity and has no automatic backups**. For real payroll use, choose a paid plan (daily backups) – check current plan details on supabase.com.
* Turn on two-step verification on your Supabase and GitHub accounts.
* Editors can overwrite data; the **History** page records every change, and re-importing a month never loses the previous state silently (it is logged).

## Not built yet (natural next steps)
* Import **Blip hours** and **Absences** so the weekly totals are calculated automatically instead of arriving from Excel formulas.
* Export in the original Excel layout, for anyone who still wants it.
* Ability to lock a pay run once payroll is submitted.

## Tests (optional, for whoever maintains it)
```bash
npm install
npm run test:maths   -- path/to/September_Monthly_2026.xlsm path/to/Fortnightly.xlsx   # new maths = Excel
npm run test:db      -- path/to/September_Monthly_2026.xlsm path/to/Fortnightly.xlsx   # schema, security, audit (in-memory Postgres)
npm run test:browser -- path/to/September_Monthly_2026.xlsm path/to/Fortnightly.xlsx   # drives the site in Chromium (needs: pip install playwright && playwright install chromium)
```

## Folder map
```
index.html            the page
css/style.css         look and feel
js/config.js          ← your Supabase URL + key
js/app.js             login, navigation
js/api.js             all database calls, live sync, the import pipeline
js/parsers.js         reads the monthly + fortnightly Excel formats
js/calc.js            the pay maths (mirrors the database view; used for the import preview)
js/pages/*.js         one file per screen
supabase/schema.sql   tables, security, audit trail, calculations
tests/                maths, database and browser tests
```
