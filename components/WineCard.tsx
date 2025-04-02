import React, { useState } from 'react';
import { Wine } from '../utils/types';
import ReviewSection from './ReviewSection';
import RatingStars from './RatingStars';

interface WineCardProps {
  wine: Wine & { webSnippets?: string };
  isFeatured?: boolean;
  onTagClick?: (tag: string) => void;
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
    
    const snippets: { source: string, snippet: string }[] = [];
    
    // Process each line
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip introductory lines that aren't actual reviews
        if (line.toLowerCase().includes('here are some review snippets for') || 
            line.match(/^Source: Web Snippet \d+$/) || 
            line.trim().length < 10) {
            continue;
        }
        
        // Extract source and snippet
        let source = '';
        let snippet = line;
        
        // Try to extract numbered review format (e.g., "1. Source: Wine Advocate - "Text")
        const numberedMatch = line.match(/^\d+\.\s+Source:\s+([^-]+)\s+-\s+"(.+)"$/);
        if (numberedMatch) {
            source = numberedMatch[1].trim();
            snippet = numberedMatch[2].trim();
            snippets.push({ source, snippet });
            continue;
        }
        
        // Try to extract direct source format (e.g., "Source: Wine Advocate - "Text")
        const sourceMatch = line.match(/^Source:\s+([^-]+)\s+-\s+"(.+)"$/);
        if (sourceMatch) {
            source = sourceMatch[1].trim();
            snippet = sourceMatch[2].trim();
            snippets.push({ source, snippet });
            continue;
        }
        
        // Try to extract simple numbered format (e.g., "1. Source: Wine Advocate...")
        const simpleNumberedMatch = line.match(/^\d+\.\s+Source:\s+([^-:]+)[:|\s](.+)$/);
        if (simpleNumberedMatch) {
            source = simpleNumberedMatch[1].trim();
            snippet = simpleNumberedMatch[2].trim();
            snippets.push({ source, snippet });
            continue;
        }
        
        // Standard format Source: X - Text
        const standardSourceMatch = line.match(/Source:\s+([^-:]+)[:|\s-]+(.+)/i);
        if (standardSourceMatch) {
            source = standardSourceMatch[1].trim();
            snippet = standardSourceMatch[2].trim();
            snippets.push({ source, snippet });
            continue;
        }
        
        // If no specific pattern matched but has "Source:" somewhere in it
        const genericSourceMatch = line.match(/Source:\s+(.+)/i);
        if (genericSourceMatch && !line.includes('Web Snippet')) {
            snippets.push({ 
                source: 'Review',
                snippet: line.trim()
            });
            continue;
        }
        
        // Default case - if we couldn't parse it but it's a substantial line
        if (line.length > 20 && !line.includes('Web Snippet')) {
            snippets.push({
                source: 'Review',
                snippet: line.trim()
            });
        }
    }
    
    return snippets;
};

// Function to extract flavor profile tags from tasting notes and wine details
const extractFlavorTags = (wine: Wine & { webSnippets?: string }): string[] => {
  const tags: string[] = [];
  const combinedText = `${wine.tastingNotes || ''} ${wine.webSnippets || ''} ${wine.grapeVarieties || ''} ${wine.region || ''}`.toLowerCase();
  
  // Check for flavor profiles
  if (combinedText.includes('sweet') || combinedText.includes('sugar') || combinedText.includes('residual sugar')) {
    tags.push('Sweet');
  }
  
  if (combinedText.includes('dry') || combinedText.includes('crisp') || combinedText.includes('brut')) {
    tags.push('Dry');
  }
  
  if (combinedText.includes('fruit') || combinedText.includes('berry') || combinedText.includes('cherry') || 
      combinedText.includes('plum') || combinedText.includes('apple') || combinedText.includes('citrus')) {
    tags.push('Fruity');
  }
  
  if (combinedText.includes('full bod') || combinedText.includes('robust') || combinedText.includes('rich') || 
      combinedText.includes('intense') || combinedText.includes('heavy')) {
    tags.push('Full Body');
  }
  
  if (combinedText.includes('light bod') || combinedText.includes('delicate') || combinedText.includes('subtle') || 
      combinedText.includes('elegant') || combinedText.includes('refreshing')) {
    tags.push('Light');
  }
  
  return tags;
};

const WineCard: React.FC<WineCardProps> = ({ wine, isFeatured, onTagClick }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const webSnippets = parseWebSnippets(wine.webSnippets || '');
  const flavorTags = extractFlavorTags(wine);
  
  // Handle user rating change
  const handleRatingChange = (rating: number) => {
    console.log(`Rating changed to ${rating} for ${wine.name}`);
    // This would typically update state or call an API
  };

  return (
    <div className={`bg-white shadow-md rounded-lg overflow-hidden ${isFeatured ? 'border-2 border-indigo-500' : ''} hover:shadow-lg transition-shadow duration-300`}>
      <div className="p-6">
        {/* Header with Name and Score */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="uppercase tracking-wide text-sm text-indigo-600 font-semibold">
              {wine.producer || wine.winery || 'Unknown Producer'}
            </div>
            <h2 className="block mt-1 text-xl leading-tight font-medium text-black">
              {wine.name || 'Unknown Wine'}
            </h2>
            <p className="mt-1 text-gray-600 text-sm">
              {wine.vintage || wine.year} {wine.region ? `· ${wine.region}` : ''} {wine.grapeVarieties ? `· ${wine.grapeVarieties}` : ''}
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
        
        {/* Flavor Profile Tags */}
        {flavorTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 mb-4">
            {flavorTags.map((tag) => (
              <span 
                key={tag} 
                onClick={() => onTagClick && onTagClick(tag)}
                className="px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full cursor-pointer hover:bg-indigo-200 transition-colors"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        
        {/* AI Review Section */}
        {wine.tastingNotes && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h3 className="text-md font-semibold text-gray-700 mb-2">Tasting Notes</h3>
            <p className="text-gray-600">
              {wine.tastingNotes} 
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
              {showSnippets ? 'Hide' : 'Show'} Other Reviews
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
  );
};

export default WineCard; 