# Bloom Journal

更新版は、会員番号・ニックネームでの利用、しずくが育つデイリー記録、個別の月間目標・自動達成率、月次の一括入力・報告・管理者返信に対応します。既存のお知らせ・グループ・参加申請・ストーリー背景を管理メニューに統合しています。

**更新版は単一HTMLだけでは動作しません。** `index.html` と `assets/`、サーバーAPIの `api/`・`lib/` が必要です。VercelとSupabaseを使います。

```sh
npm ci
npm test
npm run dev
```

公開前に、[データ移行とサーバー設定の手順](docs/journal-v2-release.md)を確認してください。管理用の秘密鍵を公開ファイルに入れないでください。

画面を変更する際は、[表記とトーン＆マナー](docs/ui-guidelines.md)を守ってください。

---

以下は初期版の説明です。単一HTML・GitHub Pagesだけでの公開手順は、更新版には適用できません。

## 初期版：あなた専用ダイエット目標シート

30〜40代ママのための体質改善ダイエット目標設定Webアプリです。

## ✨ 機能

- **5ステップ形式**でプロフィール入力 → BMI自動計算 → 目標設定 → 習慣選択 → 結果表示
- **BMI自動計算**と目標体重までの差分表示
- **パーソナライズされた習慣提案**（12種類から3〜5つ選択）
- **美しい結果シート**の生成・表示
- **PDF保存**（ブラウザ印刷機能を使用）
- **シェア機能**（Web Share API対応）
- スマホ完全対応（レスポンシブデザイン）

## 🚀 使い方

このアプリは **完全なシングルHTMLファイル**です。サーバー不要で動作します。

### ローカルで開く

```bash
# リポジトリをクローン
git clone https://github.com/あなたのユーザー名/diet-goal-sheet.git

# index.html をブラウザで開くだけ
open index.html
```

### GitHub Pages で公開する

1. GitHubでリポジトリを作成
2. `index.html` をアップロード
3. Settings → Pages → Source: `main` ブランチ、`/ (root)` を選択
4. `https://あなたのユーザー名.github.io/diet-goal-sheet/` で公開完了！

## 📁 ファイル構成

```
diet-goal-sheet/
└── index.html   ← これだけ！外部ファイル不要
```

## 🛠 カスタマイズ

Discord参加案内とLINEへの送信・サポート案内は、コミュニティ準備中のため現在は表示していません。

### ブランド名・カラーを変更する

CSS変数（`:root` 内）でメインカラーを変更できます：

```css
:root {
  --pink-strong: #E75480;  /* メインカラー */
  --pink-dark:   #C0395D;  /* ホバーカラー */
}
```

## 📱 対応ブラウザ

- Chrome / Edge（最新版）
- Safari（iOS / macOS）
- Firefox（最新版）

## 📄 ライセンス

MIT License — 自由に使用・改変・再配布できます。

---

Made with 🌸 for 30〜40代ママの体質改善サポート
