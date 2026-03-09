# Google Calendar Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Daywalker 태스크와 Google Calendar 이벤트 간 양방향 동기화 (5분 주기)

**Architecture:** Railway Express 서버에서 OAuth 2.0 인증과 Calendar API를 처리. 클라이언트는 5분마다 POST /api/sync로 프로젝트 데이터 전송, 서버가 diff를 계산하여 반환.

**Tech Stack:** Express, googleapis npm, Google OAuth 2.0, Google Calendar API v3

---

### Task 1: Express 전환 및 의존성 추가

**Files:**
- Modify: `server.js` (전체 재작성)
- Modify: `package.json` (dependencies 추가)

**Step 1: 의존성 설치**

```bash
cd C:\Users\kimsj\Workflow
npm install express googleapis
```

**Step 2: server.js를 Express로 전환**

```js
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));

// Static files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'Workflow.html')));
app.use(express.static(__dirname));

app.listen(PORT, () => console.log(`Daywalker running on port ${PORT}`));
```

**Step 3: 로컬에서 서버 실행 테스트**

```bash
node server.js
# 브라우저에서 http://localhost:3000 접속, Workflow.html 정상 로드 확인
```

**Step 4: Commit**

```bash
git add server.js package.json package-lock.json
git commit -m "feat: convert server.js to Express"
```

---

### Task 2: Google OAuth 라우트 추가

**Files:**
- Modify: `server.js` (OAuth 라우트 추가)
- Create: `.env.example` (환경변수 가이드)

**Step 1: Google Cloud Console에서 OAuth 2.0 클라이언트 ID 생성**

사전 작업 (수동):
1. https://console.cloud.google.com → 프로젝트 생성 또는 선택
2. APIs & Services → Enable "Google Calendar API"
3. Credentials → Create OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URI: `https://<railway-domain>/api/auth/callback`
   - 로컬 테스트용: `http://localhost:3000/api/auth/callback`
4. Client ID와 Client Secret 복사

**Step 2: 환경변수 설정**

Railway에서 환경변수 설정:
- `GOOGLE_CLIENT_ID` = (복사한 Client ID)
- `GOOGLE_CLIENT_SECRET` = (복사한 Client Secret)
- `GOOGLE_REDIRECT_URI` = `https://<railway-domain>/api/auth/callback`

로컬 테스트:
```bash
# .env.example (커밋용)
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

**Step 3: OAuth 라우트 구현**

server.js에 추가:

```js
const { google } = require('googleapis');

function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

// Google OAuth 로그인
app.get('/api/auth/google', (req, res) => {
    const oauth2Client = getOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/calendar']
    });
    res.redirect(url);
});

// OAuth 콜백
app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');

    try {
        const oauth2Client = getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        fs.writeFileSync(
            path.join(DATA_DIR, 'google-token.json'),
            JSON.stringify(tokens, null, 2)
        );
        res.send('<script>window.close();</script><p>Google Calendar 연결 완료! 이 창을 닫으세요.</p>');
    } catch (err) {
        console.error('OAuth error:', err);
        res.status(500).send('인증 실패: ' + err.message);
    }
});

// 인증 상태 확인
app.get('/api/auth/status', (req, res) => {
    const tokenPath = path.join(DATA_DIR, 'google-token.json');
    const connected = fs.existsSync(tokenPath);
    res.json({ connected });
});

// 연결 해제
app.post('/api/auth/disconnect', (req, res) => {
    const tokenPath = path.join(DATA_DIR, 'google-token.json');
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
    const mapPath = path.join(DATA_DIR, 'sync-map.json');
    if (fs.existsSync(mapPath)) fs.unlinkSync(mapPath);
    res.json({ ok: true });
});
```

**Step 4: 테스트**

```bash
# 환경변수를 설정하고 서버 실행
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=xxx GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback node server.js

# 브라우저에서 http://localhost:3000/api/auth/google 접속
# Google 로그인 → 권한 허용 → callback으로 리다이렉트 → data/google-token.json 생성 확인
# http://localhost:3000/api/auth/status → {"connected": true}
```

**Step 5: Commit**

```bash
git add server.js .env.example
git commit -m "feat: add Google OAuth routes"
```

---

### Task 3: 동기화 핵심 로직 구현

**Files:**
- Create: `sync.js` (동기화 로직 모듈)
- Modify: `server.js` (/api/sync 라우트 추가)

**Step 1: sync.js 헬퍼 함수 작성**

```js
// sync.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CALENDAR_NAME = 'Daywalker';

// 인증된 Calendar 클라이언트 가져오기
function getCalendarClient(oauth2Client) {
    return google.calendar({ version: 'v3', auth: oauth2Client });
}

// "Daywalker" 캘린더 찾기 또는 생성
async function getOrCreateCalendar(calendar) {
    const { data } = await calendar.calendarList.list();
    const existing = data.items.find(c => c.summary === CALENDAR_NAME);
    if (existing) return existing.id;

    const { data: created } = await calendar.calendars.insert({
        requestBody: { summary: CALENDAR_NAME }
    });
    return created.id;
}

// sync-map.json 읽기/쓰기 (taskId <-> eventId 매핑)
function loadSyncMap() {
    const p = path.join(DATA_DIR, 'sync-map.json');
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function saveSyncMap(map) {
    fs.writeFileSync(path.join(DATA_DIR, 'sync-map.json'), JSON.stringify(map, null, 2));
}

// 태스크 → Google Event 변환
function taskToEvent(task, projectName) {
    const prefix = task.progress === 100 ? '[완료] ' : '';
    const endDate = new Date(task.endDate);
    endDate.setDate(endDate.getDate() + 1); // Google Calendar end date is exclusive
    return {
        summary: `${prefix}[${projectName}] ${task.name}`,
        start: { date: task.startDate },
        end: { date: endDate.toISOString().split('T')[0] },
        extendedProperties: {
            private: { daywalkerTaskId: task.id }
        }
    };
}

// Google Event → 태스크 변경 추출
function eventToTaskUpdate(event) {
    const summary = event.summary || '';
    const completed = summary.startsWith('[완료] ');
    const cleanSummary = summary.replace(/^\[완료\] /, '');
    // [프로젝트명] 태스크명 형태에서 추출
    const match = cleanSummary.match(/^\[(.+?)\]\s*(.+)$/);
    const endDate = new Date(event.end.date);
    endDate.setDate(endDate.getDate() - 1); // Convert back from exclusive
    return {
        projectName: match ? match[1] : null,
        taskName: match ? match[2] : cleanSummary,
        startDate: event.start.date,
        endDate: endDate.toISOString().split('T')[0],
        progress: completed ? 100 : undefined,
        eventUpdated: event.updated
    };
}

// 메인 동기화 함수
async function syncWithGoogle(oauth2Client, projects) {
    const calendar = getCalendarClient(oauth2Client);
    const calendarId = await getOrCreateCalendar(calendar);
    const syncMap = loadSyncMap();

    const changes = { created: [], updated: [], deleted: [] };

    // 1. 모든 Google 이벤트 가져오기
    const { data: eventList } = await calendar.events.list({
        calendarId,
        maxResults: 2500,
        singleEvents: true
    });
    const googleEvents = eventList.items || [];
    const eventById = {};
    googleEvents.forEach(e => {
        const tid = e.extendedProperties?.private?.daywalkerTaskId;
        if (tid) eventById[tid] = e;
    });

    // 2. 모든 Daywalker 태스크를 순회
    const allTasks = [];
    projects.forEach(p => {
        if (p.type === 'separator') return;
        (p.tasks || []).forEach(t => {
            allTasks.push({ task: t, projectName: p.name });
        });
    });

    for (const { task, projectName } of allTasks) {
        const eventData = taskToEvent(task, projectName);
        const existingEvent = eventById[task.id];

        if (existingEvent) {
            // 매핑 있음: 업데이트 비교
            const taskMod = task.lastModified ? new Date(task.lastModified) : new Date(0);
            const eventMod = new Date(existingEvent.updated);

            if (taskMod > eventMod) {
                // Daywalker가 더 최신 → Google 업데이트
                await calendar.events.update({
                    calendarId,
                    eventId: existingEvent.id,
                    requestBody: eventData
                });
            } else if (eventMod > taskMod) {
                // Google이 더 최신 → Daywalker 변경사항 반환
                const update = eventToTaskUpdate(existingEvent);
                changes.updated.push({
                    taskId: task.id,
                    ...update
                });
            }
            delete eventById[task.id]; // 처리 완료 표시
        } else {
            // 매핑 없음: Google에 새로 생성
            const { data: created } = await calendar.events.insert({
                calendarId,
                requestBody: eventData
            });
            syncMap[task.id] = created.id;
        }
    }

    // 3. Google에만 있는 이벤트 (새로 추가된 것 또는 Daywalker에서 삭제된 것)
    for (const [taskId, event] of Object.entries(eventById)) {
        const taskExists = allTasks.some(t => t.task.id === taskId);
        if (!taskExists && syncMap[taskId]) {
            // Daywalker에서 삭제됨 → Google에서도 삭제
            try {
                await calendar.events.delete({ calendarId, eventId: event.id });
            } catch (e) { /* ignore 404 */ }
            delete syncMap[taskId];
        }
    }

    // 4. daywalkerTaskId 없는 Google 이벤트 = Google에서 직접 추가한 것
    for (const event of googleEvents) {
        const tid = event.extendedProperties?.private?.daywalkerTaskId;
        if (!tid && event.start?.date) {
            const update = eventToTaskUpdate(event);
            if (update.projectName) {
                changes.created.push({
                    eventId: event.id,
                    ...update
                });
            }
        }
    }

    saveSyncMap(syncMap);
    return changes;
}

module.exports = { syncWithGoogle };
```

**Step 2: server.js에 /api/sync 라우트 추가**

```js
const { syncWithGoogle } = require('./sync');

app.post('/api/sync', async (req, res) => {
    const tokenPath = path.join(DATA_DIR, 'google-token.json');
    if (!fs.existsSync(tokenPath)) {
        return res.status(401).json({ error: 'Google Calendar 연결이 필요합니다' });
    }

    try {
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(tokens);

        // 토큰 자동 갱신 시 저장
        oauth2Client.on('tokens', (newTokens) => {
            const merged = { ...tokens, ...newTokens };
            fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2));
        });

        const projects = req.body.projects || [];
        const changes = await syncWithGoogle(oauth2Client, projects);
        res.json({ ok: true, changes });
    } catch (err) {
        console.error('Sync error:', err);
        res.status(500).json({ error: err.message });
    }
});
```

**Step 3: 테스트**

```bash
# 서버 실행 후, curl로 테스트
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"projects":[{"name":"Test","tasks":[{"id":"t1","name":"Task1","startDate":"2026-03-10","endDate":"2026-03-11","progress":0}]}]}'

# 예상 응답: {"ok":true,"changes":{"created":[],"updated":[],"deleted":[]}}
# Google Calendar에 "Daywalker" 캘린더와 "[Test] Task1" 이벤트 생성 확인
```

**Step 4: Commit**

```bash
git add sync.js server.js
git commit -m "feat: add bidirectional Google Calendar sync logic"
```

---

### Task 4: 태스크에 lastModified 타임스탬프 추가

**Files:**
- Modify: `Workflow.html` (saveState 근처, 태스크 수정 시 lastModified 갱신)

**Step 1: saveState() 앞에 lastModified 갱신 로직 추가**

`Workflow.html`에서 `saveState()` 함수 시작 부분에 추가:

```js
function saveState() {
    // lastModified 갱신: 모든 태스크에 현재 타임스탬프 기록
    const now = new Date().toISOString();
    state.projects.forEach(p => {
        if (p.type === 'separator') return;
        (p.tasks || []).forEach(t => {
            if (!t.lastModified) t.lastModified = now;
        });
    });

    // ... 기존 코드
}
```

그리고 태스크를 실제로 수정하는 함수들에서 lastModified를 명시적으로 갱신:

`moveTask`, `resizeTask`, `openTaskModal의 저장`, `handleMenuAction('toggleComplete')` 등에서:

```js
task.lastModified = new Date().toISOString();
```

**Step 2: Commit**

```bash
git add Workflow.html
git commit -m "feat: add lastModified timestamp to tasks"
```

---

### Task 5: 클라이언트 UI - Google Calendar 연결 버튼 및 자동 동기화

**Files:**
- Modify: `Workflow.html` (사이드바에 버튼, 5분 주기 sync 로직)

**Step 1: 사이드바에 Google Calendar 버튼 추가**

사이드바 하단 (`syncStatus` 근처)에 추가:

```html
<button id="googleCalBtn" onclick="connectGoogleCalendar()"
        style="width:100%; padding:10px; background:#4285f4; color:white; border:none; border-radius:8px; cursor:pointer; margin-top:8px; display:none;">
    📅 Google Calendar 연결
</button>
```

**Step 2: 동기화 JS 로직 추가**

```js
let _gcalSyncInterval = null;

async function initGoogleCalSync() {
    // Electron에서는 비활성화 (서버 API가 없으므로)
    if (typeof window.electronAPI !== 'undefined') return;

    const btn = document.getElementById('googleCalBtn');
    if (!btn) return;
    btn.style.display = 'block';

    try {
        const res = await fetch('/api/auth/status');
        const { connected } = await res.json();
        if (connected) {
            btn.textContent = '📅 Google Calendar 연결됨';
            btn.style.background = '#2d8659';
            btn.onclick = disconnectGoogleCalendar;
            startGcalSync();
        }
    } catch (e) { /* server not available */ }
}

function connectGoogleCalendar() {
    window.open('/api/auth/google', '_blank', 'width=500,height=600');
    // 3초 후 상태 확인 (콜백 완료 대기)
    setTimeout(() => initGoogleCalSync(), 5000);
}

async function disconnectGoogleCalendar() {
    await fetch('/api/auth/disconnect', { method: 'POST' });
    stopGcalSync();
    initGoogleCalSync();
}

function startGcalSync() {
    if (_gcalSyncInterval) return;
    doGcalSync(); // 즉시 1회 실행
    _gcalSyncInterval = setInterval(doGcalSync, 5 * 60 * 1000); // 5분
}

function stopGcalSync() {
    if (_gcalSyncInterval) clearInterval(_gcalSyncInterval);
    _gcalSyncInterval = null;
}

async function doGcalSync() {
    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projects: state.projects })
        });
        const { ok, changes } = await res.json();
        if (!ok) return;

        let changed = false;

        // Google에서 업데이트된 태스크 반영
        (changes.updated || []).forEach(u => {
            state.projects.forEach(p => {
                if (p.type === 'separator') return;
                const task = (p.tasks || []).find(t => t.id === u.taskId);
                if (task) {
                    task.startDate = u.startDate;
                    task.endDate = u.endDate;
                    if (u.taskName) task.name = u.taskName;
                    if (u.progress !== undefined) task.progress = u.progress;
                    task.lastModified = new Date().toISOString();
                    changed = true;
                }
            });
        });

        if (changed) {
            renderProjects();
            renderGantt();
            saveState();
        }
    } catch (e) {
        console.error('Google Calendar sync error:', e);
    }
}

// DOMContentLoaded 핸들러 마지막에 호출
// initGoogleCalSync();
```

**Step 3: DOMContentLoaded에서 initGoogleCalSync() 호출 추가**

기존 DOMContentLoaded 핸들러 마지막에:
```js
initGoogleCalSync();
```

**Step 4: 테스트**

1. 로컬 서버 실행, 브라우저에서 접속
2. 사이드바에 "Google Calendar 연결" 버튼 확인
3. 버튼 클릭 → Google 로그인 → 권한 허용
4. 버튼이 "Google Calendar 연결됨"으로 변경 확인
5. Google Calendar에서 "Daywalker" 캘린더에 이벤트 생성 확인
6. 5분 후 Google에서 이벤트 날짜 수정 → Daywalker에 반영 확인

**Step 5: Commit**

```bash
git add Workflow.html
git commit -m "feat: add Google Calendar sync UI and auto-sync"
```

---

### Task 6: Dockerfile 업데이트 및 Railway 배포

**Files:**
- Modify: `Dockerfile`
- Modify: `nixpacks.toml` (제거 가능)

**Step 1: Dockerfile 업데이트**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js sync.js Workflow.html Widget.html ./
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "server.js"]
```

**Step 2: Railway 환경변수 설정**

Railway 대시보드에서:
- `GOOGLE_CLIENT_ID` = (값)
- `GOOGLE_CLIENT_SECRET` = (값)
- `GOOGLE_REDIRECT_URI` = `https://cooperative-upliftment-production.up.railway.app/api/auth/callback`

**Step 3: 배포**

```bash
git add Dockerfile
git commit -m "feat: update Dockerfile for sync dependencies"
git push
railway up
```

**Step 4: 테스트**

배포된 URL에서 Google Calendar 연결 및 동기화 동작 확인.

---

### Task 7: .gitignore 및 보안 정리

**Files:**
- Create/Modify: `.gitignore`

**Step 1: .gitignore 추가**

```
node_modules/
dist/
data/google-token.json
data/sync-map.json
.env
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore for tokens and build artifacts"
```
