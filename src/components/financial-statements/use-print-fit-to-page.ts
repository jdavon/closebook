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
 * Controls print orientation and scaling for financial statements so each
 * statement fits on exactly one 8.5″×11″ printed page.
 *
 * Orientation: <= 6 data columns → portrait, > 6 → landscape.
 *
 * Scaling strategy:
 *  - Content OVERFLOWS the page → CSS zoom to shrink (uniform scale-down).
 *  - Content UNDERFLOWS (extra vertical space) → inline font-size on each
 *    .stmt-table element. Since print CSS uses em-based padding, increasing
 *    font-size makes rows taller and numbers bigger, filling the page.
 *    CSS zoom can't do this because the table is width:100%.
 */
export function usePrintFitToPage(dataColumnCount?: number) {
  // Track all elements we modify so we can reset them after printing.
  const modifiedEls = useRef<HTMLElement[]>([]);
  const injectedStyleRef = useRef<HTMLStyleElement | null>(null);
  const columnCountRef = useRef(dataColumnCount);
  columnCountRef.current = dataColumnCount;

  useEffect(() => {
    // US Letter printable area at 96 CSS-px/in
    // Margins: 0.5in top, 0.5in bottom, 0.4in left, 0.6in right
    const PORTRAIT_WIDTH_PX = 720;   // 7.5in × 96
    const PORTRAIT_HEIGHT_PX = 960;  // 10in × 96
    const LANDSCAPE_WIDTH_PX = 960;  // 10in × 96
    const LANDSCAPE_HEIGHT_PX = 720; // 7.5in × 96

    // Estimated print-to-screen dimension ratios.
    // Print CSS uses 9pt + compact padding vs ~14px screen font.
    const WIDTH_RATIO = 0.8;
    const HEIGHT_RATIO = 0.58;

    const MIN_ZOOM = 0.45;
    const BASE_FONT_PT = 9;
    const MAX_FONT_PT = 14; // never scale above 14pt

    function handleBeforePrint() {
      const pages =
        document.querySelectorAll<HTMLElement>(".stmt-single-page");
      modifiedEls.current = [];

      const needsLandscape = columnCountRef.current != null
        ? columnCountRef.current > 6
        : false;

      // Inject @page rule: explicit letter size + orientation.
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
        if (page.offsetHeight === 0) return;

        // Reset previous adjustments.
        page.style.zoom = "";
        const table = page.querySelector<HTMLElement>(".stmt-table");
        if (table) table.style.fontSize = "";

        const estimatedPrintW = page.scrollWidth * WIDTH_RATIO;
        const estimatedPrintH = page.scrollHeight * HEIGHT_RATIO;

        const widthZoom = availW / estimatedPrintW;
        const heightZoom = availH / estimatedPrintH;

        if (widthZoom < 1 || heightZoom < 1) {
          // Content overflows — shrink with CSS zoom.
          const zoom = Math.max(
            Math.floor(Math.min(widthZoom, heightZoom) * 100) / 100,
            MIN_ZOOM,
          );
          page.style.zoom = String(zoom);
          modifiedEls.current.push(page);
        } else if (heightZoom > 1.1 && table) {
          // Extra vertical space — scale up font-size on the table directly.
          // Inline styles are guaranteed to apply in beforeprint (unlike
          // CSS variables which Chrome may not recompute for print).
          // 0.88 safety factor prevents overflow from estimation error.
          const scaledPt = Math.min(
            BASE_FONT_PT * heightZoom * 0.88,
            MAX_FONT_PT,
          );
          if (scaledPt > BASE_FONT_PT + 0.5) {
            table.style.fontSize = `${scaledPt.toFixed(1)}pt`;
            modifiedEls.current.push(table);
          }
        }
      });
    }

    function handleAfterPrint() {
      modifiedEls.current.forEach((el) => {
        el.style.zoom = "";
        el.style.fontSize = "";
      });
      modifiedEls.current = [];

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
      if (injectedStyleRef.current) {
        injectedStyleRef.current.remove();
        injectedStyleRef.current = null;
      }
    };
  }, []);
}
