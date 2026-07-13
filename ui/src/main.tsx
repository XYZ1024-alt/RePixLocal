import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LocaleProvider } from "./i18n/context";
import { ServicesProvider } from "./services/context";
import { ThemeProvider } from "./theme/context";
import { TooltipProvider } from "./components/ui/tooltip";
import "./globals.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <TooltipProvider delayDuration={500} skipDelayDuration={250}>
          <ServicesProvider>
            <App />
          </ServicesProvider>
        </TooltipProvider>
      </LocaleProvider>
    </ThemeProvider>
  </React.StrictMode>
);
