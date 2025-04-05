// Wine model definition
export interface Wine {
  name: string;
  winery?: string;
  producer?: string;
  year?: string;
  vintage?: string;
  region?: string;
  grapeVariety?: string;
  varietal?: string;
  type?: string;
  imageUrl?: string;
  uploadedImageUrl?: string;
  rating?: {
    score: number;
    source?: string;
    review?: string;
  };
  additionalReviews?: Array<{
    source?: string;
    rating?: number;
    review?: string;
    text?: string;
  }> | string[];
  aiSummary?: string;
  score?: number;
  summary?: string;
  tastingNotes?: string;
  webSnippets?: string;
  pairings?: string[];
  estimatedPrice?: string;
  valueRatio?: number;
  valueAssessment?: string;
  flavorProfile?: {
    fruitiness?: number;
    acidity?: number;
    tannin?: number;
    body?: number;
    sweetness?: number;
    oak?: number;
  };
  isFromMenu?: boolean;
}

// Wine rating details
export interface WineRating {
  score: number;
  source: string;
  review?: string;
  price?: number;
  isPriceValue: boolean;
  profile?: Record<string, number>;
}

// API response from OpenAI/Serper processing
export interface AnalyzeWineResponse {
  success: boolean;
  message?: string;
  data?: {
    wines: Wine[];
  };
}

// Types for form state
export interface UploadState {
  isLoading: boolean;
  error: string | null;
  progress?: number;
  stage?: string;
}

// Preference settings
export interface PairingPreferences {
  meat: boolean;
  fish: boolean;
  sweet: boolean;
  dry: boolean;
  fruity: boolean;
  light: boolean;
  'full-bodied': boolean;
} 

// New user preference interface for recommendations
export interface UserPreferences {
  pairingType?: 'meat' | 'fish' | 'cheese' | 'dessert' | 'vegetarian' | '';
  maxPrice?: number;
  preferredStyle?: 'red' | 'white' | 'rose' | 'sparkling' | '';
}

// Enhanced recommendation structure
export interface WineRecommendation {
  wine: Wine;
  matchScore: number; // 1-100 score indicating how well it matches user preferences
  reasons: string[]; // Explanations for why this wine was recommended
}