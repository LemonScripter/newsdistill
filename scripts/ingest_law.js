require('dotenv').config({ path: '../.env' }); // Fontos: a szülő könyvtárból olvassa a .env-t!
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const RAW_DIR = path.join(__dirname, '../data/raw_laws');
const OUTPUT_FILE = path.join(__dirname, '../data/legal_matrix.json');

// --- PROVIDEREK LISTÁJA (Ugyanaz a Failover logika) ---
const getProviders = () => [
    { id: 'GROQ', name: 'Groq', key: process.env.GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
    { id: 'OPENAI', name: 'OpenAI', key: process.env.OPENAI_API_KEY, url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' }, // Most ez fog menteni!
    { id: 'MISTRAL', name: 'Mistral', key: process.env.MISTRAL_API_KEY, url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest' }
];

async function callAI(text, filename) {
    const systemPrompt = `
    TE EGY JOGI ADATBÁZIS ÉPÍTŐ ROBOT VAGY.
    FELADAT: Elemezd a bemeneti jogi szöveget, és vond ki belőle a kulcsfontosságú szabályokat JSON formátumban.
    
    KIMENETI FORMÁTUM (JSON TÖMB):
    [
      {
        "id": "RULE_RÖVID_NÉV", 
        "category": "Kategória (pl. Személyiségi Jogok)",
        "severity": "LOW|MEDIUM|HIGH|CRITICAL",
        "description": "A szabály tömör leírása magyarul.",
        "trigger_logic": "Mikor kell jeleznie az auditornak? (pl. Ha a cikk sérteget...)",
        "sources": [ { "law": "Dokumentum neve", "article": "Cikkely száma" } ]
      }
    ]
    `;

    const providers = getProviders();

    for (const provider of providers) {
        if (!provider.key) continue;

        try {
            // console.log(`   Trying ${provider.name}...`); 
            const res = await axios.post(provider.url, {
                model: provider.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `FÁJL NEVE: ${filename}\n\nTARTALOM:\n${text}` }
                ],
                temperature: 0.1
            }, { 
                headers: { 'Authorization': `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
                timeout: 30000 
            });

            let content = res.data.choices[0].message.content;
            // JSON tisztítás
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(content);

        } catch (e) {
            console.log(`   ⚠️  ${provider.name} hiba: ${e.response?.data?.error?.message || e.message}`);
            // Folytatjuk a következővel
        }
    }
    throw new Error("Minden AI szolgáltató elutasította a kérést.");
}

async function run() {
    if (!fs.existsSync(RAW_DIR)) {
        console.error("❌ Hiba: Nem létezik a data/raw_laws mappa!");
        return;
    }

    const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.txt'));
    let fullMatrix = [];

    console.log(`🚀 Ingestálás indítása (${files.length} fájl)...`);

    for (const file of files) {
        console.log(`⏳ Feldolgozás: ${file}...`);
        try {
            const content = fs.readFileSync(path.join(RAW_DIR, file), 'utf-8');
            const rules = await callAI(content, file);
            
            if (Array.isArray(rules)) {
                fullMatrix = [...fullMatrix, ...rules];
                console.log(`✅ ${file}: ${rules.length} szabály kinyerve.`);
            }
        } catch (e) {
            console.error(`❌ Végzetes hiba (${file}):`, e.message);
        }
    }

    // --- META ADATOK GENERÁLÁSA (v2) ---
    const today = new Date().toISOString().split('T')[0];
    const metaObject = {
        "id": "META_INFO",
        "category": "META", // Ezt a backend szűrni fogja
        "severity": "LOW",
        "description": "Adatbázis verziókövetés",
        "trigger_logic": "N/A",
        "last_verified": today,
        "sources": []
    };
    fullMatrix.unshift(metaObject);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(fullMatrix, null, 2));
    console.log("------------------------------------------------");
    console.log(`🎉 KÉSZ! A teljes mátrix mentve ide: ${OUTPUT_FILE}`);
    console.log(`Összesen ${fullMatrix.length} jogi szabály az adatbázisban.`);
}

run();