const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));

// ========== Static Files ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'Workflow.html')));
app.get('/Widget.html', (req, res) => res.sendFile(path.join(__dirname, 'Widget.html')));
app.use(express.static(__dirname, { index: false }));

// ========== Google OAuth ==========
function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

app.get('/api/auth/google', (req, res) => {
    const oauth2Client = getOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/calendar']
    });
    res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');
    try {
        const oauth2Client = getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        fs.writeFileSync(path.join(DATA_DIR, 'google-token.json'), JSON.stringify(tokens, null, 2));
        res.send('<script>window.close();</script><p>Google Calendar 연결 완료! 이 창을 닫으세요.</p>');
    } catch (err) {
        console.error('OAuth error:', err);
        res.status(500).send('인증 실패: ' + err.message);
    }
});

app.get('/api/auth/status', (req, res) => {
    const connected = fs.existsSync(path.join(DATA_DIR, 'google-token.json'));
    res.json({ connected });
});

app.post('/api/auth/disconnect', (req, res) => {
    [path.join(DATA_DIR, 'google-token.json'), path.join(DATA_DIR, 'sync-map.json')].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    res.json({ ok: true });
});

// ========== Sync Logic ==========
const CALENDAR_NAME = 'Daywalker';

function loadSyncMap() {
    const p = path.join(DATA_DIR, 'sync-map.json');
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function saveSyncMap(map) {
    fs.writeFileSync(path.join(DATA_DIR, 'sync-map.json'), JSON.stringify(map, null, 2));
}

function taskToEvent(task, projectName) {
    const prefix = task.progress === 100 ? '[완료] ' : '';
    const endDate = new Date(task.endDate);
    endDate.setDate(endDate.getDate() + 1);
    return {
        summary: `${prefix}[${projectName}] ${task.name}`,
        start: { date: task.startDate },
        end: { date: endDate.toISOString().split('T')[0] },
        extendedProperties: { private: { daywalkerTaskId: task.id } }
    };
}

function eventToTaskUpdate(event) {
    const summary = event.summary || '';
    const completed = summary.startsWith('[완료] ');
    const clean = summary.replace(/^\[완료\] /, '');
    const match = clean.match(/^\[(.+?)\]\s*(.+)$/);
    const endDate = new Date(event.end.date);
    endDate.setDate(endDate.getDate() - 1);
    return {
        projectName: match ? match[1] : null,
        taskName: match ? match[2] : clean,
        startDate: event.start.date,
        endDate: endDate.toISOString().split('T')[0],
        progress: completed ? 100 : undefined,
        eventUpdated: event.updated
    };
}

async function getOrCreateCalendar(calendar) {
    const { data } = await calendar.calendarList.list();
    const existing = data.items.find(c => c.summary === CALENDAR_NAME);
    if (existing) return existing.id;
    const { data: created } = await calendar.calendars.insert({ requestBody: { summary: CALENDAR_NAME } });
    return created.id;
}

async function syncWithGoogle(oauth2Client, projects) {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarId = await getOrCreateCalendar(calendar);
    const syncMap = loadSyncMap();
    const changes = { created: [], updated: [], deleted: [] };

    const { data: eventList } = await calendar.events.list({
        calendarId, maxResults: 2500, singleEvents: true
    });
    const googleEvents = eventList.items || [];
    const eventByTaskId = {};
    googleEvents.forEach(e => {
        const tid = e.extendedProperties?.private?.daywalkerTaskId;
        if (tid) eventByTaskId[tid] = e;
    });

    const allTasks = [];
    projects.forEach(p => {
        if (p.type === 'separator') return;
        (p.tasks || []).forEach(t => allTasks.push({ task: t, projectName: p.name }));
    });

    for (const { task, projectName } of allTasks) {
        const eventData = taskToEvent(task, projectName);
        const existing = eventByTaskId[task.id];

        if (existing) {
            const taskMod = task.lastModified ? new Date(task.lastModified) : new Date(0);
            const eventMod = new Date(existing.updated);

            if (taskMod > eventMod) {
                await calendar.events.update({ calendarId, eventId: existing.id, requestBody: eventData });
            } else if (eventMod > taskMod) {
                changes.updated.push({ taskId: task.id, ...eventToTaskUpdate(existing) });
            }
            delete eventByTaskId[task.id];
        } else {
            const { data: created } = await calendar.events.insert({ calendarId, requestBody: eventData });
            syncMap[task.id] = created.id;
        }
    }

    // Daywalker에서 삭제된 태스크 → Google에서도 삭제
    for (const [taskId, event] of Object.entries(eventByTaskId)) {
        if (syncMap[taskId]) {
            try { await calendar.events.delete({ calendarId, eventId: event.id }); } catch (e) { }
            delete syncMap[taskId];
        }
    }

    saveSyncMap(syncMap);
    return changes;
}

app.post('/api/sync', async (req, res) => {
    const tokenPath = path.join(DATA_DIR, 'google-token.json');
    if (!fs.existsSync(tokenPath)) return res.status(401).json({ error: 'Google Calendar 연결이 필요합니다' });

    try {
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(tokens);
        oauth2Client.on('tokens', (newTokens) => {
            fs.writeFileSync(tokenPath, JSON.stringify({ ...tokens, ...newTokens }, null, 2));
        });

        const projects = req.body.projects || [];
        const changes = await syncWithGoogle(oauth2Client, projects);
        res.json({ ok: true, changes });
    } catch (err) {
        console.error('Sync error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========== Project Data API ==========
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

app.get('/api/projects', (req, res) => {
    try {
        if (fs.existsSync(PROJECTS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
            res.json(data);
        } else {
            res.json([]);
        }
    } catch (err) {
        console.error('Load projects error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects', (req, res) => {
    try {
        const projects = req.body;
        fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
        res.json({ ok: true });
    } catch (err) {
        console.error('Save projects error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========== AI Auto-Fill (Anthropic Claude) ==========
app.post('/api/ai/sticker-classify', async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const { company, assignee, title, memo } = req.body;
    const context = [company, assignee, title, memo].filter(Boolean).join(' / ');
    if (!context.trim()) return res.status(400).json({ error: 'No input provided' });

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 300,
                messages: [{
                    role: 'user',
                    content: `You are a Korean VC/PE investment operations classifier. Given this sticker info, classify it.

Input: "${context}"

Return ONLY valid JSON (no markdown):
{
  "category": one of "lp" | "deal" | "note",
  "status": one of "contacted"|"interested"|"negotiating"|"committed"|"paid"|"dropped"|"sourcing"|"reviewing"|"dd"|"negotiation"|"signing"|"closed"|"passed"|"qa_sent"|"qa_received"|"qa_reviewing"|"qa_done"|"todo"|"in_progress"|"done",
  "assignee_suggestion": if assignee field is empty and you can infer a person name from context, suggest it. Otherwise null.
}

Rules:
- If company name looks like a bank/securities/insurance/asset manager → category: "lp"
- If it mentions deal/투자/검토/실사/DD/소싱 → category: "deal"
- If it mentions Q&A/질의/답변 → pick appropriate qa_ status
- Default to "note" / "todo" if unclear
- Pick the most specific status that fits`
                }]
            })
        });

        if (!response.ok) {
            const err = await response.text();
            return res.status(500).json({ error: 'Anthropic API error: ' + err });
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        // Parse JSON from response (handle possible markdown wrapping)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse AI response' });

        const result = JSON.parse(jsonMatch[0]);
        res.json(result);
    } catch (err) {
        console.error('AI classify error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========== Start ==========
app.listen(PORT, () => console.log(`Daywalker running on port ${PORT}`));
