const { getStore } = require('@netlify/blobs');

const SITE_ID = process.env.NETLIFY_SITE_ID || "c6b64a57-d64a-4d36-9bc4-9f959e0fc4a9";
const SITE_TOKEN = process.env.NETLIFY_AUTH_TOKEN;

// --- HITELESÍTÉS ---
function checkAuth(event) {
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    if (!authHeader.startsWith('Basic ')) return false;
    try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
        const [user, pass] = decoded.split(':');
        return user === process.env.ADMIN_USERNAME && pass === process.env.ADMIN_PASSWORD;
    } catch (e) {
        return false;
    }
}

function getStoreByName(name) {
    return getStore({ name, siteID: SITE_ID, token: SITE_TOKEN });
}

// --- STATS aggregálás ---
async function getStats() {
    const store = getStoreByName('learning_signals');
    const { blobs } = await store.list();

    const domains = {};
    let totalFlags = 0;
    let totalFid = 0;
    let totalConfidence = 0;
    let totalScore = 0;
    let highDivergenceCount = 0;
    let unknownTermsMap = {};
    let phase1SuccessCount = 0;

    await Promise.all(blobs.map(async b => {
        try {
            const s = await store.get(b.key, { type: 'json' });
            if (!s) return;

            const d = s.domain || 'ismeretlen';
            if (!domains[d]) domains[d] = { count: 0, totalScore: 0, highDivergence: 0 };
            domains[d].count++;
            domains[d].totalScore += s.consensus_divergence?.avg_objectivity_score || 0;
            if (s.consensus_divergence?.high_divergence) {
                domains[d].highDivergence++;
                highDivergenceCount++;
            }

            totalFlags += s.flag_count || 0;
            totalFid += s.fid_count || 0;
            totalConfidence += s.phase1_confidence || 0;
            totalScore += s.consensus_divergence?.avg_objectivity_score || 0;
            if (s.phase1_available) phase1SuccessCount++;

            (s.unknown_markers || []).forEach(m => {
                const t = (m.term || '').toLowerCase().trim();
                if (!t) return;
                if (!unknownTermsMap[t]) unknownTermsMap[t] = { count: 0, ai_category: m.ai_category, contexts: [], domains: [] };
                unknownTermsMap[t].count++;
                if (m.context && unknownTermsMap[t].contexts.length < 3) unknownTermsMap[t].contexts.push(m.context);
                if (!unknownTermsMap[t].domains.includes(d)) unknownTermsMap[t].domains.push(d);
            });
        } catch (e) { /* skip broken entries */ }
    }));

    const total = blobs.length;
    const domainStats = {};
    Object.entries(domains).forEach(([d, v]) => {
        domainStats[d] = {
            count: v.count,
            avg_score: v.count ? Math.round(v.totalScore / v.count) : 0,
            high_divergence_count: v.highDivergence
        };
    });

    return {
        total_signals: total,
        avg_objectivity_score: total ? Math.round(totalScore / total) : 0,
        avg_phase1_confidence: total ? Math.round((totalConfidence / total) * 100) / 100 : 0,
        avg_flag_count: total ? Math.round((totalFlags / total) * 10) / 10 : 0,
        avg_fid_count: total ? Math.round((totalFid / total) * 10) / 10 : 0,
        high_divergence_count: highDivergenceCount,
        phase1_success_rate: total ? Math.round((phase1SuccessCount / total) * 100) : 0,
        total_unknown_markers: Object.values(unknownTermsMap).reduce((s, v) => s + v.count, 0),
        unique_unknown_terms: Object.keys(unknownTermsMap).length,
        domains: domainStats,
        generated_at: new Date().toISOString()
    };
}

// --- UNKNOWN MARKEREK aggregálás ---
async function getUnknownMarkers() {
    const store = getStoreByName('learning_signals');
    const { blobs } = await store.list();

    const termsMap = {};

    await Promise.all(blobs.map(async b => {
        try {
            const s = await store.get(b.key, { type: 'json' });
            if (!s) return;
            const d = s.domain || 'ismeretlen';
            (s.unknown_markers || []).forEach(m => {
                const t = (m.term || '').toLowerCase().trim();
                if (!t) return;
                if (!termsMap[t]) termsMap[t] = { term: t, occurrences: 0, contexts: [], domains: [], ai_category_votes: {} };
                termsMap[t].occurrences++;
                if (m.context && termsMap[t].contexts.length < 3) termsMap[t].contexts.push(m.context);
                if (!termsMap[t].domains.includes(d)) termsMap[t].domains.push(d);
                const cat = m.ai_category || 'UNKNOWN';
                termsMap[t].ai_category_votes[cat] = (termsMap[t].ai_category_votes[cat] || 0) + 1;
            });
        } catch (e) { /* skip */ }
    }));

    const markers = Object.values(termsMap).sort((a, b) => b.occurrences - a.occurrences);
    return { markers, total: markers.length };
}

// --- FŐ HANDLER ---
exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (!checkAuth(event)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const action = event.queryStringParameters?.action;
    const method = event.httpMethod;

    try {
        // GET /api/admin?action=stats
        if (method === 'GET' && action === 'stats') {
            const stats = await getStats();
            return { statusCode: 200, headers, body: JSON.stringify(stats) };
        }

        // GET /api/admin?action=unknown_markers
        if (method === 'GET' && action === 'unknown_markers') {
            const data = await getUnknownMarkers();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        // POST /api/admin?action=feedback — szótárbővítési visszajelzés
        if (method === 'POST' && action === 'feedback') {
            const body = JSON.parse(event.body || '{}');
            const { term, correct_category, correct_legal_weight, admin_note } = body;

            if (!term || !correct_category) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'term és correct_category kötelező' }) };
            }

            const overrideStore = getStoreByName('rule_overrides');
            const key = `override_${term.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_áéíóöőúüű]/g, '')}`;
            const entry = {
                term,
                correct_category,
                correct_legal_weight: correct_legal_weight || 'MEDIUM',
                admin_note: admin_note || '',
                created_at: new Date().toISOString()
            };
            await overrideStore.setJSON(key, entry);
            console.log(`[Admin] Override mentve: ${term} → ${correct_category}`);
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, saved: entry }) };
        }

        // GET /api/admin?action=overrides — mentett override-ok listája
        if (method === 'GET' && action === 'overrides') {
            const overrideStore = getStoreByName('rule_overrides');
            const { blobs } = await overrideStore.list();
            const entries = await Promise.all(blobs.map(b => overrideStore.get(b.key, { type: 'json' })));
            return { statusCode: 200, headers, body: JSON.stringify({ overrides: entries.filter(Boolean), total: entries.length }) };
        }

        // DELETE /api/admin?action=override_delete&term=... — override törlése
        if (method === 'DELETE' && action === 'override_delete') {
            const term = event.queryStringParameters?.term;
            if (!term) return { statusCode: 400, headers, body: JSON.stringify({ error: 'term kötelező' }) };
            const overrideStore = getStoreByName('rule_overrides');
            const key = `override_${term.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_áéíóöőúüű]/g, '')}`;
            await overrideStore.delete(key);
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, deleted: term }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Ismeretlen action' }) };

    } catch (e) {
        console.error('[Admin] Hiba:', e.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
};
