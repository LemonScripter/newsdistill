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
function cleanJSON(str) {
    // Eltávolítja a markdown formázást
    return str.replace(/```json/g, '').replace(/```/g, '').trim();
}

async function callAIProvider(providerConfig, prompt, systemPrompt) {
    if (!providerConfig.key) return null; // Ha nincs kulcs, átugorjuk

    console.log(`[AI] Csatlakozás: ${providerConfig.name}...`);

    const payload = {
        model: providerConfig.model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
        ],
        temperature: providerConfig.temperature,
        max_tokens: 2000 // Növelve, hogy biztosan beleférjen minden
    };

    try {
        const res = await axios.post(providerConfig.url, payload, {
            headers: { 
                'Authorization': `Bearer ${providerConfig.key}`, 
                'Content-Type': 'application/json' 
            },
            timeout: 25000 // 25mp limit per hívás
        });

        const content = res.data.choices[0].message.content;
        return cleanJSON(content);
    } catch (e) {
        console.error(`[AI] HIBA (${providerConfig.name}):`, e.message);
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
1. 'violation_id': Másold be pontosan az ID-t (pl. RULE_DEFAMATION).
2. 'law_reference': Másold be pontosan a szabályhoz tartozó 'FORRÁS' mező tartalmát! NE ÍRD IDE A SZABÁLY NEVÉT! Csak a törvényt és a cikkelyt!
3. 'severity': LOW, MEDIUM, HIGH, CRITICAL.
4. 'explanation': Írd le magyarul az indoklást. FONTOS: Ebben a szövegben SOHA NE HASZNÁLJ KÓDOKAT (pl. RULE_MURE_5)!
5. Misszió ellenőrzés: Ha 'RULE_UH_MISSION_CONSISTENCY' sérelmet találsz, azt mindenképp jelezd külön flag-ként!

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
      "original_segment": "Idézet (max 1 mondat)",
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
            
            // Limitáljuk a hosszt a sebesség érdekében (kb. 6500 karakter)
            const truncatedContent = content.substring(0, 6500);
            const userPrompt = `CÍM: ${title}\n\nTARTALOM (Részlet):\n${truncatedContent}`;

            // --- 3. FAILOVER LOGIKA (Vízesés modell) ---
            const providers = getProviders();
            let finalResult = null;
            let failedLog = [];

            for (const provider of providers) {
                if (!provider.key) continue;

                try {
                    const rawJson = await callAIProvider(provider, userPrompt, SYSTEM_PROMPT);
                    
                    if (rawJson) {
                        // Validálás: Megpróbáljuk JSON-ként értelmezni
                        finalResult = JSON.parse(rawJson);
                        
                        console.log(`✅ SIKERES ELEMZÉS (${provider.name})!`);
                        // Metaadatba beírjuk az auditáló nevét
                        finalResult.ui_meta.verdict_summary += ` (Auditálta: ${provider.name})`;
                        break; // Siker, kilépünk!
                    }
                } catch (e) {
                    console.error(`❌ JSON Parse Hiba (${provider.name}) - A válasz nem volt valid JSON.`);
                    failedLog.push(`${provider.name}: Invalid JSON response`);
                }
            }

            // --- 4. VÉGLEGES VÁLASZ ---
            if (!finalResult) {
                console.error("VÉGZETES: Minden AI elutasította a kérést.");
                return {
                    statusCode: 200, 
                    body: JSON.stringify({
                        ui_meta: {
                            risk_level: "ERROR",
                            objectivity_score: 0,
                            verdict_summary: "Sajnos technikai okok miatt az elemzés nem sikerült. A rendszer jelenleg túlterhelt, vagy a mesterséges intelligencia modellek nem érhetőek el. Kérjük, próbálja újra 15-30 perc múlva."
                        },
                        flags: [],
                        rewritten_article: null
                    })
                };
            }

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