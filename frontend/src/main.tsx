import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "@/providers/AppProvider";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BrowserRouter>
        <TooltipProvider>
          <AppProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/trains" replace />} />
              <Route path="/trains" element={<App />} />
              <Route path="/fuel" element={<App />} />
            </Routes>
          </AppProvider>
        </TooltipProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}
