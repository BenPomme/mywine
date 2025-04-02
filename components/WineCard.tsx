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

const WineCard: React.FC<WineCardProps> = ({ wine, isFeatured }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageError, setImageError] = useState(false);

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
    <div className={`bg-white shadow-md rounded-lg overflow-hidden ${isFeatured ? 'border-2 border-indigo-500' : ''}`}>
      <div className="md:flex">
        {/* Image Section */}
        <div className="md:flex-shrink-0 p-4 flex items-center justify-center md:w-1/3">
          <img 
            className="h-48 w-full object-contain md:h-full md:w-48" 
            src={wine.imageUrl || 'data:image/svg+xml;base64,...'} // Use found image, fallback
            alt={`${wine.winery} ${wine.name}`}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.onerror = null; 
              target.src = 'data:image/svg+xml;base64,...'; 
            }}
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
        </div>
      </div>
    </div>
  );
};

export default WineCard; 