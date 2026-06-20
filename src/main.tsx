import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, getInitialThemeMode } from "./hooks/use-theme";

// Apply persisted theme before first paint.
applyTheme(getInitialThemeMode());

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: "#e7000b", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          <strong>运行时错误:</strong>
          {"\n"}
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
