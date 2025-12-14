# ⚖️ NewsDistill - AI Media Forensic Auditor

**NewsDistill** is an advanced, AI-powered media audit system designed to evaluate news articles for objectivity, legal compliance, and ethical standards. It utilizes a **Parallel Consensus Protocol** involving multiple Large Language Models (LLMs) to ensure unbiased, hallucination-free analysis.

![Version](https://img.shields.io/badge/version-2.0.0_Stable-blue) ![Stack](https://img.shields.io/badge/stack-Netlify_Functions_|_Node.js-green) ![License](https://img.shields.io/badge/license-MIT-purple)

---

## 🚀 Key Features (v2.0.0)

### 🧠 Multi-AI Consensus Protocol & "Minority Report"
Unlike traditional single-model tools, NewsDistill queries **6 top-tier AI models simultaneously** to form a "jury verdict".
*   **Minority Report Protocol:** The system detects when a specific model identifies a high risk (High/Critical) that others miss. Instead of suppressing this via averaging, it highlights the **dissenting opinion** to prevent "tyranny of the majority."
*   **Models:** Google Gemini (Flash 1.5), Groq (Llama 3.3), Mistral AI, OpenAI (GPT-4o), xAI (Grok-2), Perplexity (Sonar).
*   **Aggregation:** The system merges flags, cross-references findings, and averages objectivity scores.

### 👁️ Contextual Analysis Layer
*   **Irony & Dog-whistle Detection:** Beyond literal interpretation, v2.0 includes a specialized analysis layer to detect **sarcasm, irony, and coded political messages** ("dog whistles") that strict legal filters might miss.
*   **Forensic Prompting:** Uses advanced system prompts to separate factual reporting from manipulative commentary.

### 🛡️ Dynamic Legal Matrix
The core logic relies on a strictly version-controlled JSON database (`data/legal_matrix.json`) that can be auto-updated from official sources:
*   **Auto-Versioning:** The system tracks the exact version/date of the legal database used for each audit, warning users if the rules are outdated.
*   **Hard Law:** Romanian Penal Code (Hate Speech), Civil Code (Dignity), Constitution, GDPR.
*   **Soft Law:** BBC Editorial Guidelines, MÚRE / MÚOSZ Code of Ethics.

### 💻 Modern UI/UX
*   **Dashboard:** Interactive visualization of risk levels, objectivity scores, and specific violations.
*   **Context Box:** Dedicated UI area for displaying hidden meanings and sarcastic subtexts.
*   **Legal Library:** Direct links to official government statutes (Just.ro, EUR-Lex) for every flagged issue.
*   **Transparency:** Users can compare the original text with a "Neutralized Rewrite" suggested by the AI.

---

## 📂 Project Structure

```
├── data/
│   └── legal_matrix.json       # The "Constitution" of the system (Rules & Laws)
├── netlify/
│   └── functions/
│       └── analyze.js          # Backend logic (Consensus Engine & Scraping)
├── public/
│   ├── index.html              # Landing Page
│   ├── dashboard.html          # Analysis Results & Visualization
│   ├── about.html              # Methodology Documentation
│   └── sources.html            # Legal Resources Library
└── .env                        # API Keys (Not committed)
```

---

## 🛠️ Installation & Setup

### Prerequisites
*   Node.js (v18+)
*   Netlify CLI (`npm install -g netlify-cli`)

### 1. Clone & Install
```bash
git clone https://github.com/LemonScripter/newsdistill.git
cd newsdistill
npm install
```

### 2. Configure API Keys
Create a `.env` file in the root directory and add your provider keys:
```env
GEMINI_API_KEY=...
GROQ_API_KEY=...
MISTRAL_API_KEY=...
OPENAI_API_KEY=...
GROK_API_KEY=...
PERPLEXITY_API_KEY=...
```

### 3. Run Locally
```bash
netlify dev
```
The application will be available at `http://localhost:8888`.

---

## ⚖️ Disclaimer
NewsDistill is a decision-support tool. While it uses official legal databases and state-of-the-art AI, its outputs **do not constitute legal advice**. Always consult with a qualified attorney for legal disputes.

---
© 2025 NewsDistill Engine. Developed by László Szőke.
