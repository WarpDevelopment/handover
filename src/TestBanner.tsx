import { TEST_BUILD_BANNER } from "../common/banner";

/** The always-visible tester warning. Not interactive and not dismissible. */
export function TestBanner() {
  return (
    <div className="test-banner" role="note">
      {TEST_BUILD_BANNER}
    </div>
  );
}
