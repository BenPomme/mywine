import { NextApiRequest, NextApiResponse } from 'next';
import { put } from '@vercel/blob';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define WineData type to fix type error
type WineData = {
  name: string;
  producer: string;
  vintage: string;
  region: string;
  varietal: string;
  type: string;
  score: number;
  summary: string;
  imageUrl: string;
  ratingSource: string;
  additionalReviews: Array<{source: string, review: string}>;
};

type AnalyzeRequestBody = {
  image: string;
};

type AnalyzeResponseData = {
  jobId: string;
  status: string;
  requestId?: string;
  message?: string;
  data?: {
    wines: WineData[];
    imageUrl: string;
  };
};

// Validate image format and extract base64 data
function validateAndExtractImageData(imageStr: string): string | null {
  if (!imageStr || typeof imageStr !== 'string') return null;
  
  // Handle data URLs (e.g., "data:image/jpeg;base64,/9j/4AAQ...")
  if (imageStr.startsWith('data:')) {
    const parts = imageStr.split(',');
    if (parts.length !== 2) return null;
    return parts[1];
  }
  
  // Handle raw base64 strings
  if (/^[A-Za-z0-9+/=]+$/.test(imageStr)) {
    return imageStr;
  }
  
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalyzeResponseData>
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      status: 'error', 
      message: 'Method not allowed',
      jobId: ''
    });
  }

  // Generate a request ID for logging
  const requestId = uuidv4();
  console.log(`[${requestId}] OpenAI-only analyze request received`);

  try {
    const { image } = req.body as AnalyzeRequestBody;

    if (!image) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'No image provided',
        jobId: '' 
      });
    }

    // Generate a unique job ID
    const jobId = uuidv4();
    console.log(`[${requestId}] Generated Job ID: ${jobId}`);

    // Validate and extract the base64 image data
    const imageData = validateAndExtractImageData(image);
    if (!imageData) {
      console.error(`[${requestId}] Invalid image data format`);
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid image data format. Expected base64 string or data URL',
        jobId 
      });
    }

    // Upload image to Blob storage
    console.log(`[${requestId}] [${jobId}] Uploading image to Vercel Blob...`);
    const buffer = Buffer.from(imageData, 'base64');
    
    // Upload the image to Vercel Blob storage
    const { url } = await put(`${jobId}.jpg`, buffer, {
      access: 'public',
    });
    
    console.log(`[${requestId}] [${jobId}] Image uploaded to Vercel Blob: ${url}`);

    // Create job record in KV
    await kv.hset(`job:${jobId}`, {
      status: 'processing',
      imageUrl: url,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestId
    });

    console.log(`[${requestId}] [${jobId}] Calling OpenAI Vision API...`);
    
    // Call OpenAI Vision API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content: "You are a wine expert assistant that can identify wines from images of bottles or labels. For each wine, provide detailed information including the producer/winery, name, vintage year, region, grape varieties, and any other relevant details visible in the image. If possible, estimate the wine's quality and provide tasting notes based on your knowledge of the wine."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify this wine from the image and provide details about it." },
            {
              type: "image_url",
              image_url: {
                url: url as string
              }
            }
          ]
        }
      ]
    });

    // Process OpenAI response with proper null checking
    const wineAnalysis = completion.choices[0]?.message?.content || '';
    console.log(`[${requestId}] [${jobId}] OpenAI analysis complete`);

    // Parse the analysis into structured data
    // This is a simplified parsing logic - you may want to improve this
    const wineData = parseWineDetails(wineAnalysis);
    
    // Store result in KV
    await kv.hset(`job:${jobId}`, {
      status: 'completed',
      data: {
        wines: [wineData],
        imageUrl: url,
        rawAnalysis: wineAnalysis
      },
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Return results immediately
    return res.status(200).json({
      jobId,
      status: 'completed',
      requestId,
      data: {
        wines: [wineData],
        imageUrl: url
      }
    });

  } catch (error: any) {
    console.error(`[${requestId}] Error analyzing wine:`, error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to analyze image',
      jobId: ''
    });
  }
}

// Helper function to parse the unstructured text from OpenAI into structured data
function parseWineDetails(analysisText: string): WineData {
  // Create a default structure
  const wineData: WineData = {
    name: '',
    producer: '',
    vintage: '',
    region: '',
    varietal: '',
    type: '',
    score: 0,
    summary: analysisText,
    imageUrl: '',
    ratingSource: 'AI Analysis',
    additionalReviews: []
  };

  // Extract producer/winery
  const producerMatch = analysisText.match(/(?:Producer|Winery|Maker):\s*([^,\n.]+)/i);
  if (producerMatch) wineData.producer = producerMatch[1].trim();

  // Extract name
  const nameMatch = analysisText.match(/(?:Name|Wine):\s*([^,\n.]+)/i);
  if (nameMatch) wineData.name = nameMatch[1].trim();
  
  // Extract vintage
  const vintageMatch = analysisText.match(/(?:Vintage|Year):\s*(\d{4})/i);
  if (vintageMatch) wineData.vintage = vintageMatch[1];

  // Extract region
  const regionMatch = analysisText.match(/(?:Region|Appellation):\s*([^,\n.]+)/i);
  if (regionMatch) wineData.region = regionMatch[1].trim();
  
  // Extract grape variety
  const varietalMatch = analysisText.match(/(?:Grape|Varietal|Variety):\s*([^,\n.]+)/i);
  if (varietalMatch) wineData.varietal = varietalMatch[1].trim();
  
  // Extract wine type
  const typeMatch = analysisText.match(/(?:Type):\s*(red|white|rosé|rose|sparkling|dessert)/i);
  if (typeMatch) wineData.type = typeMatch[1].trim();
  
  // Extract score if available
  const scoreMatch = analysisText.match(/(?:Rating|Score|Points):\s*(\d{1,2}(?:\.\d)?)\s*(?:\/\s*\d{1,3}|points)?/i);
  if (scoreMatch) {
    const scoreValue = parseFloat(scoreMatch[1]);
    // Normalize to a 100-point scale if needed
    if (scoreValue <= 5) {
      wineData.score = scoreValue * 20; // Convert 5-point scale to 100
    } else if (scoreValue <= 10) {
      wineData.score = scoreValue * 10; // Convert 10-point scale to 100
    } else if (scoreValue <= 20) {
      wineData.score = scoreValue * 5; // Convert 20-point scale to 100
    } else {
      wineData.score = scoreValue; // Already on 100-point scale
    }
  } else {
    // Estimate a score based on sentiment in the text
    const positiveTerms = ['excellent', 'outstanding', 'superb', 'exceptional', 'great', 'remarkable', 'fantastic'];
    const mediumTerms = ['good', 'nice', 'pleasant', 'enjoyable', 'decent', 'fine'];
    const negativeTerms = ['poor', 'disappointing', 'mediocre', 'bad', 'flawed'];
    
    let scoreEstimate = 85; // Default medium-high score
    
    for (const term of positiveTerms) {
      if (analysisText.toLowerCase().includes(term)) {
        scoreEstimate += 5;
        break;
      }
    }
    
    for (const term of mediumTerms) {
      if (analysisText.toLowerCase().includes(term)) {
        scoreEstimate = 80;
        break;
      }
    }
    
    for (const term of negativeTerms) {
      if (analysisText.toLowerCase().includes(term)) {
        scoreEstimate = 70;
        break;
      }
    }
    
    wineData.score = Math.min(100, scoreEstimate); // Cap at 100
  }

  // Extract tasting notes as reviews
  const tastingMatch = analysisText.match(/(?:Tasting Notes|Taste|Palate|Notes|Flavors):\s*([^.]+)/i);
  if (tastingMatch) {
    wineData.additionalReviews = [{
      source: 'AI Analysis',
      review: tastingMatch[1].trim()
    }];
  }

  return wineData;
} 