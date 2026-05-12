import { useState, useRef, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatWindow from "./components/ChatWindow";
import AuthPage from "./components/AuthPage";
import InteractiveBackground from "./components/InteractiveBackground";
import MagneticCard from "./components/MagneticCard";
import { authApi } from "./services/api";
import { AppLayoutProvider, useAppLayout } from "./context/AppLayoutContext";
import "./Styles.css";

const resolveDefault = <T,>(moduleValue: T) => {
  const candidate = moduleValue as unknown as { default?: T };
  return candidate.default ?? moduleValue;
};

const SidebarComponent = resolveDefault(Sidebar);
const ChatWindowComponent = resolveDefault(ChatWindow);
const AuthPageComponent = resolveDefault(AuthPage);
const InteractiveBackgroundComponent = resolveDefault(InteractiveBackground);
const MagneticCardComponent = resolveDefault(MagneticCard);

function MainAuthenticatedShell() {
  const { hideSidebar, resultsWizardOpen } = useAppLayout();

  const handleNewAnalysis = () => {
    // No action needed - chat is always visible
  };

  return (
    <div
      className={`app-wrapper ${hideSidebar ? "app-wrapper--no-sidebar" : ""}`}
    >
      <InteractiveBackgroundComponent interactive={!resultsWizardOpen} />
      {!hideSidebar && <SidebarComponent onNewAnalysis={handleNewAnalysis} />}
      <main className="main-content">
        <div className="welcome-screen">
          <h1 className="welcome-title">Welcome to Vortex AI</h1>
          <p className="welcome-subtitle">
            Get started by uploading your OpenFOAM files or describing your
            uncertainty quantification needs.
          </p>

          <div className="examples-section">
            <h2 className="examples-title">Try These Examples</h2>
            <div className="examples-grid">
              <MagneticCardComponent className="example-card agentic-card">
                <div className="card-bg-gradient"></div>
                <div className="card-shimmer"></div>
                <div className="card-sound-waves"></div>
                <div className="card-mesh-overlay"></div>
                <div className="card-corner-accent card-corner-tl"></div>
                <div className="card-corner-accent card-corner-tr"></div>
                <div className="card-corner-accent card-corner-bl"></div>
                <div className="card-corner-accent card-corner-br"></div>
                <div className="card-glow-orb"></div>
                <div className="example-card-content">
                  <div className="example-card-title" data-text="Quantify epistemic uncertainty for transonic airfoil">
                    Quantify epistemic uncertainty for transonic airfoil
                  </div>
                  <div className="example-card-description">
                    Analyze CFD simulation uncertainty for aerospace design
                    validation.
                  </div>
                  <div className="card-hover-indicator">
                    <div className="indicator-line"></div>
                  </div>
                </div>
              </MagneticCardComponent>
              <MagneticCardComponent className="example-card agentic-card">
                <div className="card-bg-gradient"></div>
                <div className="card-shimmer"></div>
                <div className="card-sound-waves"></div>
                <div className="card-mesh-overlay"></div>
                <div className="card-corner-accent card-corner-tl"></div>
                <div className="card-corner-accent card-corner-tr"></div>
                <div className="card-corner-accent card-corner-bl"></div>
                <div className="card-corner-accent card-corner-br"></div>
                <div className="card-glow-orb"></div>
                <div className="example-card-content">
                  <div className="example-card-title" data-text="Analyze mesh sensitivity for compressible flow">
                    Analyze mesh sensitivity for compressible flow
                  </div>
                  <div className="example-card-description">
                    Investigate grid convergence and numerical uncertainty
                    effects.
                  </div>
                  <div className="card-hover-indicator">
                    <div className="indicator-line"></div>
                  </div>
                </div>
              </MagneticCardComponent>
              <MagneticCardComponent className="example-card agentic-card">
                <div className="card-bg-gradient"></div>
                <div className="card-shimmer"></div>
                <div className="card-sound-waves"></div>
                <div className="card-mesh-overlay"></div>
                <div className="card-corner-accent card-corner-tl"></div>
                <div className="card-corner-accent card-corner-tr"></div>
                <div className="card-corner-accent card-corner-bl"></div>
                <div className="card-corner-accent card-corner-br"></div>
                <div className="card-glow-orb"></div>
                <div className="example-card-content">
                  <div className="example-card-title" data-text="Generate DO-160 certification report with aleatory UQ">
                    Generate DO-160 certification report with aleatory UQ
                  </div>
                  <div className="example-card-description">
                    Create comprehensive certification analysis with uncertainty
                    quantification.
                  </div>
                  <div className="card-hover-indicator">
                    <div className="indicator-line"></div>
                  </div>
                </div>
              </MagneticCardComponent>
              <MagneticCardComponent className="example-card agentic-card">
                <div className="card-bg-gradient"></div>
                <div className="card-shimmer"></div>
                <div className="card-sound-waves"></div>
                <div className="card-mesh-overlay"></div>
                <div className="card-corner-accent card-corner-tl"></div>
                <div className="card-corner-accent card-corner-tr"></div>
                <div className="card-corner-accent card-corner-bl"></div>
                <div className="card-corner-accent card-corner-br"></div>
                <div className="card-glow-orb"></div>
                <div className="example-card-content">
                  <div className="example-card-title" data-text="Compare uncertainty across multiple CFD cases">
                    Compare uncertainty across multiple CFD cases
                  </div>
                  <div className="example-card-description">
                    Statistical comparison of simulation results with confidence
                    intervals.
                  </div>
                  <div className="card-hover-indicator">
                    <div className="indicator-line"></div>
                  </div>
                </div>
              </MagneticCardComponent>
            </div>
          </div>
        </div>

        <div className="chatbox-container">
          <ChatWindowComponent />
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Restore session from backend: validate existing token on load
  useEffect(() => {
    if (!authApi.isAuthenticated()) {
      authApi.logout();
      setAuthChecked(true);
      return;
    }
    authApi.getMe()
      .then((res) => {
        if (res.data && !res.error) {
          setIsAuthenticated(true);
        } else {
          authApi.logout();
        }
      })
      .catch(() => authApi.logout())
      .finally(() => setAuthChecked(true));
  }, []);

  // Reset zoom on mount to prevent zoomed-in view on remote instances (e.g. AWS)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resetZoom = () => {
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, shrink-to-fit=no');
      }
      if (document.documentElement) {
        (document.documentElement.style as any).zoom = '1';
        document.documentElement.style.transform = '';
      }
      if (document.body) {
        (document.body.style as any).zoom = '1';
        document.body.style.transform = '';
        document.body.style.width = '';
        document.body.style.height = '';
      }
      const root = document.getElementById('root');
      if (root) {
        (root.style as any).zoom = '1';
        root.style.transform = '';
      }
    };
    resetZoom();
    setTimeout(resetZoom, 50);
    setTimeout(resetZoom, 200);
    setTimeout(resetZoom, 500);
    window.addEventListener('resize', resetZoom);
    window.addEventListener('load', resetZoom);
    return () => {
      window.removeEventListener('resize', resetZoom);
      window.removeEventListener('load', resetZoom);
    };
  }, []);
  
  if (!authChecked) {
    return (
      <div className="app-wrapper" style={{ alignItems: "center", justifyContent: "center" }}>
        <InteractiveBackgroundComponent />
        <div style={{ position: "relative", zIndex: 1001, color: "var(--text-primary, #fff)" }}>Checking authentication...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app-wrapper">
        <InteractiveBackgroundComponent />
        <AuthPageComponent onAuthSuccess={() => setIsAuthenticated(true)} />
      </div>
    );
  }

  return (
    <AppLayoutProvider>
      <MainAuthenticatedShell />
    </AppLayoutProvider>
  );
}
