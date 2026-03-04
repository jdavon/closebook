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
 * Scales each .stmt-single-page element to fill exactly one printed page.
 *
 * Always landscape US Letter with 0.3in top/bottom, 0.4in left/right margins.
 *
 * On beforeprint:
 *  - Measures each statement's screen height
 *  - Estimates its print height (screen→print ratio ~0.75)
 *  - If content overflows the page: applies CSS zoom to shrink
 *  - If content underflows: increases font-size to fill the page
 *
 * On afterprint: resets all inline styles.
 */
export function usePrintFitToPage() {
  const modifiedEls = useRef<HTMLElement[]>([]);

  useEffect(() => {
    // Portrait letter usable height:
    // 11in total - 0.3in top - 0.3in bottom = 10.4in × 96 = 998px
    // Use 960 to leave breathing room at the bottom.
    const PAGE_HEIGHT = 960;

    // Screen→print height ratio.
    // Print CSS: 10pt font (~13px) + 2.5pt cell padding (~3px) → ~20px/row
    // Screen CSS: 14px font + ~6px cell padding → ~26px/row
    // Ratio ≈ 0.77. Use 0.75 conservatively.
    const HEIGHT_RATIO = 0.75;

    // Bounds
    const MIN_ZOOM = 0.5;
    const MAX_FONT_PT = 14;
    const BASE_FONT_PT = 10; // matches the @media print base in globals.css

    function handleBeforePrint() {
      const pages =
        document.querySelectorAll<HTMLElement>(".stmt-single-page");
      modifiedEls.current = [];

      pages.forEach((page) => {
        if (page.offsetHeight === 0) return;

        // Reset any previous adjustments
        page.style.zoom = "";
        page.style.fontSize = "";

        const estimatedPrintH = page.scrollHeight * HEIGHT_RATIO;
        const scale = PAGE_HEIGHT / estimatedPrintH;

        if (scale < 0.98) {
          // Content overflows — shrink with CSS zoom
          const zoom = Math.max(
            Math.floor(scale * 100) / 100,
            MIN_ZOOM,
          );
          page.style.zoom = String(zoom);
          modifiedEls.current.push(page);
        } else if (scale > 1.08) {
          // Content underflows — increase font-size to fill the page
          const newFontPt = Math.min(BASE_FONT_PT * scale, MAX_FONT_PT);
          page.style.fontSize = `${newFontPt.toFixed(1)}pt`;
          modifiedEls.current.push(page);
        }
      });
    }

    function handleAfterPrint() {
      modifiedEls.current.forEach((el) => {
        el.style.zoom = "";
        el.style.fontSize = "";
      });
      modifiedEls.current = [];
    }

    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, []);
}
