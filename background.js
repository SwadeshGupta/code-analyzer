"use strict";

/**
 * background.js — MV3 Service Worker
 *
 * Responsibilities:
 *  1. Listen for ANALYZE_CODE messages from content.js.
 *  2. Load the user's Groq API key from browser.storage.local.
 *  3. Build the system + user prompts.
 *  4. Call the Groq API directly.
 *  5. Return structured complexity analysis to content.js.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const GROQ_ENDPOINT =
  "https://api.groq.com/openai/v1/chat/completions";

// Current Groq model
const GROQ_MODEL =
  "llama-3.1-8b-instant";

const STORAGE_KEY =
  "groqApiKey";

const TIMEOUT_MS =
  45000; // 45 seconds


// ── Normalise browser API ────────────────────────────────────────────────────
// Firefox uses `browser`, Chrome/Chromium uses `chrome`.

const _storage =
  (typeof browser !== "undefined" ? browser : chrome).storage.local;


// ── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {

    if (message.type === "ANALYZE_CODE") {

      // Keep the message channel open for the async response.
      handleAnalysis(message.payload)
        .then(sendResponse)
        .catch((error) => {
          console.error("Code Analyzer error:", error);

          sendResponse({
            success: false,
            error: "An unexpected error occurred while analyzing the code."
          });
        });

      return true;
    }
  }
);


// ── Core Analysis Handler ────────────────────────────────────────────────────

async function handleAnalysis(payload) {

  const {
    code,
    language,
    problemContext
  } = payload;


  // ── 1. Validate input ─────────────────────────────────────────────────────

  if (!code || code.trim().length === 0) {

    return {
      success: false,
      error:
        "No code was found in the editor. Write your solution first, then analyze."
    };
  }


  if (!language) {

    return {
      success: false,
      error:
        "Could not detect the programming language from the editor."
    };
  }


  // ── 2. Load Groq API key ──────────────────────────────────────────────────

  let groqApiKey;

  try {

    const result =
      await _storage.get(STORAGE_KEY);

    groqApiKey =
      result[STORAGE_KEY];

  } catch (error) {

    console.error(
      "Storage error:",
      error
    );

    return {
      success: false,
      error:
        "Could not read the Groq API key from extension storage."
    };
  }


  if (
    !groqApiKey ||
    !groqApiKey.trim()
  ) {

    return {
      success: false,
      error:
        "No Groq API key found. Open the extension options and paste your Groq API key."
    };
  }


  // ── 3. Build problem context ─────────────────────────────────────────────

  const problemLine =
    problemContext &&
    problemContext.fullTitle
      ? `Problem: ${problemContext.fullTitle}`
      : "";


  // ── 4. System prompt ──────────────────────────────────────────────────────

  const systemPrompt = `
You are an expert competitive-programming coach specializing in algorithm analysis.

Analyze the provided ${language.toUpperCase()} solution.

Your job is to determine:

1. Time complexity
2. Auxiliary space complexity
3. Main performance bottlenecks
4. Possible optimizations

Return ONLY a valid JSON object.

Do NOT return:
- Markdown
- Code fences
- Explanations outside JSON
- Extra text before or after JSON

The JSON must follow EXACTLY this structure:

{
  "time_complexity": "O(n)",
  "space_complexity": "O(1)",
  "bottlenecks": [
    "Short explanation of the main bottleneck"
  ],
  "optimizations": [
    "Short actionable optimization"
  ]
}

Rules:

- time_complexity must be a Big-O expression.
- space_complexity must be a Big-O expression.
- Count auxiliary memory used by the algorithm.
- Do not count the input itself unless the algorithm creates an additional copy.
- For nested loops, determine whether they are actually independent before multiplying their complexities.
- For sequential loops, add their costs and simplify to the dominant term.
- For recursion, analyze the recurrence when necessary.
- For sorting algorithms, identify the actual sorting complexity.
- For hash tables, consider expected/average complexity unless the code clearly requires worst-case analysis.
- For binary search, use O(log n).
- For two-pointer and sliding-window algorithms, carefully determine whether pointers move monotonically.
- For dynamic programming, consider both state count and transitions.
- Do not assume an algorithm is O(n²) merely because it contains two loops.
- Analyze the actual control flow.

"bottlenecks" must contain 1–5 concise strings.

"optimizations" must contain 1–5 concise actionable strings.

If the solution is already optimal, return an empty optimizations array.

Return valid JSON only.
`;


  // ── 5. Build user prompt ──────────────────────────────────────────────────

  const userPrompt = [

    problemLine,

    `Language: ${language}`,

    "",

    "Code:",

    "```",

    code.trim(),

    "```"

  ]
    .filter(Boolean)
    .join("\n");


  // ── 6. Create timeout controller ─────────────────────────────────────────

  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );


  // ── 7. Call Groq API ──────────────────────────────────────────────────────

  let response;

  try {

    response =
      await fetch(
        GROQ_ENDPOINT,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${groqApiKey.trim()}`
          },


          body:
            JSON.stringify({

              model:
                GROQ_MODEL,

              temperature:
                0.2,

              max_tokens:
                1024,


              // Force the model to return JSON.
              response_format: {
                type: "json_object"
              },


              messages: [

                {
                  role: "system",
                  content:
                    systemPrompt
                },

                {
                  role: "user",
                  content:
                    userPrompt
                }

              ]

            }),


          signal:
            controller.signal
        }
      );

  } catch (fetchError) {

    clearTimeout(timeoutId);


    if (
      fetchError.name ===
      "AbortError"
    ) {

      return {
        success: false,
        error:
          "Request timed out after 45 seconds. Check your internet connection and try again."
      };
    }


    console.error(
      "Groq fetch error:",
      fetchError
    );


    return {
      success: false,
      error:
        `Could not reach the Groq API: ${fetchError.message}`
    };
  }


  clearTimeout(timeoutId);


  // ── 8. Handle HTTP errors ─────────────────────────────────────────────────

  if (!response.ok) {

    let detail =
      `HTTP ${response.status}`;


    try {

      const errBody =
        await response.json();


      detail =
        errBody?.error?.message ||
        detail;

    } catch (_) {
      // Ignore JSON parsing error.
    }


    // Invalid API key
    if (
      response.status ===
      401
    ) {

      return {
        success: false,
        error:
          "Invalid Groq API key (401). Open the extension options and verify your key."
      };
    }


    // Rate limit
    if (
      response.status ===
      429
    ) {

      return {
        success: false,
        error:
          "Groq rate limit reached (429). Please wait a moment and try again."
      };
    }


    // Model unavailable
    if (
      response.status ===
      400 &&
      detail.toLowerCase().includes("model")
    ) {

      return {
        success: false,
        error:
          `Groq model error: ${detail}`
      };
    }


    return {
      success: false,
      error:
        `Groq API error: ${detail}`
    };
  }


  // ── 9. Parse API response ─────────────────────────────────────────────────

  let responseBody;

  try {

    responseBody =
      await response.json();

  } catch (_) {

    return {
      success: false,
      error:
        "Received an unreadable response from Groq."
    };
  }


  // ── 10. Extract model response ────────────────────────────────────────────

  const rawContent =
    responseBody
      ?.choices
      ?.[0]
      ?.message
      ?.content
      ?? "";


  if (
    !rawContent.trim()
  ) {

    return {
      success: false,
      error:
        "Groq returned an empty response. Please try again."
    };
  }


  // ── 11. Clean JSON response ───────────────────────────────────────────────

  const cleaned =
    rawContent

      // Remove ```json
      .replace(
        /^```(?:json)?\s*/i,
        ""
      )

      // Remove ```
      .replace(
        /\s*```$/,
        ""
      )

      .trim();


  // ── 12. Parse JSON ────────────────────────────────────────────────────────

  let analysisData;

  try {

    analysisData =
      JSON.parse(cleaned);

  } catch (error) {

    console.error(
      "Invalid JSON returned by Groq:",
      rawContent
    );


    return {
      success: false,
      error:
        "The AI returned invalid JSON. Please try analyzing the code again."
    };
  }


  // ── 13. Validate and normalize response ───────────────────────────────────

  const payload_out = {

    time_complexity:
      analysisData.time_complexity
      ?? "N/A",

    space_complexity:
      analysisData.space_complexity
      ?? "N/A",

    bottlenecks:
      Array.isArray(
        analysisData.bottlenecks
      )
        ? analysisData.bottlenecks
        : [],

    optimizations:
      Array.isArray(
        analysisData.optimizations
      )
        ? analysisData.optimizations
        : []

  };


  // ── 14. Return result to content.js ───────────────────────────────────────

  return {

    success: true,

    data:
      payload_out

  };
}
