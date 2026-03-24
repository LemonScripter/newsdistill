const { getStore } = require('@netlify/blobs');

const SITE_ID = process.env.NETLIFY_SITE_ID || "c6b64a57-d64a-4d36-9bc4-9f959e0fc4a9";
const SITE_TOKEN = process.env.NETLIFY_AUTH_TOKEN;

// Naponta 03:00 UTC-kor fut
exports.config = { schedule: "0 3 * * *" };

exports.handler = async () => {
    console.log("[Learn] Domain profil aggregálás kezdődik...");

    try {
        const learningStore = getStore({ name: 'learning_signals', siteID: SITE_ID, token: SITE_TOKEN });
        const profileStore = getStore({ name: 'domain_profiles', siteID: SITE_ID, token: SITE_TOKEN });

        const { blobs } = await learningStore.list();
        console.log(`[Learn] ${blobs.length} szignál betöltése...`);

        // Batch betöltés (max 50 egyszerre, hogy ne legyen timeout)
        const BATCH = 50;
        const allSignals = [];
        for (let i = 0; i < blobs.length; i += BATCH) {
            const batch = blobs.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(b => learningStore.get(b.key, { type: 'json' }).catch(() => null)));
            allSignals.push(...results.filter(Boolean));
        }

        // Csoportosítás domain szerint
        const byDomain = {};
        allSignals.forEach(s => {
            const d = s.domain || 'ismeretlen';
            if (!byDomain[d]) byDomain[d] = [];
            byDomain[d].push(s);
        });

        // Aggregálás domain-enként
        const profiles = {};
        Object.entries(byDomain).forEach(([domain, signals]) => {
            const count = signals.length;
            const avgScore = Math.round(signals.reduce((s, x) => s + (x.consensus_divergence?.avg_objectivity_score || 0), 0) / count);
            const avgConf = Math.round((signals.reduce((s, x) => s + (x.phase1_confidence || 0), 0) / count) * 100) / 100;
            const avgFlags = Math.round((signals.reduce((s, x) => s + (x.flag_count || 0), 0) / count) * 10) / 10;
            const avgFid = Math.round((signals.reduce((s, x) => s + (x.fid_count || 0), 0) / count) * 10) / 10;
            const highDivergenceRate = Math.round((signals.filter(x => x.consensus_divergence?.high_divergence).length / count) * 100) / 100;

            const riskDist = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
            signals.forEach(s => {
                const r = s.consensus_divergence?.final_risk;
                if (riskDist[r] !== undefined) riskDist[r]++;
            });

            const dominantRisk = Object.entries(riskDist).sort((a, b) => b[1] - a[1])[0]?.[0] || 'MEDIUM';

            // Top UNKNOWN markerek
            const unknownTermCounts = {};
            signals.forEach(s => {
                (s.unknown_markers || []).forEach(m => {
                    const t = (m.term || '').toLowerCase().trim();
                    if (t) unknownTermCounts[t] = (unknownTermCounts[t] || 0) + 1;
                });
            });
            const topUnknownMarkers = Object.entries(unknownTermCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([term]) => term);

            profiles[domain] = {
                domain,
                last_updated: new Date().toISOString(),
                analysis_count: count,
                avg_objectivity_score: avgScore,
                avg_phase1_confidence: avgConf,
                avg_flag_count: avgFlags,
                avg_fid_count: avgFid,
                high_divergence_rate: highDivergenceRate,
                risk_level_distribution: riskDist,
                dominant_risk: dominantRisk,
                top_unknown_markers: topUnknownMarkers
            };
        });

        // Mentés
        await Promise.all(
            Object.entries(profiles).map(([domain, profile]) =>
                profileStore.setJSON(`profile_${domain}`, profile)
            )
        );

        console.log(`[Learn] ${Object.keys(profiles).length} domain profil frissítve.`);
        return { statusCode: 200, body: JSON.stringify({ ok: true, domains_updated: Object.keys(profiles).length }) };

    } catch (e) {
        console.error("[Learn] Hiba:", e.message);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
