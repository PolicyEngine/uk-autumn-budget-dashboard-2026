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

// Verified bytes and parsed tables are kept per page (publication/cache.js,
// load.js); each test starts with none, so a test that alters a file is
// never answered from another test's verified copy
import { beforeEach as resetBeforeEach } from "vitest";
import { resetVerifiedCache } from "../utils/publication/cache";
import { resetParsedTables } from "../utils/publication/load";
resetBeforeEach(() => {
  resetVerifiedCache();
  resetParsedTables();
});
