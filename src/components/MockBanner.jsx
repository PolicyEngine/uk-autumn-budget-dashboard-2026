import './MockBanner.css';

// The rehearsal branch is never merged, so every build of it is a mock and
// says so, whatever the deploying project's environment.
export const IS_MOCK = true;

export default function MockBanner() {
  if (!IS_MOCK) return null;
  return (
    <div className="mock-banner" role="alert">
      MOCK DATA: Budget rehearsal, 23 October 2026. The measures and estimates
      are hypothetical. This is not a real Budget statement.
    </div>
  );
}
