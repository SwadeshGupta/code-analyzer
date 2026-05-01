# Code Analyzer Extension — Setup Guide
## Complete instructions for Firefox + FastAPI (local dev)

---

## Final Project Structure

```
code-analyzer-extension/
│
├── manifest.json          ← MV2, Firefox-specific
├── background.js          ← Event page, uses browser.* API
├── content.js             ← Code scraper + injected UI
├── content.css            ← Floating button + modal styles
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── main.py                ← FastAPI backend
├── requirements.txt
└── .env                   ← You create this (see Step 1 below)
```

---

## Part A — Backend Setup

### Step 1 — Create your .env file

In the project root, create a file named `.env` (NOT `.env.example`):

```
GROQ_API_KEY=gsk_your_actual_key_here
```

Get your free API key at: https://console.groq.com
- Sign up → API Keys → Create API Key
- Copy the key starting with `gsk_`

---

### Step 2 — Create a Python virtual environment

```bash
# Navigate to your project folder
cd code-analyzer-extension

# Create venv
python3 -m venv venv

# Activate it
# On Linux / macOS:
source venv/bin/activate

# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
```

---

### Step 3 — Install dependencies

```bash
pip install -r requirements.txt
```

This installs: `fastapi`, `uvicorn`, `groq`, `pydantic`, `python-dotenv`.

---

### Step 4 — Start the FastAPI server

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**Expected output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Application startup complete.
```

**Verify it's working** — open your browser and visit:
```
http://127.0.0.1:8000
```
You should see: `{"status":"ok","service":"Code Analyzer API","version":"1.0.0"}`

Also check the interactive API docs at:
```
http://127.0.0.1:8000/docs
```

> **Keep this terminal open.** The server must be running whenever you use the extension.

---

## Part B — Firefox Extension Setup

### Step 5 — Open the Firefox Extension Manager

1. Open Firefox
2. In the address bar, type:
   ```
   about:debugging
   ```
   and press Enter

---

### Step 6 — Load the extension

1. Click **"This Firefox"** in the left sidebar
2. Click the **"Load Temporary Add-on…"** button
3. In the file picker that opens, navigate to your project folder
4. Select the **`manifest.json`** file (not the folder — the file itself)
5. Click **Open**

**Expected result:** The extension appears in the list as "Code Analyzer — CP Edition" with a green status indicator.

> **Important:** "Temporary" means it only lasts until Firefox restarts.
> For persistent loading during development, use the same `about:debugging` flow each session,
> or use `web-ext` (see the Bonus section at the bottom).

---

### Step 7 — Verify the extension loaded

1. Click the **Extensions** puzzle-piece icon in the Firefox toolbar
2. You should see "Code Analyzer — CP Edition" in your extensions list
3. Navigate to any LeetCode problem, e.g.:
   ```
   https://leetcode.com/problems/two-sum/
   ```
4. Once the code editor loads (give it ~3 seconds), you should see an **amber "Analyze" button** in the bottom-right corner of the page

---

### Step 8 — Test the full flow

1. Go to a LeetCode problem and write (or keep) any solution in the editor
2. Click the **Analyze** button
3. The button label changes to "Analyzing…" and a modal appears with a spinner
4. After 3–8 seconds, the modal shows:
   - **Time Complexity** and **Space Complexity** cards
   - **Bottlenecks** list (red dots)
   - **Optimizations** list (green dots)
5. Click anywhere outside the modal or press **Escape** to close it

---

## Part C — Troubleshooting

### "Cannot reach the backend" error in the modal

The FastAPI server is not running. Go to your terminal and run:
```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

---

### "No code found in the editor" error

The content script couldn't read the Monaco editor. This can happen if:
- You navigated to the problem but haven't let the editor fully load yet
- LeetCode updated their DOM structure

**Fix:** Wait for the editor to fully render, then click Analyze. If it persists, open
Firefox DevTools (F12) → Console tab and look for any errors tagged `[content.js]`.

---

### The Analyze button doesn't appear

1. Open `about:debugging` and check that the extension is still loaded (it unloads on Firefox restart)
2. Check the browser console (F12) for errors — look for CSP violations or script errors
3. Make sure you're on a supported URL pattern:
   - `https://leetcode.com/problems/*`
   - `https://codeforces.com/problemset/problem/*/*`
   - `https://codeforces.com/contest/*/problem/*`

---

### Groq API errors (502 in the modal)

- Check that your `.env` file exists and contains a valid `GROQ_API_KEY`
- Check the **Uvicorn terminal** — it logs every request with details
- Visit https://console.groq.com to confirm your key is active and has quota

---

### Extension changes not reflecting after edits

Firefox does NOT hot-reload MV2 extensions automatically. After any code change:
1. Go to `about:debugging`
2. Find your extension and click **Reload**
3. Then refresh the LeetCode/Codeforces tab

---

## Part D — Bonus: `web-ext` for a Better Dev Experience

`web-ext` is Mozilla's official CLI tool. It auto-reloads the extension on file changes,
so you don't need to manually visit `about:debugging` every time.

```bash
# Install globally
npm install -g web-ext

# Run from your extension folder (keep your uvicorn terminal open separately)
cd code-analyzer-extension
web-ext run --source-dir .
```

This opens a new Firefox instance with your extension pre-loaded and watching for changes.

---

## Quick Reference Cheatsheet

| Task | Command / Location |
|---|---|
| Start backend | `uvicorn main:app --reload --host 127.0.0.1 --port 8000` |
| Test backend | `http://127.0.0.1:8000/docs` |
| Load extension | Firefox → `about:debugging` → This Firefox → Load Temporary Add-on |
| Reload extension after changes | `about:debugging` → Reload button |
| Auto-reload dev mode | `web-ext run --source-dir .` |
| View extension logs | Firefox DevTools (F12) → Console |
| View backend logs | Uvicorn terminal output |
