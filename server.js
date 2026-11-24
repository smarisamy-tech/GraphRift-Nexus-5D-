const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'graphrift_db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DEFAULT_DB = {
    sectors: [
        { id: 'sec_policy', name: 'Global Policy & Geopolitics', color: '#f43f5e' },
        { id: 'sec_media', name: 'Media & Interactive Gaming', color: '#22d3ee' },
        { id: 'sec_ev', name: 'EV & Inductive Mobility', color: '#10b981' },
        { id: 'sec_ai', name: 'Sovereign AI & Compute', color: '#a855f7' },
        { id: 'sec_fintech', name: 'FinTech & Digital Payments', color: '#f59e0b' },
        { id: 'sec_space', name: 'Aerospace & Defense Tech', color: '#38bdf8' }
    ],
    keywords: [
        {
            id: 'kw_trump',
            sectorId: 'sec_policy',
            name: 'Donald Trump Policy',
            surfaceForms: ['donald trump', 'trump', 'trumps', 'trump tariffs', 'president trump'],
            deltaPct: '+460.6%'
        },
        {
            id: 'kw_gta6',
            sectorId: 'sec_media',
            name: 'Grand Theft Auto 6',
            surfaceForms: ['gta 6', 'gta vi', 'grand theft auto', 'gta 5', 'gta trailer'],
            deltaPct: '+5474.5%'
        },
        {
            id: 'kw_inductive',
            sectorId: 'sec_ev',
            name: 'Wireless Inductive Highway',
            surfaceForms: ['wireless inductive highway', 'wireless inductive charging', 'inductive highway trend'],
            deltaPct: '+318.2%'
        },
        {
            id: 'kw_nfc',
            sectorId: 'sec_fintech',
            name: 'Near Field Communication',
            surfaceForms: ['near field communication', 'nfc payment', 'api nfc'],
            deltaPct: '+184.0%'
        }
    ],
    jaggardPairs: [
        { id: 'jag_1', title: 'Global Policy ↔ Sovereign AI Compute', score: '0.89' },
        { id: 'jag_2', title: 'EV Mobility ↔ FinTech Payments', score: '0.76' }
    ],
    articles: []
};

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
        return JSON.parse(JSON.stringify(DEFAULT_DB));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            out.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur.trim());
    return out;
}

app.get('/api/state', (req, res) => {
    res.json(readDB());
});

app.post('/api/keywords', (req, res) => {
    const db = readDB();
    const { name, surfaceForms, sectorId, deltaPct } = req.body;
    if (!name) return res.status(400).json({ error: 'Cluster name is required' });

    const newCluster = {
        id: 'kw_' + Date.now(),
        sectorId: sectorId || db.sectors[0].id,
        name: name.trim(),
        surfaceForms: Array.isArray(surfaceForms) && surfaceForms.length ? surfaceForms : [name.toLowerCase()],
        deltaPct: deltaPct || '+125.0%'
    };
    db.keywords.push(newCluster);
    writeDB(db);
    res.json({ ok: true, cluster: newCluster });
});

app.delete('/api/keywords/:id', (req, res) => {
    const db = readDB();
    db.keywords = db.keywords.filter(k => k.id !== req.params.id);
    writeDB(db);
    res.json({ ok: true });
});

app.delete('/api/jaggard/:id', (req, res) => {
    const db = readDB();
    db.jaggardPairs = db.jaggardPairs.filter(j => j.id !== req.params.id);
    writeDB(db);
    res.json({ ok: true });
});

app.post('/api/rss', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'RSS URL required' });
    try {
        const response = await fetch(url);
        const xml = await response.text();
        const items = [...xml.matchAll(/<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<\/item>/gi)]
            .slice(0, 8)
            .map(m => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());

        const db = readDB();
        items.forEach(title => {
            db.articles.unshift({ id: 'art_' + Date.now() + Math.random(), title, source: url, createdAt: new Date().toISOString() });
        });
        writeDB(db);
        res.json({ ok: true, added: items.length, titles: items });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch RSS feed', details: err.message });
    }
});

app.post('/api/sync-sheet', async (req, res) => {
    const { sheetUrl } = req.body;
    const match = (sheetUrl || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return res.status(400).json({ error: 'Invalid Google Sheet URL' });

    const sheetId = match[1];
    const gidMatch = (sheetUrl || '').match(/gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

    try {
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const csvText = await response.text();
        const lines = csvText.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) return res.json({ ok: true, addedCount: 0, newSectorsCount: 0 });

        const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
        const kwIdx = headers.findIndex(h => h.includes('canonical') || h.includes('keyword'));
        const secIdx = headers.findIndex(h => h.includes('sector'));
        const dupIdx = headers.findIndex(h => h.includes('duplicate') || h.includes('surface') || h.includes('alias'));
        const deltaIdx = headers.findIndex(h => h.includes('delta') || h.includes('velocity'));

        const db = readDB();
        let addedCount = 0;
        let newSectorsCount = 0;
        const palette = ['#22d3ee', '#f43f5e', '#10b981', '#a855f7', '#f59e0b', '#38bdf8'];

        for (let i = 1; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i]);
            const kwName = cols[kwIdx >= 0 ? kwIdx : 1];
            const secName = cols[secIdx >= 0 ? secIdx : 0] || 'General Intelligence';
            if (!kwName) continue;

            let sectorObj = db.sectors.find(s => s.name.toLowerCase() === secName.toLowerCase());
            if (!sectorObj) {
                sectorObj = {
                    id: 'sec_' + Date.now() + '_' + i,
                    name: secName,
                    color: palette[db.sectors.length % palette.length]
                };
                db.sectors.push(sectorObj);
                newSectorsCount++;
            }

            const rawDups = dupIdx >= 0 && cols[dupIdx] ? cols[dupIdx].split(/[,;|]/).map(s => s.trim()).filter(Boolean) : [kwName.toLowerCase()];
            const existing = db.keywords.find(k => k.name.toLowerCase() === kwName.toLowerCase());
            if (!existing) {
                db.keywords.push({
                    id: 'kw_sheet_' + Date.now() + '_' + i,
                    sectorId: sectorObj.id,
                    name: kwName,
                    surfaceForms: rawDups,
                    deltaPct: (deltaIdx >= 0 && cols[deltaIdx]) ? cols[deltaIdx] : '+210.0%'
                });
                addedCount++;
            } else {
                existing.sectorId = sectorObj.id;
                existing.surfaceForms = Array.from(new Set([...existing.surfaceForms, ...rawDups]));
            }
        }

        writeDB(db);
        res.json({ ok: true, addedCount, newSectorsCount });
    } catch (err) {
        res.status(500).json({ error: 'Sheet sync failed. Ensure Google Sheet link access is set to Anyone with the link.', details: err.message });
    }
});

app.get('/api/export.xls', (req, res) => {
    const db = readDB();
    const rows = db.keywords.map(k => {
        const sec = db.sectors.find(s => s.id === k.sectorId);
        return `<tr><td>${sec ? sec.name : ''}</td><td>${k.name}</td><td>${(k.surfaceForms || []).join(', ')}</td><td>${k.deltaPct}</td></tr>`;
    }).join('');

    const htmlWorkbook = `
        <html xmlns:x="urn:schemas-microsoft-com:office:excel">
        <head><meta charset="UTF-8"></head>
        <body>
            <table border="1">
                <tr><th>Macro_Sector</th><th>Canonical_Keyword</th><th>Duplicate_Surface_Forms</th><th>Velocity_Delta</th></tr>
                ${rows}
            </table>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', 'attachment; filename="GraphRift_5D_Workbook.xls"');
    res.send(htmlWorkbook);
});

app.listen(PORT, () => {
    console.log(`GraphRift 5D Full-Stack Server running at http://localhost:${PORT}`);
});