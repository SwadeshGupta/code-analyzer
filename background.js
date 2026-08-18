"use strict";

/**
 * Swadesh Code Analyzer — Background Service Worker
 *
 * Responsibilities:
 *  1. Listen for ANALYZE_CODE messages from content.js.
 *  2. Load the user's Groq API key from browser.storage.local.
 *  3. Build the system + user prompts.
 *  4. Call the Groq API directly.
 *  5. Return structured complexity analysis to content.js.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const GROQ_ENDPOINT =
  "https://api.groq.com/openai/v1/chat/completions";

/**
 * Current Groq production model.
 *
 * GPT-OSS 20B is currently available on Groq and supports
 * JSON Object Mode / Structured Outputs.
 */
const GROQ_MODEL =
  "openai/gpt-oss-20b";

const STORAGE_KEY =
  "groqApiKey";

const TIMEOUT_MS =
  45000;


// ============================================================================
// BROWSER API NORMALIZATION
// ============================================================================

const browserAPI =
  typeof browser !== "undefined"
    ? browser
    : chrome;


const storage =
  browserAPI.storage.local;


// ============================================================================
// MESSAGE ROUTER
// ============================================================================

browserAPI.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {

    if (
      !message ||
      message.type !== "ANALYZE_CODE"
    ) {
      return false;
    }


    handleAnalysis(message.payload)
      .then((result) => {

        sendResponse(result);

      })
      .catch((error) => {

        console.error(
          "[Swadesh Code Analyzer] Unexpected error:",
          error
        );


        sendResponse({
          success: false,

          error:
            "An unexpected error occurred while analyzing the code."
        });

      });


    /*
     * Keep the message channel open for the
     * asynchronous response.
     */

    return true;
  }
);


// ============================================================================
// CORE ANALYSIS HANDLER
// ============================================================================

async function handleAnalysis(payload) {

  // --------------------------------------------------------------------------
  // Validate payload
  // --------------------------------------------------------------------------

  if (
    !payload ||
    typeof payload !== "object"
  ) {

    return {
      success: false,

      error:
        "Invalid analysis request."
    };
  }


  const {
    code,
    language,
    problemContext
  } = payload;


  // --------------------------------------------------------------------------
  // Validate source code
  // --------------------------------------------------------------------------

  if (
    typeof code !== "string" ||
    code.trim().length === 0
  ) {

    return {
      success: false,

      error:
        "No code was found in the editor. Write your solution first, then analyze."
    };
  }


  // --------------------------------------------------------------------------
  // Validate language
  // --------------------------------------------------------------------------

  if (
    typeof language !== "string" ||
    language.trim().length === 0
  ) {

    return {
      success: false,

      error:
        "Could not detect the programming language from the editor."
    };
  }


  // --------------------------------------------------------------------------
  // Load Groq API key
  // --------------------------------------------------------------------------

  let groqApiKey;

  try {

    const stored =
      await storage.get(STORAGE_KEY);

    groqApiKey =
      stored?.[STORAGE_KEY];

  } catch (error) {

    console.error(
      "[Swadesh Code Analyzer] Storage error:",
      error
    );


    return {
      success: false,

      error:
        "Could not read the Groq API key from extension storage."
    };
  }


  // --------------------------------------------------------------------------
  // Validate API key
  // --------------------------------------------------------------------------

  if (
    typeof groqApiKey !== "string" ||
    groqApiKey.trim().length === 0
  ) {

    return {
      success: false,

      error:
        "No Groq API key found. Open the extension options and save your Groq API key."
    };
  }


  groqApiKey =
    groqApiKey.trim();


  // --------------------------------------------------------------------------
  // Problem context
  // --------------------------------------------------------------------------

  const problemLine =
    problemContext &&
    typeof problemContext.fullTitle === "string" &&
    problemContext.fullTitle.trim().length > 0

      ? `Problem: ${problemContext.fullTitle.trim()}`

      : "Problem context: Not available";


  // ========================================================================
  // SYSTEM PROMPT
  // ========================================================================

  const systemPrompt = `
You are an expert competitive-programming coach and algorithm-analysis specialist.

Analyze the provided ${language.toUpperCase()} solution.

Determine:

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

RULES:

- time_complexity must be a Big-O expression.
- space_complexity must be a Big-O expression.
- Count auxiliary memory used by the algorithm.
- Do not count the input itself unless the algorithm creates an additional copy.
- For nested loops, determine whether they are actually dependent before multiplying complexities.
- For sequential loops, add their costs and simplify to the dominant term.
- For recursion, analyze the recurrence when necessary.
- For sorting, identify the actual sorting complexity.
- For hash tables, use expected/average complexity unless the code clearly requires worst-case analysis.
- For binary search, use O(log n).
- For two-pointer algorithms, determine whether each pointer moves monotonically.
- For sliding-window algorithms, determine actual pointer movement rather than simply counting loops.
- For dynamic programming, consider the number of states and transitions.
- Do not assume nested loops automatically imply O(n²).
- Analyze the actual control flow.
- Consider early exits, pruning, break statements, and conditional execution.
- Consider whether helper functions or library calls introduce additional complexity.
- Distinguish auxiliary space from recursion stack space.
- If an algorithm is already asymptotically optimal, return an empty optimizations array.

"bottlenecks" must contain 1–5 concise strings.

"optimizations" must contain 0–5 concise actionable strings.

Return valid JSON only.
`;


  // ========================================================================
  // USER PROMPT
  // ========================================================================

  const userPrompt = [
    problemLine,
    `Language: ${language.trim()}`,
    "",
    "Source code:",
    code.trim()
  ]
    .join("\n");


  // ========================================================================
  // TIMEOUT
  // ========================================================================

  const controller =
    new AbortController();


  const timeoutId =
    setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );


  // ========================================================================
  // GROQ API REQUEST
  // ========================================================================

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
              `Bearer ${groqApiKey}`
          },

          body:
            JSON.stringify({

              model:
                GROQ_MODEL,

              temperature:
                0.1,

              max_tokens:
                1024,

              /*
               * GPT-OSS 20B supports JSON Object Mode.
               */
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
      fetchError &&
      fetchError.name === "AbortError"
    ) {

      return {
        success: false,

        error:
          "Request timed out after 45 seconds. Check your internet connection and try again."
      };
    }


    console.error(
      "[Swadesh Code Analyzer] Groq fetch error:",
      fetchError
    );


    return {
      success: false,

      error:
        `Could not reach the Groq API: ${
          fetchError?.message ||
          "Network request failed."
        }`
    };
  }


  clearTimeout(timeoutId);


  // ========================================================================
  // HTTP ERROR HANDLING
  // ========================================================================

  if (!response.ok) {

    let detail =
      `HTTP ${response.status}`;


    try {

      const errorBody =
        await response.json();


      detail =
        errorBody?.error?.message ||
        errorBody?.message ||
        detail;

    } catch (_) {
      // Ignore JSON parse failure.
    }


    const normalizedDetail =
      String(detail).toLowerCase();


    // ----------------------------------------------------------------------
    // 401 — Invalid API Key
    // ----------------------------------------------------------------------

    if (
      response.status === 401
    ) {

      return {
        success: false,

        error:
          "Invalid Groq API key (401). Open the extension options and verify your key."
      };
    }


    // ----------------------------------------------------------------------
    // 403 — Permission / Access
    // ----------------------------------------------------------------------

    if (
      response.status === 403
    ) {

      return {
        success: false,

        error:
          `Groq access denied (403): ${detail}`
      };
    }


    // ----------------------------------------------------------------------
    // 404 — Endpoint / Model
    // ----------------------------------------------------------------------

    if (
      response.status === 404
    ) {

      return {
        success: false,

        error:
          `Groq resource not found (404): ${detail}`
      };
    }


    // ----------------------------------------------------------------------
    // 429 — Rate Limit
    // ----------------------------------------------------------------------

    if (
      response.status === 429
    ) {

      return {
        success: false,

        error:
          "Groq rate limit reached (429). Please wait a moment and try again."
      };
    }


    // ----------------------------------------------------------------------
    // 400 — Invalid Request / Model
    // ----------------------------------------------------------------------

    if (
      response.status === 400
    ) {

      if (
        normalizedDetail.includes("model")
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
          `Invalid Groq request: ${detail}`
      };
    }


    // ----------------------------------------------------------------------
    // Other errors
    // ----------------------------------------------------------------------

    return {
      success: false,

      error:
        `Groq API error (${response.status}): ${detail}`
    };
  }


  // ========================================================================
  // PARSE GROQ RESPONSE
  // ========================================================================

  let responseBody;

  try {

    responseBody =
      await response.json();

  } catch (error) {

    console.error(
      "[Swadesh Code Analyzer] Response parsing error:",
      error
    );


    return {
      success: false,

      error:
        "Received an unreadable response from Groq."
    };
  }


  // ========================================================================
  // EXTRACT MODEL CONTENT
  // ========================================================================

  const rawContent =
    responseBody
      ?.choices
      ?.[0]
      ?.message
      ?.content
      ?? "";


  if (
    typeof rawContent !== "string" ||
    rawContent.trim().length === 0
  ) {

    return {
      success: false,

      error:
        "Groq returned an empty response. Please try again."
    };
  }


  // ========================================================================
  // CLEAN JSON
  // ========================================================================

  const cleaned =
    rawContent
      .replace(
        /^```(?:json)?\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();


  // ========================================================================
  // PARSE JSON
  // ========================================================================

  let analysisData;

  try {

    analysisData =
      JSON.parse(cleaned);

  } catch (error) {

    console.error(
      "[Swadesh Code Analyzer] Invalid JSON returned by Groq:",
      rawContent
    );


    return {
      success: false,

      error:
        "The AI returned invalid JSON. Please try analyzing the code again."
    };
  }


  // ========================================================================
  // VALIDATE ANALYSIS
  // ========================================================================

  const timeComplexity =
    typeof analysisData?.time_complexity === "string"
      ? analysisData.time_complexity.trim()
      : "N/A";


  const spaceComplexity =
    typeof analysisData?.space_complexity === "string"
      ? analysisData.space_complexity.trim()
      : "N/A";


  const bottlenecks =
    Array.isArray(
      analysisData?.bottlenecks
    )
      ? analysisData.bottlenecks
          .filter(
            item =>
              typeof item === "string"
          )
          .map(
            item =>
              item.trim()
          )
          .filter(Boolean)
          .slice(0, 5)
      : [];


  const optimizations =
    Array.isArray(
      analysisData?.optimizations
    )
      ? analysisData.optimizations
          .filter(
            item =>
              typeof item === "string"
          )
          .map(
            item =>
              item.trim()
          )
          .filter(Boolean)
          .slice(0, 5)
      : [];


  // ========================================================================
  // FINAL RESPONSE
  // ========================================================================

  return {

    success: true,

    data: {

      time_complexity:
        timeComplexity,

      space_complexity:
        spaceComplexity,

      bottlenecks:
        bottlenecks,

      optimizations:
        optimizations

    }

  };
}
