/**
 * content.js — Content Script
 *
 * Responsibilities:
 *  1. Detect the current platform (LeetCode or Codeforces).
 *  2. Extract the code string from the platform's editor.
 *  3. Detect the selected programming language.
 *  4. Inject a floating "Analyze" button into the page.
 *  5. On button click: show loading state → message background.js → render modal.
 */

// ─── Platform Detection ───────────────────────────────────────────────────────

const PLATFORM = (() => {
  const host = window.location.hostname;
  if (host.includes("leetcode.com"))    return "leetcode";
  if (host.includes("codeforces.com"))  return "codeforces";
  return "unknown";
})();

// ─── Code Extraction ──────────────────────────────────────────────────────────

/**
 * LeetCode uses Monaco Editor. The actual code lives in the model of the editor
 * instance, which is accessible via the global `monaco` object injected by the page.
 * Fallback: read from the visible `.view-lines` DOM if monaco isn't ready yet.
 */
function extractCodeLeetCode() {
  // Primary: Monaco editor model (most reliable, preserves whitespace perfectly)
  try {
    // LeetCode attaches the editor instance to a known React fiber key
    const editorContainer = document.querySelector(".monaco-editor");
    if (editorContainer) {
      // Walk up to find the React internal with the editor instance
      const monacoInstance = getMonacoEditorInstance();
      if (monacoInstance) {
        const code = monacoInstance.getValue();
        if (code && code.trim().length > 0) return code;
      }
    }
  } catch (e) { /* fall through to DOM fallback */ }

  // Fallback: scrape the rendered view lines (loses some formatting but works)
  const viewLines = document.querySelectorAll(".view-lines .view-line");
  if (viewLines.length > 0) {
    return Array.from(viewLines)
      .map(line => line.innerText)
      .join("\n");
  }

  return null;
}

/**
 * Attempt to retrieve the Monaco editor instance via the page's global `monaco`
 * object or via React fiber internals attached to the editor DOM node.
 */
function getMonacoEditorInstance() {
  // Method 1: window.monaco (available if the page exposes it)
  if (window.monaco && window.monaco.editor) {
    const models = window.monaco.editor.getModels();
    if (models && models.length > 0) {
      // Return the content of the last (active) model
      return { getValue: () => models[models.length - 1].getValue() };
    }
  }

  // Method 2: React fiber — LeetCode stores the editor on a _reactFiber prop
  const editorEl = document.querySelector(".monaco-editor");
  if (!editorEl) return null;

  const fiberKey = Object.keys(editorEl).find(
    k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance")
  );
  if (!fiberKey) return null;

  let fiber = editorEl[fiberKey];
  let attempts = 0;
  while (fiber && attempts < 50) {
    attempts++;
    const editor = fiber?.memoizedProps?.editor || fiber?.stateNode?.editor;
    if (editor && typeof editor.getValue === "function") return editor;
    fiber = fiber.return;
  }

  return null;
}

/**
 * Codeforces uses a standard CodeMirror textarea (older) or Monaco (newer).
 * The submission textarea always has id="sourceCodeTextarea" or name="source".
 */
function extractCodeCodeforces() {
  // Primary: hidden textarea that Codeforces uses for form submission
  const textarea = document.querySelector(
    "#sourceCodeTextarea, textarea[name='source'], .ace_text-input"
  );
  if (textarea && textarea.value && textarea.value.trim().length > 0) {
    return textarea.value;
  }

  // Fallback: CodeMirror rendered lines
  const cmLines = document.querySelectorAll(".CodeMirror-line");
  if (cmLines.length > 0) {
    return Array.from(cmLines)
      .map(line => line.innerText)
      .join("\n");
  }

  // Fallback: Monaco (newer CF)
  if (window.monaco && window.monaco.editor) {
    const models = window.monaco.editor.getModels();
    if (models && models.length > 0) {
      return models[models.length - 1].getValue();
    }
  }

  return null;
}

function extractCode() {
  if (PLATFORM === "leetcode")   return extractCodeLeetCode();
  if (PLATFORM === "codeforces") return extractCodeCodeforces();
  return null;
}

// ─── Language Detection ───────────────────────────────────────────────────────

function detectLanguage() {
  if (PLATFORM === "leetcode") {
    // LeetCode renders the active language in a button / select element
    const langSelectors = [
      // New LeetCode UI
      "button[id*='headlessui-listbox-button'] span",
      ".ant-select-selection-item",
      // Older LeetCode UI
      ".lang-select .ant-select-selection__rendered",
    ];
    for (const sel of langSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        return normalizeLanguage(el.textContent.trim());
      }
    }
  }

  if (PLATFORM === "codeforces") {
    // Codeforces uses a <select> for language choice
    const select = document.querySelector(
      "select[name='programTypeId'], #programTypeId"
    );
    if (select) {
      const selectedText = select.options[select.selectedIndex]?.text || "";
      return normalizeLanguage(selectedText);
    }
  }

  // Last resort: infer from file extension hints in the page
  return "cpp"; // safe default for CP
}

function normalizeLanguage(rawLang) {
  const lang = rawLang.toLowerCase();
  if (lang.includes("python"))  return "python";
  if (lang.includes("py"))      return "python";
  if (lang.includes("c++"))     return "cpp";
  if (lang.includes("cpp"))     return "cpp";
  if (lang.includes("java") && !lang.includes("script")) return "java";
  if (lang.includes("javascript") || lang.includes("js")) return "javascript";
  if (lang.includes("typescript")) return "typescript";
  if (lang.includes("go"))      return "go";
  if (lang.includes("rust"))    return "rust";
  return rawLang.toLowerCase().replace(/\s+/g, "_");
}

// ─── Problem Context Extraction ───────────────────────────────────────────────

/**
 * Returns { number, title, fullTitle } for the current problem.
 * e.g. { number: "240", title: "Search a 2D Matrix II", fullTitle: "240. Search a 2D Matrix II" }
 */
function extractProblemContext() {
  if (PLATFORM === "leetcode") {
    // Page <title> is always "Problem Title - LeetCode" — most reliable
    const pageTitle = document.title || "";
    const fromTitle = pageTitle.replace(/\s*-\s*LeetCode.*$/i, "").trim();

    // LeetCode renders number+title in heading elements — try multiple selectors
    const selectors = [
      ".text-title-large a",
      "a[href*='/problems/'] .mr-2",
      "div[class*='title'] a[href*='/problems/']",
      ".css-v3d350",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        const text  = el.textContent.trim();
        const match = text.match(/^(\d+)\.\s+(.+)$/);
        if (match) return { number: match[1], title: match[2], fullTitle: text };
      }
    }

    // Extract number from URL slug and build title from <title> tag
    const urlMatch = window.location.pathname.match(/\/problems\/([^/]+)/);
    if (urlMatch) {
      const slug  = urlMatch[1];
      const title = fromTitle || slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return { number: "", title, fullTitle: title };
    }

    if (fromTitle) return { number: "", title: fromTitle, fullTitle: fromTitle };
  }

  if (PLATFORM === "codeforces") {
    const heading = document.querySelector(".problem-statement .title, .header .title");
    if (heading) {
      const text = heading.textContent.trim();
      return { number: "", title: text, fullTitle: text };
    }
    const cfMatch = window.location.pathname.match(/\/contest\/(\d+)\/problem\/(\w+)/);
    if (cfMatch) {
      const fullTitle = `Contest ${cfMatch[1]} Problem ${cfMatch[2]}`;
      return { number: cfMatch[2], title: fullTitle, fullTitle };
    }
  }

  return { number: "", title: "", fullTitle: "" };
}

// ─── UI Injection ─────────────────────────────────────────────────────────────

let analyzeBtn   = null;
let modalOverlay = null;
let isAnalyzing  = false;   // guard against re-entrant clicks
let removalTimer = null;    // track the in-flight removeModal setTimeout

function injectAnalyzeButton() {
  // Remove stale button if the DOM was rebuilt by LeetCode's SPA router
  const existing = document.getElementById("ca-analyze-btn");
  if (existing) {
    // If the element is still in the live DOM tree, nothing to do
    if (document.body.contains(existing)) return;
    // Otherwise it's a detached stale node — remove the reference and re-inject
    existing.remove();
  }

  analyzeBtn = document.createElement("button");
  analyzeBtn.id = "ca-analyze-btn";
  analyzeBtn.innerHTML = `
    <span class="ca-btn-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    </span>
    <span class="ca-btn-label">Analyze</span>
  `;
  analyzeBtn.addEventListener("click", onAnalyzeClick);
  document.body.appendChild(analyzeBtn);
}

// ─── Button Click Handler ─────────────────────────────────────────────────────

async function onAnalyzeClick() {
  // Guard: prevent re-entrant clicks while a request is in flight
  if (isAnalyzing) return;
  isAnalyzing = true;

  // Always re-query the button from the DOM — LeetCode's SPA can re-render it
  analyzeBtn = document.getElementById("ca-analyze-btn");

  const code           = extractCode();
  const language       = detectLanguage();
  const problemContext = extractProblemContext();

  if (!code || code.trim().length === 0) {
    isAnalyzing = false;
    showModal({
      error: "No code found in the editor. Write your solution first, then click Analyze."
    });
    return;
  }

  setButtonLoading(true);
  showModal({ loading: true, language, problemContext });

  try {
    const response = await browser.runtime.sendMessage({
      type:    "ANALYZE_CODE",
      payload: { code, language, problemContext },
    });

    if (response && response.success) {
      showModal({ result: response.data, language, problemContext });
    } else {
      const errMsg = (response && response.error) || "Unknown error from background script.";
      showModal({ error: errMsg });
    }
  } catch (err) {
    // This fires if the background script itself throws (e.g. extension context invalidated)
    showModal({ error: `Extension error: ${err.message}. Try reloading the extension from about:debugging.` });
  } finally {
    // Re-query again — the DOM may have changed during the async wait
    analyzeBtn = document.getElementById("ca-analyze-btn");
    setButtonLoading(false);
    isAnalyzing = false;
  }
}

function setButtonLoading(isLoading) {
  if (!analyzeBtn) return;
  if (isLoading) {
    analyzeBtn.classList.add("ca-loading");
    analyzeBtn.querySelector(".ca-btn-label").textContent = "Analyzing…";
    analyzeBtn.disabled = true;
  } else {
    analyzeBtn.classList.remove("ca-loading");
    analyzeBtn.querySelector(".ca-btn-label").textContent = "Analyze";
    analyzeBtn.disabled = false;
  }
}

// ─── Modal Renderer ───────────────────────────────────────────────────────────

function showModal({ loading, result, error, language, problemContext }) {
  // Remove any existing modal
  removeModal();

  modalOverlay = document.createElement("div");
  modalOverlay.id = "ca-modal-overlay";

  // Use mousedown timestamp guard to prevent the same mouse event that opened
  // the modal (via the Analyze button) from immediately closing it via the overlay.
  let openedAt = Date.now();
  modalOverlay.addEventListener("click", e => {
    if (e.target !== modalOverlay) return;       // only bare overlay, not modal content
    if (Date.now() - openedAt < 300) return;     // ignore clicks within 300ms of opening
    removeModal();
  });

  const modal = document.createElement("div");
  modal.id = "ca-modal";

  // Header
  const header = document.createElement("div");
  header.className = "ca-modal-header";
  const problemBadge = (problemContext && problemContext.number)
    ? `<span class="ca-problem-badge">#${escapeHtml(problemContext.number)}</span>`
    : "";
  header.innerHTML = `
    <div class="ca-modal-title">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      Code Analyzer
      ${problemBadge}
      ${language ? `<span class="ca-lang-badge">${language.toUpperCase()}</span>` : ""}
    </div>
    <button class="ca-close-btn" title="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="3" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  header.querySelector(".ca-close-btn").addEventListener("click", removeModal);

  // Body
  const body = document.createElement("div");
  body.className = "ca-modal-body";

  if (loading) {
    const problemLine = (problemContext && problemContext.fullTitle)
      ? `<p class="ca-loading-problem">${escapeHtml(problemContext.fullTitle)}</p>`
      : "";
    body.innerHTML = `
      <div class="ca-loading-state">
        <div class="ca-spinner"></div>
        <p class="ca-loading-text">Running AI analysis…</p>
        ${problemLine}
        <p class="ca-loading-sub">Detecting complexity and bottlenecks</p>
      </div>
    `;
  } else if (error) {
    body.innerHTML = `
      <div class="ca-error-state">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff5f5f"
             stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p class="ca-error-title">Analysis Failed</p>
        <p class="ca-error-msg">${escapeHtml(error)}</p>
      </div>
    `;
  } else if (result) {
    body.innerHTML = buildResultHTML(result, problemContext);
  }

  modal.appendChild(header);
  modal.appendChild(body);
  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);

  // Trigger entrance animation
  requestAnimationFrame(() => modalOverlay.classList.add("ca-visible"));
}

function buildResultHTML(result, problemContext) {
  const {
    time_complexity  = "N/A",
    space_complexity = "N/A",
    bottlenecks      = [],
    optimizations    = [],
  } = result;

  const problemHeader = (problemContext && problemContext.fullTitle)
    ? `<div class="ca-problem-title">${escapeHtml(problemContext.fullTitle)}</div>`
    : "";

  const renderList = (items, emptyMsg) => {
    if (!items || items.length === 0) {
      return `<li class="ca-list-empty">${escapeHtml(emptyMsg)}</li>`;
    }
    return items
      .map(item => `<li>${escapeHtml(String(item))}</li>`)
      .join("");
  };

  return `
    <div class="ca-result">

      ${problemHeader}

      <div class="ca-complexity-grid">
        <div class="ca-complexity-card ca-time">
          <div class="ca-complexity-label">Time Complexity</div>
          <div class="ca-complexity-value">${escapeHtml(time_complexity)}</div>
        </div>
        <div class="ca-complexity-card ca-space">
          <div class="ca-complexity-label">Space Complexity</div>
          <div class="ca-complexity-value">${escapeHtml(space_complexity)}</div>
        </div>
      </div>

      <div class="ca-section">
        <div class="ca-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Bottlenecks
        </div>
        <ul class="ca-list ca-list-bottlenecks">
          ${renderList(bottlenecks, "No significant bottlenecks detected.")}
        </ul>
      </div>

      <div class="ca-section">
        <div class="ca-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
            <polyline points="17 6 23 6 23 12"/>
          </svg>
          Optimizations
        </div>
        <ul class="ca-list ca-list-optimizations">
          ${renderList(optimizations, "Your solution looks well-optimized!")}
        </ul>
      </div>

    </div>
  `;
}

function removeModal() {
  if (!modalOverlay) return;

  // Cancel any previously scheduled DOM removal to avoid it hitting the new modal
  if (removalTimer) {
    clearTimeout(removalTimer);
    removalTimer = null;
  }

  // Snapshot the ref — modalOverlay may be reassigned by showModal() during the timeout
  const overlayToRemove = modalOverlay;
  modalOverlay = null;

  overlayToRemove.classList.remove("ca-visible");
  removalTimer = setTimeout(() => {
    overlayToRemove.remove();
    removalTimer = null;
  }, 260);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ─── Keyboard Shortcut ────────────────────────────────────────────────────────

document.addEventListener("keydown", e => {
  // Escape closes modal
  if (e.key === "Escape" && modalOverlay) {
    removeModal();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * LeetCode is a React SPA — the editor mounts asynchronously.
 * Poll until the editor container is present before injecting the button.
 */
function waitForEditor(callback, maxWait = 15000) {
  const selectors = {
    leetcode:   ".monaco-editor",
    codeforces: "#sourceCodeTextarea, .CodeMirror, .monaco-editor",
  };
  const selector = selectors[PLATFORM] || ".monaco-editor";
  const interval = 500;
  let elapsed    = 0;

  const timer = setInterval(() => {
    if (document.querySelector(selector)) {
      clearInterval(timer);
      callback();
    }
    elapsed += interval;
    if (elapsed >= maxWait) clearInterval(timer);
  }, interval);
}

// Kick off
if (PLATFORM !== "unknown") {
  waitForEditor(injectAnalyzeButton);

  // LeetCode is a SPA — navigating between problems tears down and rebuilds
  // the entire React tree, removing our injected button. Watch for that.
  const navObserver = new MutationObserver(() => {
    if (!document.getElementById("ca-analyze-btn") ||
        !document.body.contains(document.getElementById("ca-analyze-btn"))) {
      // Editor might not be ready yet after navigation — wait for it again
      waitForEditor(injectAnalyzeButton);
    }
  });
  navObserver.observe(document.body, { childList: true, subtree: false });
}
