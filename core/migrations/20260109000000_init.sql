-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Tags Table
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    icon_type VARCHAR(10) NOT NULL,
    icon_value VARCHAR(100) NOT NULL,
    label VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(icon_type, icon_value)
);

-- Items Table
CREATE TABLE items (
    id BIGSERIAL PRIMARY KEY,
    
    tg_message_id BIGINT,
    tg_chat_id BIGINT,
    tg_user_id BIGINT,
    tg_group_id BIGINT,
    
    item_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    
    content_hash VARCHAR(32) NOT NULL UNIQUE,
    
    s3_key VARCHAR(255),
    thumbnail_key VARCHAR(255),
    
    content_text TEXT,
    searchable_text TEXT,
    
    -- Embeddings
    text_embedding VECTOR(1024),
    visual_embedding VECTOR(768),
    
    meta JSONB DEFAULT '{}',
    tags INTEGER[] DEFAULT '{}'
);

CREATE INDEX idx_items_created_at ON items (created_at DESC);
CREATE INDEX idx_items_text_vec ON items USING hnsw (text_embedding vector_cosine_ops);
CREATE INDEX idx_items_visual_vec ON items USING hnsw (visual_embedding vector_cosine_ops);
CREATE INDEX idx_items_search ON items USING gin (to_tsvector('simple', searchable_text));
CREATE INDEX idx_items_tags ON items USING gin (tags);

-- Tasks Table
CREATE TABLE tasks (
    id BIGSERIAL PRIMARY KEY,
    
    item_id BIGINT REFERENCES items(id),
    
    bot_chat_id BIGINT NOT NULL,
    bot_message_id BIGINT NOT NULL,
    
    source_chat_id BIGINT,
    source_message_id BIGINT,
    source_user_id BIGINT,
    
    payload JSONB DEFAULT '{}',
    
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    error_reply_id BIGINT,
    retry_count INT DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_created_at ON tasks (created_at DESC);
