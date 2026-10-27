// One explicit state object shared by browser feature modules.
export const state = {
  settings: { color: 'monochrome', quality: 'standard', speed: 'balanced', density: 0, contrast: 0 },
  token: '', chosenFile: null, preparedJPEG: null, previewURL: null,
  preparing: false, previewTimer: null, generation: 0, activeTaskId: null,
  busy: false, lastMessage: '', pdfjsLib: null, pdfDocument: null,
  pdfPageNumber: 1, pdfLoading: false, pdfRenderQueue: Promise.resolve(),
  pdfSelectionId: 0, previewController: null,
};
