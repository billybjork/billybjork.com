/** The inline editor marks its session on <body>; public code yields to it. */
export function isEditingActive(): boolean {
  return document.body?.classList.contains('editing') === true;
}
