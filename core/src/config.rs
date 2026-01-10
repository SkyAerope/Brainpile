use serde::Deserialize;

#[derive(Clone, Deserialize, Debug)]
pub struct Config {
    pub database_url: String,
    pub s3_endpoint: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_bucket: String,
    pub clip_api_url: String,
    pub vlm_api_base: String,
    pub vlm_api_key: String,
    pub vlm_model: String,
    pub embedding_api_base: String,
    pub embedding_api_key: String,
    pub embedding_model: String,
    pub tg_bot_token: String,
}

impl Config {
    pub fn from_env() -> Self {
        // We can use dotenvy before calling this in main
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
        let s3_endpoint = std::env::var("S3_ENDPOINT").expect("S3_ENDPOINT must be set");
        let s3_access_key = std::env::var("S3_ACCESS_KEY").expect("S3_ACCESS_KEY must be set");
        let s3_secret_key = std::env::var("S3_SECRET_KEY").expect("S3_SECRET_KEY must be set");
        let s3_bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "brainpile".to_string());
        
        let clip_api_url = std::env::var("CLIP_API_URL").expect("CLIP_API_URL must be set");
        
        let vlm_api_base = std::env::var("VLM_API_BASE").expect("VLM_API_BASE must be set");
        let vlm_api_key = std::env::var("VLM_API_KEY").expect("VLM_API_KEY must be set");
        let vlm_model = std::env::var("VLM_MODEL").expect("VLM_MODEL must be set");
        
        let embedding_api_base = std::env::var("EMBEDDING_API_BASE").expect("EMBEDDING_API_BASE must be set");
        let embedding_api_key = std::env::var("EMBEDDING_API_KEY").expect("EMBEDDING_API_KEY must be set");
        let embedding_model = std::env::var("EMBEDDING_MODEL").expect("EMBEDDING_MODEL must be set");
        
        let tg_bot_token = std::env::var("TG_BOT_TOKEN").expect("TG_BOT_TOKEN must be set");

        Self {
            database_url,
            s3_endpoint,
            s3_access_key,
            s3_secret_key,
            s3_bucket,
            clip_api_url,
            vlm_api_base,
            vlm_api_key,
            vlm_model,
            embedding_api_base,
            embedding_api_key,
            embedding_model,
            tg_bot_token,
        }
    }
}
