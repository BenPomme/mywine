import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import ImageUploader from '../components/ImageUploader';
import WineCard from '../components/WineCard';
import { Wine, UploadState } from '../utils/types';

// Add a polling status type
type PollingStatus = 'idle' | 'polling' | 'completed' | 'failed';

export default function Home() {
  const [uploadState, setUploadState] = useState<UploadState>({
    isLoading: false,
    error: null,
  });
  const [wineDataList, setWineDataList] = useState<Wine[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pollingStatus, setPollingStatus] = useState<PollingStatus>('idle');
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref to hold interval ID

  // --- Polling Logic --- 
  useEffect(() => {
    // Function to check job status
    const checkJobStatus = async () => {
      if (!jobId) return;
      console.log(`Polling for Job ID: ${jobId}`);
      try {
        const response = await fetch(`/api/get-analysis-result?jobId=${jobId}`);
        if (!response.ok) {
          // Handle non-200 responses from the status check itself
          throw new Error(`Status check failed: ${response.statusText}`);
        }
        const result = await response.json();
        console.log("Polling result:", result);

        if (result.status === 'completed') {
          console.log("Job completed!");
          setPollingStatus('completed');
          setUploadState({ isLoading: false, error: null });
          setJobId(null); // Clear job ID
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          
          // Format and set results
          if (result.data?.wines && Array.isArray(result.data.wines)) {
            // *** Reuse the formatting logic from handleImageUpload ***
             // Find the original uploaded image URL if stored, or use placeholder
            const uploadedImageUrl = result.data.imageUrl || 'data:image/svg+xml;base64,...'; // Maybe get from KV if needed?

            const formattedWines = result.data.wines.map((wineData: any) => {
                // NOTE: Ensure this mapping matches the structure returned by the Netlify function
                 return {
                    name: wineData.name || '',
                    winery: wineData.producer || wineData.winery || '',
                    year: wineData.vintage || wineData.year || '',
                    region: wineData.region || '',
                    grapeVariety: wineData.varietal || wineData.grapeVariety || '',
                    type: wineData.type || '',
                    imageUrl: wineData.imageUrl || '', // This might be the detail image now
                    uploadedImageUrl: uploadedImageUrl, // Need the originally uploaded one
                    score: wineData.score || 0,
                    summary: wineData.summary || '',
                    aiSummary: wineData.summary || '', // Keep consistent for display
                    rating: {
                      score: wineData.score || 0,
                      source: wineData.ratingSource || 'AI Analysis',
                      review: '' // Keep this empty
                    },
                    additionalReviews: Array.isArray(wineData.additionalReviews) 
                      ? wineData.additionalReviews.map((review: any) => {
                          if (typeof review === 'string') { // Should be object now based on Netlify func
                            return { source: 'Review Snippet', review: review }; 
                          }
                          return { source: review.source || 'Review Snippet', review: review.review || '' }; // Use source/review fields
                        })
                      : []
                  };
            });
            setWineDataList(formattedWines);
          } else {
             throw new Error('Completed job missing wine data');
          }

        } else if (result.status === 'failed' || result.status === 'trigger_failed') {
          console.error("Job failed:", result.data?.error);
          setPollingStatus('failed');
          setUploadState({ isLoading: false, error: result.data?.error || 'Analysis failed.' });
          setJobId(null);
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        } else if (result.status === 'not_found') {
           console.error("Job ID not found during polling.");
           setPollingStatus('failed');
           setUploadState({ isLoading: false, error: 'Analysis job lost or expired.' });
           setJobId(null);
           if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        } else {
          // Still processing ('uploading', 'processing', 'processing_started')
          console.log(`Job status: ${result.status}, continuing poll...`);
          setPollingStatus('polling'); // Ensure status reflects polling
          setUploadState({ isLoading: true, error: null }); // Keep loading true
        }

      } catch (error) {
        console.error('Error during polling:', error);
        setPollingStatus('failed');
        setUploadState({ isLoading: false, error: error instanceof Error ? error.message : 'Polling error occurred' });
        setJobId(null);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    };

    // Start polling if we have a jobId and status is processing/polling
    if (jobId && (pollingStatus === 'polling' || pollingStatus === 'idle')) {
       // Clear any existing interval before starting a new one
       if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
       }
       // Set isLoading true when starting to poll
       setUploadState({ isLoading: true, error: null }); 
       // Initial check immediately, then set interval
       checkJobStatus(); 
       pollingIntervalRef.current = setInterval(checkJobStatus, 5000); // Poll every 5 seconds
       setPollingStatus('polling'); // Explicitly set status
    }

    // Cleanup function to clear interval when component unmounts or jobId changes
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        console.log("Polling interval cleared.");
      }
    };
  }, [jobId, pollingStatus]); // Rerun effect if jobId or pollingStatus changes


  const handleImageUpload = async (file: File) => {
    try {
      setUploadState({ isLoading: true, error: null });
      setWineDataList([]); // Clear previous results
      setJobId(null); // Clear previous job ID
      setPollingStatus('idle'); // Reset polling status
      if (pollingIntervalRef.current) { // Clear previous interval if any
         clearInterval(pollingIntervalRef.current);
         pollingIntervalRef.current = null;
      }
      
      // Convert image to base64
      const base64Image = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target?.result as string;
          resolve(base64);
        };
        reader.readAsDataURL(file);
      });

      // Submit image analysis request
      console.log('Submitting image analysis request...');
      const response = await fetch('/api/analyze-wine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64Image }),
      });

      // Get jobId from response headers or body
      const jobId = response.headers.get('x-job-id') || (await response.json()).jobId;
      console.log('Received Job ID:', jobId);

      if (!jobId) {
        throw new Error('No job ID received from server');
      }

      // Start polling for results
      setJobId(jobId);
      setPollingStatus('polling');
      startPolling(jobId);

    } catch (error: any) {
      console.error('Error submitting analysis request:', error);
      setPollingStatus('failed');
      setUploadState({ isLoading: false, error: error.message || 'Failed to analyze image' });
      setJobId(null);
    }
  };

  const startPolling = (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        console.log(`Checking status for Job ID: ${jobId}`);
        const response = await fetch(`/api/get-analysis-result?jobId=${jobId}`);
        const data = await response.json();
        console.log(`Job ID ${jobId} status:`, data.status);

        if (data.status === 'completed') {
          clearInterval(pollInterval);
          setPollingStatus('completed');
          setUploadState({ isLoading: false, error: null });
          setJobId(null);
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          
          // Format and set results
          if (data.data?.wines && Array.isArray(data.data.wines)) {
            // *** Reuse the formatting logic from handleImageUpload ***
             // Find the original uploaded image URL if stored, or use placeholder
            const uploadedImageUrl = data.data.imageUrl || 'data:image/svg+xml;base64,...'; // Maybe get from KV if needed?

            const formattedWines = data.data.wines.map((wineData: any) => {
                // NOTE: Ensure this mapping matches the structure returned by the Netlify function
                 return {
                    name: wineData.name || '',
                    winery: wineData.producer || wineData.winery || '',
                    year: wineData.vintage || wineData.year || '',
                    region: wineData.region || '',
                    grapeVariety: wineData.varietal || wineData.grapeVariety || '',
                    type: wineData.type || '',
                    imageUrl: wineData.imageUrl || '', // This might be the detail image now
                    uploadedImageUrl: uploadedImageUrl, // Need the originally uploaded one
                    score: wineData.score || 0,
                    summary: wineData.summary || '',
                    aiSummary: wineData.summary || '', // Keep consistent for display
                    rating: {
                      score: wineData.score || 0,
                      source: wineData.ratingSource || 'AI Analysis',
                      review: '' // Keep this empty
                    },
                    additionalReviews: Array.isArray(wineData.additionalReviews) 
                      ? wineData.additionalReviews.map((review: any) => {
                          if (typeof review === 'string') { // Should be object now based on Netlify func
                            return { source: 'Review Snippet', review: review }; 
                          }
                          return { source: review.source || 'Review Snippet', review: review.review || '' }; // Use source/review fields
                        })
                      : []
                  };
            });
            setWineDataList(formattedWines);
          } else {
             throw new Error('Completed job missing wine data');
          }

        } else if (data.status === 'failed' || data.status === 'trigger_failed') {
          console.error("Job failed:", data.error);
          setPollingStatus('failed');
          setUploadState({ isLoading: false, error: data.error || 'Analysis failed.' });
          setJobId(null);
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        } else if (data.status === 'not_found') {
           console.error("Job ID not found during polling.");
           setPollingStatus('failed');
           setUploadState({ isLoading: false, error: 'Analysis job lost or expired.' });
           setJobId(null);
           if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        } else {
          // Still processing ('uploading', 'processing', 'processing_started')
          console.log(`Job status: ${data.status}, continuing poll...`);
          setPollingStatus('polling'); // Ensure status reflects polling
          setUploadState({ isLoading: true, error: null }); // Keep loading true
        }

      } catch (error) {
        console.error('Error polling for results:', error);
        // Don't stop polling on error, let it continue
      }
    }, 2000); // Poll every 2 seconds

    // Store interval ID for cleanup
    pollingIntervalRef.current = pollInterval;
  };

  // --- UI Rendering --- 
  return (
    <>
      <Head>
        <title>Pick My Wine</title>
        <meta name="description" content="AI-powered wine recommendations" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <main className="min-h-screen bg-gray-100 py-8">
        <div className="container mx-auto px-4">
          <header className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Pick My Wine</h1>
            <p className="text-xl text-gray-600">
              Take a photo of a wine bottle or menu to get instant ratings and reviews
            </p>
          </header>
          
          <div className="max-w-4xl mx-auto">
            <ImageUploader 
              onUpload={handleImageUpload}
              // Pass relevant state to ImageUploader if needed 
              // (e.g., disable upload while processing?)
              uploadState={{ 
                  isLoading: uploadState.isLoading || pollingStatus === 'polling',
                  error: uploadState.error
              }} 
            />
            
            {/* Display polling status message */} 
            {(uploadState.isLoading && pollingStatus === 'polling') && (
              <div className="mt-6 text-center text-gray-600">
                <p>Analyzing image... This may take a moment.</p>
                {/* Optional: Add a spinner here */}
              </div>
            )}
            
            {uploadState.error && (
              <div className="mt-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
                <strong className="font-bold">Error: </strong>
                <span className="block sm:inline">{uploadState.error}</span>
              </div>
            )}
            
            {/* Only show results when polling is complete and successful */} 
            {pollingStatus === 'completed' && wineDataList.length > 0 && (
              <div className="mt-8">
                <h2 className="text-2xl font-semibold text-gray-800 mb-4">
                  Analysis Results {wineDataList.length > 1 ? `(${wineDataList.length} wines found)` : ''}
                </h2>
                <div className="space-y-6">
                  {wineDataList.map((wine, index) => (
                    <WineCard 
                      key={`${wine.name}-${index}`} 
                      wine={wine} 
                      isFeatured={index === 0 && wineDataList.length > 1} 
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}