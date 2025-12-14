# ⚖️ NewsDistill - AI Media Forensic Auditor

**NewsDistill** is an advanced, AI-powered media audit system designed to evaluate news articles for objectivity, legal compliance, and ethical standards. It utilizes a **Parallel Consensus Protocol** involving multiple Large Language Models (LLMs) to ensure unbiased, hallucination-free analysis.

![Version](https://img.shields.io/badge/version-1.0.7_Stable-blue) ![Stack](https://img.shields.io/badge/stack-Netlify_Functions_|_Node.js-green) ![License](https://img.shields.io/badge/license-MIT-purple)

---

## 🚀 Key Features (v1.0.7)

### 🧠 Multi-AI Consensus Protocol
Unlike traditional single-model tools, NewsDistill queries **6 top-tier AI models simultaneously** to form a "jury verdict".
*   **Models:** Google Gemini (Flash 1.5), Groq (Llama 3.3), Mistral AI, OpenAI (GPT-4o), xAI (Grok-2), Perplexity (Sonar).
*   **Aggregation:** The system merges flags, cross-references findings, and averages objectivity scores to eliminate bias from any single model.
*   **Failover & Resilience:** If one API fails (e.g., rate limit), the analysis continues seamlessly with the remaining models.

### 🛡️ Legal Matrix 2.0
The core logic relies on a strict, pre-defined JSON database (`data/legal_matrix.json`) containing hard laws and soft laws:
*   **Hard Law:** Romanian Penal Code (Hate Speech), Civil Code (Dignity), Constitution, GDPR.
*   **Soft Law:** BBC Editorial Guidelines, MÚRE / MÚOSZ Code of Ethics.
*   **Dynamic Filtering:** Automatically applies specific mission statements (e.g., for *uh.ro*) while keeping general audits neutral for other domains.

### 🔍 Metadata & Forensics
*   **Scraping Engine:** Extracts article title, author, and source domain even from complex structures.
*   **Zero-Temperature:** All AI models run at `temperature: 0.1` to strictly forbid creativity and enforce factual analysis.

### 💻 Modern UI/UX
*   **Dashboard:** Interactive visualization of risk levels, objectivity scores, and specific violations.
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
