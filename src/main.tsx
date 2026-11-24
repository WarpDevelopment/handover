import React from "react";
import { createRoot } from "react-dom/client";

import { FreezeOverlay } from "./FreezeOverlay";
import { Library } from "./Library";
import { Recorder } from "./Recorder";
import { RecordingControls } from "./RecordingControls";
import { Terminal } from "./Terminal";
import "./App.css";
import "./Explain.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

const route = window.location.hash.replace("#", "");
const isLibrary = route === "library";
const isRecordingControls = route === "recording-controls";
const isTerminal = route === "terminal";
const isFreeze = route === "freeze" || route.startsWith("freeze/");
document.body.dataset.route = isLibrary
  ? "library"
  : isRecordingControls
    ? "recording-controls"
    : isTerminal
      ? "terminal"
      : isFreeze
        ? "freeze"
    : "recorder";

createRoot(root).render(
  <React.StrictMode>
    {isFreeze ? (
      <FreezeOverlay />
    ) : isLibrary ? (
      <Library />
    ) : isRecordingControls ? (
      <RecordingControls />
    ) : isTerminal ? (
      <Terminal />
    ) : (
      <Recorder />
    )}
  </React.StrictMode>,
);
