import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AnalysisFlowStep = "geometry" | "cl" | "cd" | "residuals";

export type AnalysisFlowState = {
  currentStep: AnalysisFlowStep;
  onSelectStep: (step: AnalysisFlowStep) => void;
  onExit: () => void;
};

export type AppLayoutContextValue = {
  hideSidebar: boolean;
  registerGeometryViewer: () => void;
  unregisterGeometryViewer: () => void;
  resultsWizardOpen: boolean;
  setResultsWizardOpen: (open: boolean) => void;
  analysisFlow: AnalysisFlowState | null;
  setAnalysisFlow: (flow: AnalysisFlowState | null) => void;
};

const AppLayoutContext = createContext<AppLayoutContextValue | null>(null);

export function AppLayoutProvider({ children }: { children: ReactNode }) {
  const [analysisFlow, setAnalysisFlowState] = useState<AnalysisFlowState | null>(null);
  const [resultsWizardOpen, setResultsWizardOpenState] = useState(false);

  const registerGeometryViewer = useCallback(() => {
    // Sidebar stays visible during immersive geometry/results flow.
  }, []);

  const unregisterGeometryViewer = useCallback(() => {
    // Kept for compatibility with existing viewer mount hooks.
  }, []);

  const setResultsWizardOpen = useCallback((open: boolean) => {
    setResultsWizardOpenState(open);
  }, []);

  const setAnalysisFlow = useCallback((flow: AnalysisFlowState | null) => {
    setAnalysisFlowState(flow);
  }, []);

  // The sidebar now stays visible during geometry/CL/CD/residual flow so it can act
  // as the step navigator. We keep the existing registration methods for compatibility.
  const hideSidebar = false;

  const value = useMemo(
    () => ({
      hideSidebar,
      registerGeometryViewer,
      unregisterGeometryViewer,
      resultsWizardOpen,
      setResultsWizardOpen,
      analysisFlow,
      setAnalysisFlow,
    }),
    [
      hideSidebar,
      registerGeometryViewer,
      unregisterGeometryViewer,
      resultsWizardOpen,
      setResultsWizardOpen,
      analysisFlow,
      setAnalysisFlow,
    ]
  );

  return (
    <AppLayoutContext.Provider value={value}>{children}</AppLayoutContext.Provider>
  );
}

export function useAppLayout(): AppLayoutContextValue {
  const ctx = useContext(AppLayoutContext);
  if (!ctx) {
    throw new Error("useAppLayout must be used within AppLayoutProvider");
  }
  return ctx;
}
