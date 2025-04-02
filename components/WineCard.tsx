import React, { useState } from 'react';
import { Wine } from '../utils/types';
import ReviewSection from './ReviewSection';
import RatingStars from './RatingStars';

interface WineCardProps {
  wine: Wine & { webSearchResults?: string };
  isFeatured?: boolean;
}

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

// Helper to try and extract snippets from raw web search results
const parseWebResults = (results: string): { source: string, snippet: string }[] => {
    if (!results || results === 'No specific web results found.' || results === 'Error during web search.') {
        return [];
    }
    // Basic heuristic: Look for lines that might be quotes or summaries
    // This is very basic and might need significant improvement based on actual API output
    const lines = results.split('\n').filter(line => line.trim().length > 10); // Filter short lines
    return lines.slice(0, 5).map((line, index) => ({
        source: `Web Snippet ${index + 1}`, // Placeholder source
        snippet: line.trim()
    }));
};

const WineCard: React.FC<WineCardProps> = ({ wine, isFeatured }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [showWebResults, setShowWebResults] = useState(false);
  const webSnippets = parseWebResults(wine.webSearchResults || '');

  // Handle user rating change
  const handleRatingChange = (rating: number) => {
    console.log(`Rating changed to ${rating} for ${wine.name}`);
    // This would typically update state or call an API
  };

  const handleImageError = () => {
    setImageError(true);
  };

  const getImageUrl = () => {
    if (imageError || !wine.imageUrl) {
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNFNUU3RUIiLz48cGF0aCBkPSJNODAgMTIwTDEwMCA4MEwxMjAgMTIwSDgwWiIgZmlsbD0iIzk0QTNCOCIvPjwvc3ZnPg==';
    }
    return wine.imageUrl;
  };

  return (
    <div className={`wine-card ${isFeatured ? 'p-6' : 'p-4'} glass-effect rounded-xl`}>
      <div className="flex flex-col md:flex-row gap-4">
        {/* Wine Image */}
        <div className={`relative ${isFeatured ? 'w-48 h-48' : 'w-32 h-32'} flex-shrink-0 bg-gray-50 rounded-lg overflow-hidden`}>
          <img
            src={getImageUrl()}
            alt={wine.name}
            className="w-full h-full object-contain rounded-lg"
            onError={handleImageError}
          />
        </div>

        {/* Wine Details */}
        <div className="flex-1">
          <div className="flex justify-between items-start mb-2">
            <h3 className={`font-bold ${isFeatured ? 'text-xl' : 'text-lg'} text-background-dark`}>
              {wine.name}
            </h3>
            <div className="flex items-center space-x-1">
              <span className="text-primary font-semibold">{wine.rating?.score ?? 0}%</span>
              <span className="text-secondary text-sm">({wine.rating?.source || '-'})</span>
            </div>
          </div>

          {/* Wine Pills */}
          <div className="flex flex-wrap gap-2 mb-3">
            {wine.year && (
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm">
                {wine.year}
              </span>
            )}
            {wine.region && (
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm">
                {wine.region}
              </span>
            )}
            {wine.grapeVariety && (
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm">
                {wine.grapeVariety}
              </span>
            )}
            {wine.type && (
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm">
                {wine.type}
              </span>
            )}
          </div>

          {/* Rating Stars */}
          <div className="flex items-center mb-3">
            <RatingStars rating={wine.rating?.score ?? 0} size="md" />
          </div>

          {/* AI Summary */}
          {wine.aiSummary && (
            <div className="mb-4">
              <p className="text-background-dark italic">
                "{wine.aiSummary}"
              </p>
            </div>
          )}

          {/* Reviews Section */}
          {(wine.rating?.review || (wine.additionalReviews && wine.additionalReviews.length > 0)) && (
            <div className="space-y-3">
              {/* Main Review */}
              {wine.rating?.review && (
                <div className="bg-white/50 rounded-lg p-3">
                  <p className="text-sm text-secondary">{wine.rating?.review}</p>
                </div>
              )}

              {/* Additional Reviews */}
              {wine.additionalReviews && wine.additionalReviews.length > 0 && (
                <div className="space-y-2">
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-primary text-sm font-medium hover:text-primary-light transition-colors"
                  >
                    {isExpanded ? 'Hide Reviews' : `Show ${wine.additionalReviews.length} More Reviews`}
                  </button>
                  {isExpanded && (
                    <div className="space-y-2">
                      {wine.additionalReviews.map((review, index) => (
                        <div key={index} className="bg-white/50 rounded-lg p-3">
                          <p className="text-sm text-secondary">
                            {typeof review === 'string' ? review : review.review || review.text || ''}
                          </p>
                          {typeof review === 'object' && review.source && (
                            <p className="text-xs text-secondary mt-1">Source: {review.source}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Collapsible Web Search Results Section */}
          {webSnippets.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <button 
                onClick={() => setShowWebResults(!showWebResults)}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center"
              >
                {showWebResults ? 'Hide' : 'Show'} Web Search Snippets
                <svg className={`ml-1 w-4 h-4 transform ${showWebResults ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </button>
              {showWebResults && (
                <div className="mt-2 space-y-2">
                  {webSnippets.map((snippet, index) => (
                    <div key={index} className="p-2 bg-gray-50 rounded">
                      <p className="text-xs text-gray-500 mb-1">Source: {snippet.source}</p>
                      <p className="text-sm text-gray-700">"{snippet.snippet}"</p>
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