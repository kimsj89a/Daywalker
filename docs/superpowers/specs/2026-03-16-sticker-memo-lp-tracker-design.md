# Sticker Memo LP Tracker — Design Spec

## Overview

Add a **post-it style sticker board** below the Gantt chart in Daywalker. Each sticker represents an LP (Limited Partner) with status tracking, amount, assignee, and free-text memo. Stickers are freely draggable on the board. Data is stored in Firebase Realtime Database as part of the existing project data model, enabling real-time team sync.

## Data Model

Stickers are stored in `project.stickers[]` alongside existing `project.tasks[]` and `project.memos[]`:

```javascript
{
  id: string,              // generateId()
  lpName: string,          // LP institution name
  status: string,          // contacted | interested | negotiating | committed | paid | dropped
  amount: number,          // Amount in 억 units
  assignee: string,        // Person name (free text)
  memo: string,            // Free-text note
  x: number,              // Board X coordinate (px)
  y: number,              // Board Y coordinate (px)
  createdAt: ISO8601,
  updatedAt: ISO8601
}
```

No schema migration needed — Firebase is schemaless. Existing projects without `stickers` array are handled with `project.stickers || []`.

## UI Components

### 1. Sticker Board Area

- **Location:** Below the Gantt chart timeline, separated by a thin horizontal divider
- **Dimensions:** Full width of the Gantt area, minimum height 300px
- **Background:** Slightly different shade from Gantt background (e.g., `#12192e`) with subtle dot grid pattern
- **Behavior:** Scrollable if stickers overflow; relative positioning container for sticker placement
- **Header:** Small label "LP 보드" on the left + "+ 스티커 추가" button on the right

### 2. Sticker Card

- **Size:** ~180px wide x ~130px tall
- **Position:** Absolute positioning within the board, saved as `x`/`y` coordinates
- **Visual structure:**
  - Top: 5px color bar indicating LP status
  - LP Name: Bold, 13px, white text
  - Status badge: Small rounded pill with Korean label
  - Amount: "XX억" displayed with secondary color
  - Assignee: Small text with person icon
  - Memo: 1-2 lines truncated with ellipsis
- **Interactions:**
  - **Drag:** mousedown/mousemove/mouseup to reposition; saves position on mouseup
  - **Click:** Opens edit modal
  - **Right-click:** Context menu with "삭제" option

### 3. Sticker Edit Modal

Reuses existing modal styling from task edit modal. Fields:

| Field | Type | Required |
|-------|------|----------|
| LP명 | text input | Yes |
| 상태 | select dropdown | Yes (default: contacted) |
| 금액 (억) | number input | No |
| 담당자 | text input | No |
| 메모 | textarea | No |

Buttons: 저장 / 취소 / 삭제 (edit mode only)

### 4. Status Color Mapping

| Status Key | Korean Label | Color |
|------------|-------------|-------|
| contacted | 컨택 | `#6b7280` (gray) |
| interested | 관심 | `#3b82f6` (blue) |
| negotiating | 협상 | `#f59e0b` (amber) |
| committed | 확약 | `#10b981` (green) |
| paid | 납입 | `#8b5cf6` (purple) |
| dropped | 드랍 | `#ef4444` (red) |

## Implementation Scope

### Single file change: `Workflow.html`

1. **CSS (~80 lines):** Sticker board container, sticker card styles, color bar classes, dot grid background, edit modal styles
2. **HTML (~40 lines):** Board container div, sticker edit modal markup
3. **JavaScript (~200 lines):**
   - `renderStickers()` — renders all stickers for current project
   - `openStickerModal(stickerId?)` — open create/edit modal
   - `saveSticker()` — persist sticker to project.stickers[]
   - `deleteSticker(stickerId)` — remove sticker
   - Drag handlers: `stickerDragStart()`, `stickerDrag()`, `stickerDragEnd()`
   - Integration into existing `renderGantt()` to render board below chart
   - Integration into existing `saveState()` / `loadState()` flow

### No server changes needed

Firebase client SDK handles all persistence. `server.js` unchanged.

## Integration Points

1. **`renderGantt()`** — Append sticker board container after the Gantt timeline grid
2. **`saveState()`** — `project.stickers` automatically included (already saves full project object)
3. **`loadState()`** — `project.stickers || []` fallback for backward compatibility
4. **Firebase listener** — Already syncs entire project object, stickers included
5. **Context menu** — Add sticker-specific right-click handler within board area

## Edge Cases

- **No stickers:** Board shows placeholder text "스티커를 추가하여 LP를 관리하세요"
- **Board overflow:** Stickers dragged beyond board bounds are clamped to edges
- **Project switch:** Board re-renders with new project's stickers
- **Delete project:** Stickers cascade-deleted with project (existing behavior)
- **Concurrent edit:** Firebase last-write-wins (consistent with existing task editing)

## Deployment

No deployment changes. `Workflow.html` is served by Express on Railway as-is. Push to git → Railway auto-deploys.
