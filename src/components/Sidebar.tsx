import { useState, useRef, useEffect } from "react";

type SidebarProps = {
  onNewAnalysis: () => void;
};

export default function Sidebar({ onNewAnalysis }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Lock scrollbar position - prevent ANY automatic scrolling but keep scrollbar visible
  useEffect(() => {
    const contentWrapper = sidebarRef.current;
    if (!contentWrapper) return;

    // Set scroll to top immediately
    contentWrapper.scrollTop = 0;

    // Continuously lock scroll position to prevent movement
    let rafId: number;
    let lastScrollTop = 0;
    let userInteractionTime = 0;
    
    const lockScroll = () => {
      const now = Date.now();
      const timeSinceInteraction = now - userInteractionTime;
      
      // Only lock if no recent user interaction
      if (timeSinceInteraction > 100) {
        if (contentWrapper.scrollTop !== 0) {
          contentWrapper.scrollTop = 0;
        }
      }
      rafId = requestAnimationFrame(lockScroll);
    };
    
    // Track user interactions
    const handleUserInteraction = () => {
      userInteractionTime = Date.now();
    };
    
    contentWrapper.addEventListener('mousedown', handleUserInteraction);
    contentWrapper.addEventListener('wheel', handleUserInteraction, { passive: true });
    contentWrapper.addEventListener('touchstart', handleUserInteraction, { passive: true });
    
    rafId = requestAnimationFrame(lockScroll);

    return () => {
      cancelAnimationFrame(rafId);
      contentWrapper.removeEventListener('mousedown', handleUserInteraction);
      contentWrapper.removeEventListener('wheel', handleUserInteraction);
      contentWrapper.removeEventListener('touchstart', handleUserInteraction);
    };
  }, [collapsed]);

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

      <div ref={sidebarRef} className="sidebar-content-wrapper" style={{ minHeight: 'calc(100vh + 1px)' }}>

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

            <button className="new-analysis-btn agentic-new-btn" onClick={onNewAnalysis}>
              <span className="btn-icon">+</span>
              <span className="btn-text">New Analysis</span>
              <div className="btn-shimmer"></div>
              <div className="btn-glow"></div>
            </button>

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
      </div>
    </div>
  );
}

