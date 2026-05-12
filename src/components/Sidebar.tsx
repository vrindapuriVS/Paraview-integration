import { useState } from "react";
import { useAppLayout, type AnalysisFlowStep } from "../context/AppLayoutContext";

type SidebarProps = {
  onNewAnalysis: () => void;
};

const ANALYSIS_FLOW_ITEMS: Array<{ key: AnalysisFlowStep; label: string }> = [
  { key: "geometry", label: "Geometry" },
  { key: "cl", label: "CL Values" },
  { key: "cd", label: "CD Values" },
  { key: "residuals", label: "Residuals" },
];

export default function Sidebar({ onNewAnalysis }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { analysisFlow } = useAppLayout();

  const recentItems = [
    "Transonic Airfoil UQ",
    "Compressible Flow Mesh",
    "DO-160 Certification",
    "Epistemic Analysis",
  ];

  return (
    <div className={`sidebar agentic-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-bg-gradient"></div>
      <div className="sidebar-shimmer"></div>
      <div className="sidebar-border-glow"></div>
      <button
        className="collapse-btn agentic-collapse-btn"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span className="collapse-icon" aria-hidden="true">
          {collapsed ? (
            <svg viewBox="0 0 24 24" role="presentation" focusable="false">
              <path d="M9 6l6 6-6 6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" role="presentation" focusable="false">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          )}
        </span>
        <div className="collapse-glow"></div>
      </button>

      <div className="sidebar-content-wrapper" style={{ minHeight: 'calc(100vh + 1px)' }}>

        {!collapsed && (
          <>
            <div className="sidebar-header-agentic">
              <div className="sidebar-brand">
                <div className="sidebar-brand-logo">
                  <img src="/Logo1.png" alt="Vortex AI Logo" className="logo-image" />
                </div>
                <div className="sidebar-brand-text">
                  <div className="brand-name">Vortex AI</div>
                  <div className="brand-subtitle">AI-Powered UQ Analysis</div>
                </div>
              </div>
            </div>

            {!analysisFlow && (
              <button className="new-analysis-btn agentic-new-btn" onClick={onNewAnalysis}>
                <span className="btn-icon">+</span>
                <span className="btn-text">New Analysis</span>
                <div className="btn-shimmer"></div>
                <div className="btn-glow"></div>
              </button>
            )}

            {analysisFlow ? (
              <>
                <div className="sidebar-section agentic-section sidebar-flow-section">
                  <div className="sidebar-section-title agentic-title">FLOW</div>
                  <p className="sidebar-flow-caption">
                    Navigate between geometry and result views.
                  </p>
                  <div className="sidebar-items sidebar-flow-items">
                    {ANALYSIS_FLOW_ITEMS.map((item) => {
                      const active = analysisFlow.currentStep === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`sidebar-item agentic-item sidebar-flow-item ${
                            active ? "sidebar-flow-item--active" : ""
                          }`}
                          onClick={() => analysisFlow.onSelectStep(item.key)}
                          aria-current={active ? "step" : undefined}
                        >
                          <div className="item-indicator"></div>
                          <span className="item-text">{item.label}</span>
                          <div className="item-hover-glow"></div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="sidebar-footer agentic-footer">
                  <div className="sidebar-divider-line"></div>
                  <div className="sidebar-link agentic-link sidebar-flow-hint">
                    <span>Use Exit in the top-right to return to the main page.</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="sidebar-section agentic-section">
                  <div className="sidebar-section-title agentic-title">RECENT</div>
                  <div className="sidebar-items">
                    {recentItems.map((item, i) => (
                      <div key={i} className="sidebar-item agentic-item">
                        <div className="item-indicator"></div>
                        <span className="item-text">{item}</span>
                        <div className="item-hover-glow"></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="sidebar-footer agentic-footer">
                  <div className="sidebar-divider-line"></div>
                  <div className="sidebar-link agentic-link">
                    <span>Documentation</span>
                  </div>
                  <div className="sidebar-link agentic-link">
                    <span>Settings</span>
                  </div>
                  <div className="sidebar-link agentic-link">
                    <span>Profile</span>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

