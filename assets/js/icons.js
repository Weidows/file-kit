'use strict';
/* 图标库：24×24 描边风格（feather 风格），通过 FK_UI.icon(name) 使用 */
window.FK_ICONS = {
  logo:
    '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6c.7 0 1.4.3 1.9.9l1 1.1h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 11v5"/><path d="m9.5 13.5 2.5-2.5 2.5 2.5"/>',
  extract:
    '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6c.7 0 1.4.3 1.9.9l1 1.1h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="m8.5 12.5 2 2 4-4.5"/>',
  rename:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  dedupe:
    '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3H5.5A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/><path d="m11.5 14.5 2 2 4-4"/>',
  stats:
    '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 15.5 11 10l3.5 3.5L19 7"/>',
  settings:
    '<path d="M4 6h9"/><circle cx="17" cy="6" r="2.5"/><path d="M20 6h-1"/><path d="M4 12h3"/><circle cx="11" cy="12" r="2.5"/><path d="M20 12h-6"/><path d="M4 18h9"/><circle cx="17" cy="18" r="2.5"/><path d="M20 18h-1"/>',
  folder:
    '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6c.7 0 1.4.3 1.9.9l1 1.1h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  file:
    '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z"/><path d="M13.5 3V8.5H19"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  x: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clipboard:
    '<rect x="8" y="3" width="8" height="4" rx="1.5"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  undo:
    '<path d="M8 5 4 9l4 4"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  warn:
    '<path d="M10.3 4.1 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5V13"/><path d="M12 16.5h.01"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  moon: '<path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 8.5 8.5 0 1 0 20 13.5Z"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
  reveal:
    '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6c.7 0 1.4.3 1.9.9l1 1.1h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13.5" r="2.5"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/><path d="M6.5 7 7 19a2 2 0 0 0 2 1.8h6A2 2 0 0 0 17 19l.5-12"/><path d="M10 11v5M14 11v5"/>',
  target:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/>',
  layers:
    '<path d="m12 3 8.5 4.5L12 12 3.5 7.5Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 17 8.5 4.5L20.5 17"/>',
  scan:
    '<path d="M4 4h3M4 4v3M20 4h-3M20 4v3M4 20h3M4 20v-3M20 20h-3M20 20v-3"/><path d="M8 12h8"/>',
  play: '<path d="m8 5.5 10 6.5-10 6.5Z"/>',
  history:
    '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 3.5V6H6"/><path d="M12 8v4.5l3 1.8"/>',
  info:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
};
