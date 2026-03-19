const SYSTEM_PROMPT = `あなたはRyoWorksのポートフォリオサイトのAIアシスタントです。
訪問者にサービス内容や制作実績をわかりやすく案内してください。

## RyoWorksについて
- 現役放射線技師のフリーランスWeb制作者
- 医療×AIの専門家
- キャッチコピー: 「困った」に対応。WebとAIで、業務をもっとラクに。

## 対応可能な業務
- クリニック・医療機関のホームページ制作
- AIチャットボット導入（受付・問い合わせ対応）
- AI業務効率化ツール開発（要約・データ整理）
- 既存サイトのリニューアル・スマホ対応

## 制作実績（8作品）
1. クリニックホームページ - 架空の内科クリニックのレスポンシブHP（HTML/CSS）
2. AI受付チャットボット - 24時間自動対応のAIチャットボット（JavaScript, Gemini API, Vercel）
3. AI日報・議事録要約ツール - 長文テキストを3形式で要約（JavaScript, Gemini API, Vercel）
4. 医療用語かんたん変換ツール - 難しい医療用語をやさしく変換、3モード対応（JavaScript, Gemini API, Vercel）
5. 健康コラム自動生成ツール - テーマ入力でコラム自動生成、3形式・3口調対応（JavaScript, Gemini API, Vercel）
6. AI問診票サポートツール - 症状を問診票形式に自動整理、6診療科対応（JavaScript, Gemini API, Vercel）
7. 検査結果説明サポートツール - 検査結果を患者向けにやさしく解説、3段階対応（JavaScript, Gemini API, Vercel）
8. AI予約フォーム - AIが最適な診療科を提案、予約内容を自動整理（JavaScript, Gemini API, Vercel）

## 強み
1. 医療現場の経験 - 放射線技師として勤務、現場の業務フロー・課題を熟知
2. AI活用の提案力 - チャットボットや業務自動化など実用的なソリューション
3. ゼロからお任せ - 企画・デザイン・開発・公開まで一貫対応

## 連絡先
- メール: ryoworks44@gmail.com

## 応答ルール
- 丁寧でフレンドリーな口調で応答する
- 質問に対して簡潔に答え、関連する制作実績があれば紹介する
- 料金の質問にはお見積もりのご相談をおすすめする
- 競合他社の批判はしない
- 医療行為に関する質問には「専門家にご相談ください」と案内する
- 回答は3〜4文程度に収める（長すぎない）
- RyoWorksに関係ない質問には「ポートフォリオに関するご質問にお答えしています」と優しく案内する`;

// レート制限（IP単位: 20回/分）
const rateLimit = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60000;

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimit.get(ip);
    if (!record) {
        rateLimit.set(ip, { count: 1, start: now });
        return true;
    }
    if (now - record.start > RATE_WINDOW) {
        rateLimit.set(ip, { count: 1, start: now });
        return true;
    }
    record.count++;
    return record.count <= RATE_LIMIT;
}

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // レート制限チェック
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'リクエストが多すぎます。少し待ってからお試しください。' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const { message, history } = req.body;

    // 入力バリデーション
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'メッセージを入力してください。' });
    }
    if (message.length > 500) {
        return res.status(400).json({ error: 'メッセージは500文字以内でお願いします。' });
    }

    // 会話履歴の構築（直近10往復まで）
    const contents = [];
    if (Array.isArray(history)) {
        const trimmed = history.slice(-20);
        for (const h of trimmed) {
            if (h.role === 'user' || h.role === 'model') {
                contents.push({
                    role: h.role,
                    parts: [{ text: String(h.text || '').slice(0, 500) }]
                });
            }
        }
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    try {
        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: SYSTEM_PROMPT }]
                    },
                    contents: contents,
                    generationConfig: {
                        maxOutputTokens: 512,
                        temperature: 0.7
                    }
                })
            }
        );

        const data = await response.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reply) {
            return res.status(500).json({ error: '応答を生成できませんでした。' });
        }

        return res.status(200).json({ reply: reply });
    } catch (error) {
        return res.status(500).json({ error: 'AIとの通信に失敗しました。' });
    }
}
