from fastapi import FastAPI, UploadFile, File, HTTPException
import torch
from PIL import Image
import cn_clip.clip as clip
import io
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("brainpile-clip")

app = FastAPI()

# Global model variables
model = None
preprocess = None
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# Using ViT-L-14 to match 768 vector dimension in DB
MODEL_ARCH = "ViT-L-14" 

@app.on_event("startup")
async def startup_event():
    global model, preprocess
    logger.info(f"Loading model {MODEL_ARCH} on {DEVICE}...")
    try:
        # download_root can be a mounted volume to persist models
        model, preprocess = clip.load_from_name(MODEL_ARCH, device=DEVICE, download_root="/data/models")
        model.eval()
        logger.info("Model loaded successfully.")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise e

@app.get("/health")
def health():
    if model is None:
        return {"status": "loading"}
    return {"status": "ok", "device": DEVICE}

@app.post("/embed")
async def embed_image(file: UploadFile = File(...)):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
    
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        
        # Preprocess and add batch dimension
        image_input = preprocess(image).unsqueeze(0).to(DEVICE)
        
        with torch.no_grad():
            image_features = model.encode_image(image_input)
            image_features /= image_features.norm(dim=-1, keepdim=True)
            
        embedding = image_features.squeeze().tolist()
        return {"embedding": embedding}
    except Exception as e:
        logger.error(f"Error processing image: {e}")
        raise HTTPException(status_code=500, detail=str(e))
