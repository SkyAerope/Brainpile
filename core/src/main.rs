mod config;
mod db;
mod state;
mod bot;
mod worker;
mod api;

use dotenvy::dotenv;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use std::sync::Arc;
use s3::bucket_ops::BucketConfiguration;

#[tokio::main]
async fn main() {
    dotenv().ok();
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "brainpile_core=debug,info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Brainpile Core v0.1.0 starting...");

    // Load Config
    let config = Arc::new(config::Config::from_env());
    
    // Connect DB
    let db = db::init_pool(&config.database_url).await.expect("Failed to connect to DB");
    
    // Run Migrations
    tracing::info!("Running database migrations...");
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("Failed to migrate database");

    // Init S3 & Ensure Bucket Exists
    let internal_region = s3::region::Region::Custom {
        region: "us-east-1".to_owned(),
        endpoint: config.s3_endpoint.clone(),
    };
    let credentials = s3::creds::Credentials::new(
        Some(&config.s3_access_key),
        Some(&config.s3_secret_key),
        None, None, None
    ).expect("Failed to create S3 credentials");
    
    let internal_bucket = s3::bucket::Bucket::new(
        &config.s3_bucket,
        internal_region,
        credentials.clone()
    ).expect("Failed to create bucket struct").with_path_style();

    if !internal_bucket.exists().await.unwrap_or(false) {
        tracing::info!("Bucket {} missing, creating...", config.s3_bucket);
        // Try creating with path style
        let _ = s3::bucket::Bucket::create_with_path_style(
            &config.s3_bucket,
            s3::region::Region::Custom {
                region: "us-east-1".to_owned(),
                endpoint: config.s3_endpoint.clone(),
            },
            credentials.clone(),
            BucketConfiguration::default()
        ).await.map_err(|e| tracing::warn!("Failed to create bucket: {}", e));
    }

    // Init S3 Signing Client (Public)
    let region = s3::region::Region::Custom {
        region: "us-east-1".to_owned(),
        endpoint: config.s3_public_endpoint.clone(),
    };
    let s3_signing_client = s3::bucket::Bucket::new(
        &config.s3_bucket,
        region,
        credentials
    ).expect("Failed to create S3 bucket").with_path_style();

    let state = state::AppState {
        db,
        config,
        http_client: reqwest::Client::new(),
        s3_signing_client: *s3_signing_client,
    };

    // Spawn TG Bot
    let bot_state = state.clone();
    tokio::spawn(async move {
        bot::run_bot(bot_state).await;
    });

    // Spawn Processing Worker
    let worker_state = state.clone();
    tokio::spawn(async move {
        worker::run_worker(worker_state).await;
    });

    // Start API Server
    api::run_server(state).await;
}
