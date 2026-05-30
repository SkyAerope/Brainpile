-- 合并向量列：jina-embeddings-v5-omni 把文本/图片映射到同一个 768 维空间，
-- 因此不再需要分离的 text_embedding(1024, BGE-M3) 与 visual_embedding(768, CLIP)。
-- 旧向量维度/语义与新模型不兼容，直接丢弃旧数据（需重新入库以生成新向量）。

DROP INDEX IF EXISTS idx_items_text_vec;
DROP INDEX IF EXISTS idx_items_visual_vec;

ALTER TABLE items DROP COLUMN IF EXISTS text_embedding;
ALTER TABLE items DROP COLUMN IF EXISTS visual_embedding;

ALTER TABLE items ADD COLUMN IF NOT EXISTS embedding VECTOR(768);

CREATE INDEX IF NOT EXISTS idx_items_embedding ON items USING hnsw (embedding vector_cosine_ops);
