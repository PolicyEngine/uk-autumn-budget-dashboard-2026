import './MockBanner.css';

export const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === '1';

export default function MockBanner() {
  if (!IS_MOCK) return null;
  return (
    <div className="mock-banner" role="alert">
      MOCK DRILL: Proposed 2026 announcements and estimates are hypothetical. This is not a real Budget statement.
    </div>
  );
}
