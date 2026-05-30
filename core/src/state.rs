use crate::config::Config;
use crate::embedding::MediaMarker;
use sqlx::PgPool;
use std::sync::Arc;
use s3::bucket::Bucket;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub http_client: reqwest::Client,
    pub s3_signing_client: Bucket,
    pub media_marker: MediaMarker,
}
