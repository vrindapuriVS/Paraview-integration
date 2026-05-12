/**
 * API Client for ResearchPlatform Backend
 * 
 * Matches the backend endpoints provided:
 * - auth.py: /signup, /login, /me
 * - sessions.py: /, /{session_id}
 * - cases.py: /upload, /{case_id}, /session/{session_id}/cases
 * - jobs.py: /, /{job_id}, /{job_id}/progress, /session/{session_id}/jobs
 * - llm.py: /{job_id}/explain, /{job_id}/explanation
 * - results.py: /{job_id}/results, /{job_id}/download/*
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

/** Wraps fetch to catch network errors (e.g. backend down, CORS) and return a clear message */
async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('Load failed')) {
      const base = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
      throw new Error(
        `Backend at ${base} is not reachable. Start the ResearchPlatform backend (the backend folder in your ResearchPlatform repo — not UQ_AI/backend): cd ResearchPlatform1\\ResearchPlatform\\backend && python -m uvicorn app.main:app --reload --port 8000. Then open http://localhost:8000/health`
      );
    }
    throw err;
  }
}

// ============================================
// Type Definitions
// ============================================

export interface User {
  user_id: string;
  username: string;
  email: string;
  role?: string;
  created_at: string;
  updated_at?: string;
}

export interface Token {
  access_token: string;
  token_type: string;
}

// Note: The NEW backend code you provided returns Token with access_token and token_type
// The OLD backend returns LoginResponse with token, user_id, expires_in
// This interface matches your NEW backend code

export interface Session {
  id: string; // Backend uses 'id' not 'session_id'
  session_id?: string; // Keep for backward compatibility
  user_id: string;
  name: string;
  description?: string;
  status?: string;
  case_path?: string;
  job_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface Case {
  id?: string; // Backend might use 'id'
  case_id?: string; // Keep for backward compatibility
  session_id: string;
  original_filename: string;
  storage_path?: string;
  mesh_info?: any;
  uploaded_at: string;
}

export interface Job {
  id?: string; // Backend uses 'id'
  job_id?: string; // Keep for backward compatibility
  session_id: string;
  case_id?: string;
  user_id?: string;
  prompt_text?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  current_step?: number;
  progress_percent?: number; // Some endpoints use this
  progress_percentage?: number; // Detail endpoint uses this
  solver?: string;
  turbulence_model?: string;
  aoa_from?: number;
  aoa_to?: number;
  num_samples?: number;
  job_config?: any;
  error_message?: string | null;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
}

export interface JobProgress {
  job_id: string;
  status: string;
  current_step: number;
  step_name: string;
  progress_percent: number;
  error_message?: string;
}

export interface JobResult {
  job_id: string;
  results_path: string;
  summary_csv_path?: string;
  llm_output_path?: string;
  plots_path?: string;
  created_at: string;
}

export interface ChartDataPoint {
  AOA: number;
  Mean: number;
  UQ: number;
}

export interface ChartData {
  cd: ChartDataPoint[];
  cl: ChartDataPoint[];
}

export interface FoamLoadResult {
  output_format: "vtu" | "json";
  filename?: string;
  vtu_base64?: string;
  dataset_id?: string;
  dataset?: any;
  metadata: Record<string, any>;
  warnings?: string[];
}

// ============================================
// Helper Functions
// ============================================

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('access_token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };
}

function getAuthHeadersFormData(): HeadersInit {
  const token = localStorage.getItem('access_token');
  return {
    ...(token && { Authorization: `Bearer ${token}` })
    // Don't set Content-Type for FormData - browser will set it with boundary
  };
}

async function handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const status = response.status;
  
  if (!response.ok) {
    let error = 'An error occurred';
    try {
      const data = await response.json();
      
      // Handle Pydantic validation errors (array of error objects)
      if (Array.isArray(data.detail)) {
        const errorMessages = data.detail.map((err: any) => {
          if (typeof err === 'string') return err;
          // Pydantic errors usually have 'loc' (location) and 'msg' (message)
          if (err.loc && err.msg) {
            return `${err.loc.join('.')}: ${err.msg}`;
          }
          if (err.msg) return err.msg;
          if (err.message) return err.message;
          return JSON.stringify(err);
        });
        error = errorMessages.join(', ');
        console.error('Validation errors:', data.detail);
      }
      // Handle single error object or string
      else if (data.detail) {
        if (typeof data.detail === 'string') {
          error = data.detail;
        } else if (data.detail.msg) {
          error = data.detail.msg;
        } else if (data.detail.message) {
          error = data.detail.message;
        } else {
          error = JSON.stringify(data.detail);
        }
      }
      // Fallback to message field
      else if (data.message) {
        error = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
      }
    } catch {
      error = response.statusText || error;
    }
    return { error, status };
  }
  
  // Handle 204 No Content
  if (status === 204) {
    return { data: undefined as any, status };
  }
  
  try {
    const data = await response.json();
    console.log('handleResponse parsed data:', data);
    return { data, status };
  } catch (error) {
    console.error('handleResponse parse error:', error);
    return { data: undefined as any, status };
  }
}

// ============================================
// Authentication API
// ============================================

export const authApi = {
  async signup(username: string, email: string, password: string): Promise<ApiResponse<User>> {
    const response = await apiFetch(`${API_BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    return handleResponse<User>(response);
  },

  async login(username: string, password: string): Promise<ApiResponse<Token>> {
    const response = await apiFetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const result = await handleResponse<Token>(response);
    
    // Debug logging
    console.log('Login response:', {
      status: result.status,
      hasData: !!result.data,
      data: result.data,
      error: result.error,
      responseOk: response.ok
    });
    
    // Store token if login successful
    // Check multiple possible token field names and response structures
    let token: string | undefined;
    
    if (result.data) {
      // Try different possible field names
      token = (result.data as any).access_token || 
              (result.data as any).token || 
              (result.data as any).accessToken ||
              (result.data as any).access_token;
      
      // If result.data itself is a string (token), use it directly
      if (!token && typeof result.data === 'string') {
        token = result.data;
      }
      
      // If result.data is an object, check all its properties
      if (!token && typeof result.data === 'object') {
        const dataObj = result.data as any;
        token = dataObj.access_token || dataObj.token || dataObj.accessToken;
      }
    }
    
    if (token) {
      console.log('Found token, storing:', token.substring(0, 20) + '...');
      try {
        localStorage.setItem('access_token', token);
        // Verify it was stored
        const stored = localStorage.getItem('access_token');
        if (!stored) {
          console.error('Failed to store token in localStorage!');
        } else {
          console.log('Token successfully stored in localStorage');
        }
      } catch (e) {
        console.error('Error storing token:', e);
      }
    } else {
      console.error('No token found in response. Response structure:', {
        hasData: !!result.data,
        dataType: typeof result.data,
        dataKeys: result.data && typeof result.data === 'object' ? Object.keys(result.data) : 'N/A',
        fullData: result.data
      });
    }
    
    return result;
  },

  async getMe(): Promise<ApiResponse<User>> {
    const response = await apiFetch(`${API_BASE_URL}/auth/me`, {
      headers: getAuthHeaders()
    });
    return handleResponse<User>(response);
  },

  async logout(): Promise<void> {
    // Clear local storage
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    localStorage.removeItem('user_id');
  },

  isAuthenticated(): boolean {
    return !!localStorage.getItem('access_token');
  }
};

// ============================================
// Sessions API
// ============================================

export const sessionsApi = {
  async list(skip: number = 0, limit: number = 100): Promise<ApiResponse<Session[]>> {
    const response = await apiFetch(`${API_BASE_URL}/sessions?skip=${skip}&limit=${limit}`, {
      headers: getAuthHeaders()
    });
    return handleResponse<Session[]>(response);
  },

  async create(name: string, description?: string): Promise<ApiResponse<Session>> {
    const response = await apiFetch(`${API_BASE_URL}/sessions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, description })
    });
    return handleResponse<Session>(response);
  },

  async get(sessionId: string): Promise<ApiResponse<Session>> {
    const response = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}`, {
      headers: getAuthHeaders()
    });
    return handleResponse<Session>(response);
  },

  async update(sessionId: string, name?: string, description?: string, status?: string): Promise<ApiResponse<Session>> {
    const body: any = {};
    if (name !== undefined) body.name = name;
    if (description !== undefined) body.description = description;
    if (status !== undefined) body.status = status;

    const response = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(body)
    });
    return handleResponse<Session>(response);
  },

  async delete(sessionId: string): Promise<ApiResponse<void>> {
    const response = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    return handleResponse<void>(response);
  }
};

// ============================================
// Cases API
// Note: Cases router is mounted at /sessions prefix
// ============================================

export const casesApi = {
  async upload(sessionId: string, file: File): Promise<ApiResponse<Case>> {
    const formData = new FormData();
    // session_id is in the path, not form data
    formData.append('file', file);
    
    // Correct endpoint from Swagger docs: POST /api/v1/sessions/{session_id}/upload
    const endpoint = `${API_BASE_URL}/sessions/${sessionId}/upload`;
    
    console.log('Uploading file to:', endpoint, { sessionId, fileName: file.name, fileSize: file.size });
    const response = await apiFetch(endpoint, {
      method: 'POST',
      headers: getAuthHeadersFormData(),
      body: formData
    });
    
    console.log('Upload response:', { status: response.status, statusText: response.statusText });
    const result = await handleResponse<Case>(response);
    
    if (result.data) {
      console.log('Upload response data:', {
        hasId: !!(result.data as any).id,
        hasCaseId: !!result.data.case_id,
        allKeys: Object.keys(result.data),
        fullData: result.data
      });
    }
    
    return result;
  },

  async get(caseId: string): Promise<ApiResponse<Case>> {
    const response = await apiFetch(`${API_BASE_URL}/cases/${caseId}`, {
      headers: getAuthHeaders()
    });
    return handleResponse<Case>(response);
  },

  /** STL binary for 3D preview or opening in ParaView (GET /cases/{id}/paraview-mesh). */
  async fetchParaviewStlBlob(caseId: string): Promise<Blob> {
    const token = localStorage.getItem("access_token");
    const response = await apiFetch(`${API_BASE_URL}/cases/${caseId}/paraview-mesh`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const data = await response.json();
        if (typeof data.detail === "string") detail = data.detail;
        else if (data.detail) detail = JSON.stringify(data.detail);
      } catch {
        /* use statusText */
      }
      throw new Error(detail || `HTTP ${response.status}`);
    }
    return response.blob();
  },

  async getCaseDetails(sessionId: string): Promise<ApiResponse<Case>> {
    // GET /api/v1/sessions/{session_id}/case - Get case details for a session
    const response = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}/case`, {
      headers: getAuthHeaders()
    });
    return handleResponse<Case>(response);
  },

  async listInSession(sessionId: string): Promise<ApiResponse<Case[]>> {
    // GET /sessions/session/{session_id}/cases
    const response = await apiFetch(`${API_BASE_URL}/sessions/session/${sessionId}/cases`, {
      headers: getAuthHeaders()
    });
    return handleResponse<Case[]>(response);
  },

  async delete(caseId: string): Promise<ApiResponse<void>> {
    const response = await apiFetch(`${API_BASE_URL}/cases/${caseId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    return handleResponse<void>(response);
  }
};

// ============================================
// Jobs API
// ============================================

/** Matches backend JobCreate schema: flat body, not nested under parameters */
export interface JobCreate {
  session_id: string;
  case_id: string;
  prompt_text: string;
  solver: string;
  turbulence_model: string;
  aoa_from: number;
  aoa_to: number;
  num_samples: number;
  job_config?: Record<string, unknown>;
}

export const jobsApi = {
  async create(jobData: JobCreate): Promise<ApiResponse<Job>> {
    console.log('Creating job with data:', jobData);
    const response = await apiFetch(`${API_BASE_URL}/jobs`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(jobData)
    });
    
    // Log response for debugging
    const result = await handleResponse<Job>(response);
    if (result.error) {
      console.error('Job creation error details:', {
        error: result.error,
        status: result.status,
        jobData: jobData
      });
    }
    return result;
  },

  async get(jobId: string): Promise<ApiResponse<Job>> {
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}`, {
      headers: getAuthHeaders()
    });
    return handleResponse<Job>(response);
  },

  async getDetail(jobId: string): Promise<ApiResponse<Job>> {
    // GET /api/v1/jobs/{job_id}/detail - Get full job details
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/detail`, {
      headers: getAuthHeaders()
    });
    return handleResponse<Job>(response);
  },

  async getProgress(jobId: string): Promise<ApiResponse<JobProgress>> {
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/progress`, {
      headers: getAuthHeaders()
    });
    return handleResponse<JobProgress>(response);
  },

  async execute(jobId: string, parameters?: any): Promise<ApiResponse<Job>> {
    console.log('Executing job:', jobId, parameters ? 'with parameters' : 'without parameters');
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/execute`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: parameters ? JSON.stringify(parameters) : undefined
    });
    const result = await handleResponse<Job>(response);
    if (result.error) {
      console.error('Job execution error:', {
        error: result.error,
        status: result.status,
        jobId: jobId
      });
    }
    return result;
  },

  async listInSession(sessionId: string, skip: number = 0, limit: number = 100): Promise<ApiResponse<Job[]>> {
    const response = await apiFetch(`${API_BASE_URL}/jobs/session/${sessionId}/jobs?skip=${skip}&limit=${limit}`, {
      headers: getAuthHeaders()
    });
    return handleResponse<Job[]>(response);
  },

  async update(jobId: string, updates: Partial<Job>): Promise<ApiResponse<Job>> {
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse<Job>(response);
  },

  async delete(jobId: string): Promise<ApiResponse<void>> {
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    return handleResponse<void>(response);
  }
};

// ============================================
// LLM API
// ============================================

export interface ExplainRequest {
  question?: string;
}

export interface ExplainResponse {
  job_id: string;
  explanation: string;
}

export interface ChatResponse {
  response: string;
  session_id?: string;
}

export const llmApi = {
  async explain(jobId: string, question?: string): Promise<ApiResponse<ExplainResponse>> {
    console.log('LLM explain request:', { 
      url: `${API_BASE_URL}/llm/explain`,
      jobId, 
      hasQuestion: !!question 
    });
    const response = await apiFetch(`${API_BASE_URL}/llm/explain`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ job_id: jobId, question })
    });
    const result = await handleResponse<ExplainResponse>(response);
    console.log('LLM explain response:', {
      hasData: !!result.data,
      hasError: !!result.error,
      error: result.error,
      status: result.status,
      explanationLength: result.data?.explanation?.length
    });
    if (result.error) {
      console.error('LLM explain error details:', {
        error: result.error,
        status: result.status,
        jobId,
        question
      });
    }
    return result;
  },

  async getExplanation(jobId: string): Promise<ApiResponse<ExplainResponse>> {
    // Note: This endpoint might not exist in the backend - check API docs
    // If it doesn't exist, we can remove this method or use the explain endpoint
    const response = await apiFetch(`${API_BASE_URL}/llm/explanation`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ job_id: jobId })
    });
    return handleResponse<ExplainResponse>(response);
  },

  async chat(sessionId: string, message: string): Promise<ApiResponse<ChatResponse>> {
    console.log('LLM chat request:', { 
      url: `${API_BASE_URL}/llm/chat`,
      sessionId, 
      messageLength: message.length 
    });
    const response = await apiFetch(`${API_BASE_URL}/llm/chat`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ session_id: sessionId, query: message })
    });
    const result = await handleResponse<ChatResponse>(response);
    console.log('LLM chat response:', {
      hasData: !!result.data,
      hasError: !!result.error,
      error: result.error,
      status: result.status,
      responseLength: result.data?.response?.length
    });
    if (result.error) {
      console.error('LLM chat error details:', {
        error: result.error,
        status: result.status,
        sessionId,
        messagePreview: message.substring(0, 50)
      });
    }
    return result;
  }
};

// ============================================
// Results API
// ============================================

export const resultsApi = {
  async getResults(jobId: string): Promise<ApiResponse<JobResult>> {
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/results`, {
      headers: getAuthHeaders()
    });
    return handleResponse<JobResult>(response);
  },

  async downloadSummary(jobId: string): Promise<Blob> {
    const token = localStorage.getItem('access_token');
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/download/summary`, {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` })
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download summary: ${response.statusText}`);
    }
    
    return response.blob();
  },

  async downloadLLMOutput(jobId: string): Promise<Blob> {
    const token = localStorage.getItem('access_token');
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/download/llm-output`, {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` })
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download LLM output: ${response.statusText}`);
    }
    
    return response.blob();
  },

  async getPlotData(jobId: string): Promise<ApiResponse<any>> {
    const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/plots/data`, {
      headers: getAuthHeaders()
    });
    return handleResponse<any>(response);
  }
};

// ============================================
// Health Check
// ============================================

export const healthApi = {
  async check(): Promise<ApiResponse<{ status: string; version?: string }>> {
    const response = await apiFetch(`${API_BASE_URL.replace('/api/v1', '')}/health`);
    return handleResponse(response);
  }
};

export const foamApi = {
  async loadFoam(file: File, outputFormat: "vtu" | "json" = "vtu"): Promise<ApiResponse<FoamLoadResult>> {
    const buildFormData = () => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("output_format", outputFormat);
      // VTU + coefficient metadata in JSON body (readable cross-origin); binary VTU would hide X-OpenFOAM-* headers from JS.
      if (outputFormat === "vtu") {
        fd.append("vtu_packaging", "json");
      }
      return fd;
    };

    const rootBase = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
    const candidates = [
      `${API_BASE_URL}/load-foam`,
      `${API_BASE_URL}/foam/load-foam`,
      `${rootBase}/load-foam`,
    ];

    const toBase64FromBytes = (bytes: Uint8Array): string => {
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    };

    const normalize = (payload: any): FoamLoadResult => {
      const nested = payload?.data && typeof payload.data === "object" ? payload.data : payload;
      const guessedB64 =
        nested?.vtu_base64 ||
        nested?.vtuBase64 ||
        nested?.vtu ||
        nested?.file_base64 ||
        nested?.fileBase64 ||
        nested?.base64 ||
        nested?.payload_base64 ||
        null;
      const fmtRaw = String(nested?.output_format || nested?.format || nested?.type || "").toLowerCase();
      const fmt: "vtu" | "json" = fmtRaw === "json" ? "json" : "vtu";

      return {
        output_format: fmt,
        filename: nested?.filename || nested?.file_name || nested?.name || undefined,
        vtu_base64: guessedB64 || undefined,
        dataset_id:
          nested?.dataset_id ||
          nested?.datasetId ||
          payload?.dataset_id ||
          payload?.datasetId ||
          nested?.id ||
          payload?.id ||
          undefined,
        dataset: nested?.dataset || nested?.mesh || undefined,
        metadata: (nested?.metadata && typeof nested.metadata === "object" ? nested.metadata : {}) as Record<string, any>,
        warnings: Array.isArray(nested?.warnings) ? nested.warnings : [],
      };
    };

    const fetchVtuFromUrl = async (vtuUrlRaw: string): Promise<string | null> => {
      const vtuUrl = /^https?:\/\//i.test(vtuUrlRaw)
        ? vtuUrlRaw
        : `${rootBase}${vtuUrlRaw.startsWith("/") ? "" : "/"}${vtuUrlRaw}`;
      const token = localStorage.getItem("access_token");
      const resp = await apiFetch(vtuUrl, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      return toBase64FromBytes(new Uint8Array(buf));
    };

    let lastResult: ApiResponse<FoamLoadResult> | null = null;
    for (const url of candidates) {
      const response = await apiFetch(url, {
        method: "POST",
        headers: getAuthHeadersFormData(),
        body: buildFormData(),
      });
      if (!response.ok) {
        const result = await handleResponse<FoamLoadResult>(response);
        if (result.status !== 404) {
          return result;
        }
        lastResult = result;
        continue;
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (
        contentType.includes("application/octet-stream") ||
        contentType.includes("application/vnd") ||
        contentType.includes("xml")
      ) {
        const blob = await response.blob();
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);

        let metadata: Record<string, unknown> = {};
        try {
          const metaHdr = response.headers.get("X-OpenFOAM-Metadata");
          if (metaHdr) metadata = JSON.parse(metaHdr) as Record<string, unknown>;
        } catch {
          metadata = {};
        }
        let warnings: string[] = [];
        try {
          const wHdr = response.headers.get("X-OpenFOAM-Warnings");
          if (wHdr) {
            const parsed = JSON.parse(wHdr);
            if (Array.isArray(parsed)) warnings = parsed as string[];
          }
        } catch {
          warnings = [];
        }

        return {
          status: response.status,
          data: {
            output_format: "vtu",
            filename: "openfoam_processed.vtu",
            vtu_base64: btoa(binary),
            metadata,
            warnings,
          },
        };
      }

      const generic = await handleResponse<any>(response);
      const result: ApiResponse<FoamLoadResult> = generic.data
        ? { ...generic, data: normalize(generic.data) }
        : (generic as ApiResponse<FoamLoadResult>);

      // Live backend variant: returns dataset_id + vtu_url instead of inline vtu_base64.
      const raw = generic.data as any;
      if (!result.error && result.data && !result.data.vtu_base64 && raw?.vtu_url) {
        const fetched = await fetchVtuFromUrl(String(raw.vtu_url));
        if (fetched) {
          result.data.vtu_base64 = fetched;
          result.data.filename = result.data.filename || "openfoam_processed.vtu";
        }
      }

      if (result.status !== 404) {
        return result;
      }
      lastResult = result;
    }

    return (
      lastResult ?? {
        status: 404,
        error: "OpenFOAM loader endpoint not found on backend.",
      }
    );
  },

  async getPlotData(datasetId: string): Promise<ApiResponse<any>> {
    const rootBase = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
    const encodedId = encodeURIComponent(datasetId);
    const candidates = [
      `${API_BASE_URL}/load-foam/${encodedId}/plot-data`,
      `${API_BASE_URL}/foam/load-foam/${encodedId}/plot-data`,
      `${rootBase}/load-foam/${encodedId}/plot-data`,
    ];

    let lastResult: ApiResponse<any> | null = null;
    for (const url of candidates) {
      const response = await apiFetch(url, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<any>(response);
      if (result.status !== 404) {
        return result;
      }
      lastResult = result;
    }

    return (
      lastResult ?? {
        status: 404,
        error: "OpenFOAM plot-data endpoint not found on backend.",
      }
    );
  },
};
