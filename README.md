# ⚡ Code Analyzer — CP Edition

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-Firefox-FF7139.svg)
![Architecture](https://img.shields.io/badge/architecture-Serverless_BYOK-success.svg)

A lightning-fast, serverless browser extension that provides instant AI-powered complexity analysis and optimization suggestions for competitive programming solutions on **LeetCode** and **Codeforces**.

---

## 💡 The Problem

While practicing for coding interviews or competitive programming contests, analyzing time/space complexity and identifying bottlenecks manually can be time-consuming. Existing AI tools often require copying and pasting code into a separate tab, which breaks the developer's flow state and loses the specific problem context.

## 🛠️ The Solution

Code Analyzer injects a lightweight, context-aware **"Analyze"** button directly into the LeetCode and Codeforces editors. It extracts the code and problem context, utilizing the **Groq API (Llama 3.3 70B)** to return a structured analysis in under 500ms.

### Key Features

- **Instant Inference**: Powered by Groq's LPU inference engine for sub-second AI responses.
- **Context-Aware Extraction**: Automatically scrapes problem titles, numbers, and selected programming languages to provide strict context to the LLM.
- **Native UI Injection**: Renders a clean, dark-themed modal overlay directly over the editor without altering the host page's performance.

---

## 🏗️ Architecture & Engineering Decisions

This project underwent a significant architectural pivot to optimize for speed, operating costs, and user privacy:

- **Serverless BYOK (Bring Your Own Key)**: Initially built with a custom FastAPI Python backend. I migrated to a decentralized BYOK model where the user provides their own Groq API key, which is stored securely in `browser.storage.local`.
  - _Impact_: Eliminated server hosting costs, mitigated central API rate-limiting/abuse risks, and bypassed the 45-second cold-start latency associated with free-tier cloud backends.
- **Manifest V3**: Fully compliant with the latest browser extension security standards, utilizing secure message passing between content scripts and background service workers.
- **Advanced DOM Traversal**: LeetCode is a complex React SPA that frequently re-renders. The content script utilizes advanced traversal of internal React fiber nodes to access the underlying Monaco Editor instance for 100% accurate code extraction. It also employs a `MutationObserver` to ensure the injected UI persists across client-side routing.

---

## ⚙️ Local Development Setup

1. **Clone the repository**:

```bash
   git clone https://github.com/i-git-abhishek/code-analyzer.git
```
