"use strict";

/**
 * background.js — MV3 Service Worker
 *
 * Responsibilities:
 *  1. Listen for ANALYZE_CODE messages from content.js.
 *  2. Load the user's Groq API key from browser.storage.local.
 *  3. Build the system + user prompts (previously handled by the FastAPI backend).
 *  4. Call the Groq API directly and return parsed JSON to the content script.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL    = "llama-3.3-70b-versatile";
const STORAGE_KEY   = "groqApiKey";
const TIMEOUT_MS    = 45000; // 45 s

// ── Normalise browser API (WebExtensions vs Chrome) ──────────────────────────
// In MV3 service workers the global is always `chrome`; in Firefox it's `browser`.
const _storage = (typeof browser !== "undefined" ? browser : chrome).storage.local;

// ── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ANALYZE_CODE") {
    // Must return true to keep the message channel open for the async response.
    handleAnalysis(message.payload).then(sendResponse);
    return true;
  }
});

// ── Core Handler ──────────────────────────────────────────────────────────────

async function handleAnalysis(payload) {
  const { code, language, problemContext } = payload;

  // ── 1. Validate inputs ────────────────────────────────────────────────────

  if (!code || code.trim().length === 0) {
    return {
      success: false,
      error: "No code was found in the editor. Write your solution first, then analyze.",
    };
  }

  if (!language) {
    return {
      success: false,
      error: "Could not detect the programming language from the editor.",
    };
  }

  // ── 2. Load API key ───────────────────────────────────────────────────────

  let groqApiKey;
  try {
    const result = await _storage.get(STORAGE_KEY);
    groqApiKey   = result[STORAGE_KEY];
  } catch (_) {
    return {
      success: false,
      error: "Could not read from extension storage. Please try again.",
    };
  }

  if (!groqApiKey || !groqApiKey.trim()) {
    return {
      success: false,
      error:
        "No Groq API key found. Open the extension options (right-click the toolbar icon → Options) " +
        "and paste your key from console.groq.com/keys.",
    };
  }

  // ── 3. Build prompts ──────────────────────────────────────────────────────

  const problemLine = problemContext && problemContext.fullTitle
    ? `Problem: ${problemContext.fullTitle}`
    : "";

  const systemPrompt = `You are an expert competitive-programming coach specialising in algorithm analysis.
Your task is to analyse a ${language.toUpperCase()} solution and return ONLY a raw JSON object — no markdown fences, no prose, no commentary outside the JSON.

The JSON must conform EXACTLY to this schema:
{
  "time_complexity":  "<Big-O string, e.g. O(n log n)>",
  "space_complexity": "<Big-O string, e.g. O(n)>",
  "bottlenecks": ["<concise sentence describing bottleneck 1>", ...],
  "optimizations": ["<concise actionable suggestion 1>", ...]
}

Rules:
- "time_complexity" and "space_complexity" must be Big-O strings (e.g. "O(n²)", "O(log n)", "O(1)").
- "bottlenecks" is an array of short plain-English strings (1–5 items). Empty array if none found.
- "optimizations" is an array of short, actionable plain-English suggestions (1–5 items). Empty array if solution is already optimal.
- Do NOT wrap the JSON in markdown code blocks or add any text before/after it.`;

  const userPrompt =
    [
      problemLine,
      `Language: ${language}`,
      "",
      "Code:",
      "```",
      code.trim(),
      "```",
    ]
      .filter(Boolean)
      .join("\n");

  // ── 4. Call Groq API ──────────────────────────────────────────────────────

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${groqApiKey.trim()}`,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        temperature: 0.2,         // low temp for deterministic JSON output
        max_tokens:  1024,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
      }),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError.name === "AbortError") {
      return {
        success: false,
        error:
          "Request timed out after 45 seconds. Check your internet connection and try again.",
      };
    }
    return {
      success: false,
      error: `Could not reach the Groq API: ${fetchError.message}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  // ── 5. Handle HTTP errors ─────────────────────────────────────────────────

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      // Groq returns { error: { message: "..." } }
      detail = errBody?.error?.message || detail;
    } catch (_) {}

    if (response.status === 401) {
      return {
        success: false,
        error:
          "Invalid API key (401). Open the extension options and verify your Groq key.",
      };
    }
    if (response.status === 429) {
      return {
        success: false,
        error: "Groq rate limit reached (429). Wait a moment and try again.",
      };
    }
    return { success: false, error: `Groq API error: ${detail}` };
  }

  // ── 6. Parse response ─────────────────────────────────────────────────────

  let responseBody;
  try {
    responseBody = await response.json();
  } catch (_) {
    return { success: false, error: "Received an unreadable response from Groq." };
  }

  const rawContent = responseBody?.choices?.[0]?.message?.content ?? "";
  if (!rawContent.trim()) {
    return { success: false, error: "Groq returned an empty response. Please try again." };
  }

  // Strip accidental markdown fences the model might still add
  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let analysisData;
  try {
    analysisData = JSON.parse(cleaned);
  } catch (_) {
    return {
      success: false,
      error:
        "The AI returned a response that couldn't be parsed. This sometimes happens on complex code — please try again.",
    };
  }

  // Guarantee the fields content.js expects always exist (defensive defaults)
  const payload_out = {
    time_complexity:  analysisData.time_complexity  ?? "N/A",
    space_complexity: analysisData.space_complexity ?? "N/A",
    bottlenecks:      Array.isArray(analysisData.bottlenecks)    ? analysisData.bottlenecks    : [],
    optimizations:    Array.isArray(analysisData.optimizations)  ? analysisData.optimizations  : [],
  };

  return { success: true, data: payload_out };
}
