use serde::Deserialize;

#[derive(Clone, Deserialize, Debug)]
pub struct Config {
    pub database_url: String,
    pub s3_endpoint: String,
    pub s3_public_endpoint: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_bucket: String,
    pub embedding_api_url: String,
    pub vlm_api_base: String,
    pub vlm_api_key: String,
    pub vlm_model: String,
    pub tg_bot_token: String,
}

impl Config {
    pub fn from_env() -> Self {
        // We can use dotenvy before calling this in main
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
        let s3_endpoint = std::env::var("S3_ENDPOINT").expect("S3_ENDPOINT must be set");
        let s3_public_endpoint = std::env::var("S3_PUBLIC_ENDPOINT").unwrap_or_else(|_| "http://localhost:8333".to_string());
        let s3_access_key = std::env::var("S3_ACCESS_KEY").expect("S3_ACCESS_KEY must be set");
        let s3_secret_key = std::env::var("S3_SECRET_KEY").expect("S3_SECRET_KEY must be set");
        let s3_bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "brainpile".to_string());
        
        let embedding_api_url = std::env::var("EMBEDDING_API_URL").expect("EMBEDDING_API_URL must be set");
        
        let vlm_api_base = std::env::var("VLM_API_BASE").expect("VLM_API_BASE must be set");
        let vlm_api_key = std::env::var("VLM_API_KEY").expect("VLM_API_KEY must be set");
        let vlm_model = std::env::var("VLM_MODEL").expect("VLM_MODEL must be set");
        
        let tg_bot_token = std::env::var("TG_BOT_TOKEN").expect("TG_BOT_TOKEN must be set");

        Self {
            database_url,
            s3_endpoint,
            s3_public_endpoint,
            s3_access_key,
            s3_secret_key,
            s3_bucket,
            embedding_api_url,
            vlm_api_base,
            vlm_api_key,
            vlm_model,
            tg_bot_token,
        }
    }
}
