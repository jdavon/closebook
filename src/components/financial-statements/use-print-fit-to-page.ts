import { useEffect, useRef } from "react";

/**
 * Returns the total number of data columns (excluding the label column)
 * that the statement table will render.
 *
 * periodCount × colsPerPeriod + yoyCols
 *   where colsPerPeriod = 1 (actual) + 2 if budget (budget + variance)
 *         yoyCols       = 2 if YoY enabled
 */
export function getDataColumnCount(
  periodCount: number,
  showBudget = false,
  showYoY = false,
): number {
  const colsPerPeriod = 1 + (showBudget ? 2 : 0);
  return periodCount * colsPerPeriod + (showYoY ? 2 : 0);
}

/**
 * Controls print orientation and zoom for financial statements so each
 * statement fits on exactly one 8.5″×11″ printed page.
 *
 * Orientation is determined by the number of data columns:
 *  - <= 6 columns → portrait
 *  - > 6 columns  → landscape
 *
 * Zoom is calculated by measuring each `.stmt-single-page` element against
 * the available printable area, applying estimated print-CSS shrink ratios
 * for font/padding compression.
 *
 * @param dataColumnCount  Total data columns (use `getDataColumnCount()`)
 */
export function usePrintFitToPage(dataColumnCount?: number) {
  const zoomedElements = useRef<HTMLElement[]>([]);
  const injectedStyleRef = useRef<HTMLStyleElement | null>(null);
  // Use a ref so the beforeprint handler always reads the latest value
  // without needing to re-register listeners on every render.
  const columnCountRef = useRef(dataColumnCount);
  columnCountRef.current = dataColumnCount;

  useEffect(() => {
    // US Letter printable area at 96 CSS-px/in
    // Margins: 0.5in top, 0.5in bottom, 0.4in left, 0.6in right
    // Portrait:  8.5 − 1.0 = 7.5in wide,  11 − 1.0 = 10in tall
    // Landscape: 11  − 1.0 = 10in wide,  8.5 − 1.0 = 7.5in tall
    const PORTRAIT_WIDTH_PX = 720;   // 7.5in × 96
    const PORTRAIT_HEIGHT_PX = 960;  // 10in × 96
    const LANDSCAPE_WIDTH_PX = 960;  // 10in × 96
    const LANDSCAPE_HEIGHT_PX = 720; // 7.5in × 96

    // Print stylesheet uses 9pt font + compact padding vs ~14px screen font.
    // Width shrinks modestly (number columns keep their min-width).
    // Height shrinks much more (every row is shorter with smaller font/padding).
    const WIDTH_RATIO = 0.8;   // print width ≈ 80% of screen width
    const HEIGHT_RATIO = 0.58; // print height ≈ 58% of screen height

    // Never zoom below this floor — text becomes unreadable.
    const MIN_ZOOM = 0.45;
    // Max font-size multiplier when scaling up to fill the page.
    const MAX_FONT_SCALE = 1.5;

    function handleBeforePrint() {
      const pages =
        document.querySelectorAll<HTMLElement>(".stmt-single-page");
      zoomedElements.current = [];

      // Determine orientation based on data column count:
      // <= 6 data columns → portrait, > 6 → landscape
      const needsLandscape = columnCountRef.current != null
        ? columnCountRef.current > 6
        : false;

      // Inject @page rule with explicit letter size + orientation so the
      // browser always targets 8.5″×11″ regardless of system defaults.
      const orientation = needsLandscape ? "landscape" : "portrait";
      const pageRule = `@page { size: letter ${orientation}; margin: 0.5in 0.6in 0.5in 0.4in; }`;
      if (injectedStyleRef.current) {
        injectedStyleRef.current.textContent = pageRule;
      } else {
        const style = document.createElement("style");
        style.textContent = pageRule;
        document.head.appendChild(style);
        injectedStyleRef.current = style;
      }

      const availW = needsLandscape ? LANDSCAPE_WIDTH_PX : PORTRAIT_WIDTH_PX;
      const availH = needsLandscape ? LANDSCAPE_HEIGHT_PX : PORTRAIT_HEIGHT_PX;

      pages.forEach((page) => {
        // Skip hidden tabs (inactive TabsContent has zero height).
        if (page.offsetHeight === 0) return;

        // Reset previous adjustments so we measure natural dimensions.
        page.style.zoom = "";
        page.style.removeProperty("--print-scale");

        const estimatedPrintW = page.scrollWidth * WIDTH_RATIO;
        const estimatedPrintH = page.scrollHeight * HEIGHT_RATIO;

        const widthZoom = availW / estimatedPrintW;
        const heightZoom = availH / estimatedPrintH;

        if (widthZoom < 1 || heightZoom < 1) {
          // Content overflows the page — shrink with CSS zoom.
          const zoom = Math.max(
            Math.floor(Math.min(widthZoom, heightZoom) * 100) / 100,
            MIN_ZOOM,
          );
          page.style.zoom = String(zoom);
          zoomedElements.current.push(page);
        } else if (heightZoom > 1.1) {
          // Content fits but has excess vertical space.  The table already
          // fills 100% width so zoom can't help (it would overflow width).
          // Instead, scale font-size & em-based padding via CSS variable
          // so rows get taller → content fills the page with bigger text.
          // 0.90 safety factor prevents overflow from estimation error.
          const scale = Math.min(heightZoom * 0.90, MAX_FONT_SCALE);
          if (scale > 1.05) {
            page.style.setProperty("--print-scale", scale.toFixed(2));
            zoomedElements.current.push(page);
          }
        }
      });
    }

    function handleAfterPrint() {
      zoomedElements.current.forEach((el) => {
        el.style.zoom = "";
        el.style.removeProperty("--print-scale");
      });
      zoomedElements.current = [];

      // Remove injected @page style
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
