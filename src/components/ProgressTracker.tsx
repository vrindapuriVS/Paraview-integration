import { useEffect, useState } from "react";

type ProgressStep = {
  id: string;
  label: string;
};

type ProgressTrackerProps = {
  steps: ProgressStep[];
  currentStep: number;
};

export default function ProgressTracker({ steps, currentStep }: ProgressTrackerProps) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  useEffect(() => {
    const newCompleted: number[] = [];
    for (let i = 0; i < currentStep; i++) {
      newCompleted.push(i);
    }
    setCompletedSteps(newCompleted);
  }, [currentStep]);

  const progressPercentage = (currentStep / steps.length) * 100;

  return (
    <div className="agentic-progress-box">
      <div className="agentic-bg-gradient"></div>
      
      <div className="progress-connector">
        <div 
          className="progress-connector-fill" 
          style={{ height: `${progressPercentage}%` }}
        >
          <div className="connector-glow"></div>
        </div>
      </div>
      
      <div className="progress-percentage">
        {Math.round(progressPercentage)}%
      </div>

      {steps.map((step, index) => {
        const isComplete = index < currentStep;
        const isActive = index === currentStep;
        const isPending = index > currentStep;
        const wasJustCompleted = completedSteps.includes(index) && index === currentStep - 1;

        return (
          <div
            key={step.id}
            className={`agentic-step ${isComplete ? 'complete' : ''} ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''} ${wasJustCompleted ? 'just-completed' : ''}`}
            style={{ '--step-index': index } as React.CSSProperties}
          >
            <div className="agentic-step-indicator">
              {isComplete ? (
                <div className="agentic-checkmark">
                  <div className="checkmark-circle">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path 
                        d="M11.5 4L5.75 9.75L2.5 6.5" 
                        stroke="currentColor" 
                        strokeWidth="2.5" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                        className="checkmark-path"
                      />
                    </svg>
                  </div>
                  <div className="checkmark-ripple"></div>
                </div>
              ) : isActive ? (
                <div className="agentic-spinner">
                  <div className="spinner-core"></div>
                  <div className="spinner-rings">
                    <div className="ring ring-1"></div>
                    <div className="ring ring-2"></div>
                    <div className="ring ring-3"></div>
                  </div>
                  <div className="spinner-particles">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="particle" style={{ '--particle-index': i } as React.CSSProperties}></div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="agentic-icon-pending">
                  <div className="pending-dot"></div>
                </div>
              )}
            </div>
            <div className="agentic-step-label">
              {step.label}
            </div>
            {isActive && (
              <div className="step-glow-effect"></div>
            )}
          </div>
        );
      })}

      <div className="shimmer-overlay"></div>
      
      <div className="corner-accent corner-tl"></div>
      <div className="corner-accent corner-tr"></div>
      <div className="corner-accent corner-bl"></div>
      <div className="corner-accent corner-br"></div>
    </div>
  );
}





