import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import ChatInput from "./ChatInput";
import MessageBubble from "./MessageBubble";
import ThinkingSpinner from "./ThinkingSpinner";
import StlPreview from "./StlPreview";
import VtuPreview from "./VtuPreview";
import UQChart from "./UQChart";
import { sessionsApi, casesApi, jobsApi, llmApi, resultsApi, foamApi } from "../services/api";

type Message = {
  id: number;
  role: "user" | "assistant";
  text?: string;
  content?: React.ReactNode;
  file?: File | null;
  viewerType?: "stl" | "vtu";
  analysis?: AnalysisResult;
  stlPreview?: { caseId?: string; fileName: string; file?: File | null };
  vtuPreview?: { fileName: string; vtuUrl: string };
};

type AnalysisResult = {
  progressStep: number;
  charts?: {
    cd: Array<{ AOA: number; Mean: number; UQ: number }>;
    cl: Array<{ AOA: number; Mean: number; UQ: number }>;
  } | null;
  summary?: string;
  error?: string;
};

const STEPS = [
  "Setting up the simulation",
  "Running CFD simulation",
  "Running Uncertainty Quantification",
];

const STEP_DURATIONS_MS = [10000, 20000, 5000];
const TYPING_INTERVAL_MS = 12;

const getTextCharCount = (html: string) => {
  let count = 0;
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      const closeIdx = html.indexOf('>', i);
      if (closeIdx === -1) break;
      i = closeIdx + 1;
      continue;
    }

    count += 1;
    i += 1;
  }

  return count;
};

const getTypedHtml = (html: string, visibleChars: number) => {
  let count = 0;
  let i = 0;
  let output = '';
  const openTags: string[] = [];

  while (i < html.length && count < visibleChars) {
    if (html[i] === '<') {
      const closeIdx = html.indexOf('>', i);
      if (closeIdx === -1) break;
      const tag = html.slice(i, closeIdx + 1);
      output += tag;

      const closingMatch = tag.match(/^<\s*\/\s*([a-zA-Z0-9-]+)/);
      if (closingMatch) {
        const name = closingMatch[1].toLowerCase();
        if (openTags[openTags.length - 1] === name) {
          openTags.pop();
        }
      } else {
        const openingMatch = tag.match(/^<\s*([a-zA-Z0-9-]+)/);
        const isSelfClosing = tag.endsWith('/>') || /^<\s*(br|hr|img|input|meta|link)\b/i.test(tag);
        if (openingMatch && !isSelfClosing) {
          openTags.push(openingMatch[1].toLowerCase());
        }
      }

      i = closeIdx + 1;
      continue;
    }

    output += html[i];
    count += 1;
    i += 1;
  }

  for (let j = openTags.length - 1; j >= 0; j -= 1) {
    output += `</${openTags[j]}>`;
  }

  if (count < getTextCharCount(html)) {
    output += '<span class="streaming-cursor">|</span>';
  }

  return output;
};

const StreamingSummary = ({ summary }: { summary: string }) => {
  const totalChars = useMemo(() => getTextCharCount(summary), [summary]);
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    setVisibleChars(0);
    if (!summary) return;

    const intervalId = setInterval(() => {
      setVisibleChars((current) => {
        if (current >= totalChars) {
          clearInterval(intervalId);
          return current;
        }
        return current + 1;
      });
    }, TYPING_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [summary, totalChars]);

  const typedHtml = useMemo(
    () => getTypedHtml(summary, visibleChars),
    [summary, visibleChars]
  );

  return (
    <div
      className="streaming-text"
      dangerouslySetInnerHTML={{ __html: typedHtml }}
    />
  );
};

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [thinking, setThinking] = useState(false);
  const [statusMessageIndex, setStatusMessageIndex] = useState(0);
  const [pipelineComplete, setPipelineComplete] = useState(false);
  const messageIdRef = useRef(0);

  const statusMessages = [
    "Setting up the simulation",
    "Running CFD simulation",
    "Running Uncertainty Quantification"
  ];

  // Cycle through status messages while backend processes
  useEffect(() => {
    if (!thinking) {
      setStatusMessageIndex(0);
      return;
    }

    let timeoutId: NodeJS.Timeout | null = null;
    let currentIndex = 0;

    const cycleMessages = () => {
      if (currentIndex < statusMessages.length) {
        setStatusMessageIndex(currentIndex);
        const delay = STEP_DURATIONS_MS[currentIndex] ?? 0;
        currentIndex++;
        if (currentIndex < statusMessages.length) {
          timeoutId = setTimeout(cycleMessages, delay);
        }
      }
    };

    // Start cycling immediately
    cycleMessages();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [thinking]);

  const loadCSVData = async (filename: string) => {
    const buildCandidates = () => {
      const baseUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
      const rawCandidates = [
        baseUrl ? `${baseUrl}/${filename}` : `/${filename}`,
        `/${filename}`,
        `./${filename}`,
      ];
      return Array.from(new Set(rawCandidates.map((url) => encodeURI(url))));
    };

    const parseCsv = (csvText: string) => {
      const normalized = csvText.replace(/^\uFEFF/, '').trim();
      if (!normalized) return null;
      const lines = normalized.split(/\r?\n/);
      if (lines.length < 2) return null;
      const headers = lines[0].split(',').map((h) => h.trim());
      const aoaIndex = headers.findIndex((h) => h.toLowerCase() === 'aoa');
      const meanIndex = headers.findIndex((h) => h.toLowerCase() === 'mean');
      const uqIndex = headers.findIndex((h) => h.toLowerCase() === 'uq');
      if (aoaIndex < 0 || meanIndex < 0 || uqIndex < 0) return null;

      const data: Array<{ AOA: number; Mean: number; UQ: number }> = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((value) => value.trim());
        if (!values[aoaIndex]) continue;
        const aoa = parseFloat(values[aoaIndex]);
        const mean = parseFloat(values[meanIndex]);
        const uq = parseFloat(values[uqIndex]);
        if (!Number.isFinite(aoa) || !Number.isFinite(mean) || !Number.isFinite(uq)) continue;
        data.push({ AOA: aoa, Mean: mean, UQ: uq });
      }

      return data.length ? data.sort((a, b) => a.AOA - b.AOA) : null;
    };

    try {
      const candidates = buildCandidates();
      let lastError: unknown = null;

      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, { cache: 'no-store' });
          if (!response.ok) {
            lastError = new Error(`Failed to load ${candidate}: ${response.status}`);
            continue;
          }
          const contentType = response.headers.get('content-type') || '';
          const csvText = await response.text();
          if (contentType.includes('text/html') || csvText.trim().startsWith('<!DOCTYPE')) {
            lastError = new Error(`Received HTML instead of CSV from ${candidate}`);
            continue;
          }
          const parsed = parseCsv(csvText);
          if (parsed && parsed.length) {
            console.info(`Loaded ${filename} from ${candidate} (${parsed.length} rows)`);
            return parsed;
          }
          lastError = new Error(`Parsed no rows from ${candidate}`);
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) {
        console.error(`Error loading ${filename} data:`, lastError);
      }
      return null;
    } catch (error) {
      console.error(`Error loading ${filename} data:`, error);
      return null;
    }
  };

  const parseQueryParameters = (query: string): { aoa_from: number; aoa_to: number; num_samples: number } => {
    // Default values
    let aoa_from = 0;
    let aoa_to = 10;
    let num_samples = 20;

    const lowerQuery = query.toLowerCase();

    // Parse angle of attack range: "from X to Y degrees" or "X to Y degrees" or "X-Y degrees"
    const aoaPatterns = [
      /angle\s+of\s+attack\s+from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i,
      /aoa\s+from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i,
      /angle\s+of\s+attack\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i,
      /aoa\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)\s+degrees/i,
      /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s+degrees/i,
    ];

    for (const pattern of aoaPatterns) {
      const match = lowerQuery.match(pattern);
      if (match) {
        aoa_from = parseFloat(match[1]);
        aoa_to = parseFloat(match[2]);
        break;
      }
    }

    // Parse number of samples: "X samples" or "with X samples"
    const samplesPatterns = [
      /(\d+)\s+samples/i,
      /with\s+(\d+)\s+samples/i,
      /(\d+)\s+sample/i,
    ];

    for (const pattern of samplesPatterns) {
      const match = lowerQuery.match(pattern);
      if (match) {
        num_samples = parseInt(match[1], 10);
        break;
      }
    }

    // Validate parsed values
    if (!Number.isFinite(aoa_from) || aoa_from < 0) aoa_from = 0;
    if (!Number.isFinite(aoa_to) || aoa_to <= aoa_from) aoa_to = Math.max(aoa_from + 1, 10);
    if (!Number.isFinite(num_samples) || num_samples < 1) num_samples = 20;

    console.log('Parsed query parameters:', { aoa_from, aoa_to, num_samples, query });
    return { aoa_from, aoa_to, num_samples };
  };

  const generateMockChartData = async () => {
    // Load both CL and CD data from CSV files
    const clData = await loadCSVData('SST_CL_UQ_Results.csv');
    const cdData = await loadCSVData('SST_CD_UQ_Results.csv');
    
    // Fallback to mock data if CSV files fail to load
    const aoas = Array.from({ length: 8 }, (_, i) => 2 + i * 2);
    
    return {
      cd: cdData && cdData.length ? cdData : aoas.map(aoa => ({
        AOA: aoa,
        Mean: 0.015 + aoa * 0.001 + Math.random() * 0.002,
        UQ: 0.001 + aoa * 0.0003 + Math.random() * 0.0005,
      })),
      cl: clData && clData.length ? clData : aoas.map(aoa => ({
        AOA: aoa,
        Mean: 0.3 + aoa * 0.08 + Math.random() * 0.05,
        UQ: 0.02 + aoa * 0.005 + Math.random() * 0.01,
      })),
    };
  };

  const loadChartDataFromResults = async (jobId: string, results: any): Promise<{ cd: any[]; cl: any[] } | null> => {
    try {
      console.log('Attempting to load chart data from results:', { jobId, summary_csv_path: results.summary_csv_path, plots_path: results.plots_path });
      
      // First, try to get JSON plot data (most reliable)
      try {
        console.log('Trying to load JSON plot data...');
        const plotDataResponse = await resultsApi.getPlotData(jobId);
        if (plotDataResponse.data) {
          const plotData = plotDataResponse.data;
          console.log('Plot data received:', plotData);
          
          // Try to extract CD and CL arrays from various possible formats
          let cd: any[] = [];
          let cl: any[] = [];
          
          // Format 1: { cd: [...], cl: [...] }
          if (plotData.cd && Array.isArray(plotData.cd) && plotData.cl && Array.isArray(plotData.cl)) {
            cd = plotData.cd;
            cl = plotData.cl;
          }
          // Format 2: { drag: [...], lift: [...] }
          else if (plotData.drag && Array.isArray(plotData.drag) && plotData.lift && Array.isArray(plotData.lift)) {
            cd = plotData.drag;
            cl = plotData.lift;
          }
          // Format 3: { data: [{ aoa, cd_mean, cl_mean, ... }] }
          else if (plotData.data && Array.isArray(plotData.data)) {
            cd = plotData.data.map((d: any) => ({ 
              AOA: d.aoa || d.AOA || d.angle_of_attack, 
              Mean: d.cd_mean || d.cd || d.drag_coefficient, 
              UQ: d.cd_uq || d.cd_ci || d.cd_uncertainty || 0 
            })).filter((d: any) => Number.isFinite(d.AOA) && Number.isFinite(d.Mean));
            cl = plotData.data.map((d: any) => ({ 
              AOA: d.aoa || d.AOA || d.angle_of_attack, 
              Mean: d.cl_mean || d.cl || d.lift_coefficient, 
              UQ: d.cl_uq || d.cl_ci || d.cl_uncertainty || 0 
            })).filter((d: any) => Number.isFinite(d.AOA) && Number.isFinite(d.Mean));
          }
          
          if (cd.length > 0 && cl.length > 0) {
            // Normalize to our format: { AOA, Mean, UQ }
            const normalizedCd = cd.map((d: any) => ({
              AOA: d.AOA || d.aoa || d.angle_of_attack || 0,
              Mean: d.Mean || d.mean || d.cd_mean || d.cd || 0,
              UQ: d.UQ || d.uq || d.cd_uq || d.cd_ci || d.uncertainty || 0
            })).filter((d: any) => Number.isFinite(d.AOA) && Number.isFinite(d.Mean));
            
            const normalizedCl = cl.map((d: any) => ({
              AOA: d.AOA || d.aoa || d.angle_of_attack || 0,
              Mean: d.Mean || d.mean || d.cl_mean || d.cl || 0,
              UQ: d.UQ || d.uq || d.cl_uq || d.cl_ci || d.uncertainty || 0
            })).filter((d: any) => Number.isFinite(d.AOA) && Number.isFinite(d.Mean));
            
            if (normalizedCd.length > 0 && normalizedCl.length > 0) {
              console.log(`✅ Successfully loaded ${normalizedCd.length} data points from JSON plot data`);
              const sorted = {
                cd: normalizedCd.sort((a, b) => a.AOA - b.AOA),
                cl: normalizedCl.sort((a, b) => a.AOA - b.AOA)
              };
              console.log('Data range - CD:', { minAOA: sorted.cd[0]?.AOA, maxAOA: sorted.cd[sorted.cd.length - 1]?.AOA });
              console.log('Data range - CL:', { minAOA: sorted.cl[0]?.AOA, maxAOA: sorted.cl[sorted.cl.length - 1]?.AOA });
              return sorted;
            }
          }
        }
      } catch (plotError) {
        console.warn('Failed to load JSON plot data, trying CSV:', plotError);
      }
      
      // Fallback: Try to download summary CSV if available
      if (results.summary_csv_path) {
        try {
          console.log('Downloading summary CSV from:', results.summary_csv_path);
          const csvBlob = await resultsApi.downloadSummary(jobId);
          const csvText = await csvBlob.text();
          console.log('CSV text length:', csvText.length, 'first 200 chars:', csvText.substring(0, 200));
          
          const lines = csvText.split(/\r?\n/).filter(line => line.trim());
          if (lines.length > 1) {
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
            console.log('CSV headers:', headers);
            
            const aoaIdx = headers.findIndex(h => h === 'aoa' || h === 'angle_of_attack');
            const cdMeanIdx = headers.findIndex(h => h === 'cd_mean' || h === 'cd' || h === 'drag_coefficient' || h === 'drag');
            const clMeanIdx = headers.findIndex(h => h === 'cl_mean' || h === 'cl' || h === 'lift_coefficient' || h === 'lift');
            const cdUqIdx = headers.findIndex(h => h === 'cd_uq' || h === 'cd_ci' || h === 'cd_uncertainty' || h === 'cd_std' || h === 'cd_stddev');
            const clUqIdx = headers.findIndex(h => h === 'cl_uq' || h === 'cl_ci' || h === 'cl_uncertainty' || h === 'cl_std' || h === 'cl_stddev');

            console.log('Column indices:', { aoaIdx, cdMeanIdx, clMeanIdx, cdUqIdx, clUqIdx });

            if (aoaIdx >= 0 && cdMeanIdx >= 0 && clMeanIdx >= 0) {
              const cd: any[] = [];
              const cl: any[] = [];
              
              for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim());
                if (values.length <= Math.max(aoaIdx, cdMeanIdx, clMeanIdx)) continue;
                
                const aoa = parseFloat(values[aoaIdx]);
                const cdMean = parseFloat(values[cdMeanIdx]);
                const clMean = parseFloat(values[clMeanIdx]);
                const cdUq = cdUqIdx >= 0 && cdUqIdx < values.length ? parseFloat(values[cdUqIdx]) : 0;
                const clUq = clUqIdx >= 0 && clUqIdx < values.length ? parseFloat(values[clUqIdx]) : 0;

                if (Number.isFinite(aoa) && Number.isFinite(cdMean) && Number.isFinite(clMean)) {
                  cd.push({ AOA: aoa, Mean: cdMean, UQ: Math.abs(cdUq) || 0 });
                  cl.push({ AOA: aoa, Mean: clMean, UQ: Math.abs(clUq) || 0 });
                }
              }

              if (cd.length > 0 && cl.length > 0) {
                console.log(`✅ Successfully loaded ${cd.length} data points from job results CSV`);
                const sorted = { 
                  cd: cd.sort((a, b) => a.AOA - b.AOA), 
                  cl: cl.sort((a, b) => a.AOA - b.AOA) 
                };
                console.log('Data range - CD:', { minAOA: sorted.cd[0]?.AOA, maxAOA: sorted.cd[sorted.cd.length - 1]?.AOA });
                console.log('Data range - CL:', { minAOA: sorted.cl[0]?.AOA, maxAOA: sorted.cl[sorted.cl.length - 1]?.AOA });
                return sorted;
              } else {
                console.warn('CSV parsed but no valid data points found');
              }
            } else {
              console.warn('CSV missing required columns. Found headers:', headers);
            }
          } else {
            console.warn('CSV has insufficient lines:', lines.length);
          }
        } catch (error) {
          console.error('Failed to load CSV from results:', error);
        }
      } else {
        console.warn('No summary_csv_path in results. Results object:', results);
      }
    } catch (error) {
      console.error('Error loading chart data from results:', error);
    }
    return null;
  };

  const runRealPipeline = async (prompt: string, file?: File | null) => {
    try {
      setPipelineComplete(false);
      let sessionId: string | null = null;
      let caseId: string | null = null;
      let jobId: string | null = null;

      // Step 1: Create or get a session
      setStatusMessageIndex(0);
      console.log('Creating session...');
      const sessionResponse = await sessionsApi.create(
        `Analysis - ${new Date().toLocaleString()}`,
        prompt || 'CFD Uncertainty Quantification Analysis'
      );
      
      if (sessionResponse.error || !sessionResponse.data) {
        throw new Error(sessionResponse.error || 'Failed to create session');
      }
      
      sessionId = sessionResponse.data.id || sessionResponse.data.session_id || '';
      console.log('Session created:', sessionId);

      // Step 2: Upload file if provided
      if (file) {
        setStatusMessageIndex(0);
        console.log('Uploading file...');
        const uploadResponse = await casesApi.upload(sessionId, file);
        
        if (uploadResponse.error || !uploadResponse.data) {
          throw new Error(uploadResponse.error || 'Failed to upload file');
        }
        
        caseId = uploadResponse.data.case_id || uploadResponse.data.id || '';
        console.log('File uploaded, case ID:', caseId);
      }

      // Step 3: Create job (backend requires case_id; if no file was uploaded we need a case)
      if (!caseId) {
        throw new Error('Please upload a case file first before running the analysis.');
      }

      // Parse parameters from user query
      const params = parseQueryParameters(prompt || '');
      console.log('Using parsed parameters for job:', params);

      setStatusMessageIndex(1);
      console.log('Creating job...');
      const jobCreateResponse = await jobsApi.create({
        session_id: sessionId,
        case_id: caseId,
        prompt_text: prompt || 'Run uncertainty quantification analysis',
        solver: 'simpleFoam',
        turbulence_model: 'SST',
        aoa_from: params.aoa_from,
        aoa_to: params.aoa_to,
        num_samples: params.num_samples,
      });

      if (jobCreateResponse.error || !jobCreateResponse.data) {
        throw new Error(jobCreateResponse.error || 'Failed to create job');
      }

      jobId = jobCreateResponse.data.id || jobCreateResponse.data.job_id || '';
      console.log('Job created:', jobId);

      // Step 4: Execute job
      setStatusMessageIndex(1);
      console.log('Executing job...');
      const executeResponse = await jobsApi.execute(jobId);
      
      if (executeResponse.error) {
        console.warn('Job execution warning:', executeResponse.error);
      }

      // Step 5: Poll for job progress
      setStatusMessageIndex(2);
      let jobStatus = 'pending';
      let progressPercent = 0;
      const maxPollAttempts = 300; // 5 minutes max (1 second intervals)
      let pollAttempts = 0;

      while (jobStatus !== 'completed' && jobStatus !== 'failed' && pollAttempts < maxPollAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
        
        const progressResponse = await jobsApi.getProgress(jobId);
        
        if (progressResponse.data) {
          jobStatus = progressResponse.data.status;
          progressPercent = progressResponse.data.progress_percent || 0;
          console.log(`Job progress: ${progressPercent}% - ${progressResponse.data.step_name}`);
          
          // Update status message based on progress
          if (progressPercent < 33) {
            setStatusMessageIndex(0);
          } else if (progressPercent < 66) {
            setStatusMessageIndex(1);
          } else {
            setStatusMessageIndex(2);
          }
        }
        
        pollAttempts++;
      }

      if (jobStatus === 'failed') {
        const jobDetail = await jobsApi.get(jobId);
        throw new Error(jobDetail.data?.error_message || 'Job execution failed');
      }

      if (jobStatus !== 'completed') {
        throw new Error('Job did not complete within timeout period');
      }

      // Step 6: Get results
      console.log('Fetching results...');
      const resultsResponse = await resultsApi.getResults(jobId);
      
      if (resultsResponse.error || !resultsResponse.data) {
        throw new Error(resultsResponse.error || 'Failed to get results');
      }

      const results = resultsResponse.data;

      // Step 7: Call LLM API for explanation
      console.log('Calling LLM API for explanation...');
      let summaryText = '';
      
      try {
        const llmResponse = await llmApi.explain(jobId, prompt || 'Explain the results of this uncertainty quantification analysis');
        
        if (llmResponse.data && llmResponse.data.explanation) {
          summaryText = llmResponse.data.explanation;
          console.log('LLM explanation received:', summaryText.substring(0, 100));
        } else {
          console.warn('LLM API returned no explanation:', llmResponse.error);
          // Fallback to default summary
          summaryText = "The uncertainty quantification analysis has been completed. Results show the variation in aerodynamic coefficients across the specified range of conditions.";
        }
      } catch (llmError) {
        console.error('LLM API error:', llmError);
        summaryText = "The uncertainty quantification analysis has been completed. Results show the variation in aerodynamic coefficients across the specified range of conditions.";
      }

      // Step 8: Load chart data (try to load from results, fallback to mock)
      console.log('Loading chart data from results...');
      let chartData = await loadChartDataFromResults(jobId, results);
      if (!chartData) {
        console.log('Falling back to mock chart data');
        chartData = await generateMockChartData();
      }

      setPipelineComplete(true);
      return {
        progressStep: STEPS.length,
        charts: chartData,
        summary: summaryText,
      };
    } catch (error) {
      console.error('Pipeline error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        progressStep: STEPS.length,
        charts: null,
        summary: `Error: ${errorMessage}`,
        error: errorMessage,
      };
    } finally {
      setThinking(false);
    }
  };

  const sendMessage = async (text: string, file?: File | null) => {
    const userMessage = text || (file ? `Uploaded: ${file.name}` : "");
    const messageId = messageIdRef.current++;
    const isPreviewableMesh =
      file !== null &&
      file !== undefined &&
      /\.(stl|vtk|vtu|pvd|msh|foam|zip|tgz|tar|tar\.gz)$/i.test(file.name);
    const isLocalPreviewFile =
      file !== null &&
      file !== undefined &&
      /\.(stl|vtk|vtu|pvd|foam)$/i.test(file.name);
    const isFoamMarkerOnly =
      file !== null &&
      file !== undefined &&
      /\.foam$/i.test(file.name);
    const isFoamCaseInput =
      file !== null &&
      file !== undefined &&
      /\.(zip|tgz|tar|tar\.gz)$/i.test(file.name);
    const isVtuFile =
      file !== null &&
      file !== undefined &&
      /\.vtu$/i.test(file.name);
    
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        role: "user",
        text: userMessage,
        file: file,
        viewerType: isVtuFile ? "vtu" : isLocalPreviewFile ? "stl" : undefined,
        stlPreview:
          isLocalPreviewFile && !isVtuFile
            ? { fileName: file.name, file }
            : undefined,
        vtuPreview:
          isVtuFile
            ? { fileName: file.name, vtuUrl: URL.createObjectURL(file) }
            : undefined,
      },
    ]);

    setThinking(true);
    setStatusMessageIndex(0);

    if (isPreviewableMesh) {
      try {
        if (isFoamMarkerOnly) {
          setMessages((prev) => [
            ...prev,
            {
              id: messageIdRef.current++,
              role: "assistant",
              text: "This is a reference file. Please upload full OpenFOAM case (zip or folder).",
            },
          ]);
          return;
        }

        if (isFoamCaseInput && file) {
          const foamRes = await foamApi.loadFoam(file, "vtu");
          if (foamRes.error) {
            const statusInfo = foamRes.status ? ` (HTTP ${foamRes.status})` : "";
            throw new Error(`${foamRes.error}${statusInfo}`);
          }
          if (!foamRes.data) {
            throw new Error("OpenFOAM backend returned empty response.");
          }
          if (!foamRes.data.vtu_base64) {
            // Surface actual contract mismatch details instead of a generic failure.
            const reportedFormat = foamRes.data.output_format || "unknown";
            const hasJsonPayload = Boolean(foamRes.data.dataset);
            const warningText = foamRes.data.warnings?.join(" ") || "";
            const payloadKeys = Object.keys((foamRes.data as unknown as Record<string, unknown>) || {}).join(", ");
            throw new Error(
              `OpenFOAM processing succeeded but VTU payload missing. output_format=${reportedFormat}, has_json=${hasJsonPayload}, keys=[${payloadKeys}]. ${warningText}`.trim()
            );
          }
          const binary = atob(foamRes.data.vtu_base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const outName = foamRes.data.filename || "openfoam_processed.vtu";
          const vtuFile = new File([bytes], outName, { type: "application/octet-stream" });
          const vtuUrl = URL.createObjectURL(vtuFile);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    viewerType: "vtu",
                    vtuPreview: {
                      fileName: outName,
                      vtuUrl,
                    },
                    stlPreview: undefined,
                  }
                : m
            )
          );
          const foamWarnings = foamRes.data?.warnings;
          if (foamWarnings?.length) {
            setMessages((prev) => [
              ...prev,
              {
                id: messageIdRef.current++,
                role: "assistant",
                text: `OpenFOAM loaded with warnings: ${foamWarnings.join(" ")}`,
              },
            ]);
          }
          return;
        }

        const sessionResponse = await sessionsApi.create(
          `Mesh — ${file.name}`,
          text?.trim() || "Mesh geometry"
        );
        if (sessionResponse.error || !sessionResponse.data) {
          throw new Error(sessionResponse.error || "Failed to create session");
        }
        const sessionId =
          sessionResponse.data.id || sessionResponse.data.session_id || "";
        const uploadResponse = await casesApi.upload(sessionId, file);
        if (uploadResponse.error || !uploadResponse.data) {
          throw new Error(uploadResponse.error || "Failed to upload mesh");
        }
        const up = uploadResponse.data as {
          case_id?: string;
          id?: string;
        };
        const cid = String(up.case_id || up.id || "");
        if (!cid) {
          throw new Error("Upload succeeded but no case id was returned");
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  stlPreview: {
                    caseId: cid,
                    fileName: file.name,
                    file: isLocalPreviewFile ? file : undefined,
                  },
                }
              : m
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  analysis: {
                    progressStep: STEPS.length,
                    charts: null,
                    summary: `Could not upload or preview mesh: ${msg}`,
                    error: msg,
                  },
                }
              : m
          )
        );
      } finally {
        setThinking(false);
      }
      return;
    }

    // Check if this is a simple question (no file, and text doesn't suggest running analysis)
    const isSimpleQuestion = !file && text && 
      (text.toLowerCase().includes('?') || 
       text.toLowerCase().includes('what') || 
       text.toLowerCase().includes('how') ||
       text.toLowerCase().includes('explain') ||
       text.length < 50);

    if (isSimpleQuestion) {
      // For simple questions, try to use LLM chat API
      try {
        // Create a temporary session for chat
        const sessionResponse = await sessionsApi.create(
          `Chat - ${new Date().toLocaleString()}`,
          'Chat conversation'
        );
        
        if (sessionResponse.data) {
          const sessionId = sessionResponse.data.id || sessionResponse.data.session_id || '';
          console.log('Calling LLM chat API...');
          
          const chatResponse = await llmApi.chat(sessionId, text);
          const replyText = chatResponse.data?.response;

          if (replyText) {
            setMessages((prev) => [
              ...prev,
              {
                id: messageIdRef.current++,
                role: "assistant",
                text: replyText,
              },
            ]);
            setThinking(false);
            return;
          }
        }
      } catch (error) {
        console.error('LLM chat error:', error);
        // Fall through to run pipeline instead
      }
    }

    // Run real pipeline with backend API calls (for analysis requests or if chat fails)
    const result = await runRealPipeline(text, file);
    if (result) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, analysis: result } : message
        )
      );
    }
  };


  const hasResults = messages.some(m => m.analysis);
  // Show layout when user has sent a message, or we are processing
  const hasContent = messages.some(m => m.role === "user") || thinking;
  const lastUserMessageRef = useRef<HTMLDivElement | null>(null);
  const latestStatusRef = useRef<HTMLDivElement | null>(null);

  // Scroll new user message into view above the prompt bar
  const userMessageCount = messages.filter(m => m.role === "user").length;
  useEffect(() => {
    if (userMessageCount > 0) {
      lastUserMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [userMessageCount]);

  useEffect(() => {
    if (thinking) {
      latestStatusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [thinking, statusMessageIndex]);

  return (
    <div className="chat-wrapper">
      {hasContent && (
        <div className="chat-layout-three-panel">
          {/* Right side - User messages */}
          <div className="chat-right-panel">
            {messages
              .filter(m => m.role === "user")
              .map((message, index, arr) => (
                <div
                  key={`user-${message.id}`}
                  ref={index === arr.length - 1 ? lastUserMessageRef : undefined}
                  className="message-stack"
                >
                  <MessageBubble role="user" text={message.text} />
                  {message.stlPreview && (
                    message.viewerType === "stl" ? (
                      <div className="stl-preview-in-chat">
                        {(() => {
                          console.log("Active viewer:", message.viewerType);
                          return (
                            <StlPreview
                              caseId={message.stlPreview.caseId}
                              fileName={message.stlPreview.fileName}
                              file={message.stlPreview.file}
                            />
                          );
                        })()}
                      </div>
                    ) : null
                  )}
                  {message.vtuPreview && (
                    message.viewerType === "vtu" ? (
                      <div className="stl-preview-in-chat">
                        {(() => {
                          console.log("Active viewer:", message.viewerType);
                          return (
                            <VtuPreview
                              fileName={message.vtuPreview.fileName}
                              vtuUrl={message.vtuPreview.vtuUrl}
                            />
                          );
                        })()}
                      </div>
                    ) : null
                  )}
                  {thinking && index === arr.length - 1 && !message.analysis && (
                    <div className="message-status">
                      <div
                        className="status-steps-column"
                        ref={index === arr.length - 1 ? latestStatusRef : undefined}
                      >
                        {statusMessages.map((step, idx) => (
                          <div
                            key={idx}
                            className={`status-step-item ${idx <= statusMessageIndex && thinking ? 'status-step-active' : idx < statusMessageIndex || pipelineComplete ? 'status-step-done' : ''}`}
                          >
                            {idx < statusMessageIndex || pipelineComplete ? (
                              <span className="status-step-icon status-step-done-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                                  <path d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            ) : thinking && idx === statusMessageIndex ? (
                              <ThinkingSpinner />
                            ) : (
                              <span className="status-step-icon status-step-pending" aria-hidden="true" />
                            )}
                            <span className="status-step-label">{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {message.analysis && message.analysis.progressStep >= STEPS.length && (
                    <div className="message-results">
                      {message.analysis.error ? (
                        <div className="error-message" style={{ color: '#EF4444', padding: '1rem' }}>
                          {message.analysis.summary || message.analysis.error}
                        </div>
                      ) : (
                        <>
                          {message.analysis.charts && (
                            <div className="charts-container">
                              <UQChart
                                data={message.analysis.charts.cd}
                                title="Drag Coefficient vs Angle of Attack"
                                yLabel="Drag Coefficient"
                                color="#EF4444"
                                ciFillColor="rgba(239, 68, 68, 0.45)"
                                isDashed={true}
                              />
                              <UQChart
                                data={message.analysis.charts.cl}
                                title="Lift Coefficient vs Angle of Attack"
                                yLabel="Lift Coefficient"
                                color="#3B82F6"
                                ciFillColor="rgba(59, 130, 246, 0.45)"
                                isDashed={false}
                              />
                            </div>
                          )}
                          {message.analysis.summary && (
                            <div className="results-summary">
                              <StreamingSummary summary={message.analysis.summary} />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Chat input via portal - fixed at viewport bottom, escapes parent transform */}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="chat-input-container-center">
            <ChatInput onSend={sendMessage} disabled={thinking} />
          </div>,
          document.body
        )}
    </div>
  );
}
