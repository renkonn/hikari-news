# ひかりニュース / Hikari News

前向きなニュースだけをお届けする、Claude AI 搭載のバイリンガルニュースサイト。

## デプロイ手順（5分）

### 1. GitHubにリポジトリを作る
1. https://github.com/new を開く
2. Repository name: `hikari-news`
3. Public を選択 → 「Create repository」

### 2. ファイルをアップロード
GitHubの画面で「uploading an existing file」から
このフォルダをまるごとドラッグ＆ドロップ。

### 3. Vercelと連携
1. https://vercel.com → 「Sign Up」→「Continue with GitHub」
2. 「Add New Project」→ hikari-news を選択 → 「Deploy」

### 4. Anthropic APIキーを設定
Vercel → Settings → Environment Variables:
- Name: ANTHROPIC_API_KEY
- Value: sk-ant-... (あなたのキー)
→ Save → Redeploy

### 5. 完成！
https://hikari-news.vercel.app でアクセスできます。
