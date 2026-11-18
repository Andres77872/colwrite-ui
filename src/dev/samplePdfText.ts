/** Extracted text supplied by the shared sample PDF records. */
export function samplePdfText(title: string | null) {
  return `# ${title ?? 'Document'}\n\nMixture-of-experts layers route each token to a few experts. The auxiliary load balancing loss term keeps experts evenly used.`;
}
