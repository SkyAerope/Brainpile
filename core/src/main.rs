mod config;
mod db;
mod state;
mod bot;
mod worker;
mod api;

use dotenvy::dotenv;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use std::sync::Arc;

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
        
    let state = state::AppState {
        db,
        config,
        http_client: reqwest::Client::new(),
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
