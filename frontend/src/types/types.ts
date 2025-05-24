export interface CameraCaptureProps {
  onImageCaptured: (capturedImage: File) => void;
  onCancel: () => void;
}