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
 * Always landscape US Letter with 0.3in/0.4in margins.
 *
 * On beforeprint:
 *  - Measures each statement's natural screen height
 *  - Estimates its printed height using a screen→print ratio
 *  - If content overflows the page: applies CSS zoom to shrink
 *  - If content underflows: increases font-size so it fills the page
 *
 * On afterprint: resets all inline styles.
 */
export function usePrintFitToPage() {
  const modifiedEls = useRef<HTMLElement[]>([]);

  useEffect(() => {
    // Landscape letter with 0.3in top/bottom margins → 10.2in × 96 ≈ 979px usable height
    // But we use a conservative target to leave breathing room
    const PAGE_HEIGHT = 940;

    // Screen→print height ratio: print CSS uses ~10pt font + compact padding
    // vs ~14px screen font + generous padding, so print is ~55% of screen height.
    const HEIGHT_RATIO = 0.55;

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

        if (scale < 1) {
          // Content overflows — shrink with CSS zoom
          const zoom = Math.max(
            Math.floor(scale * 100) / 100,
            MIN_ZOOM,
          );
          page.style.zoom = String(zoom);
          modifiedEls.current.push(page);
        } else if (scale > 1.05) {
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
