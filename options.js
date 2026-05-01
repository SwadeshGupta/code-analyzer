"use strict";

// ── Storage key ──────────────────────────────────────────────────────────────
const STORAGE_KEY = "groqApiKey";

// ── DOM refs ─────────────────────────────────────────────────────────────────
const inputEl       = document.getElementById("ca-api-key");
const saveBtn       = document.getElementById("ca-save-btn");
const toggleVisBtn  = document.getElementById("ca-toggle-vis");
const eyeIcon       = document.getElementById("ca-icon-eye");
const eyeOffIcon    = document.getElementById("ca-icon-eye-off");
const statusEl      = document.getElementById("ca-status");
const keyIndicator  = document.getElementById("ca-key-indicator");
const keyLabel      = document.getElementById("ca-key-label");
const clearBtn      = document.getElementById("ca-clear-btn");

// ── Normalise browser API (WebExtensions vs Chrome) ──────────────────────────
const storage = (typeof browser !== "undefined" ? browser : chrome).storage.local;

// ── Helpers ──────────────────────────────────────────────────────────────────

function showStatus(message, type /* "success" | "error" */) {
  const icon = type === "success"
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round">
         <polyline points="20 6 9 17 4 12"/>
       </svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round">
         <circle cx="12" cy="12" r="10"/>
         <line x1="12" y1="8" x2="12" y2="12"/>
         <line x1="12" y1="16" x2="12.01" y2="16"/>
       </svg>`;

  statusEl.className = `ca-status ca-status--${type}`;
  statusEl.innerHTML = `${icon} ${message}`;

  // Auto-dismiss success after 3 s
  if (type === "success") {
    setTimeout(() => { statusEl.className = "ca-status"; }, 3000);
  }
}

/** Mask the key for display: show only first 8 chars then bullets */
function maskKey(key) {
  if (!key) return "";
  return key.length <= 8
    ? "•".repeat(key.length)
    : key.slice(0, 8) + "•".repeat(Math.min(key.length - 8, 20));
}

function updateIndicator(key) {
  if (key) {
    keyIndicator.className = "ca-key-indicator ca-key-indicator--set";
    keyLabel.textContent   = `Key saved: ${maskKey(key)}`;
    clearBtn.style.display = "inline";
  } else {
    keyIndicator.className = "ca-key-indicator";
    keyLabel.textContent   = "No key saved";
    clearBtn.style.display = "none";
  }
}

// ── Load saved key on open ───────────────────────────────────────────────────

storage.get(STORAGE_KEY).then(result => {
  const saved = result[STORAGE_KEY] || "";
  updateIndicator(saved);
  // Don't pre-fill the password input — user must re-paste to update
}).catch(() => {
  // Storage unavailable; indicator stays at default
});

// ── Show / hide key toggle ───────────────────────────────────────────────────

toggleVisBtn.addEventListener("click", () => {
  const isHidden = inputEl.type === "password";
  inputEl.type       = isHidden ? "text" : "password";
  eyeIcon.style.display    = isHidden ? "none"  : "";
  eyeOffIcon.style.display = isHidden ? ""      : "none";
});

// ── Save ─────────────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", async () => {
  const key = inputEl.value.trim();

  if (!key) {
    showStatus("Please paste your Groq API key before saving.", "error");
    return;
  }

  // Groq keys start with "gsk_"
  if (!key.startsWith("gsk_")) {
    showStatus("That doesn't look like a Groq key (should start with gsk_).", "error");
    return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = "Saving…";

  try {
    await storage.set({ [STORAGE_KEY]: key });
    inputEl.value = "";                 // clear field after save
    updateIndicator(key);
    showStatus("API key saved successfully.", "success");
  } catch (err) {
    showStatus("Failed to save key: " + err.message, "error");
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = "Save API Key";
  }
});

// ── Clear ────────────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", async () => {
  try {
    await storage.remove(STORAGE_KEY);
    inputEl.value = "";
    updateIndicator(null);
    showStatus("API key removed.", "success");
  } catch (err) {
    showStatus("Failed to remove key: " + err.message, "error");
  }
});

// ── Allow Enter key to save ──────────────────────────────────────────────────

inputEl.addEventListener("keydown", e => {
  if (e.key === "Enter") saveBtn.click();
});
