# Vortex AI - ResearchPlatform Integration

Full-stack application integrating the Vortex AI frontend with the ResearchPlatform backend for CFD (Computational Fluid Dynamics) automation and uncertainty quantification.

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16+ recommended)
- **Python** (v3.8+ recommended)
- **PostgreSQL** (or your preferred database)
- **npm** or **yarn**

### Start Everything

**Windows PowerShell:**
```powershell
.\start-dev.ps1
```

**Windows Command Prompt:**
```cmd
start-dev.bat
```

This will start:
- Backend API server on `http://localhost:8000`
- Frontend dev server on `http://localhost:5173`

### Manual Start

**Backend:**
```bash
cd C:\temp\ResearchPlatform1\ResearchPlatform\backend
python -m uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd "c:\temp\vortex ai integrated"
npm start
```

## 📁 Project Structure

```
vortex ai integrated/          # Frontend (React + Vite + TypeScript)
├── src/
│   ├── components/          # React components
│   ├── services/
│   │   └── api.ts          # API client for backend
│   └── App.tsx             # Main app component
├── .env                     # Frontend environment variables
├── start-dev.ps1           # PowerShell startup script
└── start-dev.bat           # Batch startup script

ResearchPlatform1/           # Backend (FastAPI + Python)
└── ResearchPlatform/
    └── backend/
        ├── app/
        │   ├── api/v1/     # API routes
        │   ├── core/        # Configuration
        │   └── main.py      # FastAPI app entry point
        └── requirements.txt
```

## 🔧 Configuration

### Frontend

Edit `.env`:
```env
VITE_API_URL=http://localhost:8000/api/v1
```

### Backend

Ensure backend `.env` has:
- `DATABASE_URL` - Database connection string
- `SECRET_KEY` - JWT secret key
- `CORS_ORIGINS` - Allowed frontend origins (defaults to allow all in dev)

## 📚 Documentation

- **[BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md)** - Complete integration guide
- Backend API docs: `http://localhost:8000/docs` (Swagger UI)

## ✅ Integration Status

- ✅ API routes configured
- ✅ CORS enabled
- ✅ Authentication flow
- ✅ File upload endpoints
- ✅ Job execution endpoints
- ✅ Real-time progress tracking

## 🧪 Testing

1. **Health Check:**
   - Backend: `http://localhost:8000/health`
   - Should return: `{"status": "healthy"}`

2. **Full Flow:**
   - Sign up / Login
   - Create a session
   - Upload a case file (.tar.gz or .zip)
   - Create and execute a job
   - View results and charts

## 🐛 Troubleshooting

See [BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md) for detailed troubleshooting guide.

Common issues:
- **Backend not starting:** Check database connection and Python dependencies
- **CORS errors:** Verify backend CORS allows `http://localhost:5173`
- **Upload fails:** Check file format (.tar.gz or .zip) and size limits

## 📝 Development

- Backend auto-reloads on file changes (uvicorn --reload)
- Frontend hot-reloads on file changes (Vite HMR)
- API changes visible at `http://localhost:8000/docs`

## 🚢 Production

1. Build frontend: `npm run build`
2. Update CORS origins in backend config
3. Set production environment variables
4. Deploy backend and serve frontend `dist` folder

---

For detailed setup instructions, see [BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md)
