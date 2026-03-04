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
 * Ensures each .stmt-single-page element fits on exactly one printed page.
 *
 * Portrait US Letter with 0.3in top/bottom, 0.4in left/right margins.
 *
 * On beforeprint:
 *  - Measures each statement's screen height
 *  - Estimates its print height (screen→print ratio ~0.92)
 *  - If content would overflow: applies CSS zoom to shrink it to fit
 *
 * On afterprint: resets all inline styles.
 */
export function usePrintFitToPage() {
  const modifiedEls = useRef<HTMLElement[]>([]);

  useEffect(() => {
    // Portrait letter usable height:
    // 11in - 0.3in top - 0.3in bottom = 10.4in × 96 = 998px
    // Use 940 for safety margin (headers/footers can eat into this).
    const PAGE_HEIGHT = 940;

    // Screen→print height ratio.
    // Print: 10pt (~13.3px) font + ~3px cell padding → ~19px/row
    // Screen: 14px font + ~6px cell padding → ~22px/row
    // Including line-height (~1.3-1.5×), actual ratio is ~0.90-0.95.
    // Use 0.92 — slightly conservative to ensure we zoom when needed.
    const HEIGHT_RATIO = 0.92;

    const MIN_ZOOM = 0.5;

    function handleBeforePrint() {
      const pages =
        document.querySelectorAll<HTMLElement>(".stmt-single-page");
      modifiedEls.current = [];

      pages.forEach((page) => {
        if (page.offsetHeight === 0) return;

        // Reset any previous adjustments
        page.style.zoom = "";

        const estimatedPrintH = page.scrollHeight * HEIGHT_RATIO;

        if (estimatedPrintH > PAGE_HEIGHT) {
          // Content would overflow — shrink with CSS zoom
          const zoom = Math.max(
            Math.floor((PAGE_HEIGHT / estimatedPrintH) * 100) / 100,
            MIN_ZOOM,
          );
          page.style.zoom = String(zoom);
          modifiedEls.current.push(page);
        }
      });
    }

    function handleAfterPrint() {
      modifiedEls.current.forEach((el) => {
        el.style.zoom = "";
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
