# Integrating Vortex AI with ResearchPlatform Backend

Vortex AI is fully integrated with the **ResearchPlatform** backend. This guide explains how to run both together.

## ✅ Integration Status

**COMPLETE** - The frontend and backend are fully integrated:
- ✅ API routes match frontend expectations
- ✅ CORS configured to allow frontend origin
- ✅ Case upload endpoints added to sessions router
- ✅ Startup scripts created for easy development

## Quick Start

### Option 1: Use the Startup Scripts (Recommended)

**Windows PowerShell:**
```powershell
.\start-dev.ps1
```

**Windows Command Prompt:**
```cmd
start-dev.bat
```

This will automatically:
1. Start the backend server on `http://localhost:8000`
2. Wait for backend to initialize
3. Start the frontend dev server on `http://localhost:5173`

### Option 2: Manual Startup

**Step 1: Start the Backend**

```bash
cd C:\temp\ResearchPlatform1\ResearchPlatform\backend
python -m uvicorn app.main:app --reload --port 8000 --host 0.0.0.0
```

Verify backend is running:
- Open `http://localhost:8000/health` in your browser
- Should return: `{"status": "healthy", "version": "1.0.0"}`

**Step 2: Start the Frontend**

```bash
cd "c:\temp\vortex ai integrated"
npm start
```

The frontend will open at `http://localhost:5173`

## API Endpoints

The frontend calls these API endpoints (all under `/api/v1`):

| Area    | Base path              | Examples |
|---------|------------------------|----------|
| Auth    | `/api/v1/auth`         | `/signup`, `/login`, `/me` |
| Sessions| `/api/v1/sessions`     | `GET/POST /`, `GET/PATCH/DELETE /{id}` |
| Cases   | `/api/v1/sessions`     | `POST /{session_id}/upload`, `GET /session/{id}/cases` |
| Jobs    | `/api/v1/jobs`         | `POST /`, `GET /{id}`, `GET /{id}/progress`, `POST /{id}/execute`, `GET /session/{id}/jobs` |
| LLM     | `/api/v1/llm`          | `POST /explain`, `POST /chat` |
| Results | `/api/v1/jobs`         | `GET /{id}/results`, `GET /{id}/download/summary`, `.../download/llm-output` |
| Health  | `/health` (no `/api/v1`) | `GET /health` |

## Configuration

### Frontend Configuration

The frontend uses environment variables from `.env` file:

```env
VITE_API_URL=http://localhost:8000/api/v1
```

**Default:** If `.env` is not present, defaults to `http://localhost:8000/api/v1`

**To change backend URL:**
1. Edit `.env` and set `VITE_API_URL` to your backend URL
2. Restart the Vite dev server

### Backend Configuration

The backend CORS is configured to allow:
- `http://localhost:5173` (Vite dev server)
- `http://localhost:3000` (Alternative frontend port)
- `http://127.0.0.1:5173` (Alternative localhost format)

CORS configuration is in: `ResearchPlatform1/ResearchPlatform/backend/app/core/config.py`

## Integration Details

### Routes Added for Frontend Compatibility

The following routes were added to the sessions router to match frontend expectations:

1. **Case Upload:** `POST /api/v1/sessions/{session_id}/upload`
   - Allows uploading case files directly to a session
   - Frontend sends file via FormData

2. **List Cases:** `GET /api/v1/sessions/session/{session_id}/cases`
   - Lists all cases in a specific session
   - Matches frontend API client expectations

### CORS Configuration

CORS middleware is configured in `app/main.py` to allow requests from the frontend origin. The configuration includes:
- `allow_origins`: Frontend development URLs
- `allow_credentials`: True (for authentication cookies/tokens)
- `allow_methods`: All methods (`*`)
- `allow_headers`: All headers (`*`)

## Troubleshooting

### Backend not starting

1. **Check Python environment:**
   ```bash
   cd C:\temp\ResearchPlatform1\ResearchPlatform\backend
   python --version
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Check database connection:**
   - Ensure PostgreSQL (or your database) is running
   - Verify `DATABASE_URL` in backend `.env` file

4. **Check port availability:**
   - Ensure port 8000 is not in use
   - Change port in `uvicorn` command if needed

### Frontend can't connect to backend

1. **Verify backend is running:**
   - Open `http://localhost:8000/health` in browser
   - Should return JSON response

2. **Check CORS:**
   - Open browser DevTools → Network tab
   - Look for CORS errors in console
   - Verify backend CORS allows `http://localhost:5173`

3. **Check API URL:**
   - Verify `.env` file has correct `VITE_API_URL`
   - Restart Vite dev server after changing `.env`

4. **Check authentication:**
   - Ensure you're logged in
   - Check browser localStorage for `access_token`
   - Verify token is sent in Authorization header

### Case upload not working

1. **Check file format:**
   - Only `.tar.gz` and `.zip` files are allowed
   - Check file size (max 100MB default)

2. **Check session ID:**
   - Ensure session exists and belongs to current user
   - Verify session_id in upload request

3. **Check backend logs:**
   - Look for errors in backend console
   - Check file permissions for storage directory

## Development Workflow

1. **Start both servers:**
   ```powershell
   .\start-dev.ps1
   ```

2. **Make changes:**
   - Backend: Changes auto-reload (uvicorn --reload)
   - Frontend: Changes hot-reload (Vite HMR)

3. **Test integration:**
   - Sign up / Login
   - Create a session
   - Upload a case file
   - Create and execute a job
   - View results

## Production Deployment

For production:

1. **Update CORS origins:**
   - Edit `app/core/config.py`
   - Set `CORS_ORIGINS` to your production frontend URL(s)
   - Remove `"*"` wildcard

2. **Set environment variables:**
   - Backend: Set all required vars in `.env` or environment
   - Frontend: Set `VITE_API_URL` to production backend URL

3. **Build frontend:**
   ```bash
   npm run build
   ```
   Serve the `dist` folder with a web server (nginx, Apache, etc.)

## Quick Check

- ✅ Backend: `http://localhost:8000/health` → Should return `{"status": "healthy"}`
- ✅ Frontend: `http://localhost:5173` → Should load the login page
- ✅ API Docs: `http://localhost:8000/docs` → Swagger UI for backend API
- ✅ Integration: Login → Create Session → Upload Case → Should work end-to-end
