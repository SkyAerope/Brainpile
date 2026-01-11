use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn init_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(20)
        .connect(database_url)
        .await
}

/// 搜索结果项（用于召回阶段）
#[derive(Debug, Clone)]
pub struct SearchHit {
    pub id: i64,
    pub rank: usize,  // 在该路召回中的排名（从 1 开始）
}

/// 文本向量召回（text_embedding KNN）
/// 返回 (id, rank) 列表，按相似度降序
pub async fn search_text_vec(
    pool: &PgPool,
    query_embedding: &[f32],
    limit: i64,
) -> Result<Vec<SearchHit>, sqlx::Error> {
    let embedding_str = format!(
        "[{}]",
        query_embedding.iter().map(|f| f.to_string()).collect::<Vec<_>>().join(",")
    );
    
    let rows = sqlx::query(
        r#"
        SELECT id
        FROM items
        WHERE text_embedding IS NOT NULL
        ORDER BY text_embedding <=> $1::vector
        LIMIT $2
        "#
    )
    .bind(&embedding_str)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    
    Ok(rows
        .iter()
        .enumerate()
        .map(|(i, row)| SearchHit {
            id: sqlx::Row::get(row, "id"),
            rank: i + 1,
        })
        .collect())
}

/// 视觉向量召回（visual_embedding KNN）
/// 返回 (id, rank) 列表，按相似度降序
pub async fn search_visual_vec(
    pool: &PgPool,
    query_embedding: &[f32],
    limit: i64,
) -> Result<Vec<SearchHit>, sqlx::Error> {
    let embedding_str = format!(
        "[{}]",
        query_embedding.iter().map(|f| f.to_string()).collect::<Vec<_>>().join(",")
    );
    
    let rows = sqlx::query(
        r#"
        SELECT id
        FROM items
        WHERE visual_embedding IS NOT NULL
        ORDER BY visual_embedding <=> $1::vector
        LIMIT $2
        "#
    )
    .bind(&embedding_str)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    
    Ok(rows
        .iter()
        .enumerate()
        .map(|(i, row)| SearchHit {
            id: sqlx::Row::get(row, "id"),
            rank: i + 1,
        })
        .collect())
}

/// 全文检索召回（GIN tsvector + websearch_to_tsquery）
/// 返回 (id, rank) 列表，按 ts_rank 降序
pub async fn search_fts(
    pool: &PgPool,
    query: &str,
    limit: i64,
) -> Result<Vec<SearchHit>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT id
        FROM items
        WHERE searchable_text IS NOT NULL
          AND to_tsvector('simple', searchable_text) @@ websearch_to_tsquery('simple', $1)
        ORDER BY ts_rank(to_tsvector('simple', searchable_text), websearch_to_tsquery('simple', $1)) DESC
        LIMIT $2
        "#
    )
    .bind(query)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    
    Ok(rows
        .iter()
        .enumerate()
        .map(|(i, row)| SearchHit {
            id: sqlx::Row::get(row, "id"),
            rank: i + 1,
        })
        .collect())
}

/// RRF（Reciprocal Rank Fusion）融合算法
/// k: 平滑常数（通常 60）
/// 返回按融合分数降序排列的 id 列表
pub fn rrf_merge(channels: Vec<Vec<SearchHit>>, k: f64, top_n: usize) -> Vec<i64> {
    use std::collections::HashMap;
    
    let mut scores: HashMap<i64, f64> = HashMap::new();
    
    for hits in channels {
        for hit in hits {
            let score = 1.0 / (k + hit.rank as f64);
            *scores.entry(hit.id).or_insert(0.0) += score;
        }
    }
    
    let mut sorted: Vec<(i64, f64)> = scores.into_iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    
    sorted.into_iter().take(top_n).map(|(id, _)| id).collect()
}

/// 批量获取 items 详情（按给定 id 顺序返回）
pub async fn fetch_items_by_ids(
    pool: &PgPool,
    ids: &[i64],
) -> Result<Vec<sqlx::postgres::PgRow>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    
    // 使用 unnest 保持顺序
    let rows = sqlx::query(
        r#"
         SELECT i.id, i.item_type, i.content_text, i.s3_key, i.thumbnail_key, 
             i.created_at, i.meta, i.tags, i.tg_group_id
        FROM unnest($1::bigint[]) WITH ORDINALITY AS t(id, ord)
        JOIN items i ON i.id = t.id
        ORDER BY t.ord
        "#
    )
    .bind(ids)
    .fetch_all(pool)
    .await?;
    
    Ok(rows)
}
