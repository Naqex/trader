# Studio redesign spec (01/11/2026)

Khu `area=ai` đổi tên và thiết kế lại thành **Studio**. Mục tiêu: clean, thon gọn, có gu, đồng bộ design system. Chỉ dùng token (`web/public/project-palette.css`, `--wm-*` trong `component-interactions.css`), không thêm hex mới.

## Đã xong trong working tree (chưa commit)

- Nav và copy trong `FxReplayShell.jsx`: Studio; 4 mục Đội AI (paperclip, mặc định), Đánh giá (workflows), Model (models), Kết nối (connections, `alsoSections:['gateway']`). Bot và CLIProxyAPI đã ra khỏi nav.
- `main.jsx`: `section=automation` replace sang paperclip.
- `AiWorkspace.jsx`: đã bỏ nhánh automation.
- `AiStudio.jsx`: `AiPageHeader`, `AiStatus` (tone positive|warning|muted), `AiPanelState`.
- JSX mới ở AiProviderSettings, AiModelProfiles, AiWorkflows, AiGatewayPanel, AiPaperclipPanel.
- `AiWorkflows.jsx` dùng class `ai-run-row`, `ai-run-title`, `ai-run-meta`, `ai-run-more`, `ai-run-history`. Không dùng `ai-history-*` vì tên đó thuộc AiChatPanel/ai-chat.css.

## Còn phải làm

1. CSS trong `ai-workspace.css` (sửa tại chỗ, xóa rule chết `.ai-provider-mark`, `.ai-bots-empty`, `.ai-workflow-history > button`):
   - `.ai-workspace`: max-width 960px; `.ai-page-heading`: flex, align-items flex-start, justify space-between, gap 24px, margin-bottom 32px. h1 cỡ `--ds-font-page`, weight `--ds-weight-heading`; p cỡ `--ds-font-control`, muted. `.ai-page-actions`: flex, gap 8px.
   - `.ai-status`: inline-flex, align-items center, gap 8px, cỡ `--ds-font-control`, line-height `--ds-line-control`. `.ai-status-dot`: 6px tròn, flex none; `.is-positive` dùng `--project-positive`, `.is-warning` dùng `--project-warning`, `.is-muted` dùng `--project-subtle`. Chữ giữ màu text; chấm chỉ bổ sung, không thay chữ.
   - `.ai-list`: list-style none, margin 0, padding 0, border-top 1px `--project-border`; mỗi `li` có border-bottom.
   - `.ai-list-row` (button full width, text-align left, font inherit, color text, bg transparent, border 0): radius `--ds-radius-small`, transition background-color var(--ds-motion-hover) var(--ds-ease-standard); hover `--wm-row-hover`; `.is-selected` hoặc `[aria-current]` dùng `--wm-row-selected`; selected+hover dùng `--wm-row-selected-hover` (token mới, định nghĩa ở `component-interactions.css` cạnh `--wm-row-selected`: `color-mix(in srgb, var(--project-row-selected) 82%, var(--project-hover))`); focus-visible outline 2px `--wm-focus`, offset -2px; disabled cursor default, opacity `--ds-disabled-opacity`; reduced-motion: transition none.
   - `.ai-connection-row`: grid `20px minmax(0,1fr) minmax(160px,auto) 16px`, align-items center, gap 16px, padding 16px 12px. `.ai-provider-icon` và `.ai-row-chevron` muted. `.ai-connection-name strong` cỡ body weight heading; `small` muted cỡ meta. `.ai-connection-state`: grid gap 4px, justify-items end. Ở ≤760px: grid `20px minmax(0,1fr) 16px`, state chuyển xuống dòng thứ hai cột 2.
   - Model: `.ai-model-profile-row` grid `240px minmax(0,1fr)`, padding 16px 0, border-bottom; `.ai-summary-chevron` xoay 180deg khi `[open]`, transition `--ds-motion-menu`; `.ai-profile-group h2` muted cỡ meta, uppercase thì không.
   - Đánh giá: `.ai-workflow-form textarea` resize none, min-height 72px, max-height 240px, overflow auto, radius `--ds-radius-field`, border `--project-border`, focus border `--wm-focus`; `.ai-workflow-composer-bar`: flex, gap 12px, align-items center, justify space-between, wrap. `.ai-workflow-layout`: grid `240px minmax(0,1fr)`, gap 32px, border-top, padding-top 24px. `.ai-run-row`: grid gap 4px, padding 12px; `.ai-run-title` có ellipsis 2 dòng; `.ai-run-meta`: flex, gap 8px, align-items center, muted cỡ meta. `.ai-run-more`: margin-top 8px.
   - Stepper `.ai-workflow-steps > li`: grid `12px minmax(0,1fr)`, gap 12px, padding 12px 0, vị trí relative; `.ai-step-dot` 8px tròn, margin-top 6px, viền muted; `.is-positive` nền positive; `.is-warning` nền warning; `.is-current` chấm có ring `box-shadow 0 0 0 3px color-mix(in srgb, var(--project-primary) 25%, transparent)` và animation pulse nhẹ (`--ds-motion-loading`), tắt khi reduced-motion; đường nối dọc 1px `--project-border` giữa các chấm.
   - `.ai-count`: pill nhỏ, margin-left 8px, cỡ meta, padding 0 6px, bg `--project-control`, radius pill.
   - `ai-gateway.css`: `.ai-gateway-state-icon` muted; `.ai-gateway-state h1` cỡ `--ds-font-section`.
   - Icon và chữ trong `.wm-button` phải thẳng tâm (inline-flex, align-items center, gap 8px); kiểm tra lại button Làm mới có icon.
2. `ui/compact-system.md`: thêm mục ngắn "Trang Studio (cài đặt dạng danh sách)" mô tả header, hàng, trạng thái chấm+chữ, selected+hover token, stepper, motion và reduced-motion.
3. Test: `npx vite build --outDir $env:TEMP\studio-build --emptyOutDir`; sửa và chạy `tests/aiPaperclip.browser.mjs`, `tests/cliProxyEmbed.browser.mjs` nếu selector đổi (cliProxyEmbed click `a[href*="section=gateway"]` trong nav, nay mở từ drawer Kết nối hoặc vào thẳng URL). Viết `tests/aiStudio.browser.mjs` (cổng 5245 strictPort, API mock, chặn mọi lệnh ghi và network ngoài): nav đúng 4 mục, không có Bot; automation redirect sang paperclip; gateway làm sáng Kết nối; không tràn ngang ở 1440 và 390; icon và chữ trong hàng/nút lệch tâm dọc ≤1px; màu selected+hover khác selected và khác hover; chạy light/dark × vi/en. Screenshot vào `$env:TEMP\studio-shots`.
4. Commit chỉ file Studio: `feat(ui): redesign the AI area as Studio`, trailer `AI-Model-Requested: unknown` rồi dòng cuối `AI-Tool: Codex`.