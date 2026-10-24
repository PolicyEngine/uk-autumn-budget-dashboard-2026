import { webcrypto } from "node:crypto";
import { configure } from "@testing-library/react";
import "@testing-library/jest-dom";

// The page verifies every artifact with Web Crypto before it renders; on a
// busy machine that can take longer than testing-library's one-second wait.
// This is the most a findBy or waitFor waits, not what it checks.
configure({ asyncUtilTimeout: 10000 });

// jsdom supplies the DOM; Node supplies the browser Web Crypto implementation.
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

// Mock ResizeObserver for Recharts ResponsiveContainer
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
