import './MockBanner.css';

export const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === '1';

export default function MockBanner() {
  if (!IS_MOCK) return null;
  return (
    <div className="mock-banner" role="alert">
      MOCK DATA: rehearsal Budget for PolicyEngine drill 1. Every measure and number on this page is invented. Not a real Budget.
    </div>
  );
}
