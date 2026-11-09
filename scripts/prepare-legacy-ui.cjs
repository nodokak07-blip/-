'use strict';
// One-time, idempotent adaptation of the existing single-file application.
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(target, 'utf8');
html = html.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');
html = html.replace(/\\u\{([0-9a-f]+)\}/gi, (match, hex) => /\p{Extended_Pictographic}/u.test(String.fromCodePoint(parseInt(hex, 16))) ? '' : match);
// Supabase's own token storage is untouched. Legacy application records are scoped per account.
html = html.replace(/(?<!window\.)localStorage\.(getItem|setItem|removeItem)\(/g, 'bloomStorage.$1(');
if (!html.includes('const bloomStorage =')) {
  html = html.replace('let currentUser = null;', `let currentUser = null;
const bloomStorage = {
  getItem(key) { return window.localStorage.getItem('bloom-account:' + (currentUser ? currentUser.id : 'guest') + ':' + key); },
  setItem(key, value) { window.localStorage.setItem('bloom-account:' + (currentUser ? currentUser.id : 'guest') + ':' + key, value); },
  removeItem(key) { window.localStorage.removeItem('bloom-account:' + (currentUser ? currentUser.id : 'guest') + ':' + key); }
};`);
}
// Replace the disabled legacy emoji/profile selection with a platform-independent mark.
html = html.replace('アイコン（絵文字）', 'プロフィールアイコン').replaceAll('絵文字', 'アイコン');
fs.writeFileSync(target, html.trimEnd()+'\n');
