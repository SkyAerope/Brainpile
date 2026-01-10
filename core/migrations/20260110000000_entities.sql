CREATE TABLE entities (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT,
    type TEXT NOT NULL, -- 'user', 'bot', 'channel', 'group', 'supergroup', 'private'
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
