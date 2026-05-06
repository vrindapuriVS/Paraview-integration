import { useState } from "react";
import InteractiveBackground from "./InteractiveBackground";
import { authApi } from "../services/api";
import "./AuthPage.css";

export default function AuthPage({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsLoading(true);

    if (!formData.email.trim()) {
      setErrors((prev) => ({ ...prev, email: "Email is required" }));
      setIsLoading(false);
      return;
    }
    if (!formData.password) {
      setErrors((prev) => ({ ...prev, password: "Password is required" }));
      setIsLoading(false);
      return;
    }
    if (!isLogin) {
      if (formData.password.length < 6) {
        setErrors((prev) => ({ ...prev, password: "Password must be at least 6 characters" }));
        setIsLoading(false);
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setErrors((prev) => ({ ...prev, confirmPassword: "Passwords do not match" }));
        setIsLoading(false);
        return;
      }
    }

    try {
      if (isLogin) {
        const result = await authApi.login(formData.email.trim(), formData.password);
        if (result.error) {
          setErrors((prev) => ({ ...prev, form: result.error || "Login failed" }));
          setIsLoading(false);
          return;
        }
        onAuthSuccess();
      } else {
        const username = formData.name.trim() || formData.email.trim();
        const signupResult = await authApi.signup(username, formData.email.trim(), formData.password);
        if (signupResult.error) {
          setErrors((prev) => ({ ...prev, form: signupResult.error || "Sign up failed" }));
          setIsLoading(false);
          return;
        }
        // Log in after signup so the user has a token (backend may not return token on signup)
        const loginResult = await authApi.login(username, formData.password);
        if (loginResult.error) {
          setErrors((prev) => ({ ...prev, form: "Account created. Please log in." }));
          setIsLogin(true);
          setIsLoading(false);
          return;
        }
        onAuthSuccess();
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, form: "Network or server error. Please try again." }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page-wrapper" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1000 }}>
      <InteractiveBackground />
      <div className="auth-container" style={{ position: 'relative', zIndex: 1001 }}>
        <div className="auth-card">
          <div className="auth-card-bg-gradient"></div>
          <div className="auth-card-shimmer"></div>
          <div className="auth-card-corner-accent auth-corner-tl"></div>
          <div className="auth-card-corner-accent auth-corner-tr"></div>
          <div className="auth-card-corner-accent auth-corner-bl"></div>
          <div className="auth-card-corner-accent auth-corner-br"></div>
          
          <div className="auth-header">
            <h1 className="auth-title">Vortex AI</h1>
            <p className="auth-subtitle">
              {isLogin ? "Welcome back" : "Create your account"}
            </p>
          </div>

          <div className="auth-tabs">
            <button
              className={`auth-tab ${isLogin ? "active" : ""}`}
              onClick={() => setIsLogin(true)}
            >
              Login
            </button>
            <button
              className={`auth-tab ${!isLogin ? "active" : ""}`}
              onClick={() => setIsLogin(false)}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {errors.form && (
              <div className="form-group form-error-banner">
                <span className="error-message">{errors.form}</span>
              </div>
            )}
            {!isLogin && (
              <div className="form-group">
                <label htmlFor="name">Full Name</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className={errors.name ? "error" : ""}
                  placeholder="Enter your full name"
                />
                {errors.name && <span className="error-message">{errors.name}</span>}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className={errors.email ? "error" : ""}
                placeholder="Enter your email"
              />
              {errors.email && <span className="error-message">{errors.email}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                className={errors.password ? "error" : ""}
                placeholder="Enter your password"
              />
              {errors.password && <span className="error-message">{errors.password}</span>}
            </div>

            {!isLogin && (
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className={errors.confirmPassword ? "error" : ""}
                  placeholder="Confirm your password"
                />
                {errors.confirmPassword && (
                  <span className="error-message">{errors.confirmPassword}</span>
                )}
              </div>
            )}

            <button 
              type="submit" 
              className="auth-submit-btn"
              disabled={isLoading}
            >
              <span>{isLoading ? "Processing..." : isLogin ? "Login" : "Sign Up"}</span>
              <div className="btn-glow"></div>
            </button>
          </form>

          <div className="auth-footer">
            {isLogin ? (
              <p>
                Don't have an account?{" "}
                <button
                  className="auth-link"
                  onClick={() => setIsLogin(false)}
                >
                  Sign up
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{" "}
                <button
                  className="auth-link"
                  onClick={() => setIsLogin(true)}
                >
                  Login
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
