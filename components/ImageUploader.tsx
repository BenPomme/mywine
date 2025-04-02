import { useState, useRef, useEffect } from 'react';
import { UploadState } from '../utils/types';

interface ImageUploaderProps {
  onSubmit: (data: { image: string }) => Promise<void>;
  onStatusChange: (status: 'uploading' | 'success' | 'error', data?: any) => void;
  uploadState: UploadState;
  setUploadState: React.Dispatch<React.SetStateAction<UploadState>>;
  progress: number;
  disabled?: boolean;
}

const ImageUploader = ({ 
  onSubmit, 
  onStatusChange, 
  uploadState, 
  setUploadState, 
  progress, 
  disabled = false 
}: ImageUploaderProps) => {
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Handle file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processFile(files[0]);
    }
  };

  // Handle file drop
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  // Handle drag events
  const handleDrag = (e: React.DragEvent<HTMLDivElement>, active: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(active);
  };

  // Process the selected file
  const processFile = async (file: File) => {
    if (!file.type.match('image.*')) {
      setUploadState(prev => ({ ...prev, error: 'Please select an image file' }));
      return;
    }

    // Update state to show file is being processed
    setUploadState({
      uploading: true,
      file,
      preview: URL.createObjectURL(file),
      error: null
    });
    
    onStatusChange('uploading', { progress: 10 });

    // Convert the file to Base64
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (event.target?.result) {
        onStatusChange('uploading', { progress: 50 });
        
        // Extract the Base64 data part
        const base64String = event.target.result.toString();
        const base64Data = base64String.split(',')[1];
        
        try {
          // Call the submit handler
          await onSubmit({ image: base64Data });
          onStatusChange('success', { progress: 100 });
        } catch (error) {
          console.error('Error analyzing image:', error);
          setUploadState(prev => ({ 
            ...prev, 
            uploading: false,
            error: 'Failed to analyze image. Please try again.' 
          }));
          onStatusChange('error', {});
        }
      }
    };
    
    reader.onerror = () => {
      setUploadState(prev => ({ 
        ...prev, 
        uploading: false,
        error: 'Error reading file. Please try again.' 
      }));
      onStatusChange('error', {});
    };
    
    reader.readAsDataURL(file);
  };

  // Click the hidden file input
  const openFileSelector = () => {
    fileInputRef.current?.click();
  };

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // Use back camera by default
      });
      streamRef.current = stream;
      setShowCamera(true);
      setCameraError(null);
    } catch (error) {
      console.error('Error accessing camera:', error);
      setCameraError('Unable to access camera. Please make sure you have granted camera permissions.');
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  };

  // Capture photo
  const capturePhoto = async () => {
    if (!videoRef.current) return;

    const width = videoRef.current.videoWidth || videoRef.current.clientWidth;
    const height = videoRef.current.videoHeight || videoRef.current.clientHeight;

    if (!width || !height) {
      console.error('Video dimensions not available');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(videoRef.current, 0, 0, width, height);

    // Convert to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas is empty'));
      }, 'image/jpeg', 0.8);
    });

    // Create a File object from the blob
    const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
    
    // Process the file like a regular file upload
    await processFile(file);
    stopCamera();
  };

  useEffect(() => {
    if (showCamera && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play();
      };
    }
  }, [showCamera]);

  return (
    <div className="w-full max-w-xl mx-auto">
      {uploadState.uploading || disabled ? (
        <div className="bg-white rounded-lg p-4 shadow-md text-center">
          <div className="mb-2">
            <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
              <div 
                className="bg-indigo-500 h-2 rounded-full transition-all" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-gray-600 text-xs">Analyzing your wine...</p>
          </div>
          <div className="flex justify-center">
            <svg className="animate-spin h-6 w-6 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        </div>
      ) : showCamera ? (
        <div className="bg-white rounded-lg p-4 shadow-md">
          <div className="relative">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onCanPlay={() => { videoRef.current?.play(); }}
              className="w-full rounded-lg"
            />
            <button
              onClick={stopCamera}
              className="absolute top-2 right-2 bg-white rounded-full p-2 shadow-lg hover:bg-gray-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              onClick={capturePhoto}
              className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full p-4 shadow-lg"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          {cameraError && (
            <p className="text-red-500 text-sm mt-2">{cameraError}</p>
          )}
        </div>
      ) : (
        <div 
          className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
            dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-500 hover:bg-indigo-50'
          }`}
          onDragOver={(e) => handleDrag(e, true)}
          onDragEnter={(e) => handleDrag(e, true)}
          onDragLeave={(e) => handleDrag(e, false)}
          onDrop={handleDrop}
        >
          <input 
            ref={fileInputRef}
            type="file" 
            className="hidden" 
            accept="image/*" 
            onChange={handleFileChange}
          />
          <div className="space-y-4">
            <div className="flex justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-medium text-gray-700">
                Drag and drop your wine image here
              </p>
              <p className="text-sm text-gray-500 mt-1">
                or click to select a file
              </p>
            </div>
            <button
              onClick={openFileSelector}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Select File
            </button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">or</span>
              </div>
            </div>
            <button
              onClick={startCamera}
              className="bg-white hover:bg-gray-50 text-indigo-600 border border-indigo-500 px-4 py-2 rounded-lg transition-colors"
            >
              Use Camera
            </button>
          </div>
          {uploadState.error && (
            <p className="mt-4 text-red-500 text-sm">{uploadState.error}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ImageUploader; 