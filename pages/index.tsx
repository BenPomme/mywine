import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import ImageUploader from '../components/ImageUploader';
import WineCard from '../components/WineCard';
import { Wine, UploadState } from '../utils/types';

// Add a polling status type
type PollingStatus = 'idle' | 'polling' | 'completed' | 'failed';

export default function Home() {
  const [uploadState, setUploadState] = useState<UploadState>({
    uploading: false,
    file: null,
    preview: null,
    error: null,
  });
  const [wineDataList, setWineDataList] = useState<(Wine & { webSnippets?: string })[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pollingStatus, setPollingStatus] = useState<PollingStatus>('idle');
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingCountRef = useRef<number>(0);
  
  // Add filter state
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<string>('score'); // 'score', 'name', or 'year'
  
  // Filter and sort the wine list based on active filters
  const filteredAndSortedWines = wineDataList
    .filter((wine) => {
      if (activeFilters.length === 0) return true;
      
      // Check if wine has any of the active filters
      const wineText = `${wine.tastingNotes || ''} ${wine.webSnippets || ''} ${wine.grapeVarieties || ''} ${wine.region || ''}`.toLowerCase();
      
      return activeFilters.some(filter => {
        switch (filter) {
          case 'Sweet':
            return wineText.includes('sweet') || wineText.includes('sugar') || wineText.includes('residual sugar');
          case 'Dry':
            return wineText.includes('dry') || wineText.includes('crisp') || wineText.includes('brut');
          case 'Fruity':
            return wineText.includes('fruit') || wineText.includes('berry') || wineText.includes('cherry') || 
                   wineText.includes('plum') || wineText.includes('apple') || wineText.includes('citrus');
          case 'Full Body':
            return wineText.includes('full bod') || wineText.includes('robust') || wineText.includes('rich') || 
                   wineText.includes('intense') || wineText.includes('heavy');
          case 'Light':
            return wineText.includes('light bod') || wineText.includes('delicate') || wineText.includes('subtle') || 
                   wineText.includes('elegant') || wineText.includes('refreshing');
          default:
            return false;
        }
      });
    })
    .sort((a, b) => {
      switch (sortOption) {
        case 'score':
          return (b.score || 0) - (a.score || 0);
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'year':
          const yearA = parseInt(a.vintage || a.year || '0');
          const yearB = parseInt(b.vintage || b.year || '0');
          return yearB - yearA;
        default:
          return 0;
      }
    });
  
  // Toggle a filter
  const handleFilterToggle = (tag: string) => {
    setActiveFilters(prev => 
      prev.includes(tag) 
        ? prev.filter(f => f !== tag) 
        : [...prev, tag]
    );
  };

  // Handle file upload status and progress
  const handleUploadStatusChange = (status: 'uploading' | 'success' | 'error', data?: any) => {
    if (status === 'uploading') {
      setUploadProgress(data?.progress || 0);
      if (data?.progress === 100) {
        setUploadProgress(0);
      }
    }
  };

  // Submit handler for image analysis
  const handleSubmit = async (data: { image: string }) => {
    console.log('Submitting image analysis request...');
    setPollingStatus('polling');
    setPollingError(null);
    pollingCountRef.current = 0;
    
    try {
      const response = await fetch('/api/analyze-wine-openai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: data.image }),
      });
      
      const result = await response.json();
      console.log('Received Job ID:', result.jobId);
      setJobId(result.jobId);
      
      // Check if we already have results (sync response)
      if (result.status === 'completed' && result.data) {
        setWineDataList(result.data.wines);
        setPollingStatus('completed');
        setActiveFilters([]); // Reset filters for new results
        return;
      }
      
      // Otherwise start polling
      startPolling(result.jobId);
    } catch (error) {
      console.error('Error submitting image for analysis:', error);
      setPollingError('Failed to submit image for analysis. Please try again.');
      setPollingStatus('failed');
    }
  };

  // Start polling for results
  const startPolling = (jobId: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    pollingIntervalRef.current = setInterval(async () => {
      try {
        pollingCountRef.current += 1;
        console.log(`Polling attempt ${pollingCountRef.current} for job ${jobId}`);
        
        const response = await fetch(`/api/get-analysis-result?jobId=${jobId}`);
        const result = await response.json();
        
        if (result.status === 'completed' && result.data) {
          clearInterval(pollingIntervalRef.current!);
          setWineDataList(result.data.wines || []);
          setPollingStatus('completed');
          setActiveFilters([]); // Reset filters for new results
        } else if (result.status === 'failed') {
          clearInterval(pollingIntervalRef.current!);
          setPollingError(result.message || 'Analysis failed. Please try again.');
          setPollingStatus('failed');
        } else if (pollingCountRef.current >= 60) { // 5 minutes timeout (5s interval × 60)
          clearInterval(pollingIntervalRef.current!);
          setPollingError('Analysis timed out. Please try again.');
          setPollingStatus('failed');
        }
      } catch (error) {
        console.error('Error polling for results:', error);
        clearInterval(pollingIntervalRef.current!);
        setPollingError('Failed to retrieve analysis results. Please try again.');
        setPollingStatus('failed');
      }
    }, 5000); // Poll every 5 seconds
  };

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Reset analysis when a new file is uploaded
  useEffect(() => {
    if (uploadState.file) {
      setWineDataList([]);
      setPollingStatus('idle');
      setActiveFilters([]);
    }
  }, [uploadState.file]);

  return (
    <>
      <Head>
        <title>Wine Finder - Analyze your wine collection</title>
        <meta name="description" content="AI-powered wine analysis and identification" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
              Wine Finder
            </h1>
            <p className="text-gray-600 text-lg">
              Upload an image of wine bottles to analyze and identify them
            </p>
          </div>
          
          <div className="max-w-xl mx-auto mb-8">
            <ImageUploader 
              onStatusChange={handleUploadStatusChange}
              onSubmit={handleSubmit}
              uploadState={uploadState}
              setUploadState={setUploadState}
              progress={uploadProgress}
              disabled={pollingStatus === 'polling'}
            />
          </div>
          
          <div className="text-center mt-4">
            {pollingStatus === 'polling' && (
              <div className="animate-pulse">
                <p className="text-indigo-600">Analyzing your wine... this may take up to a minute.</p>
                <div className="w-full max-w-md h-2 bg-gray-200 rounded-full mx-auto mt-4 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full progress-bar animate-pulse"></div>
                </div>
              </div>
            )}
            
            {pollingStatus === 'failed' && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
                <strong className="font-bold">Error: </strong>
                <span className="block sm:inline">{pollingError || 'Something went wrong. Please try again.'}</span>
              </div>
            )}

            {pollingStatus === 'completed' && wineDataList.length > 0 && (
              <div className="mt-8">
                <h2 className="text-2xl font-semibold text-gray-800 mb-4">
                  Analysis Results {wineDataList.length > 1 ? `(${wineDataList.length} wines found)` : ''}
                </h2>
                
                {/* Filters and sorting */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="text-sm font-medium text-gray-700">Filter by:</span>
                    {['Sweet', 'Dry', 'Fruity', 'Full Body', 'Light'].map((filter) => (
                      <button
                        key={filter}
                        onClick={() => handleFilterToggle(filter)}
                        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors
                          ${activeFilters.includes(filter) 
                            ? 'bg-indigo-600 text-white' 
                            : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">Sort by:</span>
                    <select 
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value)}
                      className="border border-gray-300 rounded-md px-3 py-1 text-sm"
                    >
                      <option value="score">Score</option>
                      <option value="name">Name</option>
                      <option value="year">Year</option>
                    </select>
                  </div>
                </div>
                
                {activeFilters.length > 0 && (
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-600">Active filters:</span>
                    {activeFilters.map(filter => (
                      <span 
                        key={filter}
                        className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full flex items-center"
                      >
                        {filter}
                        <button
                          onClick={() => handleFilterToggle(filter)}
                          className="ml-1 text-indigo-600 hover:text-indigo-800"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => setActiveFilters([])}
                      className="text-xs text-indigo-600 hover:text-indigo-800 ml-2"
                    >
                      Clear all
                    </button>
                  </div>
                )}
                
                <div className="space-y-6">
                  {filteredAndSortedWines.length > 0 ? (
                    filteredAndSortedWines.map((wine, index) => (
                      <WineCard 
                        key={`${wine.name}-${index}`} 
                        wine={wine} 
                        isFeatured={index === 0 && filteredAndSortedWines.length > 1}
                        onTagClick={handleFilterToggle}
                      />
                    ))
                  ) : (
                    <div className="text-center py-6 bg-gray-50 rounded-lg">
                      <p className="text-gray-500">No wines match your current filters</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}