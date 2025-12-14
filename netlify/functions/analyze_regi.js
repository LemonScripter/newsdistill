const axios = require('axios');
const cheerio = require('cheerio');

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
    // Globális timeout védelem (26s - Netlify limit)
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Global Timeout (26s)")), 26000));

    const mainTask = async () => {
        try {
            if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
            
            let body;
            try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, body: "Invalid JSON" }; }
            if (!body.url) return { statusCode: 400, body: "Missing URL" };

            const targetUrl = body.url.toLowerCase();

            // --- 1. SZABÁLYSZŰRÉS ÉS BIZTONSÁGI BESZÚRÁS ---
            
            // a) Alap szűrés: Kivesszük az UH-t, hogy ne legyen duplikálva, majd visszatesszük, ha kell
            let activeMatrix = fullLegalMatrix.filter(rule => rule.id !== 'RULE_UH_MISSION_CONSISTENCY');

            // b) Ha uh.ro a célpont, akkor KÉNYSZERÍTVE beszúrjuk a szabályt!
            if (targetUrl.includes('uh.ro')) {
                activeMatrix.push({
                    id: "RULE_UH_MISSION_CONSISTENCY",
                    description: "Az uh.ro missziója: 'Hitelesen és szabadon'. A portál a közösséget szolgálja, kerüli a rejtett manipulációt és a hatásvadászatot.",
                    trigger_logic: "Jelezzen, ha a cikk stílusa (pl. gúnyolódó, gonzo, egyoldalú) ellentmond a portál saját 'hiteles és szolgáló' önképének.",
                    sources: [{ law: "uh.ro Misszió Nyilatkozat", article: "(Hitelesség és Szabadság)" }]
                });
                console.log("[Logic] uh.ro detektálva -> Misszió szabály aktiválva.");
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
5. Misszió ellenőrzés: Ha 'RULE_UH_MISSION_CONSISTENCY' sérelmet találsz, azt mindenképp jelezd külön flag-ként!

FIGYELEM: A vlaszod KIZÁRÓLAG a nyers JSON objektum legyen!
NE írj bevezető szöveget (pl. "Itt van a JSON...").
NE írj lezáró szöveget.
NE használj markdown formázást (\`\`\`json).
CSAK A { ... } TARTALOM KELL!

KIMENET: Valid JSON.
{
  "ui_meta": {
    "risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    "objectivity_score": 0-100,
    "verdict_summary": "Tömör jogi összefoglaló (max 3 mondat)."
  },
  "flags": [
    {
      "violation_id": "Szabály ID (pl. RULE_DEFAMATION)",
      "severity": "RED" | "YELLOW",
      "original_segment": "Közvetlen, szó szerinti idézet a cikkből (max 1 mondat, VÁLTOZATLAN FORMÁBAN)",
      "explanation": "Indoklás magyarul",
      "law_reference": "A törvény neve és cikkelye (pl. Cod Civil Art. 72)"
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
            const title = $('h1').text().trim();
            // Tartalomkeresés fallback logikával
            let content = $('article').text().trim() || $('div.entry-content').text().trim() || $('p').text().trim();
            
            // Limitáljuk a hosszt a sebesség érdekében (kb. 25000 karakter - Gemini/GPT-4o elbírja)
            const truncatedContent = content.substring(0, 25000);
            const userPrompt = `CÍM: ${title}\n\nTARTALOM (Részlet):\n${truncatedContent}`;

            // --- 3. PÁRHUZAMOS ELEMZÉS ÉS AGGREGÁCIÓ (Consensus Protocol) ---
            const providers = getProviders();
            // Csak azokat futtatjuk, amikhez van kulcs. 
            // Megemeljük a limitet 6-ra, hogy MINDENKI (Gemini, Groq, Mistral, OpenAI, xAI, Perplexity) beleférjen!
            const activeProviders = providers.filter(p => p.key).slice(0, 6);
            
            console.log(`[Consensus] Indítás ${activeProviders.length} modellel: ${activeProviders.map(p => p.name).join(', ')}`);

            // Párhuzamos indítás (Promise.allSettled, hogy ne dőljön be, ha egy hibázik)
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

            // --- 4. EREDMÉNYEK ÖSSZEFÉSÜLÉSE ---
            if (successfulResults.length === 0) {
                console.error("VÉGZETES: Minden AI elutasította a kérést.");
                return {
                    statusCode: 200, 
                    body: JSON.stringify({
                        ui_meta: {
                            risk_level: "ERROR",
                            objectivity_score: 0,
                            verdict_summary: "Nem sikerült az elemzés egyetlen modellel sem. (Ellenőrizd az API kulcsokat!)"
                        },
                        flags: [],
                        rewritten_article: null
                    })
                };
            }

            // Aggregáció logika
            let combinedFlags = [];
            let totalScore = 0;
            let summaries = [];
            let riskLevels = [];
            // Prioritási sorrend a kockázatokhoz
            const riskOrder = { "CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1 };
            const riskLevelNames = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

            successfulResults.forEach(res => {
                const { provider, data } = res;
                
                // 1. Flags: Minden flaghez hozzáadjuk a forrást
                if (data.flags && Array.isArray(data.flags)) {
                    const taggedFlags = data.flags.map(f => ({
                        ...f,
                        explanation: `[${provider}] ${f.explanation}` // Megjelöljük, ki mondta
                    }));
                    combinedFlags.push(...taggedFlags);
                }

                // 2. Score: Átlagoláshoz gyűjtünk
                totalScore += (data.ui_meta.objectivity_score || 0);

                // 3. Summary: Gyűjtés
                summaries.push(`**${provider}:** ${data.ui_meta.verdict_summary}`);

                // 4. Risk: Gyűjtés
                if (data.ui_meta.risk_level) riskLevels.push(data.ui_meta.risk_level);
            });

            // Végső számítások
            const avgScore = Math.round(totalScore / successfulResults.length);
            const finalSummary = summaries.join('\n\n');
            
            // Legrosszabb kockázat kiválasztása (Worst-case scenario)
            let maxRiskVal = 0;
            riskLevels.forEach(r => {
                if (riskOrder[r] > maxRiskVal) maxRiskVal = riskOrder[r];
            });
            const finalRisk = maxRiskVal > 0 ? riskLevelNames[maxRiskVal - 1] : "LOW";

            // Az első sikeres modell rewrite-ját használjuk (egyszerűsítés)
            const finalRewrite = successfulResults[0].data.rewritten_article;

            const finalResult = {
                ui_meta: {
                    risk_level: finalRisk,
                    objectivity_score: avgScore,
                    verdict_summary: finalSummary
                },
                flags: combinedFlags,
                rewritten_article: finalRewrite
            };
            
            console.log(`✅ SIKERES AGGREGÁCIÓ: ${successfulResults.length} modell alapján.`);
            return { statusCode: 200, body: JSON.stringify(finalResult) };

            /* EREDETI FAILOVER LOOP KOMMENTEZVE A CSERE MIATT
            for (const provider of providers) { ... } 
            */

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