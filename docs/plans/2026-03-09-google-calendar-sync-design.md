# Daywalker - Google Calendar Sync Design

## Summary
Daywalker 태스크와 Google Calendar 이벤트 간 양방향 동기화. Railway 백엔드에서 OAuth 인증 및 Calendar API를 처리하고, 클라이언트는 5분마다 동기화 요청.

## Architecture

```
[Daywalker Client (Web/Electron)]
        |
        v  POST /api/sync (every 5 min)
[Railway Server (Express)]
        |
        +-- GET  /api/auth/google    -> OAuth login redirect
        +-- GET  /api/auth/callback  -> Token save
        +-- POST /api/sync           -> Bidirectional sync
                |
                v
        [Google Calendar API]
```

## Data Mapping

| Daywalker         | Google Calendar Event                          |
|-------------------|------------------------------------------------|
| task.name         | summary: `[projectName] taskName`              |
| task.startDate    | start.date (all-day event)                     |
| task.endDate      | end.date                                       |
| task.progress=100 | summary prefix `[완료]`                         |
| task.id           | extendedProperties.private.daywalkerTaskId     |
| task.lastModified | compared with event.updated for conflict resolution |

## Sync Logic

- **Daywalker -> Google**: Compare task.lastModified vs event.updated. Push if task is newer.
- **Google -> Daywalker**: Pull if event.updated is newer than task.lastModified.
- **Conflict**: Last-write-wins based on timestamp.
- **Delete**: Daywalker delete -> Google event delete. Google delete -> No action on Daywalker (safe).
- **New**: New task without mapped eventId -> create Google event. New Google event with no daywalkerTaskId -> create Daywalker task.

## Auth Flow

1. User clicks "Google Calendar 연결" in Daywalker
2. GET /api/auth/google -> Redirect to Google OAuth consent
3. User approves -> /api/auth/callback receives tokens, saves to data/google-token.json
4. Subsequent /api/sync calls use stored token (auto-refresh)

## Server Changes

- Convert server.js from http to Express
- Add `googleapis` npm package
- Routes: /api/auth/google, /api/auth/callback, /api/sync
- Token storage: data/google-token.json
- Sync mapping: data/sync-map.json (taskId <-> eventId)
- Calendar name: "Daywalker" (auto-created if not exists)

## Client Changes

- Add "Google Calendar 연결" button in sidebar
- 5-min setInterval calling POST /api/sync with current projects JSON
- Apply returned changes to state
- Add lastModified timestamp to tasks on every save

## Sync Trigger

- Periodic: every 5 minutes
- Client sends full project data to /api/sync
- Server compares with Google Calendar and returns diff
