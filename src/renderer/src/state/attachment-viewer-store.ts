import { create } from 'zustand';

export type ViewerFile = { filename: string; mediaType: string; url: string };

type AttachmentViewerStore = {
  file: ViewerFile | null;
  open: (file: ViewerFile) => void;
  close: () => void;
};

export const useAttachmentViewer = create<AttachmentViewerStore>((set) => ({
  file: null,
  open: (file) => set({ file }),
  close: () => set({ file: null }),
}));

/** Open the attachment viewer for a file (image lightbox / text content). */
export const openAttachment = (file: ViewerFile): void => useAttachmentViewer.getState().open(file);
