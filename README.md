# ⚡ Swadesh Code Analyzer — CP Edition

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-Firefox-FF7139.svg)
![Architecture](https://img.shields.io/badge/architecture-Serverless_BYOK-success.svg)

A lightning-fast, serverless browser extension that provides instant AI-powered complexity analysis and optimization suggestions for competitive programming solutions on **LeetCode** and **Codeforces**.

---

## 💡 The Problem

While practicing for coding interviews or competitive programming contests, analyzing time/space complexity and identifying bottlenecks manually can be time-consuming. Existing AI tools often require copying and pasting code into a separate tab, which breaks the developer's flow state and loses the specific problem context.

## 🛠️ The Solution

**Swadesh Code Analyzer** injects a lightweight, context-aware **"Analyze"** button directly into the LeetCode and Codeforces editors. It extracts the code and problem context and utilizes the **Groq API** to return a structured analysis.

### Key Features

- **Instant Inference**: Powered by Groq's inference engine for fast AI responses.
- **Context-Aware Extraction**: Automatically extracts problem context, code, and programming language to provide relevant analysis.
- **Native UI Injection**: Renders a clean, dark-themed analysis interface directly over the coding environment.
- **Time Complexity Analysis**: Identifies the expected time complexity of your solution.
- **Space Complexity Analysis**: Estimates additional memory usage.
- **Bottleneck Detection**: Highlights potentially inefficient parts of the solution.
- **Optimization Suggestions**: Provides suggestions for improving algorithmic efficiency.

---

## 🏗️ Architecture & Engineering Decisions

This project uses a serverless BYOK architecture designed to reduce infrastructure requirements while keeping API configuration under the user's control.

- **Serverless BYOK (Bring Your Own Key)**: Users provide their own Groq API key, which is stored locally using `browser.storage.local`.
  - _Impact_: Removes the need for a centralized backend server and avoids maintaining a shared API infrastructure.

- **Manifest V3**: Uses the modern browser extension architecture with content scripts and background processing.

- **Dynamic DOM Handling**: LeetCode is a complex React-based single-page application that frequently re-renders. The content script uses DOM observation and dynamic element detection to keep the analyzer available during navigation and UI changes.

- **Lightweight Integration**: The extension operates directly within supported coding platforms without requiring users to copy their code into another application.

---

## 🔐 Privacy & Security

Swadesh Code Analyzer follows a **Bring Your Own Key (BYOK)** approach.

- Your Groq API key is stored locally in the browser.
- No custom backend server is required.
- The extension does not require users to create an account.
- Your API key should never be shared publicly or committed to a repository.

> **Never commit your Groq API key to GitHub or include it directly in source code.**

---

## 🌐 Supported Platforms

### LeetCode

Analyze solutions directly while solving LeetCode problems.

### Codeforces

Analyze solutions directly on supported Codeforces problem pages.

---

## ⚙️ Local Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/i-git-abhishek/code-analyzer.git
