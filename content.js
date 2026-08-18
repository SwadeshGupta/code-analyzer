/**
 * Code Analyzer — Content Script
 *
 * Supports:
 *   - LeetCode
 *   - Codeforces
 *
 * Responsibilities:
 *   1. Detect platform
 *   2. Extract source code
 *   3. Detect programming language
 *   4. Extract problem information
 *   5. Inject Analyze button
 *   6. Send code to background.js
 *   7. Display analysis results
 */

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

const PLATFORM = (() => {
  const hostname = window.location.hostname.toLowerCase();

  if (hostname.includes("leetcode.com")) {
    return "leetcode";
  }

  if (hostname.includes("codeforces.com")) {
    return "codeforces";
  }

  return "unknown";
})();


// ============================================================================
// CODE EXTRACTION — LEETCODE
// ============================================================================

function extractCodeLeetCode() {
  /*
   * Method 1:
   * Try Monaco's global editor models.
   */
  try {
    if (
      window.monaco &&
      window.monaco.editor &&
      typeof window.monaco.editor.getModels === "function"
    ) {
      const models = window.monaco.editor.getModels();

      if (models && models.length > 0) {
        // Prefer the model with actual source code.
        for (let i = models.length - 1; i >= 0; i--) {
          const value = models[i].getValue();

          if (value && value.trim().length > 0) {
            return value;
          }
        }
      }
    }
  } catch (error) {
    console.debug("[Code Analyzer] Monaco extraction failed:", error);
  }


  /*
   * Method 2:
   * Try React Fiber internals.
   */
  try {
    const editor = getMonacoEditorInstance();

    if (editor && typeof editor.getValue === "function") {
      const code = editor.getValue();

      if (code && code.trim().length > 0) {
        return code;
      }
    }
  } catch (error) {
    console.debug("[Code Analyzer] React Fiber extraction failed:", error);
  }


  /*
   * Method 3:
   * Read Monaco's rendered lines.
   */
  try {
    const lines = document.querySelectorAll(
      ".monaco-editor .view-lines .view-line"
    );

    if (lines.length > 0) {
      const code = Array.from(lines)
        .map((line) => line.innerText || "")
        .join("\n");

      if (code.trim().length > 0) {
        return code;
      }
    }
  } catch (error) {
    console.debug("[Code Analyzer] DOM extraction failed:", error);
  }

  return null;
}


// ============================================================================
// GET MONACO EDITOR INSTANCE
// ============================================================================

function getMonacoEditorInstance() {
  const editorElement = document.querySelector(".monaco-editor");

  if (!editorElement) {
    return null;
  }

  const fiberKey = Object.keys(editorElement).find(
    (key) =>
      key.startsWith("__reactFiber") ||
      key.startsWith("__reactInternalInstance")
  );

  if (!fiberKey) {
    return null;
  }

  let fiber = editorElement[fiberKey];
  let attempts = 0;

  while (fiber && attempts < 100) {
    attempts++;

    try {
      const possibleEditors = [
        fiber.memoizedProps?.editor,
        fiber.memoizedProps?.monacoEditor,
        fiber.stateNode?.editor,
        fiber.stateNode?.monacoEditor,
      ];

      for (const editor of possibleEditors) {
        if (
          editor &&
          typeof editor.getValue === "function"
        ) {
          return editor;
        }
      }
    } catch (_) {
      // Continue walking the Fiber tree.
    }

    fiber = fiber.return;
  }

  return null;
}


// ============================================================================
// CODE EXTRACTION — CODEFORCES
// ============================================================================

function extractCodeCodeforces() {
  /*
   * Codeforces traditional textarea.
   */
  const textarea = document.querySelector(
    "#sourceCodeTextarea, " +
    "textarea[name='source'], " +
    "textarea[name='sourceCode']"
  );

  if (textarea && textarea.value) {
    const code = textarea.value;

    if (code.trim().length > 0) {
      return code;
    }
  }


  /*
   * CodeMirror.
   */
  try {
    const codeMirror = document.querySelector(".CodeMirror");

    if (codeMirror && codeMirror.CodeMirror) {
      const code = codeMirror.CodeMirror.getValue();

      if (code && code.trim().length > 0) {
        return code;
      }
    }
  } catch (error) {
    console.debug("[Code Analyzer] CodeMirror extraction failed:", error);
  }


  /*
   * CodeMirror rendered lines.
   */
  try {
    const lines = document.querySelectorAll(
      ".CodeMirror-line"
    );

    if (lines.length > 0) {
      const code = Array.from(lines)
        .map((line) => line.innerText || "")
        .join("\n");

      if (code.trim().length > 0) {
        return code;
      }
    }
  } catch (_) {}


  /*
   * Ace editor.
   */
  try {
    const aceEditor = document.querySelector(".ace_editor");

    if (aceEditor && window.ace) {
      const editor = window.ace.edit(aceEditor);

      if (editor) {
        const code = editor.getValue();

        if (code && code.trim().length > 0) {
          return code;
        }
      }
    }
  } catch (error) {
    console.debug("[Code Analyzer] Ace extraction failed:", error);
  }


  /*
   * Monaco fallback.
   */
  try {
    if (
      window.monaco &&
      window.monaco.editor &&
      typeof window.monaco.editor.getModels === "function"
    ) {
      const models = window.monaco.editor.getModels();

      for (let i = models.length - 1; i >= 0; i--) {
        const code = models[i].getValue();

        if (code && code.trim().length > 0) {
          return code;
        }
      }
    }
  } catch (_) {}

  return null;
}


// ============================================================================
// GENERAL CODE EXTRACTION
// ============================================================================

function extractCode() {
  if (PLATFORM === "leetcode") {
    return extractCodeLeetCode();
  }

  if (PLATFORM === "codeforces") {
    return extractCodeCodeforces();
  }

  return null;
}


// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

function normalizeLanguage(rawLanguage) {
  if (!rawLanguage) {
    return "cpp";
  }

  const lang = rawLanguage
    .toLowerCase()
    .trim();


  if (
    lang.includes("c++") ||
    lang.includes("cpp") ||
    lang.includes("gnu c++")
  ) {
    return "cpp";
  }

  if (
    lang.includes("python") ||
    lang === "py"
  ) {
    return "python";
  }

  if (
    lang.includes("java") &&
    !lang.includes("javascript")
  ) {
    return "java";
  }

  if (
    lang.includes("javascript") ||
    lang === "js"
  ) {
    return "javascript";
  }

  if (
    lang.includes("typescript") ||
    lang === "ts"
  ) {
    return "typescript";
  }

  if (
    lang === "go" ||
    lang.includes("golang")
  ) {
    return "go";
  }

  if (lang.includes("rust")) {
    return "rust";
  }

  if (lang.includes("kotlin")) {
    return "kotlin";
  }

  if (lang.includes("swift")) {
    return "swift";
  }

  if (lang.includes("c#") || lang.includes("csharp")) {
    return "csharp";
  }

  if (lang === "c" || lang.includes(" c ")) {
    return "c";
  }

  return lang.replace(/\s+/g, "_");
}


function detectLanguage() {

  // --------------------------------------------------------------------------
  // LEETCODE
  // --------------------------------------------------------------------------

  if (PLATFORM === "leetcode") {

    const selectors = [
      "button[id*='headlessui-listbox-button'] span",
      "button[id*='listbox-button'] span",
      ".ant-select-selection-item",
      ".lang-select .ant-select-selection__rendered",
      "[data-cy='lang-select']",
      "button[class*='language'] span",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (element) {
        const text = element.textContent?.trim();

        if (text) {
          return normalizeLanguage(text);
        }
      }
    }


    // Search visible buttons for language names.
    const buttons = document.querySelectorAll("button");

    for (const button of buttons) {
      const text = button.textContent?.trim();

      if (!text) {
        continue;
      }

      const normalized = normalizeLanguage(text);

      if (
        [
          "cpp",
          "python",
          "java",
          "javascript",
          "typescript",
          "go",
          "rust",
          "kotlin",
          "swift",
        ].includes(normalized)
      ) {
        return normalized;
      }
    }
  }


  // --------------------------------------------------------------------------
  // CODEFORCES
  // --------------------------------------------------------------------------

  if (PLATFORM === "codeforces") {

    const select = document.querySelector(
      "select[name='programTypeId'], " +
      "#programTypeId, " +
      "select[name='lang']"
    );

    if (select) {
      const selectedOption =
        select.options[select.selectedIndex];

      if (selectedOption) {
        return normalizeLanguage(
          selectedOption.textContent
        );
      }
    }
  }


  // Competitive programming default.
  return "cpp";
}


// ============================================================================
// PROBLEM CONTEXT
// ============================================================================

function extractProblemContext() {

  // --------------------------------------------------------------------------
  // LEETCODE
  // --------------------------------------------------------------------------

  if (PLATFORM === "leetcode") {

    const pageTitle = document.title || "";

    const cleanTitle = pageTitle
      .replace(/\s*-\s*LeetCode.*$/i, "")
      .trim();


    const selectors = [
      ".text-title-large",
      ".text-title-large a",
      "a[href*='/problems/'] .mr-2",
      "div[class*='title'] a[href*='/problems/']",
      ".css-v3d350",
      "h1",
    ];


    for (const selector of selectors) {

      const element = document.querySelector(selector);

      if (!element) {
        continue;
      }

      const text = element.textContent
        ?.replace(/\s+/g, " ")
        .trim();

      if (!text) {
        continue;
      }


      const match = text.match(
        /^(\d+)\.\s*(.+)$/
      );

      if (match) {
        return {
          number: match[1],
          title: match[2],
          fullTitle: `${match[1]}. ${match[2]}`,
        };
      }


      if (text.length > 2) {
        return {
          number: "",
          title: text,
          fullTitle: text,
        };
      }
    }


    // Extract title from URL.
    const urlMatch = window.location.pathname.match(
      /\/problems\/([^/]+)/
    );

    if (urlMatch) {

      const slug = urlMatch[1];

      const title =
        cleanTitle ||
        slug
          .replace(/-/g, " ")
          .replace(/\b\w/g, (char) =>
            char.toUpperCase()
          );

      return {
        number: "",
        title,
        fullTitle: title,
      };
    }


    if (cleanTitle) {
      return {
        number: "",
        title: cleanTitle,
        fullTitle: cleanTitle,
      };
    }
  }


  // --------------------------------------------------------------------------
  // CODEFORCES
  // --------------------------------------------------------------------------

  if (PLATFORM === "codeforces") {

    const heading = document.querySelector(
      ".problem-statement .title, " +
      ".problem-statement .header .title"
    );

    if (heading) {

      const text = heading.textContent
        ?.replace(/\s+/g, " ")
        .trim();

      if (text) {

        const match = text.match(
          /^([A-Za-z0-9]+)\.\s*(.+)$/
        );

        if (match) {
          return {
            number: match[1],
            title: match[2],
            fullTitle: text,
          };
        }

        return {
          number: "",
          title: text,
          fullTitle: text,
        };
      }
    }


    const contestMatch =
      window.location.pathname.match(
        /\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/i
      );

    if (contestMatch) {

      const contestNumber = contestMatch[1];
      const problemNumber = contestMatch[2];

      const fullTitle =
        `Contest ${contestNumber} — Problem ${problemNumber}`;

      return {
        number: problemNumber,
        title: fullTitle,
        fullTitle,
      };
    }


    const problemsetMatch =
      window.location.pathname.match(
        /\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/i
      );

    if (problemsetMatch) {

      const contestNumber = problemsetMatch[1];
      const problemNumber = problemsetMatch[2];

      const fullTitle =
        `${contestNumber}${problemNumber}`;

      return {
        number: `${contestNumber}${problemNumber}`,
        title: fullTitle,
        fullTitle,
      };
    }
  }


  return {
    number: "",
    title: "",
    fullTitle: "",
  };
}


// ============================================================================
// UI STATE
// ============================================================================

let analyzeBtn = null;
let modalOverlay = null;
let isAnalyzing = false;
let removalTimer = null;


// ============================================================================
// INJECT ANALYZE BUTTON
// ============================================================================

function injectAnalyzeButton() {

  if (!document.body) {
    return;
  }


  const existing =
    document.getElementById("ca-analyze-btn");

  if (existing) {

    if (document.body.contains(existing)) {
      analyzeBtn = existing;
      return;
    }

    existing.remove();
  }


  analyzeBtn =
    document.createElement("button");

  analyzeBtn.id =
    "ca-analyze-btn";

  analyzeBtn.type =
    "button";

  analyzeBtn.setAttribute(
    "aria-label",
    "Analyze code complexity"
  );


  analyzeBtn.innerHTML = `
    <span class="ca-btn-icon">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    </span>

    <span class="ca-btn-label">
      Analyze
    </span>
  `;


  analyzeBtn.addEventListener(
    "click",
    onAnalyzeClick
  );


  document.body.appendChild(
    analyzeBtn
  );
}


// ============================================================================
// ANALYZE BUTTON CLICK
// ============================================================================

async function onAnalyzeClick() {

  if (isAnalyzing) {
    return;
  }

  isAnalyzing = true;


  analyzeBtn =
    document.getElementById(
      "ca-analyze-btn"
    );


  const code =
    extractCode();

  const language =
    detectLanguage();

  const problemContext =
    extractProblemContext();


  // --------------------------------------------------------------------------
  // NO CODE
  // --------------------------------------------------------------------------

  if (!code || !code.trim()) {

    isAnalyzing = false;

    showModal({
      error:
        "No code found in the editor. Write your solution first, then click Analyze.",
      language,
      problemContext,
    });

    return;
  }


  // --------------------------------------------------------------------------
  // LOADING
  // --------------------------------------------------------------------------

  setButtonLoading(true);

  showModal({
    loading: true,
    language,
    problemContext,
  });


  // --------------------------------------------------------------------------
  // SEND TO BACKGROUND
  // --------------------------------------------------------------------------

  try {

    const response =
      await browser.runtime.sendMessage({
        type: "ANALYZE_CODE",

        payload: {
          code,
          language,
          problemContext,
        },
      });


    if (
      response &&
      response.success
    ) {

      showModal({
        result: response.data,
        language,
        problemContext,
      });

    } else {

      const errorMessage =
        response?.error ||
        "Unknown error from background script.";

      showModal({
        error: errorMessage,
        language,
        problemContext,
      });
    }

  } catch (error) {

    console.error(
      "[Code Analyzer]",
      error
    );


    showModal({
      error:
        `Extension error: ${error.message}. ` +
        `Try reloading the extension from about:debugging.`,
      language,
      problemContext,
    });

  } finally {

    analyzeBtn =
      document.getElementById(
        "ca-analyze-btn"
      );

    setButtonLoading(false);

    isAnalyzing = false;
  }
}


// ============================================================================
// BUTTON LOADING STATE
// ============================================================================

function setButtonLoading(isLoading) {

  if (!analyzeBtn) {
    return;
  }


  const label =
    analyzeBtn.querySelector(
      ".ca-btn-label"
    );


  if (isLoading) {

    analyzeBtn.classList.add(
      "ca-loading"
    );

    if (label) {
      label.textContent =
        "Analyzing…";
    }

    analyzeBtn.disabled =
      true;

  } else {

    analyzeBtn.classList.remove(
      "ca-loading"
    );

    if (label) {
      label.textContent =
        "Analyze";
    }

    analyzeBtn.disabled =
      false;
  }
}


// ============================================================================
// MODAL
// ============================================================================

function showModal({
  loading = false,
  result = null,
  error = null,
  language = "",
  problemContext = null,
}) {

  removeModal();


  modalOverlay =
    document.createElement("div");

  modalOverlay.id =
    "ca-modal-overlay";


  const openedAt =
    Date.now();


  modalOverlay.addEventListener(
    "click",
    (event) => {

      if (
        event.target !==
        modalOverlay
      ) {
        return;
      }


      if (
        Date.now() -
        openedAt <
        300
      ) {
        return;
      }


      removeModal();
    }
  );


  const modal =
    document.createElement("div");

  modal.id =
    "ca-modal";


  // --------------------------------------------------------------------------
  // HEADER
  // --------------------------------------------------------------------------

  const header =
    document.createElement("div");

  header.className =
    "ca-modal-header";


  const problemBadge =
    problemContext?.number
      ? `
        <span class="ca-problem-badge">
          #${escapeHtml(problemContext.number)}
        </span>
      `
      : "";


  const languageBadge =
    language
      ? `
        <span class="ca-lang-badge">
          ${escapeHtml(language.toUpperCase())}
        </span>
      `
      : "";


  header.innerHTML = `
    <div class="ca-modal-title">

      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>

      <span>
        Code Analyzer
      </span>

      ${problemBadge}

      ${languageBadge}

    </div>

    <button
      class="ca-close-btn"
      type="button"
      title="Close"
      aria-label="Close"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
      >
        <line
          x1="18"
          y1="6"
          x2="6"
          y2="18"
        />

        <line
          x1="6"
          y1="6"
          x2="18"
          y2="18"
        />
      </svg>
    </button>
  `;


  const closeButton =
    header.querySelector(
      ".ca-close-btn"
    );


  if (closeButton) {
    closeButton.addEventListener(
      "click",
      removeModal
    );
  }


  // --------------------------------------------------------------------------
  // BODY
  // --------------------------------------------------------------------------

  const body =
    document.createElement("div");

  body.className =
    "ca-modal-body";


  // --------------------------------------------------------------------------
  // LOADING
  // --------------------------------------------------------------------------

  if (loading) {

    const problemLine =
      problemContext?.fullTitle
        ? `
          <p class="ca-loading-problem">
            ${escapeHtml(
              problemContext.fullTitle
            )}
          </p>
        `
        : "";


    body.innerHTML = `
      <div class="ca-loading-state">

        <div class="ca-spinner"></div>

        <p class="ca-loading-text">
          Running AI analysis…
        </p>

        ${problemLine}

        <p class="ca-loading-sub">
          Detecting complexity and bottlenecks
        </p>

      </div>
    `;
  }


  // --------------------------------------------------------------------------
  // ERROR
  // --------------------------------------------------------------------------

  else if (error) {

    body.innerHTML = `
      <div class="ca-error-state">

        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ff5f5f"
          stroke-width="2"
          stroke-linecap="round"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
          />

          <line
            x1="12"
            y1="8"
            x2="12"
            y2="12"
          />

          <line
            x1="12"
            y1="16"
            x2="12.01"
            y2="16"
          />
        </svg>

        <p class="ca-error-title">
          Analysis Failed
        </p>

        <p class="ca-error-msg">
          ${escapeHtml(error)}
        </p>

      </div>
    `;
  }


  // --------------------------------------------------------------------------
  // RESULT
  // --------------------------------------------------------------------------

  else if (result) {

    body.innerHTML =
      buildResultHTML(
        result,
        problemContext
      );
  }


  modal.appendChild(header);
  modal.appendChild(body);

  modalOverlay.appendChild(modal);

  document.body.appendChild(
    modalOverlay
  );


  requestAnimationFrame(() => {

    if (modalOverlay) {
      modalOverlay.classList.add(
        "ca-visible"
      );
    }

  });
}


// ============================================================================
// RESULT HTML
// ============================================================================

function buildResultHTML(
  result,
  problemContext
) {

  const timeComplexity =
    result?.time_complexity ||
    result?.timeComplexity ||
    "N/A";


  const spaceComplexity =
    result?.space_complexity ||
    result?.spaceComplexity ||
    "N/A";


  const bottlenecks =
    Array.isArray(result?.bottlenecks)
      ? result.bottlenecks
      : [];


  const optimizations =
    Array.isArray(result?.optimizations)
      ? result.optimizations
      : [];


  const problemHeader =
    problemContext?.fullTitle
      ? `
        <div class="ca-problem-title">
          ${escapeHtml(
            problemContext.fullTitle
          )}
        </div>
      `
      : "";


  function renderList(
    items,
    emptyMessage
  ) {

    if (
      !items ||
      items.length === 0
    ) {
      return `
        <li class="ca-list-empty">
          ${escapeHtml(emptyMessage)}
        </li>
      `;
    }


    return items
      .map(
        (item) => `
          <li>
            ${escapeHtml(
              String(item)
            )}
          </li>
        `
      )
      .join("");
  }


  return `
    <div class="ca-result">

      ${problemHeader}


      <!-- Complexity -->

      <div class="ca-complexity-grid">

        <div class="ca-complexity-card ca-time">

          <div class="ca-complexity-label">
            Time Complexity
          </div>

          <div class="ca-complexity-value">
            ${escapeHtml(
              String(timeComplexity)
            )}
          </div>

        </div>


        <div class="ca-complexity-card ca-space">

          <div class="ca-complexity-label">
            Space Complexity
          </div>

          <div class="ca-complexity-value">
            ${escapeHtml(
              String(spaceComplexity)
            )}
          </div>

        </div>

      </div>


      <!-- Bottlenecks -->

      <div class="ca-section">

        <div class="ca-section-title">

          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />

            <line
              x1="12"
              y1="9"
              x2="12"
              y2="13"
            />

            <line
              x1="12"
              y1="17"
              x2="12.01"
              y2="17"
            />
          </svg>

          Bottlenecks

        </div>


        <ul class="ca-list ca-list-bottlenecks">

          ${renderList(
            bottlenecks,
            "No significant bottlenecks detected."
          )}

        </ul>

      </div>


      <!-- Optimizations -->

      <div class="ca-section">

        <div class="ca-section-title">

          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline
              points="23 6 13.5 15.5 8.5 10.5 1 18"
            />

            <polyline
              points="17 6 23 6 23 12"
            />
          </svg>

          Optimizations

        </div>


        <ul class="ca-list ca-list-optimizations">

          ${renderList(
            optimizations,
            "Your solution looks well-optimized!"
          )}

        </ul>

      </div>

    </div>
  `;
}


// ============================================================================
// REMOVE MODAL
// ============================================================================

function removeModal() {

  if (!modalOverlay) {
    return;
  }


  if (removalTimer) {

    clearTimeout(
      removalTimer
    );

    removalTimer = null;
  }


  const overlayToRemove =
    modalOverlay;


  modalOverlay = null;


  overlayToRemove.classList.remove(
    "ca-visible"
  );


  removalTimer =
    setTimeout(() => {

      if (
        overlayToRemove &&
        overlayToRemove.parentNode
      ) {
        overlayToRemove.remove();
      }

      removalTimer = null;

    }, 260);
}


// ============================================================================
// HTML ESCAPING
// ============================================================================

function escapeHtml(value) {

  const div =
    document.createElement("div");

  div.appendChild(
    document.createTextNode(
      String(value ?? "")
    )
  );

  return div.innerHTML;
}


// ============================================================================
// KEYBOARD SHORTCUT
// ============================================================================

document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Escape" &&
      modalOverlay
    ) {
      removeModal();
    }

  },
  true
);


// ============================================================================
// CHECK EDITOR
// ============================================================================

function editorExists() {

  if (PLATFORM === "leetcode") {

    return Boolean(
      document.querySelector(
        ".monaco-editor"
      )
    );
  }


  if (PLATFORM === "codeforces") {

    return Boolean(
      document.querySelector(
        "#sourceCodeTextarea, " +
        ".CodeMirror, " +
        ".ace_editor, " +
        ".monaco-editor"
      )
    );
  }


  return false;
}


// ============================================================================
// WAIT FOR EDITOR
// ============================================================================

function waitForEditor(
  callback,
  maxWait = 20000
) {

  const intervalTime = 500;

  let elapsed = 0;


  if (editorExists()) {

    callback();

    return;
  }


  const timer =
    setInterval(() => {

      elapsed += intervalTime;


      if (editorExists()) {

        clearInterval(timer);

        callback();

        return;
      }


      if (elapsed >= maxWait) {

        clearInterval(timer);

      }

    }, intervalTime);
}


// ============================================================================
// INITIALIZATION
// ============================================================================

function initialize() {

  if (
    PLATFORM === "unknown"
  ) {
    return;
  }


  waitForEditor(
    injectAnalyzeButton
  );
}


// ============================================================================
// SPA NAVIGATION SUPPORT
// ============================================================================

if (
  PLATFORM !== "unknown"
) {

  initialize();


  /*
   * LeetCode is a React SPA.
   *
   * When navigating from one problem to another,
   * the page may rebuild parts of the DOM.
   *
   * MutationObserver makes sure the Analyze button
   * comes back after the editor is recreated.
   */

  const navObserver =
    new MutationObserver(() => {

      const button =
        document.getElementById(
          "ca-analyze-btn"
        );


      if (
        !button ||
        !document.body.contains(button)
      ) {

        waitForEditor(
          injectAnalyzeButton,
          10000
        );
      }

    });


  navObserver.observe(
    document.body,
    {
      childList: true,
      subtree: true,
    }
  );


  /*
   * Also detect URL changes.
   * Useful because LeetCode uses client-side routing.
   */

  let lastUrl =
    window.location.href;


  setInterval(() => {

    const currentUrl =
      window.location.href;


    if (
      currentUrl !== lastUrl
    ) {

      lastUrl =
        currentUrl;


      removeModal();


      analyzeBtn = null;


      waitForEditor(
        injectAnalyzeButton,
        10000
      );
    }

  }, 1000);
}


// ============================================================================
// DEBUG MESSAGE
// ============================================================================

console.log(
  `[Code Analyzer] Loaded on ${PLATFORM}`
);
