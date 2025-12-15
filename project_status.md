# NewsDistill Project Status
**Date:** 2025. december 15.
**Status:** 🟢 Live / Stable (Full AI Consensus + Rate Limiting)
**URL:** https://newsdistill.netlify.app

## 🚀 Accomplishments (Today)
1. **Full AI Consensus Engine**
   - Successfully integrated and verified **5 concurrent AI models**:
     - ✅ OpenAI (GPT-4o)
     - ✅ Google Gemini (Flash 2.0) - Fixed 404/429 errors.
     - ✅ Perplexity (Sonar) - Fixed 401 errors.
     - ✅ Groq (Llama 3.3)
     - ✅ Mistral AI (EU)
   - The system now aggregates opinions from all 5 models to produce a "Consensus Verdict" and "Minority Report".
   - Verified execution time: ~5.3s for 5 models.

2. **Visual Audit (Backend Ready / UI Disabled)**
   - Backend now extracts and sanitizes HTML content (`article_html`) using a "Smart Selector" and "Whitelist" approach.
   - Frontend UI for Visual Audit (Reader View) is implemented but **temporarily hidden** (showing a "Under Development" message) until content cleaning is perfected.
   - Layout fallbacks and styling improvements implemented.

3. **Cost Control & Infrastructure**
   - **Rate Limiting:** Implemented a global daily limit of **15 new analyses** per day (using Netlify Blobs). Cached analyses remain free and unlimited.
   - Solved Netlify Blobs caching issues (manually injected environment variables).
   - Fixed multiple API key/quota issues.
   - Standardized Footer and CSS across all pages.

## ⚠️ Known Issues
1. **Scraping Limitations**
   - Standard `axios` scraper receives 404/Blocking from protected news sites (e.g., Telex, BBC, uh.ro).
   - **Workaround:** Works fine on less protected sites (example.com), but a robust scraping solution (Puppeteer/Playwright or API service) is needed for production-grade reliability.

2. **Visual Content Quality**
   - Extracted HTML still contains some "noise" (related links, ads) despite whitelist filtering. Requires further refinement before enabling UI.

## 📋 Next Steps
- [ ] **Scraping Upgrade:** Implement a headless browser service or proxy rotation to bypass news site blockers.
- [ ] **Visual Audit Polish:** Fine-tune the content extraction logic (Readability.js integration?) and enable the UI tab.
- [ ] **Monitoring:** Watch API quotas (especially Gemini Free Tier).
