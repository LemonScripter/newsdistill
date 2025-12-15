const axios = require('axios');
const cheerio = require('cheerio');
const { getStore } = require('@netlify/blobs'); // v2.1 Cache

// --- 1. JOGI MÁTRIX BETÖLTÉSE ---
let fullLegalMatrix = [];
try {
    fullLegalMatrix = require('../../data/legal_matrix.json');
} catch (e) {
    console.error("HIBA: Nem található a legal_matrix.json! (Fallback mód)");
    // Fallback vész esetére
    fullLegalMatrix = [{
        id: "FALLBACK", 
        description: "Általános etikai vizsgálat.", 
        trigger_logic: "Etikátlan tartalom.",
        sources: [{ law: "Etikai Kódex", article: "Általános elvek" }]
    }];
}

// --- KONFIGURÁCIÓ: AI SZOLGÁLTATÓK (PRIORITÁSI SORREND) ---
const getProviders = () => [
    {
        id: 'GEMINI',
        name: 'Google Gemini (Flash 1.5)',
        key: process.env.GEMINI_API_KEY,
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
        model: 'gemini-1.5-flash',
        temperature: 0.1
    },
    {
        id: 'GROQ',
        name: 'Groq (Llama 3.3)',
        key: process.env.GROQ_API_KEY,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1
    },
    {
        id: 'MISTRAL',
        name: 'Mistral AI (EU)',
        key: process.env.MISTRAL_API_KEY,
        url: 'https://api.mistral.ai/v1/chat/completions',
        model: 'mistral-small-latest',
        temperature: 0.1
    },
    {
        id: 'OPENAI',
        name: 'OpenAI (GPT-4o)',
        key: process.env.OPENAI_API_KEY,
        url: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o',
        temperature: 0.2
    },
    {
        id: 'XAI',
        name: 'xAI (Grok-2)',
        key: process.env.GROK_API_KEY,
        url: 'https://api.x.ai/v1/chat/completions',
        model: 'grok-beta',
        temperature: 0.2
    },
    {
        id: 'PERPLEXITY',
        name: 'Perplexity (Sonar)',
        key: process.env.PERPLEXITY_API_KEY,
        url: 'https://api.perplexity.ai/chat/completions',
        model: 'sonar',
        temperature: 0.1
    }
];

// --- SEGÉDFÜGGVÉNYEK ---
function extractJSON(str) {
    // Debug log a bemenetről (első 100 karakter)
    console.log(`[extractJSON] Bemenet hossza: ${str.length}, Eleje: ${str.substring(0, 50)}...`);

    // 1. Megpróbáljuk a markdown blokkok eltávolítását
    let cleaned = str.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // 2. Megkeressük az első '{' és az utolsó '}' karaktert
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonCandidate = cleaned.substring(firstBrace, lastBrace + 1);
        console.log(`[extractJSON] JSON találat: ${firstBrace}-tól ${lastBrace}-ig.`);
        return jsonCandidate;
    }

    console.warn("[extractJSON] NEM találtam JSON objektumot ({...}) a válaszban!");
    return cleaned; // Ha nem találunk JSON struktúrát, visszaadjuk az eredetit
}

async function callAIProvider(providerConfig, prompt, systemPrompt) {
    if (!providerConfig.key) return null; // Ha nincs kulcs, átugorjuk

    console.log(`[AI] Csatlakozás: ${providerConfig.name}...`);
    let payload;
    let headers = { 'Content-Type': 'application/json' };

    // GEMINI SPECIFIKUS KEZELÉS
    if (providerConfig.id === 'GEMINI') {
        const fullPrompt = `${systemPrompt}\n\nFELHASZNÁLÓI BEMENET:\n${prompt}`;
        payload = {
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: {
                temperature: providerConfig.temperature,
                maxOutputTokens: 8000 // Gemini támogat nagy kimenetet
            }
        };
        // A Gemini API URL-be kell a kulcs query paraméterként
    } else {
        // OPENAI STANDARD KEZELÉS (Groq, Mistral, OpenAI, xAI, Perplexity)
        payload = {
            model: providerConfig.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            temperature: providerConfig.temperature,
            max_tokens: 4000
        };
        headers['Authorization'] = `Bearer ${providerConfig.key}`;
    }

    try {
        let url = providerConfig.url;
        // Gemini esetén a kulcs az URL-ben van
        if (providerConfig.id === 'GEMINI') {
            url = `${url}?key=${providerConfig.key}`;
        }

        const res = await axios.post(url, payload, {
            headers: headers,
            timeout: 25000 
        });

        let content;
        if (providerConfig.id === 'GEMINI') {
            content = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
        } else {
            content = res.data.choices[0].message.content;
        }

        if (!content) throw new Error("Üres válasz az AI-tól");

        return extractJSON(content);
    } catch (e) {
        // Részletesebb hibaüzenet logolása
        const errorMsg = e.response?.data?.error?.message || e.message;
        console.error(`[AI] HIBA (${providerConfig.name}):`, errorMsg);
        return null;
    }
}

exports.handler = async (event, context) => {
    // DEBUG: Kulcsok ellenőrzése (csak az első 5 karakter)
    console.log("--- API KULCS DIAGNOSZTIKA ---");
    console.log("GEMINI:", process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 5) + "..." : "NINCS MEGADVA");
    console.log("GROQ:", process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.substring(0, 5) + "..." : "NINCS MEGADVA");
    console.log("OPENAI:", process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 5) + "..." : "NINCS MEGADVA");
    console.log("------------------------------");

    // Globális timeout védelem (26s - Netlify limit)
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Global Timeout (26s)")), 26000));

    const mainTask = async () => {
        try {
            if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
            
            let body;
            try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, body: "Invalid JSON" }; }
            if (!body.url) return { statusCode: 400, body: "Missing URL" };

            const targetUrl = body.url.toLowerCase();

            // --- v2.1 CACHE LOGIKA (Netlify Blobs) ---
            // 30 napos cache idő
            const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; 
            const cacheKey = Buffer.from(targetUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, ''); // URL -> Base64 -> Safe Filename
            let store;
            
            try {
                store = getStore({ name: 'analysis_cache', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
                const cachedEntry = await store.get(cacheKey, { type: 'json' });

                if (cachedEntry && cachedEntry.timestamp) {
                    const age = Date.now() - cachedEntry.timestamp;
                    if (age < CACHE_TTL_MS) {
                        console.log(`[CACHE] HIT! URL: ${targetUrl}, Age: ${Math.round(age / 1000 / 60)} min`);
                        // Visszaadjuk a tárolt eredményt
                        return { statusCode: 200, body: JSON.stringify(cachedEntry.data) };
                    } else {
                        console.log(`[CACHE] EXPIRED! URL: ${targetUrl}, Age: ${Math.round(age / 1000 / 60 / 60 / 24)} days`);
                        // Lejárt, de törölni nem feltétlen kell, felülírjuk majd
                    }
                } else {
                    console.log(`[CACHE] MISS! URL: ${targetUrl}`);
                }
            } catch (cacheError) {
                console.warn("[CACHE] Hiba a blob store elérésekor:", cacheError.message);
                // Nem állunk meg, megyünk tovább az élő elemzéssel
            }
            // ------------------------------------------


            // --- 1. SZABÁLYSZŰRÉS ÉS BIZTONSÁGI BESZÚRÁS ---
            
            // a) Metaadatok kinyerése (v2 Dynamic DB)
            const metaObj = fullLegalMatrix.find(r => r.id === 'META_INFO');
            const dbVersionDate = metaObj ? metaObj.last_verified : "Ismeretlen";

            // b) Alap szűrés: Kivesszük a "BELSŐ" és "META" kategóriájú szabályokat
            let activeMatrix = fullLegalMatrix.filter(rule => rule.category !== 'BELSŐ' && rule.category !== 'META');

            // c) Ha uh.ro a célpont, akkor VISSZATESSZÜK a BELSŐ szabályt az eredeti listából
            if (targetUrl.includes('uh.ro')) {
                const missionRule = fullLegalMatrix.find(rule => rule.id === 'RULE_INTERNAL_MISSION');
                if (missionRule) {
                    activeMatrix.push(missionRule);
                    console.log("[Logic] uh.ro detektálva -> RULE_INTERNAL_MISSION aktiválva.");
                } else {
                    console.warn("[Logic] uh.ro detektálva, de a RULE_INTERNAL_MISSION nem található a JSON-ben!");
                }
            }

            // c) Prompt generálás - Kiemelten a FORRÁS mezővel
            const RULES_TEXT = activeMatrix.map(rule => {
                const sourceText = (rule.sources || []).map(s => `${s.law} ${s.article}`).join('; ');
                return `ID: ${rule.id}\nSZABÁLY: ${rule.description}\nFORRÁS (KÖTELEZŐ MÁSOLNI): ${sourceText || "Szakmai Etikai Norma"}\nTRIGGER: ${rule.trigger_logic}`;
            }).join('\n----------------\n');

            const SYSTEM_PROMPT = `
SZEREP: Te egy Szigorú Médiajogi Auditor (Forensic Media Auditor) vagy.
FELADAT: Elemezd a cikket a lenti SZABÁLYKÖNYV alapján.

SZABÁLYKÖNYV:
${RULES_TEXT}

KÖTELEZŐ INSTRUKCIÓK A JSON KIMENETHEZ:
1. 'violation_id': Másold be pontosan az ID-t a fenti SZABÁLYKÖNYVBŐL (pl. RULE_DEFAMATION).
2. 'law_reference': Másold be pontosan a szabályhoz tartozó 'FORRÁS' mező tartalmát, beleértve az összes előtagot (pl. '§', 'Codul')! NE ÍRD IDE A SZABÁLY NEVÉT! Csak a törvényt és a cikkelyt!
3. 'severity': LOW, MEDIUM, HIGH, CRITICAL.
4. 'explanation': Írd le magyarul az indoklást. FONTOS: Ebben a szövegben SOHA NE HASZNÁLJ KÓDOKAT (pl. RULE_MURE_5)!
5. Misszió ellenőrzés: Ha 'RULE_INTERNAL_MISSION' sérelmet találsz, azt mindenképp jelezd külön flag-ként!
6. 'contextual_analysis': Vizsgáld a szövegkörnyezetet! Van benne szarkazmus, irónia vagy "dog whistle" (kódolt politikai üzenet)? Ha igen, írd le röviden magyarul. Ha tiszta/tényszerű, hagyd üresen.

FIGYELEM: A válaszod KIZÁRÓLAG a nyers JSON objektum legyen!
NE írj bevezető szöveget (pl. "Itt van a JSON...").
NE írj lezáró szöveget.
NE használj markdown formázást (pl. json kodblokk).
CSAK A { ... } TARTALOM KELL!

KIMENET: Valid JSON.
{
  "ui_meta": {
    "risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    "objectivity_score": 0-100,
    "verdict_summary": "Tömör jogi összefoglaló (max 3 mondat)."
  },
  "contextual_analysis": "Rejtett jelentés leírása vagy üres string",
  "flags": [
    {
      "violation_id": "Szabály ID",
      "severity": "RED" | "YELLOW",
      "original_segment": "Idézet",
      "explanation": "Indoklás",
      "law_reference": "Jogforrás"
    }
  ],
  "rewritten_article": {
    "neutral_headline": "Cím javaslat", 
    "neutral_body_html": "HTML szöveg"
  }
}`;

            // --- 2. SCRAPING ---
            console.log(`[Scrape] ${body.url}`);
            const scrapeRes = await axios.get(body.url, { headers: { 'User-Agent': 'NewsDistill/1.0' }, timeout: 5000 });
            const $ = cheerio.load(scrapeRes.data);
            
            const title = $('h1').text().trim() || $('meta[property="og:title"]').attr('content') || "Cím nem található";
            
            const author = 
                $('meta[name="author"]').attr('content') || 
                $('meta[property="article:author"]').attr('content') || 
                $('.author').first().text().trim() || 
                $('.post-author').first().text().trim() || 
                $('.entry-author').first().text().trim() || 
                $('.byline').first().text().trim() || 
                $('a[rel="author"]').first().text().trim() || 
                "Ismeretlen szerző";

            const domain = new URL(targetUrl).hostname.replace('www.', '');

            let content = $('article').text().trim() || $('div.entry-content').text().trim() || $('p').text().trim();
            const truncatedContent = content.substring(0, 25000);
            const userPrompt = `CÍM: ${title}\nSZERZŐ: ${author}\n\nTARTALOM (Részlet):\n${truncatedContent}`;

            // --- 3. PÁRHUZAMOS ELEMZÉS ÉS AGGREGÁCIÓ (Consensus Protocol v2) ---
            const providers = getProviders();
            const activeProviders = providers.filter(p => p.key).slice(0, 6);
            
            console.log(`[Consensus] Indítás ${activeProviders.length} modellel: ${activeProviders.map(p => p.name).join(', ')}`);

            const promises = activeProviders.map(async (provider) => {
                try {
                    const rawJson = await callAIProvider(provider, userPrompt, SYSTEM_PROMPT);
                    if (!rawJson) throw new Error("Empty response");
                    const parsed = JSON.parse(rawJson);
                    return { provider: provider.name, data: parsed, success: true };
                } catch (e) {
                    console.error(`❌ HIBA (${provider.name}):`, e.message);
                    return { provider: provider.name, error: e.message, success: false };
                }
            });

            const results = await Promise.allSettled(promises);
            const successfulResults = results
                .filter(r => r.status === 'fulfilled' && r.value.success)
                .map(r => r.value);

            // --- 4. EREDMÉNYEK ÖSSZEFÉSÜLÉSE (v2 Logic) ---
            if (successfulResults.length === 0) {
                console.error("VÉGZETES: Minden AI elutasította a kérést.");
                return {
                    statusCode: 200, 
                    body: JSON.stringify({
                        ui_meta: { risk_level: "ERROR", objectivity_score: 0, verdict_summary: "Nem sikerült az elemzés egyetlen modellel sem." },
                        flags: [],
                        rewritten_article: null
                    })
                };
            }

            let combinedFlags = [];
            let totalScore = 0;
            let summaries = [];
            let riskLevels = [];
            let contextualAnalyses = []; // v2: Kontextus gyűjtő

            const riskOrder = { "CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1 };
            const riskLevelNames = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

            successfulResults.forEach(res => {
                const { provider, data } = res;
                
                // Flags
                if (data.flags && Array.isArray(data.flags)) {
                    const taggedFlags = data.flags.map(f => ({ ...f, explanation: `[${provider}] ${f.explanation}` }));
                    combinedFlags.push(...taggedFlags);
                }

                // Score
                totalScore += (data.ui_meta.objectivity_score || 0);

                // Summary
                summaries.push(`**${provider}:** ${data.ui_meta.verdict_summary}`);

                // Risk
                if (data.ui_meta.risk_level) riskLevels.push({ provider: provider, level: data.ui_meta.risk_level, value: riskOrder[data.ui_meta.risk_level] || 1 });

                // Context (v2)
                if (data.contextual_analysis && data.contextual_analysis.length > 5) {
                    contextualAnalyses.push(`[${provider}]: ${data.contextual_analysis}`);
                }
            });

            // v2: Kisebbségi jelentés (Minority Report) Logika
            // Megkeressük a "Konszenzus" szintet (pl. módusz vagy átlag), és megnézzük, ki tér el felfelé.
            
            // 1. Átlagos pontszám
            const avgScore = Math.round(totalScore / successfulResults.length);
            
            // 2. Legmagasabb kockázat (Safety First) - Ez marad a fő plecsni
            const maxRiskVal = Math.max(...riskLevels.map(r => r.value));
            const finalRisk = riskLevelNames[maxRiskVal - 1] || "LOW";

            // 3. Különvélemény keresés (Dissenting Opinion)
            // Ha a többség (vagy legalább 1 modell) LOW/MEDIUM, de van HIGH/CRITICAL, az gyanús.
            // Vagy fordítva: Mindenki CRITICAL, de valaki LOW (bár ez kevésbé veszélyes).
            // A "Kisebbségi jelentés" akkor érdekes, ha valaki VESZÉLYT jelez, miközben mások nem.
            
            let minorityReport = null;
            const highRiskCount = riskLevels.filter(r => r.value >= 3).length; // HIGH vagy CRITICAL
            const totalCount = riskLevels.length;

            if (highRiskCount > 0 && highRiskCount < totalCount) {
                // Van nézeteltérés! Van magas kockázat, de nem mindenki szerint.
                const dissenters = riskLevels.filter(r => r.value >= 3);
                const dissenterNames = dissenters.map(d => d.provider).join(', ');
                minorityReport = {
                    title: "Kisebbségi jelentés (Kockázat)",
                    content: `${dissenterNames} magasabb kockázatot (HIGH/CRITICAL) azonosított, míg más modellek enyhébbnek ítélték.`,
                    dissenters: dissenters
                };
            }

            // 4. Kontextuális réteg összefésülése
            let finalContext = null;
            if (contextualAnalyses.length > 0) {
                // Ha legalább 2 modell lát iróniát, vagy 1 modell nagyon hosszan ír róla
                finalContext = contextualAnalyses.join(' | ');
            }

            const finalSummary = summaries.join('\n\n');
            const finalRewrite = successfulResults[0].data.rewritten_article;

            const finalResult = {
                metadata: { title, author, domain, url: targetUrl },
                db_version_date: dbVersionDate,
                ui_meta: {
                    risk_level: finalRisk,
                    objectivity_score: avgScore,
                    verdict_summary: finalSummary
                },
                minority_report: minorityReport, // v2 Feature
                contextual_analysis: finalContext, // v2 Feature
                flags: combinedFlags,
                rewritten_article: finalRewrite
            };
            
            // --- v2.1 CACHE MENTÉS ---
            try {
                if(store) {
                    await store.setJSON(cacheKey, { timestamp: Date.now(), data: finalResult });
                    console.log(`[CACHE] SAVED! URL: ${targetUrl}`);
                }
            } catch (saveError) {
                console.warn("[CACHE] Hiba a mentéskor:", saveError.message);
            }
            // ------------------------

            console.log(`✅ SIKERES AGGREGÁCIÓ (v2): ${successfulResults.length} modell. Minority: ${minorityReport ? 'VAN' : 'NINCS'}`);
            return { statusCode: 200, body: JSON.stringify(finalResult) };

        } catch (error) {
            console.error("HANDLER CRASH:", error.message);
            return { 
                statusCode: 200, 
                body: JSON.stringify({
                    ui_meta: {
                        risk_level: "ERROR",
                        objectivity_score: 0,
                        verdict_summary: "A cikk feldolgozása során váratlan hiba történt. Kérjük ellenőrizze az URL-t, vagy próbálja újra később."
                    },
                    flags: [],
                    rewritten_article: null
                })
            };
        }
    };

    try {
        return await Promise.race([mainTask(), timeoutPromise]);
    } catch (e) {
        return { 
            statusCode: 200, 
            body: JSON.stringify({
                ui_meta: {
                    risk_level: "ERROR",
                    objectivity_score: 0,
                    verdict_summary: "Az elemzés időtúllépés miatt megszakadt. A cikk túl hosszú lehet, vagy a rendszerek lassan válaszolnak."
                },
                flags: [],
                rewritten_article: null
            })
        };
    }
};