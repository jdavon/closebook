import { useEffect, useRef } from "react";

/**
 * Dynamically zooms each `.stmt-single-page` element so it fits on exactly
 * one printed page.  Runs on the `beforeprint` event (fires for both
 * Ctrl+P and the Print button) and restores zoom on `afterprint`.
 *
 * How it works:
 *  1.  Measure the element's `scrollWidth` and `scrollHeight` in screen layout.
 *  2.  If scrollWidth exceeds the portrait page width, switch to landscape by
 *      injecting an `@page { size: landscape }` style tag.
 *  3.  Estimate the printed dimensions by applying a shrink ratio (print uses
 *      9pt font + compact padding, so content is shorter than on screen).
 *  4.  Calculate zoom for both width and height; use the smaller (more
 *      aggressive) zoom so the content fits within a single page.
 */
export function usePrintFitToPage() {
  const zoomedElements = useRef<HTMLElement[]>([]);
  const injectedStyleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    // US Letter dimensions at 96 CSS-px/in
    // Portrait:  8.5" × 11"  →  margins 0.4in L + 0.6in R = 7.5in wide, 0.5in T+B = 10in tall
    // Landscape: 11" × 8.5"  →  margins 0.4in L + 0.6in R = 10in wide,  0.5in T+B = 7.5in tall
    const PORTRAIT_WIDTH_PX = 720;   // 7.5in × 96
    const PORTRAIT_HEIGHT_PX = 930;  // ~10in minus small buffer
    const LANDSCAPE_WIDTH_PX = 960;  // 10in × 96
    const LANDSCAPE_HEIGHT_PX = 690; // ~7.5in minus small buffer

    // Print stylesheet shrinks content (9pt font, tighter padding) relative to
    // screen layout.  A conservative ratio of 0.8 means we assume print height
    // is ~80% of screen height; this errs on the side of zooming a bit more
    // than strictly necessary, which is preferable to content overflowing.
    const PRINT_RATIO = 0.8;

    // Never zoom below this floor — text becomes unreadable.
    const MIN_ZOOM = 0.45;

    function handleBeforePrint() {
      const pages =
        document.querySelectorAll<HTMLElement>(".stmt-single-page");
      zoomedElements.current = [];

      // Determine if any visible page needs landscape by checking scrollWidth
      let needsLandscape = false;
      pages.forEach((page) => {
        if (page.offsetHeight === 0) return;
        page.style.zoom = "";
        const screenWidth = page.scrollWidth;
        const estimatedPrintWidth = screenWidth * PRINT_RATIO;
        if (estimatedPrintWidth > PORTRAIT_WIDTH_PX) {
          needsLandscape = true;
        }
      });

      // Inject landscape @page rule if needed
      if (needsLandscape && !injectedStyleRef.current) {
        const style = document.createElement("style");
        style.textContent = "@page { size: landscape; }";
        document.head.appendChild(style);
        injectedStyleRef.current = style;
      }

      const availW = needsLandscape ? LANDSCAPE_WIDTH_PX : PORTRAIT_WIDTH_PX;
      const availH = needsLandscape ? LANDSCAPE_HEIGHT_PX : PORTRAIT_HEIGHT_PX;

      pages.forEach((page) => {
        // Skip hidden tabs (inactive TabsContent has zero height).
        if (page.offsetHeight === 0) return;

        // Reset any previous zoom so we measure the natural dimensions.
        page.style.zoom = "";
        const screenWidth = page.scrollWidth;
        const screenHeight = page.scrollHeight;
        const estimatedPrintWidth = screenWidth * PRINT_RATIO;
        const estimatedPrintHeight = screenHeight * PRINT_RATIO;

        // Calculate zoom needed for each dimension
        const widthZoom =
          estimatedPrintWidth > availW ? availW / estimatedPrintWidth : 1;
        const heightZoom =
          estimatedPrintHeight > availH ? availH / estimatedPrintHeight : 1;

        // Use the more aggressive (smaller) zoom to fit both dimensions
        const zoom = Math.max(
          Math.floor(Math.min(widthZoom, heightZoom) * 100) / 100,
          MIN_ZOOM
        );

        if (zoom < 1) {
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

      // Remove injected landscape style
      if (injectedStyleRef.current) {
        injectedStyleRef.current.remove();
        injectedStyleRef.current = null;
      }
    }

    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
      // Clean up on unmount
      if (injectedStyleRef.current) {
        injectedStyleRef.current.remove();
        injectedStyleRef.current = null;
      }
    };
  }, []);
}
