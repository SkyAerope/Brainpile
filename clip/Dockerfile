FROM python:3.10-slim

WORKDIR /app

# cn_clip might need git to install from repo if pypi version is outdated, but let's try pypi first.
# Added git just in case.
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
