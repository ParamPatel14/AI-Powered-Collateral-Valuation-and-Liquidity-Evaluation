# AI-Powered Collateral Valuation and Liquidity Evaluation

End-to-end app for estimating a property’s valuation range, resale/liquidity outlook, and risk indicators using:
- Location intelligence (OpenStreetMap Overpass by default, Google Places when configured)
- Market intelligence (listing extraction + scoring, with Gemini-assisted URL context when configured)
- Optional photo-based condition scoring (Gemini Vision)

## Architecture

- **Client**: React + TypeScript + Vite ([client/](file:///c:/Projects/AI-Powered%20Collateral%20Valuation%20and%20Liquidity%20Evaluation/client))
- **Server**: FastAPI (Python) ([server/](file:///c:/Projects/AI-Powered%20Collateral%20Valuation%20and%20Liquidity%20Evaluation/server))

The client calls the server API. The server aggregates signals (location + market + optional images), then computes:
- **Market value range** and **distress value range**
- **Resale Potential Index** and **estimated time to sell**
- **Confidence score** and **risk flags**

## End-to-End Process (What Happens When You Click “Evaluate”)

1. **Address → Coordinates**
   - The UI uses server-backed Google Places endpoints (if configured) to autocomplete and resolve a place into latitude/longitude.
2. **Optional Photos → Condition Score (Gemini Vision)**
   - Photos are resized/compressed, then sent to Gemini Vision for:
     - overall/interior/exterior condition scores
     - detected property type/subtype (if possible)
     - issues list + summary
3. **Location Intelligence**
   - If Google Maps is configured, the server queries nearby counts via Places (schools/hospitals/transit).
   - Otherwise it falls back to OpenStreetMap Overpass queries.
   - These counts are normalized into a **location_score** plus a feature breakdown.
4. **Market Intelligence**
   - The server resolves the city (reverse geocode via OSM Nominatim when needed).
   - It gathers comparable listings from sources and extracts prices/areas.
   - It computes:
     - **avg_price_per_sqft**
     - **listing_count**
     - **market_score**
     - and a snapshot-based “change since last” (when available)
5. **Valuation + Liquidity + Risk Models**
   - The server normalizes the input area basis (carpet/built_up/super_built_up) into an “effective” pricing area.
   - It then runs:
     - valuation model (location + market + age + condition + property features)
     - liquidity model (market + demand + standardization + condition, etc.)
     - risk model (confidence + risk flags)
6. **Response → UI**
   - The UI displays valuation ranges, liquidity outcomes, risk/confidence, plus drivers that explain major contributors.

## API (Server)

Base URL defaults to `http://localhost:8000`. The server mounts routes both with and without a prefix:
- `/api/v1/...`
- `/...` (compatibility)

Key endpoints:
- `GET /health`
- `POST /evaluate` (JSON payload, no photos)
- `POST /evaluate-with-photos` (multipart form: `payload` JSON + `photos[]` + `photos_meta`)
- `POST /location-intelligence`
- `POST /market-intelligence`
- `POST /image-intelligence` (multipart photos-only; useful for testing Vision independently)
- `GET /places/autocomplete`
- `GET /places/details`

## Local Setup

### 1) Server (FastAPI)

From the repo root:

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create `server/.env` (do not commit secrets) with whichever providers you want enabled:

```env
# Optional: enables photo intelligence + Gemini-assisted market URL context
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TIMEOUT_SECONDS=30
GEMINI_MAX_IMAGES=6

# Optional: enables Places autocomplete/details + Google-based location intelligence
GOOGLE_MAPS_API_KEY=your_key_here
GOOGLE_MAPS_LANGUAGE=en
GOOGLE_MAPS_REGION=in

# Optional tuning
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
OVERPASS_RADIUS_METERS=2000
OVERPASS_TIMEOUT_SECONDS=12
```

Run:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2) Client (React/Vite)

```bash
cd client
npm install
```

Optional client env (create `client/.env`):

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_API_TIMEOUT_MS=120000
```

Run:

```bash
npm run dev
```

## Photo Upload Format

`/evaluate-with-photos` expects:
- `payload`: JSON string matching the property evaluation request schema
- `photos`: one or more uploaded files
- `photos_meta`: JSON describing categories per filename:

Example `photos_meta`:

```json
[
  { "filename": "kitchen.jpg", "category": "interior" },
  { "filename": "front.jpg", "category": "exterior" }
]
```

## Common Errors / Troubleshooting

### Gemini HTTP 503 (UNAVAILABLE / High Demand)

If you see logs like:
- `gemini_vision.http_status ... status=503 ... "This model is currently experiencing high demand"`

It means Gemini accepted the request but temporarily could not serve it due to capacity. Typical mitigation:
- Retry after a short delay (exponential backoff + jitter)
- Consider switching to another model if you need higher availability during traffic spikes

### 503 “Gemini Vision is not configured”

If you call endpoints that require Gemini and you haven’t set `GEMINI_API_KEY`, the server will return 503 with a configuration message.

### 503 “Google Maps is not configured”

Places and Google-based location intelligence require `GOOGLE_MAPS_API_KEY`.

### CORS issues

If the browser blocks requests, ensure `CORS_ORIGINS` includes your client URL (default Vite is `http://localhost:5173`).

