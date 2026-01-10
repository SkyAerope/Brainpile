CREATE TABLE entities (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT,
    type TEXT NOT NULL, -- 'user', 'bot', 'channel', 'group', 'supergroup', 'private'
    avatar_url TEXT,    -- 存储头像 URL (可以是 S3 URL 或 Telegram 原生 URL)
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
