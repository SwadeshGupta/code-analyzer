"""
main.py — Code Analyzer FastAPI Backend
========================================
Accepts a code snippet + language, calls the Groq API, and returns a
structured JSON analysis containing time/space complexity, bottlenecks,
and optimization suggestions.

Run with:
    uvicorn main:app --reload --port 8000
"""

import os
import json
import re
import logging
from typing import List

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from groq import Groq
from dotenv import load_dotenv

# ─── Logging Setup ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ─── Environment ─────────────────────────────────────────────────────────────

load_dotenv()  # reads .env in the project root

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError(
        "GROQ_API_KEY is not set. "
        "Create a .env file with: GROQ_API_KEY=gsk_..."
    )

# Optional secret token to protect the public endpoint from abuse.
# Set API_SECRET in your Render environment variables.
# The extension sends this in the X-API-Secret header.
API_SECRET = os.getenv("API_SECRET", "")

# ─── Groq Client ─────────────────────────────────────────────────────────────

groq_client = Groq(api_key=GROQ_API_KEY)

# Model selection: llama3-70b-8192 is fast and excellent at structured output.
# Fall back to mixtral-8x7b-32768 for longer code snippets (32k context window).
GROQ_MODEL      = "llama-3.3-70b-versatile"
GROQ_MAX_TOKENS = 1024

# ─── Pydantic Models ──────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    code: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="The source code to analyze.",
    )
    language: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="Programming language (e.g. 'cpp', 'python').",
    )


class AnalysisResult(BaseModel):
    time_complexity:  str        = Field(..., description="Big-O time complexity,  e.g. 'O(N log N)'")
    space_complexity: str        = Field(..., description="Big-O space complexity, e.g. 'O(N)'")
    bottlenecks:      List[str]  = Field(..., description="List of identified performance bottlenecks.")
    optimizations:    List[str]  = Field(..., description="List of concrete optimization suggestions.")


# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Code Analyzer API",
    description="AI-powered complexity and optimization analysis for competitive programming solutions.",
    version="1.0.0",
)

# ─── CORS Middleware ──────────────────────────────────────────────────────────
# We must allow the Firefox extension origin (moz-extension://) and the Chrome
# extension origin (chrome-extension://).  FastAPI's CORSMiddleware uses
# fnmatch-style wildcards, but origin schemes with "://" need explicit listing
# or a custom allow_origin_regex.
#
# The cleanest cross-browser approach: allow all origins for this local-only
# server. This is safe because the server only binds to 127.0.0.1 (localhost)
# — it is never reachable from the public internet.

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # Safe: server binds to 127.0.0.1 only
    allow_credentials=False,      # Must be False when allow_origins=["*"]
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# ─── System Prompt ────────────────────────────────────────────────────────────

def build_system_prompt() -> str:
    return """You are an expert competitive programming coach and algorithm analyst.
Your sole task is to analyze code submitted by the user and return a performance report.

STRICT OUTPUT FORMAT:
- You MUST respond with a single, valid JSON object.
- Do NOT include any text, explanation, markdown, or code fences before or after the JSON.
- Do NOT include comments inside the JSON.
- The JSON object must contain EXACTLY these four keys:

{
  "time_complexity":  "<Big-O string>",
  "space_complexity": "<Big-O string>",
  "bottlenecks":      ["<string>", ...],
  "optimizations":    ["<string>", ...]
}

FIELD RULES:
- "time_complexity"  : A single Big-O expression (e.g. "O(N^2)", "O(N log N)", "O(1)").
                       Analyze the worst-case unless the average-case is significantly better.
- "space_complexity" : A single Big-O expression for auxiliary space (exclude input size unless asked).
- "bottlenecks"      : An array of 1–5 strings. Each string is a concise, specific observation
                       about what makes the code slow or memory-inefficient.
                       If no bottleneck exists, return an array with one entry: "No significant bottlenecks detected."
- "optimizations"    : An array of 1–5 strings. Each string is an actionable suggestion with
                       a brief reason (e.g. "Use a hash map instead of nested loops to reduce
                       time complexity from O(N^2) to O(N).").
                       If the code is already optimal, return: ["Solution appears optimal for the given constraints."]

ANALYSIS GUIDELINES:
- Be precise about variable names (e.g. "The nested loop over `nums` on line ~12 is O(N^2)").
- Consider language-specific overhead (e.g. Python list copies, C++ STL sort).
- For competitive programming, assume N can be up to 10^6 unless the code implies otherwise.
- Do not praise the code or add conversational filler — be direct and technical.
"""


def build_user_prompt(code: str, language: str) -> str:
    return f"""Language: {language}

Code:
```{language}
{code}
```

Analyze this code and return the JSON report."""


# ─── Groq Integration ─────────────────────────────────────────────────────────

def extract_json_from_response(raw: str) -> dict:
    """
    Robustly extract a JSON object from the model's response.
    Handles cases where the model wraps JSON in markdown fences despite instructions.
    """
    # Strip markdown code fences if present
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip()
    cleaned = cleaned.rstrip("```").strip()

    # Try direct parse first
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Try to find the first {...} block in the response
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not extract valid JSON from model response. Raw: {raw[:500]}")


def validate_analysis(data: dict) -> AnalysisResult:
    """Validate the parsed dict against our Pydantic model."""
    required_keys = {"time_complexity", "space_complexity", "bottlenecks", "optimizations"}
    missing = required_keys - set(data.keys())
    if missing:
        raise ValueError(f"Model response is missing required keys: {missing}")
    return AnalysisResult(**data)


async def call_groq_api(code: str, language: str) -> AnalysisResult:
    """
    Calls the Groq API with the system + user prompt.
    Returns a validated AnalysisResult.
    Raises HTTPException on any failure.
    """
    system_prompt = build_system_prompt()
    user_prompt   = build_user_prompt(code, language)

    log.info(f"Calling Groq [{GROQ_MODEL}] for language={language}, code_length={len(code)}")

    try:
        chat_completion = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            max_tokens=GROQ_MAX_TOKENS,
            temperature=0.1,        # Low temperature = deterministic, structured output
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            # Groq supports response_format for JSON mode on some models.
            # We leave it off here and rely on the prompt instead, because
            # JSON mode is not yet supported on all Groq model variants.
        )
    except Exception as e:
        log.error(f"Groq API call failed: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Groq API error: {str(e)}",
        )

    raw_response = chat_completion.choices[0].message.content
    log.info(f"Groq response received ({len(raw_response)} chars)")
    log.debug(f"Raw response: {raw_response}")

    try:
        parsed = extract_json_from_response(raw_response)
        result = validate_analysis(parsed)
    except (ValueError, Exception) as e:
        log.error(f"Failed to parse model response: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"AI returned an unparseable response. Please try again. Detail: {str(e)}",
        )

    return result


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Code Analyzer API", "version": "1.0.0"}


@app.post(
    "/analyze",
    response_model=AnalysisResult,
    tags=["Analysis"],
    summary="Analyze a code snippet",
    description="Accepts code + language, returns AI-generated complexity and optimization analysis.",
)
async def analyze_code(
    request: AnalyzeRequest,
    x_api_secret: str = Header(default=""),
):
    """
    Main analysis endpoint consumed by the browser extension.

    - **code**: The raw source code string (max 50,000 characters).
    - **language**: The programming language identifier (e.g. `cpp`, `python`).
    """
    # Protect the endpoint when deployed publicly
    if API_SECRET and x_api_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Secret header.")

    log.info(f"POST /analyze  language={request.language}  code_length={len(request.code)}")

    result = await call_groq_api(request.code, request.language)

    log.info(
        f"Analysis complete — time={result.time_complexity}  "
        f"space={result.space_complexity}  "
        f"bottlenecks={len(result.bottlenecks)}  "
        f"optimizations={len(result.optimizations)}"
    )

    return result
