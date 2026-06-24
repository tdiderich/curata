export function highlightTarget(
  root: HTMLElement,
  target: string,
  annId: string,
): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const content = textNode.textContent || "";
    const idx = content.indexOf(target);
    if (idx === -1) continue;

    const svgParent = textNode.parentElement?.closest("svg");
    if (svgParent) {
      const svgText = textNode.parentElement?.closest("text");
      if (svgText) {
        insertSvgHighlight(svgText, annId);
      }
      const component = svgParent.closest("[data-kind]") ?? svgParent.parentElement;
      return (component as HTMLElement) ?? null;
    }

    try {
      const range = document.createRange();
      range.setStart(textNode, idx);
      range.setEnd(textNode, idx + target.length);
      const mark = document.createElement("mark");
      mark.className = "ann-target-highlight";
      mark.dataset.ann = annId;
      range.surroundContents(mark);
      return mark;
    } catch {
      continue;
    }
  }
  return null;
}

function insertSvgHighlight(svgText: SVGTextElement, annId: string) {
  const bbox = svgText.getBBox();
  const pad = 3;
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(bbox.x - pad));
  rect.setAttribute("y", String(bbox.y - pad));
  rect.setAttribute("width", String(bbox.width + pad * 2));
  rect.setAttribute("height", String(bbox.height + pad * 2));
  rect.setAttribute("rx", "3");
  rect.classList.add("ann-target-highlight-svg");
  svgText.parentNode?.insertBefore(rect, svgText);
  svgText.dataset.ann = annId;
  svgText.style.cursor = "pointer";
}

export function clearHighlights(root: HTMLElement) {
  root.querySelectorAll("mark.ann-target-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  root.querySelectorAll(".ann-target-highlight-svg").forEach((el) => el.remove());
  root.querySelectorAll("text[data-ann]").forEach((el) => {
    delete (el as SVGElement).dataset.ann;
    (el as SVGElement).style.cursor = "";
  });
  root.normalize();
}
