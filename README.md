# ⚖️ NewsDistill - Forensic Media Auditor

**NewsDistill** is an AI-powered media forensics tool designed to audit news articles for legal compliance, ethical standards, and mission consistency. 

It acts as an objective third-party auditor, cross-referencing journalistic content against the **Romanian Penal & Civil Code**, **GDPR**, **European Human Rights standards (ECHR)**, and professional ethical guidelines (BBC, MÚRE).

![Version](https://img.shields.io/badge/version-1.0.5_Beta-blue) ![Stack](https://img.shields.io/badge/stack-Node.js_|_Netlify_Functions-green) ![License](https://img.shields.io/badge/license-Proprietary-red)

---

## 🚀 Key Features

* **🛡️ Legal Compliance Audit:** Checks articles against specific articles of the Romanian Civil Code (Art. 72, 1349) and Penal Code (Art. 369 - Hate Speech).
* **⚖️ Ethical & Bias Detection:** Analyzes content for violations of impartiality (BBC Standards), lack of verification, and opinion manipulation.
* **🎯 Mission Consistency Check:** Specifically for *uh.ro*, it verifies if the article aligns with the media outlet's public mission statement ("Credibility", "Service to Community").
* **🔄 AI Failover System (Waterfall):** A robust multi-provider backend that ensures analysis never fails, even if one AI provider is down or rate-limited.
* **📝 Safe Mode Rewrite:** Generates a neutral, legally compliant version of the problematic text.
* **🇭🇺 Hungarian UI & Output:** The interface and the analysis reports are fully localized in Hungarian.

---

## 🧠 System Architecture

NewsDistill operates on a **Serverless Architecture** using Netlify Functions to secure API keys and handle backend logic.

### 1. The Brain: `legal_matrix.json`
The core of the system is a structured database of laws and rules located in `data/legal_matrix.json`. This acts as the "Constitution" for the AI.
* **Hard Laws:** Romanian Constitution, Civil Code, Penal Code.
* **Soft Laws:** MÚOSZ Code of Ethics, BBC Editorial Guidelines.
* **Internal Rules:** Mission statements (triggered dynamically based on the URL).

### 2. The Logic: AI Waterfall Model
The backend (`analyze.js`) implements a priority-based failover system. It attempts to analyze the article using the following hierarchy:

1.  **Groq (Llama 3.3 70B):** Fastest & Cost-effective.
2.  **Mistral AI (Mistral Small - EU):** Excellent for European legal context.
3.  **OpenAI (GPT-4o):** The most capable model (High precision).
4.  **xAI (Grok-2 Beta):** Uncensored, high-reasoning alternative.
5.  **Perplexity (Sonar):** Final fallback/Search-based verification.

If one provider fails (Rate Limit, 500 Error, Timeout), the system automatically logs the error and tries the next one in the chain without the user noticing.

---

## 🛠️ Installation & Setup

### Prerequisites
* Node.js (v18 or higher)
* Netlify CLI (installed globally: `npm install -g netlify-cli`)

### 1. Clone & Install
Navigate to the project directory and install dependencies:

```bash
cd _NewsDistill_UJ
npm install