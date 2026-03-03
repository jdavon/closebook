import { useEffect, useRef } from "react";

/**
 * Dynamically zooms each `.stmt-single-page` element so it fits on exactly
 * one printed page.  Runs on the `beforeprint` event (fires for both
 * Ctrl+P and the Print button) and restores zoom on `afterprint`.
 *
 * How it works:
 *  1.  Measure the element's `scrollHeight` in screen layout.
 *  2.  Estimate its printed height by applying a shrink ratio (print uses
 *      9pt font + compact padding, so content is shorter than on screen).
 *  3.  If the estimated height exceeds the available page height, apply a
 *      CSS `zoom` value that scales it down to fit.
 */
export function usePrintFitToPage() {
  const zoomedElements = useRef<HTMLElement[]>([]);

  useEffect(() => {
    // US Letter: 11 in tall.  @page margins 0.5 in top + 0.5 in bottom = 10 in
    // available.  At 96 CSS-px / in → 960 px.  Subtract a small buffer for
    // rounding and header text → 930 px target.
    const AVAILABLE_HEIGHT_PX = 930;

    // Print stylesheet shrinks content (9pt font, tighter padding) relative to
    // screen layout.  A conservative ratio of 0.8 means we assume print height
    // is ~80 % of screen height; this errs on the side of zooming a bit more
    // than strictly necessary, which is preferable to content overflowing.
    const PRINT_RATIO = 0.8;

    // Never zoom below this floor — text becomes unreadable.
    const MIN_ZOOM = 0.5;

    function handleBeforePrint() {
      const pages =
        document.querySelectorAll<HTMLElement>(".stmt-single-page");
      zoomedElements.current = [];

      pages.forEach((page) => {
        // Skip hidden tabs (inactive TabsContent has zero height).
        if (page.offsetHeight === 0) return;

        // Reset any previous zoom so we measure the natural height.
        page.style.zoom = "";
        const screenHeight = page.scrollHeight;
        const estimatedPrintHeight = screenHeight * PRINT_RATIO;

        if (estimatedPrintHeight > AVAILABLE_HEIGHT_PX) {
          const zoom = Math.max(
            Math.floor((AVAILABLE_HEIGHT_PX / estimatedPrintHeight) * 100) /
              100,
            MIN_ZOOM
          );
          page.style.zoom = String(zoom);
          zoomedElements.current.push(page);
        }
      });
    }

    function handleAfterPrint() {
      zoomedElements.current.forEach((el) => {
        el.style.zoom = "";
      });
      zoomedElements.current = [];
    }

    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, []);
}
