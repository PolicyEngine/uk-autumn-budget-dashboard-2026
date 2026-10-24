import { webcrypto } from "node:crypto";
import "@testing-library/jest-dom";

// jsdom supplies the DOM; Node supplies the browser Web Crypto implementation.
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

// Mock ResizeObserver for Recharts ResponsiveContainer
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
