const axios = require('axios');
const cheerio = require('cheerio');
const { getStore } = require('@netlify/blobs');

// --- 1. JOGI MÁTRIX BETÖLTÉSE ---
let fullLegalMatrix = [];
try {
    fullLegalMatrix = require('../../data/legal_matrix.json');
} catch (e) {
    console.error("HIBA: Nem található a legal_matrix.json! (Fallback mód)");
    fullLegalMatrix = [{
        id: "FALLBACK",
        description: "Általános etikai vizsgálat.",
        trigger_logic: "Etikátlan tartalom.",
        sources: [{ law: "Etikai Kódex", article: "Általános elvek" }]
    }];
}

// --- 2. EPISZTEMIKUS SZÓTÁR BETÖLTÉSE ---
let epistemicDictionary = { categories: {} };
try {
    epistemicDictionary = require('../../data/epistemic_dictionary.json');
    console.log("[Init] Episztemikus szótár betöltve.");
} catch (e) {
    console.error("[Init] Episztemikus szótár NEM található! (üres fallback)");
}

// --- KONFIGURÁCIÓ: AI SZOLGÁLTATÓK (PRIORITÁSI SORREND) ---
const getProviders = () => [
    {
        id: 'GEMINI',
        name: 'Google Gemini (Flash 2.0)',
        key: process.env.GEMINI_API_KEY,
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        model: 'gemini-2.0-flash',
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

// --- PHASE 1 PROVIDER (Gyors, determinisztikus – csak Groq) ---
const PHASE1_PROVIDER = {
    id: 'GROQ_PHASE1',
    name: 'Groq Phase 1 (Llama 3.3 – Szemantikai kinyerő)',
    key: process.env.GROQ_API_KEY,
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    temperature: 0.0
};

// --- PHASE 1 RENDSZER-PROMPT (Angol – megbízhatóbb struktúrakövető viselkedés) ---
const PHASE1_SYSTEM_PROMPT = `You are a computational linguist specializing in Hungarian media discourse analysis.
Your ONLY task is to extract the SEMANTIC STRUCTURE of a news article – NOT to judge it legally or ethically.
You must identify attribution chains: who says what claim, about whom, in what voice.

CLAIM TYPE TAXONOMY (use these exact enum values):
- AUTHOR_VOICE: The journalist's own statement presented as fact (e.g. "A döntés súlyos következményekkel jár")
- DIRECT_QUOTE: Verbatim quote with explicit attribution verb (e.g. "X azt mondta: '...'")
- INDIRECT_QUOTE: Paraphrased claim attributed to a named source (e.g. "X szerint...", "X állítása szerint...", "X elmondta, hogy...")
- FREE_INDIRECT: Ambiguous – reads as the subject's thought/voice but appears in narrator position without explicit "said/thought" verb
- IMPLICIT: A claim where attribution is embedded in framing, tone, or rhetorical structure without explicit marker

HUNGARIAN ATTRIBUTION MARKERS to look for:
- Direct quote verbs: mondta, kijelentette, közölte, bejelentette, leszögezte, nyilatkozott, hangsúlyozta, hozzátette
- Indirect markers: szerint, állítása szerint, véleménye szerint, értesüléseink szerint, informátorunk szerint
- Certainty markers (author asserts as fact): bizonyítottan, jogerősen, beismerte, elismerte, igazoltan, dokumentáltan
- Uncertainty markers (author distances): állítólag, feltételezhetően, úgy tudni, forrásaink szerint, látszólag, valószínűleg
- Implicit evaluative (hidden author judgment): nyilván, természetesen, köztudomású, nem meglepő, persze, logikusan
- Amplifying markers (rhetorical escalation): sőt, ráadásul, mégis, holott, noha, botrányos, döbbenetes

RULES for author_legally_responsible:
- true  → claim_type is AUTHOR_VOICE
- true  → claim_type is FREE_INDIRECT (author blurs the line and may own the claim legally)
- true  → claim_type is INDIRECT_QUOTE but epistemic_marker indicates CERTAINTY (author asserts as fact)
- false → claim_type is DIRECT_QUOTE (the quoted speaker is primarily responsible)
- false → claim_type is INDIRECT_QUOTE with UNCERTAINTY marker (author is distancing themselves)
- AMBIGUOUS → when you genuinely cannot determine responsibility

OUTPUT RULES:
- Return ONLY a valid JSON object. No markdown. No preamble. No trailing text.
- Extract maximum 15 most legally significant attribution_map entries.
- Extract ALL epistemic_markers found in the article.
- If a field has no data, use an empty array [] or empty string "".

OUTPUT SCHEMA:
{
  "discourse_subject": "string – the primary person/organization this article is ABOUT",
  "entities": ["array of all named persons and organizations mentioned"],
  "attribution_map": [
    {
      "id": "claim_1",
      "claim_type": "AUTHOR_VOICE|DIRECT_QUOTE|INDIRECT_QUOTE|FREE_INDIRECT|IMPLICIT",
      "speaker": "who makes this claim – name, org, or 'AUTHOR' for journalist voice",
      "subject": "who the claim is ABOUT",
      "claim_text": "exact text segment, max 200 chars",
      "epistemic_marker": "the specific marker word/phrase found, or null",
      "author_legally_responsible": true
    }
  ],
  "epistemic_markers": [
    {
      "term": "the exact marker word or phrase",
      "category": "BIZONYTALAN|BIZONYOS|IMPLICIT_ÉRTÉKELŐ|AMPLIFIKÁLÓ",
      "context": "surrounding ~50 chars for context"
    }
  ],
  "free_indirect_discourse_candidates": [
    {
      "segment": "the ambiguous text segment",
      "likely_speaker": "who probably thinks/feels/claims this",
      "risk_note": "why this is legally risky"
    }
  ],
}`;

// --- SEGÉDFÜGGVÉNYEK ---
function extractJSON(str) {
    let cleaned = str.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return cleaned.substring(firstBrace, lastBrace + 1);
    }
    console.warn("[extractJSON] NEM találtam JSON objektumot a válaszban!");
    return cleaned;
}

// --- DETERMINISTIKUS SZEMANTIKAI KONFIDENCIA-SZÁMÍTÁS ---
// Az AI-t kivesszük az önértékelésből — a kinyert adatokból számítunk objektív értéket.
function calculateSemanticConfidence(semanticMap, contentLength) {
    if (!semanticMap) return null;

    let score = 1.0;
    const penalties = [];

    const attributionMap   = semanticMap.attribution_map || [];
    const fidCandidates    = semanticMap.free_indirect_discourse_candidates || [];
    const epistemicMarkers = semanticMap.epistemic_markers || [];
    const totalClaims      = Math.max(attributionMap.length, 1);

    // 1. Szabad függő beszéd (FID) — minden szegmens 8%-ot von le, max -24%
    if (fidCandidates.length > 0) {
        const p = Math.min(fidCandidates.length * 0.08, 0.24);
        score -= p;
        penalties.push(`FID szegmens (${fidCandidates.length} db): -${Math.round(p * 100)}%`);
    }

    // 2. UNKNOWN típusú attribúciók aránya — legfeljebb -30%
    const unknownClaims = attributionMap.filter(c => !c.claim_type || c.claim_type === 'UNKNOWN').length;
    if (unknownClaims > 0) {
        const p = (unknownClaims / totalClaims) * 0.30;
        score -= p;
        penalties.push(`Ismeretlen attribúció-típus (${unknownClaims}/${totalClaims}): -${Math.round(p * 100)}%`);
    }

    // 3. Bizonytalan jogi felelősség (author_legally_responsible nincs kitöltve) — max -20%
    const ambiguousClaims = attributionMap.filter(c =>
        c.author_legally_responsible === null || c.author_legally_responsible === undefined
    ).length;
    if (ambiguousClaims > 0) {
        const p = (ambiguousClaims / totalClaims) * 0.20;
        score -= p;
        penalties.push(`Bizonytalan felelősség (${ambiguousClaims} állítás): -${Math.round(p * 100)}%`);
    }

    // 4. Nincs azonosítható diskurzus-alany — -10%
    const subject = (semanticMap.discourse_subject || '').toLowerCase().trim();
    if (!subject || subject === 'ismeretlen' || subject === 'unknown' || subject === '') {
        score -= 0.10;
        penalties.push('Nincs diskurzus-alany: -10%');
    }

    // 5. Kevés attribúció hosszú szövegben — scraping vagy parsing probléma — -20%
    if (attributionMap.length < 3 && contentLength > 1500) {
        score -= 0.20;
        penalties.push(`Kevés attribúció (${attributionMap.length}) hosszú szövegben: -20%`);
    }

    // 6. Implicit értékelő jelölők (rejtett szerzői hang) — 3%/db, max -15%
    const implicitCount = epistemicMarkers.filter(m =>
        (m.dictionary_category || m.category) === 'IMPLICIT_ÉRTÉKELŐ'
    ).length;
    if (implicitCount > 0) {
        const p = Math.min(implicitCount * 0.03, 0.15);
        score -= p;
        penalties.push(`Implicit értékelő jelölő (${implicitCount} db): -${Math.round(p * 100)}%`);
    }

    // 7. Amplifikáló jelölők (manipulatív retorika) — 2%/db, max -10%
    const ampCount = epistemicMarkers.filter(m =>
        (m.dictionary_category || m.category) === 'AMPLIFIKÁLÓ'
    ).length;
    if (ampCount > 0) {
        const p = Math.min(ampCount * 0.02, 0.10);
        score -= p;
        penalties.push(`Amplifikáló jelölő (${ampCount} db): -${Math.round(p * 100)}%`);
    }

    // 8. Bónusz: sok jól azonosított attribúció — +5%
    if (attributionMap.length >= 10) {
        score += 0.05;
        penalties.push('Gazdag attribúciós térkép (10+ bejegyzés): +5%');
    }

    const final = Math.round(Math.max(0.10, Math.min(1.0, score)) * 100) / 100;
    console.log(`[Konfidencia] ${Math.round(final * 100)}% | ${penalties.join(' | ') || 'Levonás nélkül'}`);
    return final;
}

async function callAIProvider(providerConfig, prompt, systemPrompt) {
    if (!providerConfig.key) return null;

    console.log(`[AI] Csatlakozás: ${providerConfig.name}...`);
    let payload;
    let headers = { 'Content-Type': 'application/json' };

    if (providerConfig.id === 'GEMINI') {
        const fullPrompt = `${systemPrompt}\n\nFELHASZNÁLÓI BEMENET:\n${prompt}`;
        payload = {
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { temperature: providerConfig.temperature, maxOutputTokens: 8000 }
        };
    } else {
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
        if (providerConfig.id === 'GEMINI') url = `${url}?key=${providerConfig.key}`;

        const res = await axios.post(url, payload, {
            headers: headers,
            timeout: 18000  // Phase 2 timeout: 18s (Phase 1 már elfogyasztott ~3-5s-t)
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
        const errorMsg = e.response?.data?.error?.message || e.message;
        console.error(`[AI] HIBA (${providerConfig.name}):`, errorMsg);
        return null;
    }
}

// --- PHASE 1: SZEMANTIKAI KINYERŐ FÜGGVÉNY ---
async function runPhase1SemanticExtraction(content, title, author) {
    console.log("[Phase1] Szemantikai kinyerés indul (Groq Llama 3.3)...");
    const startTime = Date.now();

    if (!PHASE1_PROVIDER.key) {
        console.warn("[Phase1] Nincs GROQ_API_KEY – Phase 1 kihagyva, degradált módban fut.");
        return null;
    }

    const truncated = content.substring(0, 25000);
    const userPrompt = `ARTICLE TITLE: ${title}\nBYLINE AUTHOR: ${author}\n\nARTICLE CONTENT:\n${truncated}`;

    try {
        const payload = {
            model: PHASE1_PROVIDER.model,
            messages: [
                { role: "system", content: PHASE1_SYSTEM_PROMPT },
                { role: "user", content: userPrompt }
            ],
            temperature: PHASE1_PROVIDER.temperature,
            max_tokens: 3000,
            response_format: { type: "json_object" }
        };

        const res = await axios.post(PHASE1_PROVIDER.url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${PHASE1_PROVIDER.key}`
            },
            timeout: 12000
        });

        const rawContent = res.data.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error("Üres Phase 1 válasz");

        const parsed = JSON.parse(extractJSON(rawContent));

        // Mezők validálása / alapértékek biztosítása
        if (!Array.isArray(parsed.attribution_map)) parsed.attribution_map = [];
        if (!Array.isArray(parsed.epistemic_markers)) parsed.epistemic_markers = [];
        if (!Array.isArray(parsed.free_indirect_discourse_candidates)) parsed.free_indirect_discourse_candidates = [];
        if (typeof parsed.analysis_confidence !== 'number') parsed.analysis_confidence = 0.5;
        if (!Array.isArray(parsed.entities)) parsed.entities = [];

        const elapsed = Date.now() - startTime;
        console.log(`[Phase1] Kész. ${elapsed}ms | Alany: "${parsed.discourse_subject}" | Attribúciók: ${parsed.attribution_map.length} | Episztemikus: ${parsed.epistemic_markers.length} | FID: ${parsed.free_indirect_discourse_candidates.length} | Konfidencia: ${parsed.analysis_confidence}`);

        return parsed;

    } catch (e) {
        const errorMsg = e.response?.data?.error?.message || e.message;
        console.error(`[Phase1] HIBA: ${errorMsg}. Phase 2 degradált módban fut.`);
        return null;
    }
}

// --- EPISZTEMIKUS GAZDAGÍTÁS (szótárral keresztreferencia) ---
function enrichEpistemicMarkers(semanticMap) {
    if (!semanticMap || !semanticMap.epistemic_markers) return semanticMap;

    // Szótárból felépítjük a gyors keresési indexet
    const termIndex = {};
    Object.entries(epistemicDictionary.categories || {}).forEach(([categoryKey, categoryData]) => {
        (categoryData.terms || []).forEach(term => {
            termIndex[term.toLowerCase()] = {
                category: categoryKey,
                legal_weight: categoryData.legal_weight,
                ui_color: categoryData.ui_color,
                label: categoryData.label
            };
        });
    });

    semanticMap.epistemic_markers = semanticMap.epistemic_markers.map(marker => {
        const key = (marker.term || '').toLowerCase();
        const lookup = termIndex[key];
        if (lookup) {
            return {
                ...marker,
                dictionary_category: lookup.category,
                legal_weight: lookup.legal_weight,
                ui_color: lookup.ui_color,
                category_label: lookup.label
            };
        }
        // A modell talált valamit, ami nincs a szótárban – megőrizzük, jelöljük
        return { ...marker, dictionary_category: 'UNKNOWN', legal_weight: 'UNKNOWN', category_label: 'Ismeretlen típus' };
    });

    return semanticMap;
}

// --- PHASE 2 RENDSZER-PROMPT GENERÁTOR (jogi mátrix + szemantikai kontextus) ---
function buildPhase2SystemPrompt(rulesText, semanticMap) {
    const hasSemanticMap = semanticMap && semanticMap.attribution_map && semanticMap.attribution_map.length > 0;

    const semanticSection = hasSemanticMap ? `

SZEMANTIKAI TÉRKÉP (Phase 1 lingvisztikai elemzés eredménye – KÖTELEZŐ figyelembe venni a felelősség meghatározásánál):
Diskurzus-alany (a cikk fókusza): ${semanticMap.discourse_subject || 'Ismeretlen'}
Entitások: ${(semanticMap.entities || []).join(', ') || 'Nem azonosítható'}

Attribúciós térkép (ki mondja minek kinek):
${JSON.stringify(semanticMap.attribution_map, null, 2)}

Szabad függő beszéd gyanús részletek (KRITIKUS – bizonytalan jogi felelősség):
${JSON.stringify(semanticMap.free_indirect_discourse_candidates, null, 2)}

Elemzési megbízhatóság: ${Math.round((semanticMap.analysis_confidence || 0.5) * 100)}%

ATTRIBÚCIÓ-TUDATOS AUDIT INSTRUKCIÓK:
1. Ha egy flag-nél az attribúciós térkép szerint claim_type=DIRECT_QUOTE és author_legally_responsible=false: az indoklásban jelezd, hogy az újságíró idézett, és a nyilatkozó a felelős.
2. Ha claim_type=AUTHOR_VOICE és author_legally_responsible=true: teljes jogi mérce alkalmazandó.
3. Ha claim_type=FREE_INDIRECT: LEGMAGASABB FIGYELEM – a szerző elmoshatja a határt, jogilag felelős lehet az idézett gondolatért/állításért.
4. Ha claim_type=INDIRECT_QUOTE és epistemic_marker bizonytalanságot jelez: az indoklásban megjegyezheted, hogy a szerző distanciált, de a megjelenítési döntés még felelősséget hordozhat.
5. A discourse_subject az elsődleges rágalmazási kockázat hordozója – rá vonatkozó állítások kapjanak nagyobb figyelmet.
6. MINDEN flag-hez adj meg egy 'attribution_metadata' mezőt (lásd a JSON sémában).
` : `
SZEMANTIKAI TÉRKÉP: Nem érhető el (Phase 1 nem futott vagy sikertelen volt). Standard elemzés folytatódik attribúciós kontextus nélkül.
Figyelmeztetés: Az attribúciós felelősség meghatározása korlátozottabb pontossággal lehetséges.
`;

    return `SZEREP: Te egy Szigorú Médiajogi Auditor (Forensic Media Auditor) vagy.
FELADAT: Elemezd a cikket a lenti SZABÁLYKÖNYV alapján.
${semanticSection}

SZABÁLYKÖNYV:
${rulesText}

KÖTELEZŐ INSTRUKCIÓK A JSON KIMENETHEZ:
1. 'violation_id': Másold be pontosan az ID-t a fenti SZABÁLYKÖNYVBŐL (pl. RULE_DEFAMATION).
2. 'law_reference': Másold be pontosan a szabályhoz tartozó 'FORRÁS' mező tartalmát, beleértve az összes előtagot! NE ÍRD IDE A SZABÁLY NEVÉT!
3. 'severity': LOW, MEDIUM, HIGH, CRITICAL.
4. 'explanation': Írd le magyarul az indoklást. FONTOS: SOHA NE HASZNÁLJ KÓDOKAT (pl. RULE_MURE_5)! Ha az attribúciós térkép szerint az állítás idézett (nem szerzői), jelezd ezt az indoklásban!
5. Misszió ellenőrzés: Ha 'RULE_INTERNAL_MISSION' sérelmet találsz, jelezd külön flag-ként!
6. 'contextual_analysis': Szarkazmus, irónia, "dog whistle" (kódolt politikai üzenet) keresés. Ha tiszta, hagyd üresen.
7. 'attribution_metadata': Kötelező minden flag-hez – ki mondja, mi a típus, ki a felelős.

FIGYELEM: A válaszod KIZÁRÓLAG a nyers JSON objektum legyen! Nincs bevezető, nincs lezárás, nincs markdown!

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
      "explanation": "Indoklás (tartalmazza-e az attribúciós kontextust)",
      "law_reference": "Jogforrás",
      "attribution_metadata": {
        "claim_id": "claim_N vagy null",
        "claim_type": "AUTHOR_VOICE|DIRECT_QUOTE|INDIRECT_QUOTE|FREE_INDIRECT|IMPLICIT|UNKNOWN",
        "responsible_party": "AUTHOR|QUOTED_SPEAKER|AMBIGUOUS",
        "uncertainty_markers": ["episztemikus jelölők, ha vannak"]
      }
    }
  ],
  "rewritten_article": {
    "neutral_headline": "Az újraírt cikk tényszerű, semleges hangvételű főcíme",
    "neutral_body_html": "<p>Az újraírt cikk első bekezdése, tényszerűen megfogalmazva.</p><p>Második bekezdés – minden bekezdés külön p tagban. Nincs benne szubjektív értékelés, jogilag problémás állítás, vagy bizonyítatlan tényállítás.</p>"
  }
}`;
}

// ================================================================
// NETLIFY HANDLER
// ================================================================
exports.handler = async (event, context) => {
    console.log("--- API KULCS DIAGNOSZTIKA ---");
    console.log("GEMINI:", process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 5) + "..." : "NINCS MEGADVA");
    console.log("GROQ:", process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.substring(0, 5) + "..." : "NINCS MEGADVA");
    console.log("OPENAI:", process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 5) + "..." : "NINCS MEGADVA");
    console.log("------------------------------");

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Global Timeout (26s)")), 26000)
    );

    const mainTask = async () => {
        try {
            if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

            let body;
            try { body = JSON.parse(event.body); } catch (e) { return { statusCode: 400, body: "Invalid JSON" }; }
            if (!body.url) return { statusCode: 400, body: "Missing URL" };

            const targetUrl = body.url.toLowerCase();

            // --- CACHE LOGIKA (Netlify Blobs, 30 nap) ---
            const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
            const DAILY_LIMIT = 15;

            const cacheKey = Buffer.from(targetUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
            const todayStr = new Date().toISOString().split('T')[0];
            const usageKey = `daily_usage_${todayStr}`;

            let store;
            let cacheStatus = "MISS";
            let cacheErrorMsg = "";

            try {
                store = getStore({
                    name: 'analysis_cache',
                    siteID: process.env.NETLIFY_SITE_ID || "c6b64a57-d64a-4d36-9bc4-9f959e0fc4a9",
                    token: process.env.NETLIFY_AUTH_TOKEN
                });

                const cachedEntry = await store.get(cacheKey, { type: 'json' });
                if (cachedEntry && cachedEntry.timestamp) {
                    const age = Date.now() - cachedEntry.timestamp;
                    if (age < CACHE_TTL_MS) {
                        console.log(`[CACHE] HIT! URL: ${targetUrl}, Age: ${Math.round(age / 1000 / 60)} min`);
                        cacheStatus = "HIT";
                        return {
                            statusCode: 200,
                            headers: { 'X-Cache-Status': 'HIT' },
                            body: JSON.stringify(cachedEntry.data)
                        };
                    } else {
                        cacheStatus = "EXPIRED";
                    }
                } else {
                    console.log(`[CACHE] MISS! URL: ${targetUrl}`);
                }

                const usageData = await store.get(usageKey, { type: 'json' }) || { count: 0 };
                console.log(`[LIMIT] Napi használat: ${usageData.count} / ${DAILY_LIMIT}`);

                if (usageData.count >= DAILY_LIMIT) {
                    console.warn("[LIMIT] Napi limit elérve!");
                    return {
                        statusCode: 429,
                        body: JSON.stringify({
                            ui_meta: {
                                risk_level: "ERROR",
                                objectivity_score: 0,
                                verdict_summary: `⚠️ ELÉRTÜK A NAPI LIMITET!\n\nA rendszer biztonsági okokból és a költségek kontrollálása miatt korlátozott számú új cikket elemez naponta. A mai keret sajnos elfogyott.\n\nKérjük, térjen vissza holnap reggel 9:00 után! (A már elemzett cikkek továbbra is megnyithatók).`
                            },
                            flags: [],
                            rewritten_article: null
                        })
                    };
                }

                await store.setJSON(usageKey, { count: usageData.count + 1 });

            } catch (cacheError) {
                console.warn("[CACHE/LIMIT] Hiba a blob store elérésekor:", cacheError.message);
                cacheStatus = "ERROR";
                cacheErrorMsg = cacheError.message;
            }

            // --- 1. SZABÁLYSZŰRÉS (Jogi mátrix előkészítés) ---
            const metaObj = fullLegalMatrix.find(r => r.id === 'META_INFO');
            const dbVersionDate = metaObj ? metaObj.last_verified : "Ismeretlen";

            let activeMatrix = fullLegalMatrix.filter(rule => rule.category !== 'BELSŐ' && rule.category !== 'META');

            if (targetUrl.includes('uh.ro')) {
                const missionRule = fullLegalMatrix.find(rule => rule.id === 'RULE_INTERNAL_MISSION');
                if (missionRule) {
                    activeMatrix.push(missionRule);
                    console.log("[Logic] uh.ro detektálva → RULE_INTERNAL_MISSION aktiválva.");
                }
            }

            const RULES_TEXT = activeMatrix.map(rule => {
                const sourceText = (rule.sources || []).map(s => `${s.law} ${s.article}`).join('; ');
                return `ID: ${rule.id}\nSZABÁLY: ${rule.description}\nFORRÁS (KÖTELEZŐ MÁSOLNI): ${sourceText || "Szakmai Etikai Norma"}\nTRIGGER: ${rule.trigger_logic}`;
            }).join('\n----------------\n');

            // --- 2. SCRAPING ---
            console.log(`[Scrape] ${body.url}`);
            const scrapeRes = await axios.get(body.url, {
                headers: { 'User-Agent': 'NewsDistill/2.1' },
                timeout: 5000
            });
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

            // --- HTML KINYERÉSE VIZUÁLIS AUDITHOZ ---
            const trashSelectors = [
                'script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'input',
                'nav', 'footer', 'header', 'aside',
                '.sidebar', '#sidebar', '.widget', '.ad', '.advertisement', '.banner',
                '.comments', '#comments', '.comment-section', '.related-posts', '.related-articles',
                '.menu', '.navigation', '.nav', '.cookie-consent', '.popup', '.subscribe',
                '.social-share', '.share-buttons', '.author-bio'
            ];
            $(trashSelectors.join(', ')).remove();

            const candidates = ['article', 'div.entry-content', 'div.main-content', 'div.post-content', 'div.article-body', 'div#content', 'main', 'body'];
            let $content = null;
            let maxLength = 0;

            candidates.forEach(selector => {
                const el = $(selector).first();
                if (el.length > 0) {
                    const textLen = el.clone().text().trim().length;
                    if (textLen > maxLength) {
                        maxLength = textLen;
                        $content = el;
                    }
                }
            });

            let articleHtml = "";
            if ($content) {
                $content.find('.author-bio, .share, .tags, .meta, .breadcrumbs, .cookies').remove();
                const whitelistSelectors = 'p, h2, h3, h4, h5, h6, ul, ol, blockquote';
                let cleanHtmlBuilder = [];

                $content.find(whitelistSelectors).each((i, el) => {
                    const $el = $(el);
                    const text = $el.text().trim();
                    if (text.length < 2) return;
                    if (el.tagName === 'p' && text.length < 15 && !text.endsWith('.') && !text.endsWith('?')) return;
                    const linkCount = $el.find('a').length;
                    if (linkCount > 0 && ($el.text().length / linkCount < 30)) return;
                    const lowerText = text.toLowerCase();
                    const badWords = ['kapcsolódó', 'ajánlott', 'olvassa el', 'ez is érdekelhet', 'még több cikk', 'hirdetés', 'reklám', 'iratkozzon fel', 'kövessen minket', 'támogassa', 'forrás:', 'fotó:', 'kép:', 'videó:', 'címkék:', 'szerző:', 'megosztás'];
                    if (text.length < 100 && badWords.some(w => lowerText.includes(w))) return;
                    const tagName = el.tagName.toLowerCase();
                    let innerHtml = $el.html();
                    cleanHtmlBuilder.push(`<${tagName}>${innerHtml}</${tagName}>`);
                });

                articleHtml = cleanHtmlBuilder.join('\n');
            }

            if (!articleHtml || articleHtml.length < 100) {
                console.warn("[Scrape] HTML tartalom gyanúsan rövid.");
                if (!articleHtml) articleHtml = $('body').html() || "<div class='p-4'>Nem sikerült kinyerni a tartalmat.</div>";
            }

            // ================================================================
            // --- 3. PHASE 1: SZEMANTIKAI KINYERÉS (Groq, szekvenciális) ---
            // ================================================================
            const semanticMap = await runPhase1SemanticExtraction(content, title, author);
            const enrichedSemanticMap = enrichEpistemicMarkers(semanticMap);

            // Deterministikus konfidencia-számítás (felülírja az AI önértékelését)
            if (enrichedSemanticMap) {
                enrichedSemanticMap.analysis_confidence = calculateSemanticConfidence(enrichedSemanticMap, content.length);
            }

            // Elemzési megbízhatóság értékelése
            const phase1Confidence = enrichedSemanticMap?.analysis_confidence ?? null;
            const phase1Available = enrichedSemanticMap !== null;

            // Figyelmeztetések generálása az elemzés minőségéről
            const analysisWarnings = [];
            if (!phase1Available) {
                analysisWarnings.push("Szemantikai előelemzés (Phase 1) nem futott – az attribúciós felelősség meghatározása korlátozott.");
            } else {
                if (phase1Confidence < 0.5) {
                    analysisWarnings.push(`Alacsony szemantikai megbízhatóság (${Math.round(phase1Confidence * 100)}%) – a szöveg nehezen osztályozható attribúciós szempontból.`);
                }
                if ((enrichedSemanticMap.free_indirect_discourse_candidates || []).length > 0) {
                    analysisWarnings.push(`${enrichedSemanticMap.free_indirect_discourse_candidates.length} szabad függő beszéd szegmens azonosítva – bizonytalan szerzői/idézett felelősség.`);
                }
                const anonClaims = (enrichedSemanticMap.attribution_map || []).filter(c =>
                    c.speaker && (c.speaker.toLowerCase().includes('forrás') || c.speaker.toLowerCase().includes('névtelen') || c.speaker.toLowerCase().includes('informátor'))
                );
                if (anonClaims.length > 0) {
                    analysisWarnings.push(`${anonClaims.length} állítás névtelen forrástól – jogi státuszuk speciális.`);
                }
            }

            // ================================================================
            // --- 4. PHASE 2: PÁRHUZAMOS JOGI AUDIT (Konszenzus Protokoll) ---
            // ================================================================
            // Phase 2 rövidebb szöveget kap (15k char) – a szemantikai térkép már tartalmazza a kulcs állításokat
            const phase2Content = content.substring(0, 15000);
            const phase2UserPrompt = `CÍM: ${title}\nSZERZŐ: ${author}\n\nTARTALOM (Részlet, 15000 karakter):\n${phase2Content}`;
            const phase2SystemPrompt = buildPhase2SystemPrompt(RULES_TEXT, enrichedSemanticMap);

            const providers = getProviders();
            const activeProviders = providers.filter(p => p.key).slice(0, 5); // Max 5, timeout-biztonság

            console.log(`[Phase2] Jogi audit indul ${activeProviders.length} modellel: ${activeProviders.map(p => p.name).join(', ')}`);

            const promises = activeProviders.map(async (provider) => {
                try {
                    const rawJson = await callAIProvider(provider, phase2UserPrompt, phase2SystemPrompt);
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

            // --- 5. EREDMÉNYEK ÖSSZEFÉSÜLÉSE ---
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
            let contextualAnalyses = [];

            const riskOrder = { "CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1 };
            const riskLevelNames = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

            successfulResults.forEach(res => {
                const { provider, data } = res;
                if (data.flags && Array.isArray(data.flags)) {
                    const taggedFlags = data.flags.map(f => ({ ...f, explanation: `[${provider}] ${f.explanation}` }));
                    combinedFlags.push(...taggedFlags);
                }
                totalScore += (data.ui_meta.objectivity_score || 0);
                summaries.push(`**${provider}:** ${data.ui_meta.verdict_summary}`);
                if (data.ui_meta.risk_level) riskLevels.push({ provider, level: data.ui_meta.risk_level, value: riskOrder[data.ui_meta.risk_level] || 1 });
                if (data.contextual_analysis && data.contextual_analysis.length > 5) {
                    contextualAnalyses.push(`[${provider}]: ${data.contextual_analysis}`);
                }
            });

            const avgScore = Math.round(totalScore / successfulResults.length);
            const maxRiskVal = Math.max(...riskLevels.map(r => r.value));
            const finalRisk = riskLevelNames[maxRiskVal - 1] || "LOW";

            // Kisebbségi jelentés
            let minorityReport = null;
            const highRiskCount = riskLevels.filter(r => r.value >= 3).length;
            const totalCount = riskLevels.length;
            if (highRiskCount > 0 && highRiskCount < totalCount) {
                const dissenters = riskLevels.filter(r => r.value >= 3);
                minorityReport = {
                    title: "Kisebbségi jelentés (Kockázat)",
                    content: `${dissenters.map(d => d.provider).join(', ')} magasabb kockázatot (HIGH/CRITICAL) azonosított, míg más modellek enyhébbnek ítélték.`,
                    dissenters
                };
            }

            let finalContext = contextualAnalyses.length > 0 ? contextualAnalyses.join(' | ') : null;
            const finalSummary = summaries.join('\n\n');
            const finalRewrite = successfulResults[0].data.rewritten_article;

            // --- VÉGSŐ EREDMÉNY (Szemantikai térképpel bővítve) ---
            const finalResult = {
                metadata: { title, author, domain, url: targetUrl },
                article_html: articleHtml,
                db_version_date: dbVersionDate,
                semantic_map: enrichedSemanticMap ? {
                    discourse_subject: enrichedSemanticMap.discourse_subject,
                    entities: enrichedSemanticMap.entities,
                    attribution_map: enrichedSemanticMap.attribution_map,
                    epistemic_markers: enrichedSemanticMap.epistemic_markers,
                    free_indirect_discourse_candidates: enrichedSemanticMap.free_indirect_discourse_candidates,
                    analysis_confidence: enrichedSemanticMap.analysis_confidence
                } : null,
                analysis_warnings: analysisWarnings,
                ui_meta: {
                    risk_level: finalRisk,
                    objectivity_score: avgScore,
                    verdict_summary: finalSummary,
                    semantic_confidence: phase1Confidence,
                    phase1_available: phase1Available
                },
                minority_report: minorityReport,
                contextual_analysis: finalContext,
                flags: combinedFlags,
                rewritten_article: finalRewrite
            };

            // --- CACHE MENTÉS ---
            try {
                if (store) {
                    await store.setJSON(cacheKey, { timestamp: Date.now(), data: finalResult });
                    console.log(`[CACHE] SAVED! URL: ${targetUrl}`);
                }
            } catch (saveError) {
                console.warn("[CACHE] Hiba a mentéskor:", saveError.message);
            }

            console.log(`✅ SIKERES AGGREGÁCIÓ (v3): ${successfulResults.length} modell | Phase1: ${phase1Available ? 'OK' : 'SKIP'} | Minority: ${minorityReport ? 'VAN' : 'NINCS'} | Figyelmeztetések: ${analysisWarnings.length}`);

            const responseHeaders = { 'X-Cache-Status': cacheStatus };
            if (cacheStatus === 'ERROR' && cacheErrorMsg) responseHeaders['X-Cache-Error'] = cacheErrorMsg;

            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify(finalResult)
            };

        } catch (error) {
            console.error("HANDLER CRASH:", error.message);
            return {
                statusCode: 200,
                body: JSON.stringify({
                    ui_meta: {
                        risk_level: "ERROR",
                        objectivity_score: 0,
                        verdict_summary: "DEBUG ERROR: " + error.message
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
