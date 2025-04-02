import React, { useState } from 'react';
import { Wine } from '../utils/types';
import ReviewSection from './ReviewSection';
import RatingStars from './RatingStars';

interface WineCardProps {
  wine: Wine & { webSnippets?: string };
  isFeatured?: boolean;
}

// Placeholder SVG and reliable fallback images
const placeholderSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Crect width='10' height='10' fill='%23E5E7EB'/%3E%3C/svg%3E";
const fallbackWineImage = "https://images.vivino.com/labels/default_label.jpg";

// Helper to generate star icons based on score (out of 100)
const renderStars = (score: number) => {
  const stars = [];
  const normalizedScore = Math.max(0, Math.min(100, score)); // Ensure score is 0-100
  const filledStars = Math.round(normalizedScore / 20); // 5 stars, each represents 20 points
  const hasHalfStar = (normalizedScore % 20) >= 10;

  for (let i = 1; i <= 5; i++) {
    if (i <= filledStars) {
      stars.push(<span key={i} className="text-yellow-400">&#9733;</span>); // Filled star
    } else if (i === filledStars + 1 && hasHalfStar) {
        // Basic half-star representation (adjust CSS if needed for better visuals)
        stars.push(
            <span key={i} className="relative inline-block text-yellow-400">
                &#9733; 
                <span className="absolute top-0 left-0 w-1/2 overflow-hidden text-gray-300">&#9733;</span>
            </span>
        );
    } else {
      stars.push(<span key={i} className="text-gray-300">&#9734;</span>); // Empty star
    }
  }
  return stars;
};

// Helper to parse snippets (assuming newline separated)
const parseWebSnippets = (snippetsText: string): { source: string, snippet: string }[] => {
    const defaultMessages = [
        'No specific web results found.',
        'Error during web search.',
        'Web search performed, but snippets require further processing.',
        'No snippets found on Vivino, Decanter, or Wine-Searcher.',
        'Failed to get snippets after tool call simulation.',
        'Error retrieving snippets after tool simulation.',
        'No relevant snippets found.'
    ];

    // Trim and check against default/error messages
    const trimmedText = snippetsText?.trim() || '';
    if (!trimmedText || defaultMessages.includes(trimmedText)) {
        return [];
    }
    
    // Split by newline and filter out empty/short lines
    const lines = trimmedText.split('\n').filter(line => line.trim().length > 5);
    
    return lines.map((line, index) => {
        let source = `Web Snippet ${index + 1}`; // Default source
        let snippet = line.trim();

        // Try to extract source if mentioned (e.g., "Source: Vivino - ..." or "Vivino: ...")
        const sourceMatch = snippet.match(/^(?:Source:|From|Vivino|Decanter|Wine-Searcher)[:\s-]+(.+)/i);
        if (sourceMatch && sourceMatch[1]) {
            // Try to identify the source name more reliably
            const potentialSource = snippet.substring(0, sourceMatch.index || 0).trim().replace(/[:\s-]+$/, '');
            if (potentialSource.length > 2) { // Avoid grabbing just punctuation
                source = potentialSource;
            }
            snippet = sourceMatch[1].trim(); // The rest is the snippet
        }
        
        // Remove leading/trailing quotes if present
        snippet = snippet.replace(/^["'\s]+|["'\s]+$/g, '');

        return { source, snippet };
    });
};

const WineCard: React.FC<WineCardProps> = ({ wine, isFeatured }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const webSnippets = parseWebSnippets(wine.webSnippets || '');

  // Handle user rating change
  const handleRatingChange = (rating: number) => {
    console.log(`Rating changed to ${rating} for ${wine.name}`);
    // This would typically update state or call an API
  };

  const handleImageError = () => {
    console.log(`Image error for: ${wine.imageUrl}`);
    setImageError(true);
  };

  // Get a cleaned image URL or fallback to placeholder
  const getImageUrl = () => {
    // First check if we have a wine.imageUrl that isn't empty and hasn't errored
    if (wine.imageUrl && !imageError && wine.imageUrl.startsWith('http')) {
      // Check for trusted domains that we know work reliably
      const trustedDomains = ['images.vivino.com', 'www.wine.com', 'www.winespectator.com'];
      for (const domain of trustedDomains) {
        if (wine.imageUrl.includes(domain)) {
          return wine.imageUrl; // Return trusted URLs directly
        }
      }
      // For non-trusted domains, we still try the URL unless there was an error
      return wine.imageUrl;
    }
    
    // If the URL caused an error or doesn't exist, use fallback
    return fallbackWineImage;
  };

  return (
    <div className={`bg-white shadow-md rounded-lg overflow-hidden ${isFeatured ? 'border-2 border-indigo-500' : ''}`}>
      <div className="md:flex">
        {/* Image Section */}
        <div className="md:flex-shrink-0 p-4 flex items-center justify-center md:w-1/3">
          <img 
            className="h-48 w-full object-contain md:h-full md:w-48" 
            src={getImageUrl()} 
            alt={`${wine.producer || wine.winery || ''} ${wine.name || ''}`}
            onError={handleImageError}
          />
        </div>

        {/* Details Section */}
        <div className="p-6 flex-grow">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="uppercase tracking-wide text-sm text-indigo-600 font-semibold">
                {wine.winery || 'Unknown Winery'}
              </div>
              <h2 className="block mt-1 text-lg leading-tight font-medium text-black">
                {wine.name || 'Unknown Wine'}
              </h2>
              <p className="mt-1 text-gray-500 text-sm">
                {wine.year} {wine.region ? `· ${wine.region}` : ''} {wine.grapeVariety ? `· ${wine.grapeVariety}` : ''}
              </p>
            </div>
            <div className="text-right ml-4 flex-shrink-0">
              <span className="text-xl font-bold text-gray-900">
                {wine.score ? `${wine.score}` : 'N/A'}<span className="text-sm font-normal text-gray-500">/100</span>
              </span>
              <div className="mt-1 flex items-center justify-end">
                 {renderStars(wine.score || 0)} 
              </div>
               <p className="text-xs text-gray-500 mt-1">(AI Analysis)</p> 
            </div>
          </div>
          
          {/* AI Review Section */}
          {wine.summary && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <h3 className="text-md font-semibold text-gray-700 mb-2">AI Review</h3>
              <p className="text-gray-600 text-sm">
                {wine.summary} 
              </p>
            </div>
          )}

           {/* Collapsible Web Snippets Section */} 
          {webSnippets.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <button 
                onClick={() => setShowSnippets(!showSnippets)}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center"
              >
                {showSnippets ? 'Hide' : 'Show'} Web Snippets
                <svg className={`ml-1 w-4 h-4 transform ${showSnippets ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </button>
              {showSnippets && (
                <div className="mt-2 space-y-2">
                  {webSnippets.map((snippet, index) => (
                    <div key={index} className="p-2 bg-gray-50 rounded">
                      <p className="text-xs text-gray-500 mb-1">Source: {snippet.source}</p>
                      <p className="text-sm text-gray-700">{snippet.snippet}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WineCard; 